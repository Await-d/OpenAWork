/**
 * 消息频道的错误留痕入口。
 *
 * 背景：`channels/` 目录下原先**没有任何一处**把错误写库。失败只走
 * `channelLogWarn` + 内存 `Map`（`ChannelManager.statuses` /
 * `inboundDiagnostics`），进程重启即丢，排查时会出现「Web 没显示异常、IM 也没
 * 回消息」的黑洞。而 agent 内核层的失败（上游模型 / 流中断）虽已落
 * `message_v2`，**发生在用户消息落库之前**的 early-return（409 会话占用、
 * 模型绑定不可用、队列满、service 缺失）仍然是彻底丢失。
 *
 * 本模块提供三条互补的落库通道，调用方无需再各自拼 SQL：
 *
 *   1. {@link recordChannelRunFailure} —— 会话级。会话内某一轮 agent 运行失败：
 *      幂等补写缺失的 user / error 消息 + 标记 `sessions.last_error` + 写审计。
 *   2. {@link recordChannelHealthIssue} —— 频道级。服务启停、入站解析、队列
 *      拒绝、回复投递等**没有可用会话**的故障：写 `channel_health` + 写审计。
 *   3. {@link persistChannelInboundDiagnostic} —— 入站观测。成功与否都留一份，
 *      让「消息到底有没有进来」可跨重启回答。
 *
 * 三条不变式：
 *   - **不抛错**：落库是旁路，自身失败只记日志，绝不能反过来打断消息投递。
 *   - **幂等**：同一 `clientRequestId` 下已有 assistant 消息时不再补写第二条
 *     （内核可能已经落过）；user 消息同理，��免与 `persistStreamUserMessage`
 *     双写。
 *   - **不污染 prompt**：`status: 'error'` 的消息在
 *     `message-to-model-messages.ts` 被显式剔除，只对客户端可见。
 */

import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { writeAuditLog } from '../infra/audit-log.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import {
  appendSessionMessageV2,
  listSessionMessagesByRequestScope,
} from '../message/message-v2-adapter.js';
import type { ChannelStatus } from './types.js';

/** 错误来源，用于审计行分组与 `channel_health.last_error_source` 定位。 */
export type ChannelErrorSource =
  /** 会话内 agent 运行失败（含内核已落库后的渠道侧兜底文案）。 */
  | 'channel_run'
  /** 频道服务启动失败。 */
  | 'channel_start'
  /** 频道服务停止失败。 */
  | 'channel_stop'
  /** 自动重启失败。 */
  | 'channel_restart'
  /** 入站解析 / 鉴权 / 富化失败。 */
  | 'channel_inbound'
  /** 会话串行队列已满，消息被拒绝。 */
  | 'channel_queue'
  /** 回复投递（含错误通知本身）失败。 */
  | 'channel_delivery'
  /** 分发兜底失败。 */
  | 'channel_dispatch';

/** `source` → 审计行 `tool_name` 后缀（最终为 `channel:<value>`）。 */
const AUDIT_SOURCE_NAMES: Readonly<Record<ChannelErrorSource, string>> = {
  channel_run: 'CHANNEL_RUN_FAILED',
  channel_start: 'CHANNEL_START_FAILED',
  channel_stop: 'CHANNEL_STOP_FAILED',
  channel_restart: 'CHANNEL_RESTART_FAILED',
  channel_inbound: 'CHANNEL_INBOUND_FAILED',
  channel_queue: 'CHANNEL_QUEUE_REJECTED',
  channel_delivery: 'CHANNEL_DELIVERY_FAILED',
  channel_dispatch: 'CHANNEL_DISPATCH_FAILED',
};

/**
 * 错误摘要上限。落库字段与 `message_v2` 正文都可能被直接渲染到 UI 或喂给
 * 终端面板，无界写入既撑大 DB 又会把「第一行真正的错误」挤出视野。
 */
export const CHANNEL_ERROR_SUMMARY_MAX = 2_000;

/**
 * 堆栈截断上限。排障只需要栈顶的调用链，完整堆栈动辄几十 KB，写进 `output_json`
 * 会让每一行审计膨胀到其他错误类型的几十倍。
 */
export const CHANNEL_ERROR_STACK_MAX = 8_000;

interface ChannelHealthRow {
  readonly channel_id: string;
  readonly owner_user_id: string | null;
  readonly status: string | null;
  readonly last_error: string | null;
  readonly last_error_at: number | null;
  readonly last_error_source: string | null;
  readonly last_error_channel_type: string | null;
  readonly last_inbound_at: number | null;
  readonly last_inbound_accepted: number | null;
  readonly last_inbound_type: string | null;
  readonly last_inbound_error: string | null;
  readonly last_message_at: number | null;
  readonly last_message_chat_id: string | null;
  readonly updated_at: string;
}

export interface ChannelHealthRecord {
  readonly channelId: string;
  readonly ownerUserId: string | null;
  readonly status: string | null;
  readonly lastError: string | null;
  readonly lastErrorAt: number | null;
  readonly lastErrorSource: string | null;
  readonly lastErrorChannelType: string | null;
  readonly lastInboundAt: number | null;
  readonly lastInboundAccepted: boolean | null;
  readonly lastInboundType: string | null;
  readonly lastInboundError: string | null;
  readonly lastMessageAt: number | null;
  readonly lastMessageChatId: string | null;
  readonly updatedAt: string;
}

/** 落库结果的判定分支，供测试断言与调用方决定是否需要额外补偿。 */
export type ChannelFailureOutcome =
  /** 补写了错误消息（此前请求作用域内没有任何 assistant 消息）。 */
  | 'persisted'
  /** 内核已为该请求落过 assistant 消息，跳过补写（审计仍写）。 */
  | 'deduplicated';

export interface ChannelRunFailureInput {
  readonly channelId: string;
  /** 内核已落库但渠道侧仍需留痕时的补充说明，写入审计行。 */
  readonly detail?: string | undefined;
  readonly sessionId: string;
  readonly userId: string;
  readonly clientRequestId: string;
  /** 错误码，与 `[错误: CODE]` 前缀一同落库，供 UI 还原错误卡片。 */
  readonly code: string;
  readonly message: string;
  readonly stack?: string | undefined;
  /** 原始入站文本；缺失时不补写 user 消息（如仅图片附件）。 */
  readonly userMessageText?: string | undefined;
}

export interface ChannelHealthIssueInput {
  readonly channelId: string;
  readonly channelType?: string | undefined;
  readonly message: string;
  readonly ownerUserId?: string | undefined;
  /** 事件时间戳；缺省用当前时间。 */
  readonly occurredAt?: number;
  /** 关联会话（可空）。给了才会出现在 `/settings/diagnostics` 的会话维度里。 */
  readonly sessionId?: string | null | undefined;
  readonly source: ChannelErrorSource;
  readonly stack?: string | undefined;
  readonly status?: ChannelStatus | undefined;
  readonly requestId?: string | undefined;
}

function truncateErrorSummary(value: string): string {
  return value.length > CHANNEL_ERROR_SUMMARY_MAX
    ? `${value.slice(0, CHANNEL_ERROR_SUMMARY_MAX)}…（已截断）`
    : value;
}

function normalizeErrorMessage(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? truncateErrorSummary(trimmed) : '未知错误（异常未提供信息）';
}

function toErrorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * 与内核 `buildErrorContent` / `buildClientStreamErrorText` 完全同构：`[错误: CODE] 摘要`。
 * 保持同一形态才能被 `assistant-error-content-v2.ts` 还原成错误卡片，而不是退化成
 * 一个普通正文气泡。
 */
function buildChannelErrorText(code: string, message: string, detail?: string): string {
  const summary = message.trim();
  const suffix = detail && detail.trim() !== summary ? `\n\n技术详情：${detail.trim()}` : '';
  return `[错误: ${code}] ${summary}${suffix}`.trim();
}

function writeChannelErrorAudit(input: {
  readonly channelId: string;
  readonly channelType?: string | undefined;
  readonly code: string;
  readonly message: string;
  readonly output?: Record<string, unknown>;
  readonly requestId: string;
  readonly sessionId: string | null;
  readonly source: ChannelErrorSource;
  readonly stack?: string | undefined;
}): void {
  writeAuditLog({
    sessionId: input.sessionId,
    category: 'channel',
    sourceName: AUDIT_SOURCE_NAMES[input.source],
    requestId: input.requestId,
    isError: true,
    input: {
      channelId: input.channelId,
      ...(input.channelType ? { channelType: input.channelType } : {}),
      source: input.source,
    },
    output: {
      message: input.message,
      code: input.code,
      // `channelId` / `source` 同时冗余进 output：它们是排障的两个主检索维度，
      // 而排障页只解析 `output_json` 一列（`input_json` 承载的是写入上下文，
      // 字段会随实现演进，不能作为稳定契约）。
      channelId: input.channelId,
      source: input.source,
      ...(input.channelType ? { channelType: input.channelType } : {}),
      ...input.output,
      // 堆栈是事后回溯「当时为什么炸」的唯一持久化证据，与 stream 侧同策略。
      ...(input.stack ? { stack: truncateStack(input.stack) } : {}),
    },
  });
}

/** 堆栈按 `CHANNEL_ERROR_STACK_MAX` 截断，避免单行审计无限膨胀。 */
function truncateStack(stack: string): string {
  return stack.length > CHANNEL_ERROR_STACK_MAX
    ? `${stack.slice(0, CHANNEL_ERROR_STACK_MAX)}…（堆栈已截断）`
    : stack;
}

function upsertChannelHealthRow(input: {
  readonly channelId: string;
  readonly channelType?: string | undefined;
  readonly error: string | null;
  readonly errorAt: number | null;
  readonly errorSource: string | null;
  readonly ownerUserId: string | null;
  readonly status: string | null;
}): void {
  // `owner_user_id` 只在该频道已知归属时写入：频道配置存在 `user_settings`
  // 里、没有独立表，归属可能被更新；此处若被改动需要同步清理旧行，
  // 故仅在首次写入或归属确实变化时更新。
  sqliteRun(
    `INSERT INTO channel_health (
       channel_id, owner_user_id, status,
       last_error, last_error_at, last_error_source, last_error_channel_type
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel_id) DO UPDATE SET
       owner_user_id = COALESCE(excluded.owner_user_id, channel_health.owner_user_id),
       status = COALESCE(excluded.status, channel_health.status),
       last_error = COALESCE(excluded.last_error, channel_health.last_error),
       last_error_at = COALESCE(excluded.last_error_at, channel_health.last_error_at),
       last_error_source = COALESCE(excluded.last_error_source, channel_health.last_error_source),
       last_error_channel_type = COALESCE(
         excluded.last_error_channel_type,
         channel_health.last_error_channel_type
       ),
       updated_at = datetime('now')`,
    [
      input.channelId,
      input.ownerUserId,
      input.status,
      input.error,
      input.errorAt,
      input.errorSource,
      input.channelType ?? null,
    ],
  );
}

/**
 * 清空频道级错误快照（服务成功启动、或入站恢复正常后调用）。
 * 只清 `last_error*`，入站诊断与消息水位保留 —— 后者是观测数据不是故障。
 */
export function clearChannelHealthIssue(channelId: string): void {
  try {
    sqliteRun(
      `UPDATE channel_health
       SET last_error = NULL, last_error_at = NULL, last_error_source = NULL,
           updated_at = datetime('now')
       WHERE channel_id = ?`,
      [channelId],
    );
  } catch (error) {
    logGatewayWarn(`[channels] 清空频道健康快照失败：${toErrorText(error)}`);
  }
}

/**
 * 记录**没有可用会话**的频道级故障（启停 / 入站 / 队列 / 投递 / 分发）。
 *
 * 这类故障往往发生在会话创建之前，消息内容无处安放 —— 落 `channel_health`
 * 至少让「这条消息为什么没回」在重启后仍可回答；`sessionId` 传了就同时进审计。
 */
export function recordChannelHealthIssue(input: ChannelHealthIssueInput): void {
  const message = normalizeErrorMessage(input.message);
  const occurredAt = input.occurredAt ?? Date.now();
  const requestId = input.requestId ?? `channel:${input.channelId}:${occurredAt}`;

  try {
    upsertChannelHealthRow({
      channelId: input.channelId,
      ...(input.channelType ? { channelType: input.channelType } : {}),
      error: message,
      errorAt: occurredAt,
      errorSource: input.source,
      ownerUserId: input.ownerUserId ?? null,
      status: input.status ?? null,
    });
  } catch (error) {
    // 落库失败不能反过来打断消息投递，否则一次 DB 抖动会让故障从「记录不到」
    // 升级成「消息也发不出去」。
    logGatewayWarn(`[channels] 写入频道健康快照失败：${toErrorText(error)}`);
  }

  writeChannelErrorAudit({
    channelId: input.channelId,
    ...(input.channelType ? { channelType: input.channelType } : {}),
    code: AUDIT_SOURCE_NAMES[input.source],
    message,
    requestId,
    sessionId: input.sessionId ?? null,
    source: input.source,
    ...(input.stack ? { stack: input.stack } : {}),
  });
}

/**
 * 入站观测的写入节流窗口。
 *
 * `persistChannelInboundDiagnostic` 是同步 SQLite 写，而入站是高频路径
 * （Telegram polling 的高频群可达每秒数条）。这里原先只写内存 Map、零成本；
 * 改成落库后若不加节流，每次入站都是一次 commit，会明显拉长事件循环的同步
 * 阻塞。60s 足以让「消息到底有没有进来」在重启后仍可回答（时间戳精度对排障
 * 没有意义），又不会把写入放大到不可接受。
 */
export const CHANNEL_INBOUND_PERSIST_THROTTLE_MS = 60_000;

/** 各频道上次落库入站观测的时间；进程内状态，重启后自然清空并重新记录。 */
const lastInboundPersistAt = new Map<string, number>();

/**
 * 持久化入站观测。成功也写 —— 「消息有没有进来」本身就是要回答的问题，诊断的
 * 价值在于对照而非只记故障。与 `ChannelManager.inboundDiagnostics` 的内存快照
 * 互补，后者活不过一次重启。
 *
 * **节流**：成功入站按频道合并到 {@link CHANNEL_INBOUND_PERSIST_THROTTLE_MS}
 * 一次（首条必写）；**失败入站永远写** —— 那正是要查的东西，不能被合并掉。
 */
export function persistChannelInboundDiagnostic(input: {
  readonly accepted: boolean;
  readonly chatId?: string | undefined;
  readonly channelId: string;
  readonly channelType?: string | undefined;
  readonly error?: string | undefined;
  readonly eventType?: string | undefined;
  readonly occurredAt?: number;
  readonly ownerUserId?: string | undefined;
}): void {
  const occurredAt = input.occurredAt ?? Date.now();
  const isFailure = !input.accepted || Boolean(input.error);
  if (!isFailure) {
    const previous = lastInboundPersistAt.get(input.channelId);
    if (previous !== undefined && occurredAt - previous < CHANNEL_INBOUND_PERSIST_THROTTLE_MS) {
      return;
    }
  }
  lastInboundPersistAt.set(input.channelId, occurredAt);

  try {
    sqliteRun(
      `INSERT INTO channel_health (
         channel_id, owner_user_id, last_inbound_at, last_inbound_accepted,
         last_inbound_type, last_inbound_error, last_message_at, last_message_chat_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET
         owner_user_id = COALESCE(excluded.owner_user_id, channel_health.owner_user_id),
         last_inbound_at = excluded.last_inbound_at,
         last_inbound_accepted = excluded.last_inbound_accepted,
         last_inbound_type = COALESCE(excluded.last_inbound_type, channel_health.last_inbound_type),
         last_inbound_error = COALESCE(
           excluded.last_inbound_error,
           channel_health.last_inbound_error
         ),
         last_message_at = COALESCE(excluded.last_message_at, channel_health.last_message_at),
         last_message_chat_id = COALESCE(
           excluded.last_message_chat_id,
           channel_health.last_message_chat_id
         ),
         updated_at = datetime('now')`,
      [
        input.channelId,
        input.ownerUserId ?? null,
        occurredAt,
        input.accepted ? 1 : 0,
        input.eventType ?? null,
        input.error ? truncateErrorSummary(input.error) : null,
        input.chatId ? occurredAt : null,
        input.chatId ?? null,
      ],
    );
  } catch (error) {
    logGatewayWarn(`[channels] 写入频道入站诊断失败：${toErrorText(error)}`);
  }
}

/** 用错误摘要与时间标记会话，便于排查时区分「空闲」与「上一轮失败」。 */
function markSessionFailed(sessionId: string, userId: string, message: string): void {
  sqliteRun(
    `UPDATE sessions
     SET last_error = ?, last_error_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    [message, sessionId, userId],
  );
}

/**
 * 清空会话的失败标记。一轮成功即视为恢复 —— 否则 `last_error` 会永久钉住，
 * 让 `findReusableChannelSession` 把刚跑通的会话误判为不可复用。
 */
export function markChannelSessionHealthy(input: {
  readonly sessionId: string;
  readonly userId: string;
}): void {
  try {
    sqliteRun(
      `UPDATE sessions SET last_error = NULL, last_error_at = NULL
       WHERE id = ? AND user_id = ? AND last_error IS NOT NULL`,
      [input.sessionId, input.userId],
    );
  } catch (error) {
    logGatewayWarn(`[channels] 清空会话失败标记出错：${toErrorText(error)}`);
  }
}

/**
 * 记录会话内某一轮的失败。
 *
 * 与内核已有落库的差异决定了本函数的两个分支：
 *   - 内核在 `persistStreamUserMessage` 之后失败（模型 5xx / 流中断）：user 与
 *     error 消息都已落库，此处只补 `sessions.last_error` 与审计；
 *   - 内核在此之前 early-return（`SESSION_ALREADY_RUNNING`、模型绑定不可用、
 *     single-flight replay 拦截）：**user 消息也没落库**，此处一并补写，否则
 *     这条入站消息彻底消失。
 */
export function recordChannelRunFailure(input: ChannelRunFailureInput): ChannelFailureOutcome {
  const message = normalizeErrorMessage(input.message);
  let outcome: ChannelFailureOutcome = 'persisted';

  try {
    markSessionFailed(input.sessionId, input.userId, message);

    const scoped = listSessionMessagesByRequestScope({
      clientRequestId: input.clientRequestId,
      sessionId: input.sessionId,
      userId: input.userId,
    });
    const hasAssistant = scoped.some((entry) => entry.role === 'assistant');
    const hasUser = scoped.some((entry) => entry.role === 'user');

    if (!hasUser && input.userMessageText && input.userMessageText.trim().length > 0) {
      appendSessionMessageV2({
        sessionId: input.sessionId,
        userId: input.userId,
        role: 'user',
        content: [{ type: 'text', text: input.userMessageText }],
        clientRequestId: input.clientRequestId,
      });
    }

    if (hasAssistant) {
      // 内核已落过 assistant 消息（含它自己写的 error 卡片）：补写会造成重复气泡，
      // 且若是成功回合更不该被反写成失败。
      outcome = 'deduplicated';
    } else {
      appendSessionMessageV2({
        sessionId: input.sessionId,
        userId: input.userId,
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: buildChannelErrorText(input.code, message, input.detail),
          },
        ],
        clientRequestId: input.clientRequestId,
        status: 'error',
        replaceExisting: false,
      });
    }
  } catch (error) {
    // 消息补写失败不应吞掉审计与渠道侧的错误回推。
    logGatewayWarn(`[channels] 落库渠道失败消息出错：${toErrorText(error)}`);
    outcome = 'deduplicated';
  }

  writeChannelErrorAudit({
    channelId: input.channelId,
    code: input.code,
    message,
    requestId: input.clientRequestId,
    sessionId: input.sessionId,
    source: 'channel_run',
    ...(input.detail ? { output: { channelDetail: input.detail } } : {}),
    ...(input.stack ? { stack: input.stack } : {}),
  });

  return outcome;
}

/** 读取单个频道的持久化健康快照（无行时返回 null）。 */
export function getChannelHealthRecord(channelId: string): ChannelHealthRecord | null {
  const row = sqliteGet<ChannelHealthRow>(
    'SELECT * FROM channel_health WHERE channel_id = ? LIMIT 1',
    [channelId],
  );
  return row ? mapChannelHealthRow(row) : null;
}

/** 按归属列出频道健康快照，未指定 `ownerUserId` 时返回全部（管理/排障视角）。 */
export function listChannelHealthRecords(input?: {
  readonly ownerUserId?: string | undefined;
}): ChannelHealthRecord[] {
  const rows = input?.ownerUserId
    ? sqliteAll<ChannelHealthRow>(
        'SELECT * FROM channel_health WHERE owner_user_id = ? ORDER BY last_error_at DESC',
        [input.ownerUserId],
      )
    : sqliteAll<ChannelHealthRow>('SELECT * FROM channel_health ORDER BY last_error_at DESC');
  return rows.map(mapChannelHealthRow);
}

/** 删除频道时一并清理留痕，避免孤儿行在排障列表里长期堆积。 */
export function deleteChannelHealthRecord(channelId: string): void {
  sqliteRun('DELETE FROM channel_health WHERE channel_id = ?', [channelId]);
}

export interface ChannelErrorAuditRecord {
  readonly id: number;
  readonly sessionId: string | null;
  readonly requestId: string;
  readonly toolName: string;
  readonly channelId: string | null;
  readonly source: string | null;
  readonly message: string;
  readonly code: string | null;
  readonly stack: string | null;
  /** ISO 8601 UTC（含 `Z`）；来源非标准形态时原样透传。 */
  readonly createdAt: string;
}

/** 审计行里频道来源的 `tool_name` 前缀（`writeChannelErrorAudit` 统一加的）。 */
const CHANNEL_AUDIT_PREFIX = 'channel:';

/**
 * 列出某个用户的频道错误审计行。
 *
 * 归属判定沿用 `/settings/diagnostics` 的做法：按 `session_id` 关联 `sessions`
 * 取 `user_id`。**没有会话的频道级故障（启停 / 队列 / 投递）在这里查不到** ——
 * 那是刻意的：审计表无法证明归属，猜错会把 A 用户的故障暴露给 B 用户。这类记录
 * 在 `channel_health` 侧按 `owner_user_id` 提供完整可见性。
 */
export function listChannelErrorAuditLogs(
  userId: string,
  limit = 100,
): readonly ChannelErrorAuditRecord[] {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const rows = sqliteAll<{
    id: number;
    session_id: string | null;
    request_id: string;
    tool_name: string;
    output_json: string | null;
    created_at: string;
  }>(
    `SELECT a.id, a.session_id, a.request_id, a.tool_name, a.output_json, a.created_at
     FROM audit_logs a
     INNER JOIN sessions s ON s.id = a.session_id
     WHERE s.user_id = ? AND a.is_error = 1
       AND a.tool_name LIKE ?
     ORDER BY a.id DESC
     LIMIT ?`,
    [userId, `${CHANNEL_AUDIT_PREFIX}%`, boundedLimit],
  );

  return rows.map((row) => {
    const output = parseChannelAuditOutput(row.output_json);
    return {
      id: row.id,
      sessionId: row.session_id,
      requestId: row.request_id,
      toolName: row.tool_name,
      channelId: output.channelId,
      source: output.source,
      message: output.message,
      code: output.code,
      stack: output.stack,
      createdAt: toIsoUtc(row.created_at),
    };
  });
}

/**
 * SQLite `datetime('now')` 返回 `YYYY-MM-DD HH:MM:SS` 形态的 **UTC** 时间，且不带
 * 时区标记。前端 `new Date('2026-10-13 14:20:03')` 会把它当**本地时间**解析，
 * 展示时刻会随时区偏移几小时 —— 排障时「这条错误是什么时候发生的」偏掉几小时
 * 是致命的。
 *
 * 这里在出口统一补上 `Z`，让契约变成前端无需猜测的绝对时间（既有
 * `/settings/dev-logs` 端点有同样的偏差，但那是既有行为，不在本次改动范围内）。
 */
function toIsoUtc(sqliteDatetime: string): string {
  // 手改 / 非法值原样返回，交给前端 `Date.parse` 降级成 Invalid Date，
  // 好过在这里抛错让整个排障接口不可用。
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sqliteDatetime)
    ? `${sqliteDatetime.replace(' ', 'T')}Z`
    : sqliteDatetime;
}

/**
 * 清空某用户的频道错误留痕（健康快照 + 会话级审计行）。
 *
 * 会话归属的行靠 `sessions` 关联删除；`channel_health` 按 `owner_user_id` 删。
 * 返回被删除的行数，让调用方（HTTP 响应）能如实告知用户清了多少。
 */
export function clearChannelErrorRecords(userId: string): {
  clearedAuditRows: number;
  clearedHealthRows: number;
} {
  const auditBefore = sqliteGet<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM audit_logs a
     INNER JOIN sessions s ON s.id = a.session_id
     WHERE s.user_id = ? AND a.tool_name LIKE ?`,
    [userId, `${CHANNEL_AUDIT_PREFIX}%`],
  );
  sqliteRun(
    `DELETE FROM audit_logs
     WHERE tool_name LIKE ?
       AND session_id IN (SELECT id FROM sessions WHERE user_id = ?)`,
    [`${CHANNEL_AUDIT_PREFIX}%`, userId],
  );

  const healthBefore = sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM channel_health WHERE owner_user_id = ?',
    [userId],
  );
  sqliteRun('DELETE FROM channel_health WHERE owner_user_id = ?', [userId]);

  return {
    clearedAuditRows: auditBefore?.count ?? 0,
    clearedHealthRows: healthBefore?.count ?? 0,
  };
}

/**
 * 解析审计行的 `output_json`。
 *
 * 字段缺失一律降级为 null 而不是抛错：审计行是**排障数据**，读它时再抛异常
 * 会让排障入口本身不可用。堆栈已在写入侧按 `CHANNEL_ERROR_STACK_MAX` 截断，
 * 这里只做防御性兜底（防手改 / 早期版本写入的超长行）。
 */
function parseChannelAuditOutput(outputJson: string | null): {
  channelId: string | null;
  source: string | null;
  message: string;
  code: string | null;
  stack: string | null;
} {
  const fallback = {
    channelId: null,
    source: null,
    message: '（审计输出缺失，无法解析）',
    code: null,
    stack: null,
  };
  if (!outputJson) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputJson);
  } catch (error) {
    logGatewayWarn(`[channels] 解析频道审计行失败：${toErrorText(error)}`);
    return fallback;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return fallback;
  }

  const record = parsed as Record<string, unknown>;
  const readString = (key: string): string | null => {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  return {
    channelId: readString('channelId'),
    source: readString('source'),
    message: readString('message') ?? fallback.message,
    code: readString('code'),
    stack: readString('stack')?.slice(0, CHANNEL_ERROR_STACK_MAX) ?? null,
  };
}

function mapChannelHealthRow(row: ChannelHealthRow): ChannelHealthRecord {
  return {
    channelId: row.channel_id,
    ownerUserId: row.owner_user_id,
    status: row.status,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    lastErrorSource: row.last_error_source,
    lastErrorChannelType: row.last_error_channel_type,
    lastInboundAt: row.last_inbound_at,
    lastInboundAccepted:
      row.last_inbound_accepted === null ? null : row.last_inbound_accepted === 1,
    lastInboundType: row.last_inbound_type,
    lastInboundError: row.last_inbound_error,
    lastMessageAt: row.last_message_at,
    lastMessageChatId: row.last_message_chat_id,
    updatedAt: row.updated_at,
  };
}
