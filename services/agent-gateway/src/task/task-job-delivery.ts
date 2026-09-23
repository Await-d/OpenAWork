import type { SubagentNoticeState } from '@openAwork/shared';
import { sqliteGet } from '../infra/db.js';
import { injectSyntheticSessionMessage } from '../message/synthetic-message-injection.js';
import { getAnyInFlightStreamRequestForSession } from '../routes/stream-cancellation.js';
import { toSubagentWireState } from './delegated-task-display.js';
import { completeBackground } from './task-job.js';
import { tryConsumeWakeBudget } from './task-wake-budget.js';

/**
 * 子代理完成结果的**单通道交付**。
 *
 * 对齐上游 opencode 的 `SubagentCompletion.deliver`：
 *   1. 先「准入」——幂等写入一条合成通知（`injectSyntheticSessionMessage`）；
 *   2. 再按 `resume` 与父会话繁忙度决定是否**唤醒**（`continueSessionFromHistory`）。
 *
 * 与旧路径（`appendParentTaskCompletionReminder` + `scheduleTaskParentAutoResume`）的关键差异：
 *   - 不再伪造用户请求；
 *   - 忙时**留库待消费**而非注册 800/1500ms 定时重试；
 *   - 通知已落库，因此「延后」永不丢——用户下一次自然发言时模型仍能看到它。
 *
 * 通知正文由 `formatSubagentNoticeText` 统一渲染为参考库的
 * `<subagent sessionID="..." state="..." description="...">…</subagent>` 标签形态，
 * 并带一道**长度防护**（`MAX_SUBAGENT_NOTICE_CHARS`）：`description` / `metadata`
 * 是客户端字段、不下发模型（见 `message-to-model-messages.ts`），因此来源信息
 * 必须写在正文里；超长正文截断并引导模型去子会话读全文。
 */

export type TaskJobWakeDeferReason =
  'budget-exhausted' | 'busy' | 'parent-paused' | 'resume-false' | 'wake-failed';

export type TaskJobWakeDecision =
  { action: 'wake' } | { action: 'defer'; reason: TaskJobWakeDeferReason };

/**
 * 纯决策函数：只依据事实判断「能否立即唤醒」。
 *
 * 规则对齐上游（`session.ts` 的 `resume` 布尔 + `restart.ts` 的挂起父会话处理）：
 *   - 调用方显式 `resume: false` → 只入库
 *   - 父会话已有在飞请求 → 忙（延后）
 *   - 父会话处于 running / paused → 延后
 *   - 其余 → 唤醒
 */
export function resolveTaskJobWakeDecision(facts: {
  hasInFlightStream: boolean;
  parentStateStatus: string | null;
  resume?: boolean;
}): TaskJobWakeDecision {
  if (facts.resume === false) {
    return { action: 'defer', reason: 'resume-false' };
  }
  if (facts.hasInFlightStream) {
    return { action: 'defer', reason: 'busy' };
  }
  if (facts.parentStateStatus === 'running' || facts.parentStateStatus === 'paused') {
    return { action: 'defer', reason: 'parent-paused' };
  }
  return { action: 'wake' };
}

/**
 * 通知身份：对同一 `(子会话, 任务更新时间)` 稳定，保证重复结算幂等。
 *
 * 用 `updatedAt` 参与构造，使「任务被恢复后再次终态」能产生**新的**通知，
 * 而同一终态的重复结算仍然是同一条。
 */
export function buildTaskJobNotificationId(input: {
  childSessionId: string;
  taskUpdatedAt: number;
}): string {
  return `task-job:${input.childSessionId}:${input.taskUpdatedAt}`;
}

/** 通知正文：错误信息优先，其次任务结果，再次结算摘要；保证非空（读取侧会过滤空正文）。 */
export function buildTaskJobNoticeText(input: {
  errorMessage?: string;
  result?: string;
  summary: string;
}): string {
  const primary = input.errorMessage?.trim() || input.result?.trim() || input.summary.trim() || '';
  return primary.length > 0 ? primary : '子代理执行已结束。';
}

/**
 * 通知正文上限（字符）。
 *
 * 参考库（`SubagentCompletion.deliver`）对通知正文不设上限；本上限是**额外防护**：
 * 子代理若把整段文件内容塞进最终回复，通知会把父会话上下文吃掉一大块。
 * 超出时截断并引导去子会话读全文（通知已落库，「留库待消费」语义不受影响）。
 */
const MAX_SUBAGENT_NOTICE_CHARS = 4_000;

/** `<subagent>` 标签属性净化：双引号 / 换行会破坏标签结构（参考库不净化，此处更严格）。 */
function sanitizeNoticeAttribute(value: string): string {
  return value.replace(/["\r\n]+/gu, ' ').trim();
}

/**
 * 把通知正文渲染为参考库的 `<subagent>` 标签形态：
 *
 *   `<subagent sessionID="..." state="..." description="...">\n{text}\n</subagent>`
 *
 * `state` 经 `toSubagentWireState` 映射为上游 wire 词表（`completed | error | cancelled`，
 * 参考库 `Job.Status`）；`metadata.state` 仍用本仓客户端契约词表（`done | failed | cancelled`）。
 * `description` 缺失时省略该属性（参考库工具必填，项目 `failed` 允许为空）。
 */
export function formatSubagentNoticeText(input: {
  childSessionId: string;
  description?: string;
  state: SubagentNoticeState;
  text: string;
}): string {
  const description = input.description ? sanitizeNoticeAttribute(input.description) : '';
  const body =
    input.text.length <= MAX_SUBAGENT_NOTICE_CHARS
      ? input.text
      : `${input.text.slice(0, MAX_SUBAGENT_NOTICE_CHARS)}\n\n[子代理完成通知过长，已截断 — 完整内容见子会话 sessionID: ${input.childSessionId}]`;

  return [
    `<subagent sessionID="${sanitizeNoticeAttribute(input.childSessionId)}" state="${toSubagentWireState(input.state)}"${
      description.length > 0 ? ` description="${description}"` : ''
    }>`,
    body,
    '</subagent>',
  ].join('\n');
}

export interface TaskJobDeliveryInput {
  /** 子会话 id（通知来源）。 */
  childSessionId: string;
  /** 通知短标签；`failed` 状态允许为空。 */
  description?: string;
  /** 通知身份；同时作为合成消息 id 与唤醒请求的幂等键。 */
  notificationId: string;
  /** 父会话 id（通知投递目标）。 */
  parentSessionId: string;
  /** 是否允许唤醒；`false` 表示只入库（对齐上游 `resume: false`）。 */
  resume?: boolean;
  state: SubagentNoticeState;
  /** 通知正文；必须非空，否则读取侧会过滤掉该消息。 */
  text: string;
  agent: string;
  userId: string;
}

export interface TaskJobDeliveryResult {
  created: boolean;
  deferReason?: TaskJobWakeDeferReason;
  messageId: string;
  wake: 'woken' | 'deferred' | 'skipped' | 'parent-missing';
}

export async function deliverTaskCompletion(
  input: TaskJobDeliveryInput,
): Promise<TaskJobDeliveryResult> {
  const parent = sqliteGet<{ state_status: string }>(
    'SELECT state_status FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.parentSessionId, input.userId],
  );
  if (!parent) {
    // 父会话已不存在（被删除）：清掉持久化通知，避免重启后反复尝试投递。
    completeBackground(input.notificationId);
    return { created: false, messageId: input.notificationId, wake: 'parent-missing' };
  }

  const injected = injectSyntheticSessionMessage({
    sessionId: input.parentSessionId,
    userId: input.userId,
    notificationId: input.notificationId,
    text: formatSubagentNoticeText({
      childSessionId: input.childSessionId,
      ...(input.description ? { description: input.description } : {}),
      state: input.state,
      text: input.text,
    }),
    ...(input.description ? { description: input.description } : {}),
    metadata: {
      source: 'subagent',
      childID: input.childSessionId,
      agent: input.agent,
      state: input.state,
    },
  });

  const decision = resolveTaskJobWakeDecision({
    hasInFlightStream: Boolean(
      getAnyInFlightStreamRequestForSession({
        sessionId: input.parentSessionId,
        userId: input.userId,
      }),
    ),
    parentStateStatus: parent.state_status,
    ...(input.resume !== undefined ? { resume: input.resume } : {}),
  });

  if (decision.action === 'defer') {
    // 只入库（resume:false）时通知已完整交付，可清持久化记录；
    // 忙导致的延后则保留记录，供重启恢复扫描补偿（T-19b-4）。
    if (decision.reason === 'resume-false') {
      completeBackground(input.notificationId);
    }
    return {
      created: injected.created,
      deferReason: decision.reason,
      messageId: injected.messageId,
      wake: decision.reason === 'resume-false' ? 'skipped' : 'deferred',
    };
  }

  // 唤醒预算门禁：只统计**真的要唤醒**的次数，防止「唤醒 → 又委派 → 再唤醒」的无界自激。
  // 预算耗尽时**仍然投递通知**（已入库），只是不唤醒——用户下一次自然发言时模型仍能看到它。
  if (!tryConsumeWakeBudget({ sessionId: input.parentSessionId, userId: input.userId })) {
    return {
      created: injected.created,
      deferReason: 'budget-exhausted',
      messageId: injected.messageId,
      wake: 'skipped',
    };
  }

  const { continueSessionFromHistory } = await import('../routes/stream-runtime.js');
  const result = await continueSessionFromHistory({
    clientRequestId: input.notificationId,
    sessionId: input.parentSessionId,
    userId: input.userId,
  });

  if (result.statusCode !== 200) {
    return {
      created: injected.created,
      deferReason: 'wake-failed',
      messageId: injected.messageId,
      wake: 'deferred',
    };
  }

  completeBackground(input.notificationId);
  return { created: injected.created, messageId: injected.messageId, wake: 'woken' };
}
