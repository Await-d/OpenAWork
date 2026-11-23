/**
 * 定时任务的可读展示派生（调度表达式 / 状态 / 下次触发）。
 *
 * 抽成独立模块供两处复用：HTTP `/cron/jobs`（Web 定时任务页）与 `schedule_manage`
 * 工具输出（模型自查）。此前 Web 端把网关的 snake_case 原始记录硬 cast 成
 * `CronJob`，`scheduleDisplay` / `status` / `fireCount` 全部缺失，页面上的
 * 「启用 / 禁用」按钮因此永不渲染——派生统一收口在这里，避免两端各写一份。
 */

import type { ScheduledTaskView } from '@openAwork/shared';
import type { CronExecutionRecord, CronJobRecord } from './types.js';

export type CronJobStatus = 'enabled' | 'disabled';

/** 人类可读的调度描述（对齐 `shared-ui` 的 `CronJob.scheduleDisplay`）。 */
export function formatScheduleDisplay(job: CronJobRecord): string {
  switch (job.schedule_kind) {
    case 'at':
      return typeof job.schedule_at === 'number'
        ? new Date(job.schedule_at).toLocaleString('zh-CN', { hour12: false })
        : '—';
    case 'every':
      return typeof job.schedule_every === 'number'
        ? `每 ${formatInterval(job.schedule_every)}`
        : '—';
    case 'cron':
      return job.schedule_expr ? `${job.schedule_expr}（${job.schedule_tz}）` : '—';
    default:
      return '—';
  }
}

function formatInterval(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000} 天`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} 小时`;
  if (ms % 60_000 === 0) return `${ms / 60_000} 分钟`;
  if (ms % 1000 === 0) return `${ms / 1000} 秒`;
  return `${ms} 毫秒`;
}

/**
 * 启停态。**不接受「运行中」**——见 `CronJobView.status` 的说明：把 running
 * 映射到 `status` 会让 `CronManager` 收起停用按钮。
 */
export function resolveCronJobStatus(job: CronJobRecord): CronJobStatus {
  return job.enabled ? 'enabled' : 'disabled';
}

/**
 * Web 定时任务页使用的视图模型：原始记录 + 派生展示字段。
 *
 * 保留全部原始字段（`...job`）以免破坏既有消费者；另外补一份**驼峰别名**，
 * 直接对齐 `shared-ui` 的 `CronJob` 接口（`scheduleKind` / `lastFiredAt` /
 * `nextFireAt` / `fireCount` / `scheduleDisplay` / `status`）——页面此前把这些
 * 字段当成已存在，实际全是 `undefined`，列表与操作按钮因此不可用。
 */
export type CronJobView = ScheduledTaskView;

export function toCronJobView(
  job: CronJobRecord,
  options: {
    readonly nextFireAt: number | null;
    readonly running?: boolean;
    readonly lastExecution?: CronExecutionRecord | null;
  },
): CronJobView {
  return {
    ...job,
    scheduleKind: job.schedule_kind,
    scheduleDisplay: formatScheduleDisplay(job),
    status: resolveCronJobStatus(job),
    running: options.running === true,
    fireCount: job.fire_count,
    lastFiredAt: job.last_fired_at,
    nextFireAt: options.nextFireAt,
    lastExecution: options.lastExecution ?? null,
  };
}
