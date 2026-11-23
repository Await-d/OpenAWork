import type { ScheduledTaskDefinition, ScheduledTaskExecution } from '@openAwork/shared';

export type { ScheduleKind, DeliveryMode } from '@openAwork/shared';
export type CronJobRecord = ScheduledTaskDefinition;
export type CronExecutionRecord = ScheduledTaskExecution;

/**
 * 执行上下文：handler 建好「本次执行会话」后回调，调度器据此把 `session_id`
 * 写进执行历史。
 *
 * 为什么需要：历史里本来就有 `session_id` 列，但此前从未写入，于是
 * `delivery_mode: 'none'` 的任务跑完之后，用户**没有任何入口**找到产出
 * （产出确实写进了 `cron:<任务名>` 会话，但界面上没有任何指针指向它）。
 * 这个回调让「执行历史 → 执行现场」成为一条可点的链路。
 *
 * 必须在**真正开始执行之前**调用（失败路径也要能记录现场）。
 */
export interface CronJobExecutionContext {
  reportSession(sessionId: string): void;
}

export type CronJobHandler = (
  job: CronJobRecord,
  context?: CronJobExecutionContext,
) => Promise<void>;
