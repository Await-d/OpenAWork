import type { CronExecutionRecord, CronJobRecord } from '@openAwork/web-client';
import type { ScheduleDeliveryMode } from '../../../components/schedules/schedule-form-utils.js';

/**
 * 定时任务页各视图（概览 / 卡片 / 时间轴）共用的 props 契约。
 *
 * 单独成文件是为了让三个视图组件**只依赖同一份签名**：动作全部由页面从
 * `useSchedulesPage` 透传，视图自身不发请求、不改状态，避免三套实现漂移。
 */

/** 视图切换：卡片（状态优先）｜时间轴（节奏优先）。 */
export type SchedulesViewMode = 'cards' | 'timeline';

/**
 * 卡片密度（D-02）：舒适（信息完整，默认）｜紧凑（一屏放更多任务）。
 *
 * 只影响卡片视图的网格与留白；时间轴是单列竖排，不受密度影响，因此这个入参
 * 不在 `SchedulesViewCommonProps` 里，而是卡片视图自己的 props。
 */
export type SchedulesDensity = 'comfortable' | 'compact';

/** 页面透传给所有任务的统一动作集（与 `useSchedulesPage` 的 actions 同名同义）。 */
export interface SchedulesJobActions {
  /** 正在处理的任务 id（用于禁用按钮与「处理中」提示）。 */
  busyJobId: string | null;
  onEnable: (jobId: string) => void;
  onDisable: (jobId: string) => void;
  onRunNow: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onDeliveryChange: (jobId: string, mode: ScheduleDeliveryMode) => void;
  /** 请求某任务的执行历史（页面调 `handleHistory`，结果回落到 `historyView`）。 */
  onOpenHistory: (jobId: string, jobName: string) => void;
}

/** 执行历史的只读快照（与 `useSchedulesPage` 的 `historyView` 结构一致）。 */
export interface SchedulesHistorySnapshot {
  jobId: string;
  jobName: string;
  entries: CronExecutionRecord[];
}

/** 时间轴与概览卡共用的「当前时刻」入参：由页面注入，便于测试固定时间。 */
interface SchedulesClock {
  nowMs: number;
}

/**
 * 卡片视图与时间轴视图的公共 props：**必须完全一致**，否则同一个任务在两个视角
 * 下的行为会分叉（历史展开、投递可改性、空态文案都是从这里统一出去的）。
 */
export interface SchedulesViewCommonProps extends SchedulesClock {
  /** 已按当前筛选 + 排序处理过的任务列表。 */
  jobs: CronJobRecord[];
  actions: SchedulesJobActions;
  historyView: SchedulesHistorySnapshot | null;
  /** 正在拉取历史的任务 id（用于「正在加载执行历史…」）。 */
  historyJobId: string | null;
  onOpenSession: (sessionId: string) => void;
  emptyText: string;
  /** 网关只为最近若干条执行生成产出摘要；内联历史区据此出条数说明。 */
  historyLimit: number;
}
