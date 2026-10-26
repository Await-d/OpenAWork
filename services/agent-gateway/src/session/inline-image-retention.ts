/**
 * 会话级内联图片保留策略（最旧优先淘汰）。
 *
 * 背景：渠道入站图片会在入库前转成 base64 data URL（企业微信 / Discord / QQ
 * 的远程地址必须内联，否则多模态协议层拒绝整轮请求）。这些 data URL 落在
 * `part_v2.data` 与 `event_log` 的 part 快照里，随用户发图数量**线性增长**。
 * 请求侧的 `image-request-budget` 只在构建请求时剔除旧图，不碰存储，所以
 * 「活跃长会话」会无限变大。
 *
 * 本模块在**写入侧**兜底：每次用户消息带图落库后，统计该会话所有内联图片的
 * payload 总量；超过触发阈值就从**最旧**的开始删除图片 part，直到降到目标
 * 值以下（与请求侧预算同一语义：宁可丢旧图，也不让库无限增长）。
 *
 * 约束与取舍：
 *   - 只删「该消息还有其它 part」的图片，避免把消息清成空壳；
 *   - 删除走 `MessageEvents.PartRemoved` 事件（投影删 `part_v2` 行，同时由
 *     projector 清掉 `event_log` 里对应的 part 快照），不裸写 SQL；
 *   - best-effort：淘汰失败只 warn，绝不能让用户这条消息落库回滚。
 */

import { sqliteAll } from '../infra/db.js';
import { logGatewayInfo, logGatewayWarn } from '../infra/gateway-logger.js';
import { inlineImagePayloadBytes } from '../message/image-request-budget.js';
import { MessageEvents, emitEvent } from './sync-event.js';

/** 默认触发阈值（64 MiB）：超过后开始淘汰最旧的图片。 */
export const DEFAULT_SESSION_IMAGE_BUDGET_TRIGGER_BYTES = 64 * 1024 * 1024;
/** 默认目标值（32 MiB）：淘汰到该值以下才停手。 */
export const DEFAULT_SESSION_IMAGE_BUDGET_TARGET_BYTES = 32 * 1024 * 1024;

export interface SessionImageBudget {
  readonly triggerBytes: number;
  readonly targetBytes: number;
}

export interface SessionImagePruneResult {
  readonly removedCount: number;
  readonly removedBytes: number;
}

interface ImagePartRow {
  readonly id: string;
  readonly message_id: string;
  readonly data: string;
}

function resolveEnvBytes(name: string, fallback: number): number {
  const raw = globalThis.process?.env?.[name];
  if (raw === undefined || raw === null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

/**
 * 解析会话级图片预算；非正数视为禁用（与 `image-request-budget` 同口径）。
 * target 不得高于 trigger。
 */
export function resolveSessionImageBudget(): SessionImageBudget {
  const triggerBytes = resolveEnvBytes(
    'OPENAWORK_SESSION_IMAGE_BUDGET_TRIGGER_BYTES',
    DEFAULT_SESSION_IMAGE_BUDGET_TRIGGER_BYTES,
  );
  const targetBytes = resolveEnvBytes(
    'OPENAWORK_SESSION_IMAGE_BUDGET_TARGET_BYTES',
    DEFAULT_SESSION_IMAGE_BUDGET_TARGET_BYTES,
  );
  if (triggerBytes <= 0 || targetBytes <= 0) {
    return { triggerBytes: 0, targetBytes: 0 };
  }
  return { triggerBytes, targetBytes: Math.min(targetBytes, triggerBytes) };
}

/** 读取一张 part 的内联图片 payload 字节数；非内联图片返回 0。 */
function readInlineImageBytes(row: ImagePartRow): number {
  try {
    const part = JSON.parse(row.data) as { url?: unknown };
    return typeof part.url === 'string' ? inlineImagePayloadBytes(part.url) : 0;
  } catch {
    // 损坏行不参与淘汰（也不让整次写入失败）。
    return 0;
  }
}

function countPartsByMessage(sessionId: string): Map<string, number> {
  const rows = sqliteAll<{ message_id: string; count: number }>(
    'SELECT message_id, COUNT(*) AS count FROM part_v2 WHERE session_id = ? GROUP BY message_id',
    [sessionId],
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.message_id, Number(row.count ?? 0));
  }
  return counts;
}

/**
 * 淘汰该会话最旧的内联图片，返回实际删除数量与释放的 payload 字节。
 *
 * 调用方应处在写事务内（`persistStreamUserMessage` 的 `sqliteTransaction`），
 * 这样 `PartRemoved` 事件与消息落库共享同一次写锁。
 */
export function pruneSessionInlineImages(input: {
  sessionId: string;
  budget?: SessionImageBudget;
  /**
   * 本轮刚写入的消息：**永不淘汰**。
   *
   * 否则单轮图片就超过 target（例如一次粘贴多张超大图）时，会立刻把用户
   * 刚发的图删掉，下一轮模型什么也看不到——这比"超一点预算"糟糕得多。
   */
  excludeMessageId?: string;
}): SessionImagePruneResult {
  const budget = input.budget ?? resolveSessionImageBudget();
  if (budget.triggerBytes <= 0 || budget.targetBytes <= 0) {
    return { removedCount: 0, removedBytes: 0 };
  }

  const rows = sqliteAll<ImagePartRow>(
    `SELECT id, message_id, data FROM part_v2
      WHERE session_id = ? AND data LIKE '%"inputType":"input_image"%'
      ORDER BY time_created ASC, rowid ASC`,
    [input.sessionId],
  );
  if (rows.length === 0) {
    return { removedCount: 0, removedBytes: 0 };
  }

  const candidates = rows
    .map((row) => ({ row, bytes: readInlineImageBytes(row) }))
    .filter((candidate) => candidate.bytes > 0);
  if (candidates.length === 0) {
    return { removedCount: 0, removedBytes: 0 };
  }

  // 触发判断用**全部**图片（含本轮），是否可删再由候选列表决定。
  let totalBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);
  if (totalBytes <= budget.triggerBytes) {
    return { removedCount: 0, removedBytes: 0 };
  }

  const partCounts = countPartsByMessage(input.sessionId);
  let removedCount = 0;
  let removedBytes = 0;
  for (const { row, bytes } of candidates) {
    if (totalBytes <= budget.targetBytes) break;
    if (input.excludeMessageId !== undefined && row.message_id === input.excludeMessageId) {
      continue;
    }
    // 保留消息结构：只有一个 part 的消息不删（否则会变成空消息）。
    const partCount = partCounts.get(row.message_id) ?? 0;
    if (partCount <= 1) continue;

    emitEvent({
      definition: MessageEvents.PartRemoved,
      aggregateID: input.sessionId,
      data: {
        sessionID: input.sessionId,
        messageID: row.message_id,
        partID: row.id,
      },
    });
    partCounts.set(row.message_id, partCount - 1);
    totalBytes -= bytes;
    removedCount += 1;
    removedBytes += bytes;
  }

  return { removedCount, removedBytes };
}

/**
 * 写入侧入口：仅当本次落库的用户消息含内联图片时才做预算检查。
 *
 * 纯文本轮次直接跳过——否则每轮都要扫一遍该会话的 part 行（长会话可达数千行）。
 * 任何失败只 warn：淘汰是旁路，不能让用户消息落库失败。
 */
export function maybePruneSessionInlineImages(input: {
  sessionId: string;
  hasInlineImage: boolean;
  /** 本轮刚写入的消息：永不淘汰（见 `pruneSessionInlineImages`）。 */
  excludeMessageId?: string;
}): SessionImagePruneResult {
  if (!input.hasInlineImage) {
    return { removedCount: 0, removedBytes: 0 };
  }
  try {
    const result = pruneSessionInlineImages({
      sessionId: input.sessionId,
      ...(input.excludeMessageId ? { excludeMessageId: input.excludeMessageId } : {}),
    });
    if (result.removedCount > 0) {
      // 正常淘汰不是异常，用 info 级别，避免污染 warn/error 告警面。
      logGatewayInfo('[inline-image-retention] 已淘汰最旧的会话图片', {
        sessionId: input.sessionId,
        removedCount: result.removedCount,
        removedBytes: result.removedBytes,
      });
    }
    return result;
  } catch (error) {
    logGatewayWarn('[inline-image-retention] 会话图片淘汰失败（本轮继续）', {
      sessionId: input.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { removedCount: 0, removedBytes: 0 };
  }
}
