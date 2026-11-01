/**
 * 渠道通知幂等出站（261101-记忆确认写入与周期整理）。
 *
 * 设计要点：
 * - 以 `memory_deliveries` 为唯一真相源，`(user_id, dedupe_key)` 唯一索引 +
 *   `INSERT OR IGNORE` 保证「通知重放不产生重复写入 / 重复骚扰」。
 * - **脱敏硬约束**：通知只允许「待确认数量 + 一句指引 + 链接路径」，绝不携带
 *   记忆正文 / key / value / 来源发送者名称。写库前统一过一遍清洗与截断。
 * - 发送侧走租约（`status='sending'` + `lease_owner` / `lease_expires_at`），
 *   崩溃遗留由 `recoverExpiredMemoryDeliveryLeases` 回收。
 */
import { randomUUID } from 'node:crypto';
import {
  sqliteAll,
  sqliteGet,
  sqliteRun,
  sqliteRunWithChanges,
  sqliteTransaction,
} from '../../infra/db.js';

/** 单行文本硬上限（防上游误传正文入通知的兜底）。 */
const MAX_LINE_LENGTH = 200;
/** 整条通知拼接文本硬上限。 */
const MAX_BODY_LENGTH = 500;
/** 通知标题固定文案。 */
const MEMORY_NOTIFICATION_TITLE = '有新的记忆待确认';
/** 单次领取的最大条数。 */
const MAX_CLAIM_LIMIT = 200;
/** 投递租约默认有效期：5 分钟。 */
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
/** 投递最大尝试次数，达上限置 failed。 */
const MAX_DELIVERY_ATTEMPTS = 5;
/** 投递退避上限：10 分钟。 */
const MAX_DELIVERY_BACKOFF_MS = 10 * 60 * 1000;
/** 投递退避基数：30 秒（`base * 2^(attempts-1)`）。 */
const DELIVERY_BACKOFF_BASE_MS = 30 * 1000;

export interface MemoryDeliveryBody {
  title: string;
  lines: readonly string[];
  href?: string | null;
}

export interface MemoryDeliveryRow {
  id: string;
  userId: string;
  channelInstanceId: string;
  chatId: string;
  body: MemoryDeliveryBody;
  dedupeKey: string;
  attempts: number;
}

export interface EnqueueMemoryNotificationInput {
  userId: string;
  channelInstanceId: string;
  chatId: string;
  dedupeKey: string;
  body: MemoryDeliveryBody;
  now?: Date;
}

export interface ClaimPendingMemoryDeliveriesInput {
  owner: string;
  limit: number;
  now: Date;
  leaseMs?: number;
}

export interface BuildMemoryDeliveryBodyInput {
  pendingProposalCount: number;
  reportCount: number;
  confirmPath: string;
}

interface MemoryDeliveryDbRow {
  id: string;
  user_id: string;
  channel_instance_id: string;
  chat_id: string;
  body_json: string;
  dedupe_key: string;
  attempts: number;
}

interface MemoryDeliveryCandidateRow {
  id: string;
  user_id: string;
  channel_instance_id: string;
  chat_id: string;
  body_json: string;
  dedupe_key: string;
  attempts: number;
}

function toIso(date: Date): string {
  return date.toISOString();
}

function isoOrNow(date: Date | undefined): string {
  return toIso(date ?? new Date());
}

/** 指数退避，上限 `MAX_DELIVERY_BACKOFF_MS`。 */
function computeDeliveryBackoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const raw = DELIVERY_BACKOFF_BASE_MS * 2 ** Math.min(exponent, 20);
  return Math.min(raw, MAX_DELIVERY_BACKOFF_MS);
}

/** 单行脱敏：折叠换行、截断到 `MAX_LINE_LENGTH`。 */
function sanitizeLine(line: string): string {
  return line
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
    .slice(0, MAX_LINE_LENGTH);
}

/** 合法链接路径：以 `/` 开头且不含空白，仅允许路径 / 查询字符。 */
const HREF_PATTERN = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#[\]]*$/;
/** 合法「待确认数量」指引行：只允许计数与固定指引文案。 */
const COUNT_LINE_PATTERN =
  /^(?:待确认的记忆提议\s*\d+\s*条(?:，整理报告\s*\d+\s*份)?。|请进入记忆确认页逐条确认。)$/;

/**
 * 清洗通知正文。
 *
 * 这是防止上游把记忆正文误塞进通知的最后一道闸门，两层防线：
 * 1) **内容白名单**：只放行「计数指引行」与「链接路径」，任何疑似正文 / key /
 *    value / 发送者名称的行一律丢弃（长度截断杀不掉语义泄漏）。
 * 2) 单行 200 字符、整条 500 字符硬截断（兜底防御）。
 */
function sanitizeDeliveryBody(body: MemoryDeliveryBody): MemoryDeliveryBody {
  const href = body.href ?? null;
  const safeHref =
    href !== null && href.length > 0 && HREF_PATTERN.test(href) ? sanitizeLine(href) : null;

  const allowedLines: string[] = [];
  for (const raw of body.lines) {
    const line = sanitizeLine(raw);
    if (line.length === 0 || line.length > MAX_LINE_LENGTH) {
      continue;
    }
    if (line === safeHref) {
      continue;
    }
    if (COUNT_LINE_PATTERN.test(line)) {
      allowedLines.push(line);
    }
  }

  const lines: string[] = [];
  let total = MEMORY_NOTIFICATION_TITLE.length;
  const push = (line: string): void => {
    if (total + line.length > MAX_BODY_LENGTH) {
      return;
    }
    lines.push(line);
    total += line.length;
  };
  if (safeHref !== null && safeHref.length <= MAX_LINE_LENGTH) {
    push(safeHref);
  }
  for (const line of allowedLines) {
    push(line);
  }

  return { title: MEMORY_NOTIFICATION_TITLE, lines, href: safeHref };
}

/** 幂等入队一条渠道通知；同 `dedupeKey` 重复入队是 no-op。 */
export function enqueueMemoryNotification(input: EnqueueMemoryNotificationInput): void {
  const nowIso = isoOrNow(input.now);
  const body = sanitizeDeliveryBody(input.body);
  sqliteRun(
    `INSERT OR IGNORE INTO memory_deliveries
       (id, user_id, channel_instance_id, chat_id, body_json, dedupe_key, status,
        attempts, next_attempt_at, lease_owner, lease_expires_at, last_error,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, ?)`,
    [
      randomUUID(),
      input.userId,
      input.channelInstanceId,
      input.chatId,
      JSON.stringify(body),
      input.dedupeKey,
      nowIso,
      nowIso,
      nowIso,
    ],
  );
}

/**
 * 领取待投递通知。
 *
 * 事务内逐行条件更新 `pending AND next_attempt_at <= now` → `sending`，
 * 写租约；`changes === 0` 的行说明被别的 worker 抢走，跳过不返回。
 */
export function claimPendingMemoryDeliveries(
  input: ClaimPendingMemoryDeliveriesInput,
): MemoryDeliveryRow[] {
  const limit = Math.max(1, Math.min(input.limit, MAX_CLAIM_LIMIT));
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  const nowIso = toIso(input.now);
  const leaseExpiresAt = toIso(new Date(input.now.getTime() + leaseMs));

  return sqliteTransaction(() => {
    const candidates = sqliteAll<MemoryDeliveryCandidateRow>(
      `SELECT id, user_id, channel_instance_id, chat_id, body_json, dedupe_key, attempts
         FROM memory_deliveries
        WHERE status = 'pending' AND next_attempt_at <= ?
        ORDER BY next_attempt_at ASC, created_at ASC
        LIMIT ?`,
      [nowIso, limit],
    );

    const claimed: MemoryDeliveryRow[] = [];
    for (const candidate of candidates) {
      const changes = sqliteRunWithChanges(
        `UPDATE memory_deliveries
            SET status = 'sending',
                lease_owner = ?,
                lease_expires_at = ?,
                attempts = attempts + 1,
                updated_at = ?
          WHERE id = ? AND status = 'pending'`,
        [input.owner, leaseExpiresAt, nowIso, candidate.id],
      );
      if (changes === 0) {
        continue;
      }

      claimed.push({
        id: candidate.id,
        userId: candidate.user_id,
        channelInstanceId: candidate.channel_instance_id,
        chatId: candidate.chat_id,
        body: JSON.parse(candidate.body_json) as MemoryDeliveryBody,
        dedupeKey: candidate.dedupe_key,
        attempts: candidate.attempts + 1,
      });
    }
    return claimed;
  });
}

/** 标记投递成功；按 `id + lease_owner` 条件。 */
export function completeMemoryDelivery(id: string, owner: string): boolean {
  const changes = sqliteRunWithChanges(
    `UPDATE memory_deliveries
        SET status = 'sent',
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_error = NULL,
            updated_at = ?
      WHERE id = ? AND lease_owner = ?`,
    [new Date().toISOString(), id, owner],
  );
  return changes > 0;
}

/**
 * 标记投递失败。
 *
 * `attempts >= MAX_DELIVERY_ATTEMPTS` → `failed`；否则回 `pending` 并把
 * `next_attempt_at` 按指数退避前移。返回是否成功（`id + lease_owner` 条件）。
 */
export function failMemoryDelivery(id: string, owner: string, error: string, now: Date): boolean {
  const row = sqliteGet<MemoryDeliveryDbRow>(
    'SELECT id, user_id, channel_instance_id, chat_id, body_json, dedupe_key, attempts FROM memory_deliveries WHERE id = ? AND lease_owner = ?',
    [id, owner],
  );
  if (row === undefined) {
    return false;
  }

  const nowIso = toIso(now);
  if (row.attempts >= MAX_DELIVERY_ATTEMPTS) {
    const changes = sqliteRunWithChanges(
      `UPDATE memory_deliveries
          SET status = 'failed',
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_error = ?,
              updated_at = ?
        WHERE id = ? AND lease_owner = ?`,
      [error, nowIso, id, owner],
    );
    return changes > 0;
  }

  const nextAttemptAt = toIso(new Date(now.getTime() + computeDeliveryBackoffMs(row.attempts)));
  const changes = sqliteRunWithChanges(
    `UPDATE memory_deliveries
        SET status = 'pending',
            next_attempt_at = ?,
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_error = ?,
            updated_at = ?
      WHERE id = ? AND lease_owner = ?`,
    [nextAttemptAt, error, nowIso, id, owner],
  );
  return changes > 0;
}

/** 回收租约过期的 sending 投递，返回回收条数。 */
export function recoverExpiredMemoryDeliveryLeases(now: Date): number {
  const nowIso = toIso(now);
  return sqliteRunWithChanges(
    `UPDATE memory_deliveries
        SET status = 'pending',
            next_attempt_at = ?,
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_error = 'lease_expired',
            updated_at = ?
      WHERE status = 'sending' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
    [nowIso, nowIso, nowIso],
  );
}

/**
 * 构造脱敏通知正文。
 *
 * 只含「待确认数量 + 一句指引 + 链接路径」，**不含任何记忆正文 / key / value /
 * 来源发送者名称**。
 */
export function buildMemoryDeliveryBody(input: BuildMemoryDeliveryBodyInput): MemoryDeliveryBody {
  const proposalCount = Math.max(0, Math.floor(input.pendingProposalCount));
  const reportCount = Math.max(0, Math.floor(input.reportCount));
  const lines = [`待确认的记忆提议 ${proposalCount} 条，整理报告 ${reportCount} 份。`];
  if (proposalCount > 0 || reportCount > 0) {
    lines.push('请进入记忆确认页逐条确认。');
  }
  return { title: MEMORY_NOTIFICATION_TITLE, lines, href: input.confirmPath };
}
