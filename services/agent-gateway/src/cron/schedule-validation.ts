/**
 * 定时任务配置的**写入期**校验，供 HTTP 路由（`router.ts`）与模型工具
 * （`schedule-admin-tools.ts`）共用。
 *
 * 为什么必须抽出来：两条入口此前各写一套——工具侧有 `assertScheduleConsistent`，
 * 路由侧只有 Zod 的字段类型检查。结果是 `POST /cron/jobs` 能建出
 * `schedule_kind: 'cron'` + `schedule_expr: null` 的任务：落库成功、界面显示
 * 「已启用」，但 `scheduleJob` 直接 return，任务永远不触发且没有任何错误。
 * 同一类问题还有：
 *  - `at` 缺 `schedule_at`、`every` 缺间隔；
 *  - 时区名拼错（`Asia/Shangai`）——解析器会静默回落 UTC，任务偏移 8 小时；
 *  - `delivery_mode: 'session'` 但没有目标会话。
 *
 * 这些都属于「写入时就该拒绝」的配置错误，不能留给运行期静默降级。
 */

import { isValidCronExpression, isValidTimeZone, nextCronFireAfter } from './cron-expression.js';
import { MAX_TIMER_DELAY_MS } from './scheduler.js';
import type { DeliveryMode, ScheduleKind } from './types.js';

/**
 * 固定间隔任务的最小间隔（HTTP 接口与 `schedule_manage` 工具共用）。
 *
 * 页面表单另外把下限提到 1 分钟（避免高频空转），接口层只拦「毫秒级」这种明显误填。
 */
export const MIN_SCHEDULE_EVERY_MS = 1_000;

export interface ScheduleValidationInput {
  readonly scheduleKind: ScheduleKind;
  readonly scheduleAt: number | null;
  readonly scheduleEvery: number | null;
  readonly scheduleExpr: string | null;
  /** 仅 `cron` 使用；`at` / `every` 忽略。 */
  readonly scheduleTimeZone?: string | null;
  readonly deliveryMode?: DeliveryMode | null;
  readonly deliveryTarget?: string | null;
  /** `delivery_mode: 'session'` 未显式给 target 时的兜底目标。 */
  readonly sessionId?: string | null;
  /**
   * 放行「已经过期的一次性任务」。
   *
   * 只给 PATCH 用：用户可能只是想改名字或停用一个早已过期的 `at` 任务，
   * 不该被「时间必须是未来」挡住。只要本次请求改动了 `schedule_kind` /
   * `schedule_at`，调用方就必须传 false，否则等于允许把任务改成死配置。
   */
  readonly allowExpiredAt?: boolean;
}

/**
 * 收集配置问题；空数组代表通过。
 *
 * 返回数组而不是直接抛错，是因为调用方形态不同：路由要转成 400 的 issues，
 * 工具要抛 `Error`。文案统一在这里维护，避免两端漂移。
 */
export function collectScheduleIssues(input: ScheduleValidationInput): string[] {
  const issues: string[] = [];

  if (input.scheduleKind === 'at') {
    if (typeof input.scheduleAt !== 'number' || !Number.isFinite(input.scheduleAt)) {
      issues.push('一次性任务必须提供 schedule_at（epoch 毫秒）。');
    } else if (input.allowExpiredAt !== true && input.scheduleAt <= Date.now()) {
      issues.push('一次性任务的 schedule_at 必须是未来时间（当前已过期）。');
    }
  } else if (input.scheduleKind === 'every') {
    if (
      typeof input.scheduleEvery !== 'number' ||
      !Number.isFinite(input.scheduleEvery) ||
      input.scheduleEvery < MIN_SCHEDULE_EVERY_MS
    ) {
      issues.push(`固定间隔任务必须提供不小于 ${MIN_SCHEDULE_EVERY_MS} 毫秒的 schedule_every。`);
    } else if (input.scheduleEvery > MAX_TIMER_DELAY_MS) {
      // 超过 32 位定时器上限的间隔会被运行时钳成 1ms（见 MAX_TIMER_DELAY_MS）。
      issues.push(
        `固定间隔任务的间隔不能超过 ${MAX_TIMER_DELAY_MS} 毫秒（约 24.8 天）；更长的周期请改用 cron 表达式。`,
      );
    }
  } else {
    const expr = input.scheduleExpr?.trim() ?? '';
    if (expr.length === 0) {
      issues.push('cron 调度必须提供 schedule_expr（5 段表达式）。');
    } else if (!isValidCronExpression(expr)) {
      issues.push(`schedule_expr "${expr}" 不是合法的 5 段 cron 表达式（分 时 日 月 周）。`);
    } else if (nextCronFireAfter(expr, input.scheduleTimeZone ?? 'UTC', Date.now()) === null) {
      // 语法合法但永远等不到：如 `0 0 30 2 *`（2 月没有 30 号）。旧行为是建臂
      // 失败后落一条 failed，任务却留在列表里显示「已启用」——写入期就拒绝更直接。
      issues.push(`schedule_expr "${expr}" 在可预见的 8 年内不会触发（请检查日期 / 月份组合）。`);
    }

    const timeZone = input.scheduleTimeZone?.trim() ?? '';
    if (timeZone.length === 0) {
      // 空串不等于「没填」：`schedule_tz` 的默认值在 schema 层是 `UTC`，能走到
      // 这里说明调用方显式传了空串，运行期会被当成 UTC——与用户意图无关。
      issues.push('cron 调度必须提供时区（例如 Asia/Shanghai；如需 UTC 请显式填写 UTC）。');
    } else if (!isValidTimeZone(timeZone)) {
      issues.push(`时区 "${timeZone}" 不是合法的 IANA 时区名（例如 Asia/Shanghai）。`);
    }
  }

  if (input.deliveryMode === 'session') {
    const target = input.deliveryTarget?.trim() || input.sessionId?.trim() || '';
    if (target.length === 0) {
      issues.push('投递到会话时必须提供 delivery_target（或绑定 session_id）。');
    }
  }

  return issues;
}

/** 断言配置合法；不合法时抛出的错误文案可直接展示给用户。 */
export function assertValidSchedule(input: ScheduleValidationInput): void {
  const issues = collectScheduleIssues(input);
  if (issues.length > 0) {
    throw new Error(issues.join(' '));
  }
}
