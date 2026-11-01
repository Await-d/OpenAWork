import { sqliteAll } from '../../infra/db.js';
import { logGatewayWarn } from '../../infra/gateway-logger.js';
import { channelManager } from '../../channels/manager.js';
import {
  listUnnotifiedMemoryMaintenanceReports,
  markMemoryMaintenanceReportsNotified,
} from '../governance/memory-job-store.js';
import {
  buildMemoryDeliveryBody,
  claimPendingMemoryDeliveries,
  completeMemoryDelivery,
  enqueueMemoryNotification,
  failMemoryDelivery,
  recoverExpiredMemoryDeliveryLeases,
  type MemoryDeliveryRow,
} from '../governance/memory-notification-outbox.js';
import {
  countPendingMemoryProposals,
  listMemoryProposals,
  markMemoryProposalsNotified,
} from '../governance/memory-proposal-store.js';

/**
 * 记忆治理渠道通知投递（261101-记忆确认写入与周期整理）。
 *
 * 两段职责：
 *   - `enqueuePendingMemoryNotifications`：把「有待确认提议 / 未通知报告」的用户，
 *     按天汇总成一条 outbox 记录。**只对私聊来源入队**——群里不通知，避免把私人
 *     记忆的存在感暴露到群聊；这类用户走设置页自己看。
 *   - `dispatchMemoryDeliveries`：领取 outbox 记录并真正发出。找不到渠道 / 渠道
 *     关闭 / 未运行一律视为失败（走退避重试），绝不谎报成功。
 *
 * **脱敏硬约束**：通知正文只含「数量 + 指引 + 链接」，绝不含记忆正文；正文由
 * `buildMemoryDeliveryBody` 统一构造，本模块不再往里塞任何条目内容。
 */

/** 单条发送超时（默认 10 秒）。 */
const DEFAULT_SEND_TIMEOUT_MS = 10_000;
/** 单轮投递最多处理条数。 */
const DEFAULT_DELIVERY_LIMIT = 20;
/** 单轮入队扫描的用户数上限。 */
const DEFAULT_ENQUEUE_LIMIT = 100;
/** 确认页路径。 */
const MEMORY_CONFIRM_PATH = '/settings?tab=memory';

function resolveSendTimeoutMs(): number {
  const raw = globalThis.process?.env['MEMORY_DELIVERY_SEND_TIMEOUT_MS'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_SEND_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SEND_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

/** UTC 日键 `YYYYMMDD`（dedupeKey 用）。 */
function utcDayCompact(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 公开 Web 基址。
 *
 * **未配置时返回 null**：宁可这次不发通知，也不伪造一个用户点不开的链接。
 */
function resolvePublicWebUrl(): string | null {
  const raw = globalThis.process?.env['OPENAWORK_PUBLIC_WEB_URL'];
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.replace(/\/+$/, '') : null;
}

/**
 * 通知正文里的链接。
 *
 * 只放**相对路径**：出站 outbox 的脱敏白名单（`HREF_PATTERN`）只接受以 `/` 开头、
 * 不含主机的路径——绝对 URL 会被清洗成 null（防上游把任意外链塞进通知）。基址
 * 只在「是否允许发通知」这一层作为开关使用，不进入正文。
 */
function memoryConfirmPath(): string {
  return MEMORY_CONFIRM_PATH;
}

interface PrivateProvenanceRow {
  channel_instance_id: string;
  chat_id: string;
}

/**
 * 某用户最近一条**私聊**渠道来源。
 *
 * 来源表本身不带 user_id，故经 `sessions.user_id` 关联。`chat_type='private'`
 * 是硬条件；未知/群一律不返回（下游据此不入队）。
 */
function readLatestPrivateProvenanceForUser(userId: string): PrivateProvenanceRow | null {
  const rows = sqliteAll<PrivateProvenanceRow>(
    `SELECT p.channel_instance_id, p.chat_id
       FROM memory_message_provenance p
       JOIN sessions s ON s.id = p.session_id
      WHERE s.user_id = ? AND p.chat_type = 'private'
      ORDER BY p.created_at DESC, p.rowid DESC
      LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** 有「待确认提议 / 未通知报告」的用户 id 列表（并集，去重）。 */
function listUsersWithPendingMemoryWork(limit: number): string[] {
  const rows = sqliteAll<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM (
       SELECT user_id FROM memory_proposals WHERE status = 'pending'
       UNION
       SELECT user_id FROM memory_maintenance_reports WHERE notified_at IS NULL
     )
     LIMIT ?`,
    [limit],
  );
  return rows.map((row) => row.user_id);
}

/**
 * 为待确认提议 / 未通知报告的用户入队渠道通知。
 *
 * 返回本轮实际入队的行数（重复入队 / 缺配置 / 无私聊来源都不计）。
 *
 * 幂等：`dedupeKey` 形如 `proposal-notify:<userId>:<yyyymmdd>`，每天每用户至多
 * 一条汇总；同一天重复调用被 outbox 唯一索引吸收。
 */
export async function enqueuePendingMemoryNotifications(input?: {
  now?: Date;
  limit?: number;
}): Promise<number> {
  const now = input?.now ?? new Date();
  const limit = input?.limit ?? DEFAULT_ENQUEUE_LIMIT;
  // 基址只作开关：未配置说明部署没有可点的记忆确认页，此时不入队（不伪造链接）。
  if (resolvePublicWebUrl() === null) {
    logGatewayWarn('[memory-delivery] 未配置 OPENAWORK_PUBLIC_WEB_URL，跳过本轮记忆通知入队');
    return 0;
  }

  const confirmPath = memoryConfirmPath();
  const dayKey = utcDayCompact(now);
  const userIds = listUsersWithPendingMemoryWork(limit);
  let enqueued = 0;

  for (const userId of userIds) {
    const pendingProposalCount = countPendingMemoryProposals(userId);
    const reportCount = listUnnotifiedMemoryMaintenanceReports(userId).length;
    if (pendingProposalCount === 0 && reportCount === 0) {
      continue;
    }

    const provenance = readLatestPrivateProvenanceForUser(userId);
    if (provenance === null) {
      // 无私聊来源：不入队（群里不通知，避免暴露隐私）。
      continue;
    }

    const body = buildMemoryDeliveryBody({ pendingProposalCount, reportCount, confirmPath });
    const dedupeKey = `proposal-notify:${userId}:${dayKey}`;
    const before = countDeliveriesForDedupe(userId, dedupeKey);
    enqueueMemoryNotification({
      userId,
      channelInstanceId: provenance.channel_instance_id,
      chatId: provenance.chat_id,
      dedupeKey,
      body,
      now,
    });
    if (countDeliveriesForDedupe(userId, dedupeKey) > before) {
      enqueued += 1;
    }
  }

  return enqueued;
}

function countDeliveriesForDedupe(userId: string, dedupeKey: string): number {
  const rows = sqliteAll<{ n: number }>(
    'SELECT COUNT(*) AS n FROM memory_deliveries WHERE user_id = ? AND dedupe_key = ?',
    [userId, dedupeKey],
  );
  return rows[0]?.n ?? 0;
}

export interface MemoryDeliveryDispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * 领取并投递 outbox 记录。
 *
 * 逐条独立：**一条失败绝不影响其他条**。渠道不可用时走 `failMemoryDelivery`
 * （attempts+1、退避重试），绝不把「没送到」当成成功。
 */
export async function dispatchMemoryDeliveries(input?: {
  owner?: string;
  limit?: number;
  now?: Date;
}): Promise<MemoryDeliveryDispatchResult> {
  const now = input?.now ?? new Date();
  const owner = input?.owner ?? 'memory-delivery-dispatcher';
  const limit = input?.limit ?? DEFAULT_DELIVERY_LIMIT;

  recoverExpiredMemoryDeliveryLeases(now);

  const rows = claimPendingMemoryDeliveries({ owner, limit, now });
  const result: MemoryDeliveryDispatchResult = {
    claimed: rows.length,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    await dispatchOne(row, owner, now, result);
  }
  return result;
}

async function dispatchOne(
  row: MemoryDeliveryRow,
  owner: string,
  now: Date,
  result: MemoryDeliveryDispatchResult,
): Promise<void> {
  try {
    const service = channelManager.getService(row.channelInstanceId);
    if (!service || !service.isRunning()) {
      // 找不到渠道 / 未运行：视为失败并退避重试，不谎报成功。
      failMemoryDelivery(row.id, owner, 'channel_unavailable', now);
      result.failed += 1;
      return;
    }

    const text = formatDeliveryText(row);
    await withTimeout(
      service.sendMessage(row.chatId, text),
      resolveSendTimeoutMs(),
      'channel_send_timeout',
    );

    completeMemoryDelivery(row.id, owner);
    markDeliveredWork(row, now);
    result.sent += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logGatewayWarn(`[memory-delivery] 投递失败：${message}`, {
      deliveryId: row.id,
      channelInstanceId: row.channelInstanceId,
    });
    failMemoryDelivery(row.id, owner, message, now);
    result.failed += 1;
  }
}

/** 把通知正文拼成一段纯文本（标题 + 逐行 + 链接）。 */
function formatDeliveryText(row: MemoryDeliveryRow): string {
  const lines = [row.body.title, ...row.body.lines];
  if (row.body.href && row.body.href.length > 0) {
    lines.push(row.body.href);
  }
  return lines.join('\n');
}

/** 发送成功后标记对应的提议 / 报告已通知，防止下一轮重复汇总。 */
function markDeliveredWork(row: MemoryDeliveryRow, now: Date): void {
  try {
    const proposalIds = listMemoryProposals(row.userId, {
      status: ['pending'],
      limit: 500,
    }).map((proposal) => proposal.id);
    markMemoryProposalsNotified(proposalIds);

    const reportIds = listUnnotifiedMemoryMaintenanceReports(row.userId, 500).map(
      (report) => report.id,
    );
    markMemoryMaintenanceReportsNotified(reportIds, now);
  } catch (error) {
    // 标记失败不能让「已成功发出」变成失败——那会触发重发同一条通知。
    logGatewayWarn(
      `[memory-delivery] 标记已通知失败（通知已发出）：${
        error instanceof Error ? error.message : String(error)
      }`,
      { deliveryId: row.id },
    );
  }
}

/** 超时包装：超时即 reject，交由调用方走失败路径。 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, reason: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(reason)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
