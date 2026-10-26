/**
 * 定时任务的可读展示派生（调度表达式 / 状态 / 下次触发）。
 *
 * 抽成独立模块供两处复用：HTTP `/cron/jobs`（Web 定时任务页）与 `schedule_manage`
 * 工具输出（模型自查）。此前 Web 端把网关的 snake_case 原始记录硬 cast 成
 * `CronJob`，`scheduleDisplay` / `status` / `fireCount` 全部缺失，页面上的
 * 「启用 / 禁用」按钮因此永不渲染——派生统一收口在这里，避免两端各写一份。
 */

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
export interface CronJobView extends CronJobRecord {
  readonly scheduleKind: CronJobRecord['schedule_kind'];
  readonly scheduleDisplay: string;
  /**
   * 只表达启停态（`enabled` / `disabled`）。
   *
   * **刻意不把「正在运行」映射进 `status`**：`shared-ui` 的 `CronManager` 在
   * `status === 'running'` 时既隐藏「启用 / 禁用」按钮、又禁用「立即运行」
   * （`CronManager.tsx` 的 245 / 263 / 284 行）。若此处上报 running，任务一旦
   * 运行时间较长（单次上限 10 分钟）用户就**无法停用它**——「跑飞了想按停」
   * 恰好是最需要按钮在场的场景。运行中信息改由独立字段 `running` 提供，页面
   * 只用作提示，不动操作面。
   */
  readonly status: CronJobStatus;
  /** 该任务当前是否有一次执行在途（独立于 `status`，不影响按钮可用性）。 */
  readonly running: boolean;
  readonly fireCount: number;
  readonly lastFiredAt: number | null;
  readonly nextFireAt: number | null;
  /**
   * 最近一次执行（含失败原因）。列表页据此标出「上次失败」，不必再逐任务
   * 单独拉一次 history（N+1）。
   */
  readonly lastExecution: CronExecutionRecord | null;
}

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
