/**
 * Composer Queue Store — 会话待发队列的服务端持久化
 *
 * 背景：待发队列原先完全寄生在浏览器侧（Zustand + localStorage + IndexedDB），
 * 导致刷新、换浏览器、换设备（桌面端 ↔ Web）后条目不可见。改为落库后，
 * 网关成为唯一真相源，客户端只做乐观渲染 + 水合。
 *
 * 设计的三个要点：
 * 1. **幂等键复用客户端生成的 itemId**：与 `message/synthetic-message-injection.ts`
 *    一致——同一个 id 重复入队不会产生第二条，天然抵抗「入队请求重试 / 双标签页」。
 * 2. **只存附件元数据**：二进制 Blob 仍由客户端 IndexedDB 持有，避免为一个纯文本
 *    的排队功能引入文件上传 + 生命周期 GC。前端据此比对本地 Blob，对不上时回退为
 *    `requiresAttachmentRebind`，让用户重新选文件而不是静默丢附件。
 * 3. **归属用 `user_id` 而非 email**：与会话子域其它表（`session_entry` /
 *    `message_v2`）保持一致，且 email 可变更、不适合做约束键。
 *
 * 消费语义沿用「先落库、后唤醒」：是否发出由客户端依据会话空闲状态决定，
 * 本模块不注册任何定时重试。
 */

import {
  sqliteAll,
  sqliteGet,
  sqliteRun,
  sqliteRunWithChanges,
  sqliteTransaction,
} from '../infra/db.js';

/** 附件元数据（与前端 `AttachmentItem` 对齐，仅保留重建预览所需字段）。 */
export interface ComposerQueueAttachment {
  /**
   * 跨端存储引用：客户端入队后把附件上传到 `/sessions/:id/artifacts` 得到的 id。
   *
   * 有它，另一台设备水合时才能把二进制拉回去（`GET .../artifacts/:id/content`）；
   * 没有它，条目在这端只能退化成本地附件（取不到就标记需重新选择）。
   * 可选是刻意的：上传失败、旧版本客户端写入的条目都不带该字段。
   */
  artifactId?: string;
  id: string;
  name: string;
  sizeBytes: number;
  type: 'audio' | 'file' | 'image' | 'video';
}

export interface ComposerQueueItem {
  attachmentItems: ComposerQueueAttachment[];
  enqueuedAt: number;
  id: string;
  requiresAttachmentRebind: boolean;
  text: string;
}

interface ComposerQueueRow {
  attachment_items_json: string;
  enqueued_at: number;
  id: string;
  requires_attachment_rebind: number;
  text: string;
}

/** 单条队列消息的文本长度上限——与前端输入框的实际上限同量级，防止单行塞爆库。 */
export const COMPOSER_QUEUE_TEXT_MAX_LENGTH = 200_000;

/** 单条队列消息允许携带的附件数量上限。 */
export const COMPOSER_QUEUE_ATTACHMENT_MAX_COUNT = 32;

function normalizeAttachmentType(value: string): ComposerQueueAttachment['type'] {
  return value === 'image' || value === 'audio' || value === 'video' ? value : 'file';
}

/**
 * 解析落库的附件 JSON。
 *
 * 库里的 JSON 是历史写入的产物，可能来自旧版本客户端，因此这里做**收敛解析**而非
 * 抛错：单条脏数据不应让整条队列读取失败——最坏情况退化成「无附件」，用户仍能
 * 看到并发出文本。
 */
function parseAttachmentItems(raw: string): ComposerQueueAttachment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const attachments: ComposerQueueAttachment[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id : '';
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    if (id.length === 0 || name.length === 0) {
      continue;
    }
    const rawSize = candidate.sizeBytes;
    const rawArtifactId = candidate.artifactId;
    attachments.push({
      ...(typeof rawArtifactId === 'string' && rawArtifactId.length > 0
        ? { artifactId: rawArtifactId }
        : {}),
      id,
      name,
      sizeBytes: typeof rawSize === 'number' && Number.isFinite(rawSize) ? rawSize : 0,
      type: normalizeAttachmentType(typeof candidate.type === 'string' ? candidate.type : 'file'),
    });
  }
  return attachments;
}

function toComposerQueueItem(row: ComposerQueueRow): ComposerQueueItem {
  return {
    attachmentItems: parseAttachmentItems(row.attachment_items_json),
    enqueuedAt: row.enqueued_at,
    id: row.id,
    requiresAttachmentRebind: row.requires_attachment_rebind === 1,
    text: row.text,
  };
}

/**
 * 列出某会话的待发队列，按入队时间升序（FIFO）。
 *
 * 同时按 `session_id` 与 `user_id` 过滤：即便路由层已经做过归属校验，
 * 这里再带一次 `user_id` 可以避免调用方误传他人 sessionId 时发生越权读取。
 */
export function listComposerQueueItems(input: {
  sessionId: string;
  userId: string;
}): ComposerQueueItem[] {
  const rows = sqliteAll<ComposerQueueRow>(
    `SELECT id, text, attachment_items_json, requires_attachment_rebind, enqueued_at
       FROM session_composer_queue
      WHERE session_id = ? AND user_id = ?
      ORDER BY enqueued_at ASC, rowid ASC`,
    [input.sessionId, input.userId],
  );
  return rows.map(toComposerQueueItem);
}

/**
 * 入队一条待发消息（幂等）。
 *
 * `itemId` 由客户端生成并作为唯一主键：重复提交同一条不会重复入库，调用方可
 * 无脑重试。已存在时**不覆盖**——这样「入队 → 响应丢包 → 重试」不会把条目重置到
 * 队尾，破坏 FIFO 顺序。
 */
export function enqueueComposerQueueItem(input: {
  attachmentItems: ComposerQueueAttachment[];
  enqueuedAt: number;
  itemId: string;
  requiresAttachmentRebind: boolean;
  sessionId: string;
  text: string;
  userId: string;
}): { created: boolean; item: ComposerQueueItem } {
  const attachmentItems = input.attachmentItems.slice(0, COMPOSER_QUEUE_ATTACHMENT_MAX_COUNT);
  const existing = sqliteGet<ComposerQueueRow>(
    `SELECT id, text, attachment_items_json, requires_attachment_rebind, enqueued_at
       FROM session_composer_queue
      WHERE id = ? AND session_id = ? AND user_id = ?
      LIMIT 1`,
    [input.itemId, input.sessionId, input.userId],
  );
  if (existing) {
    return { created: false, item: toComposerQueueItem(existing) };
  }

  sqliteRun(
    `INSERT INTO session_composer_queue
       (id, session_id, user_id, text, attachment_items_json, requires_attachment_rebind, enqueued_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [
      input.itemId,
      input.sessionId,
      input.userId,
      input.text.slice(0, COMPOSER_QUEUE_TEXT_MAX_LENGTH),
      JSON.stringify(attachmentItems),
      input.requiresAttachmentRebind ? 1 : 0,
      input.enqueuedAt,
    ],
  );

  // 以 `created` 表达「本次是否真新建」：ON CONFLICT 命中时回读既有行，
  // 让调用方拿到的是库里的权威内容而非本次提交的入参。
  const persisted = sqliteGet<ComposerQueueRow>(
    `SELECT id, text, attachment_items_json, requires_attachment_rebind, enqueued_at
       FROM session_composer_queue
      WHERE id = ? LIMIT 1`,
    [input.itemId],
  );
  if (!persisted) {
    // 理论上不可达（仅在并发删除命中时发生）；返回入参构造的等价视图，
    // 保证调用方不会因为一次竞态而丢掉刚入队的条目。
    return {
      created: true,
      item: {
        attachmentItems,
        enqueuedAt: input.enqueuedAt,
        id: input.itemId,
        requiresAttachmentRebind: input.requiresAttachmentRebind,
        text: input.text.slice(0, COMPOSER_QUEUE_TEXT_MAX_LENGTH),
      },
    };
  }
  return { created: true, item: toComposerQueueItem(persisted) };
}

/** 按 id 读取单条待发消息；不存在或不属于该会话 / 用户时返回 null。 */
export function getComposerQueueItem(input: {
  itemId: string;
  sessionId: string;
  userId: string;
}): ComposerQueueItem | null {
  const row = sqliteGet<ComposerQueueRow>(
    `SELECT id, text, attachment_items_json, requires_attachment_rebind, enqueued_at
       FROM session_composer_queue
      WHERE id = ? AND session_id = ? AND user_id = ?
      LIMIT 1`,
    [input.itemId, input.sessionId, input.userId],
  );
  return row ? toComposerQueueItem(row) : null;
}

/**
 * 回填条目的附件元数据（客户端把跨端副本上传成功后写入 `artifactId`），
 * 可选地同时清除「需重新选择附件」标记。
 *
 * 只更新附件 JSON 与 rebind 两列：文本、入队时间与 claim 租约都不受影响——上传通常
 * 在入队后几百毫秒内完成，而此刻另一端可能已经抢到发送权，动 claim 字段会破坏租约互斥。
 * 条目不存在（已被消费 / 移出）时返回 null，调用方据此回收刚上传的孤儿副本。
 */
export function updateComposerQueueItemAttachments(input: {
  attachmentItems: ComposerQueueAttachment[];
  itemId: string;
  requiresAttachmentRebind?: boolean;
  sessionId: string;
  userId: string;
}): ComposerQueueItem | null {
  const existing = getComposerQueueItem(input);
  if (!existing) {
    return null;
  }
  const attachmentItems = input.attachmentItems.slice(0, COMPOSER_QUEUE_ATTACHMENT_MAX_COUNT);
  // 未显式传值时保持原状：附件回填与 rebind 标记是两个独立事实，不互相隐式覆盖。
  const requiresAttachmentRebind =
    input.requiresAttachmentRebind ?? existing.requiresAttachmentRebind;
  sqliteRun(
    `UPDATE session_composer_queue
        SET attachment_items_json = ?, requires_attachment_rebind = ?
      WHERE id = ? AND session_id = ? AND user_id = ?`,
    [
      JSON.stringify(attachmentItems),
      requiresAttachmentRebind ? 1 : 0,
      input.itemId,
      input.sessionId,
      input.userId,
    ],
  );
  return { ...existing, attachmentItems, requiresAttachmentRebind };
}

/** 移除单条待发消息（移出队列 / 恢复回输入框）。返回是否确实删掉了行。 */
export function removeComposerQueueItem(input: {
  itemId: string;
  sessionId: string;
  userId: string;
}): boolean {
  return (
    sqliteRunWithChanges(
      'DELETE FROM session_composer_queue WHERE id = ? AND session_id = ? AND user_id = ?',
      [input.itemId, input.sessionId, input.userId],
    ) > 0
  );
}

/** 清空某会话的待发队列，返回删除条数。 */
export function clearComposerQueue(input: { sessionId: string; userId: string }): number {
  return sqliteRunWithChanges(
    'DELETE FROM session_composer_queue WHERE session_id = ? AND user_id = ?',
    [input.sessionId, input.userId],
  );
}

/** 待发队列条数——供会话删除 / 压缩路径判断是否还有残留。 */
export function countComposerQueueItems(input: { sessionId: string; userId: string }): number {
  const row = sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM session_composer_queue WHERE session_id = ? AND user_id = ?',
    [input.sessionId, input.userId],
  );
  return row?.count ?? 0;
}

/**
 * 默认消费租约时长。
 *
 * 取 60s 是权衡两端：必须显著长于一次正常发送（通常 <5s），否则另一端会在发送途中
 * 抢到租约造成重复；又不能太长，否则客户端崩溃/断网后条目要卡很久才能被别的端接手。
 */
export const COMPOSER_QUEUE_CLAIM_LEASE_MS = 60_000;

export interface ComposerQueueClaimResult {
  claimed: boolean;
  itemId: string;
}

/** 租约时长上下限——客户端传 0 或超大值都会让互斥语义失效，故在此夹紧。 */
const CLAIM_LEASE_MIN_MS = 5_000;
const CLAIM_LEASE_MAX_MS = 5 * 60_000;

function clampLeaseMs(leaseMs: number): number {
  if (!Number.isFinite(leaseMs)) {
    return COMPOSER_QUEUE_CLAIM_LEASE_MS;
  }
  return Math.min(CLAIM_LEASE_MAX_MS, Math.max(CLAIM_LEASE_MIN_MS, Math.trunc(leaseMs)));
}

/**
 * 原子 claim 一条待发消息，独占其发送权。
 *
 * **为什么需要它**：队列在服务端，而「判断空闲 → 发送」发生在客户端。同一会话被多端
 * （桌面端 ↔ Web）或同机多标签页打开时，各端都水合到了同一条待发消息，会各自把它发
 * 一遍——用户看到的是同一条消息被重复发送。claim 把互斥下沉到数据库：一条 UPDATE 的
 * WHERE 里同时判定「未被他人持有」与「自己的持有可续期」，天然原子，不依赖事务隔离级别。
 *
 * 三个细节：
 * 1. `claimed_by = ?` 也算命中——同一客户端重试（网络抖动导致响应丢失）能续自己的租约，
 *    不会把自己锁死；
 * 2. 租约过期（`claimed_until <= now`）即可被抢占，防止持权方崩溃后条目永久卡死；
 * 3. 返回 false **不是错误**，而是「别人正在处理」，调用方应跳过而非重试。
 */
export function claimComposerQueueItem(input: {
  clientId: string;
  itemId: string;
  leaseMs: number;
  now: number;
  sessionId: string;
  userId: string;
}): boolean {
  return (
    claimComposerQueueItems({
      ...input,
      itemIds: [input.itemId],
    })[0]?.claimed === true
  );
}

export function claimComposerQueueItems(input: {
  clientId: string;
  itemIds: readonly string[];
  leaseMs: number;
  now: number;
  sessionId: string;
  userId: string;
}): ComposerQueueClaimResult[] {
  const itemIds = [...new Set(input.itemIds)];
  if (itemIds.length === 0) {
    return [];
  }

  const leaseMs = clampLeaseMs(input.leaseMs);
  return sqliteTransaction(() =>
    itemIds.map((itemId) => ({
      claimed:
        sqliteRunWithChanges(
          `UPDATE session_composer_queue
              SET claimed_by = ?, claimed_until = ?
            WHERE id = ? AND session_id = ? AND user_id = ?
              AND (claimed_by IS NULL
                   OR claimed_until IS NULL
                   OR claimed_until <= ?
                   OR claimed_by = ?)`,
          [
            input.clientId,
            input.now + leaseMs,
            itemId,
            input.sessionId,
            input.userId,
            input.now,
            input.clientId,
          ],
        ) > 0,
      itemId,
    })),
  );
}

/**
 * 释放 claim——发送失败时调用，把条目交还给队列。
 *
 * 谓词里带 `claimed_by = ?`：只有当前持有者能释放，避免「A 失败释放时 B 已经抢到租约」
 * 这种交错把 B 的锁误删。
 */
export function releaseComposerQueueItem(input: {
  clientId: string;
  itemId: string;
  sessionId: string;
  userId: string;
}): boolean {
  return (
    sqliteRunWithChanges(
      `UPDATE session_composer_queue
          SET claimed_by = NULL, claimed_until = NULL
        WHERE id = ? AND session_id = ? AND user_id = ? AND claimed_by = ?`,
      [input.itemId, input.sessionId, input.userId, input.clientId],
    ) > 0
  );
}
