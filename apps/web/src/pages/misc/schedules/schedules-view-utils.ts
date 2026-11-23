import type { CronExecutionRecord, CronJobRecord } from '@openAwork/web-client';
import { formatTimestamp } from '../../../components/schedules/schedule-form-utils.js';

/**
 * 定时任务页视图的**纯计算**层（卡片视图 / 时间轴视图 / 概览卡共用）。
 *
 * 全部时间入参都是网关下发的 **epoch 毫秒**（`ScheduledTaskExecution.started_at`、
 * `CronJobRecord.nextFireAt` / `lastFiredAt` 均为 number）；本模块只做本地时区
 * 换算与分组，不发请求、不读全局状态，便于单测直接覆盖。
 */

/** 执行结果语义色（映射到 `schedules-*.css` 里的 tone class）。 */
type ScheduleTone = 'success' | 'danger' | 'running' | 'muted';

interface ExecutionStatusDescriptor {
  label: string;
  tone: ScheduleTone;
}

const EXECUTION_STATUS: Readonly<Record<CronExecutionRecord['status'], ExecutionStatusDescriptor>> =
  {
    completed: { label: '成功', tone: 'success' },
    failed: { label: '失败', tone: 'danger' },
    running: { label: '运行中', tone: 'running' },
    // 跳过 / 过期都不是失败：长任务的下一个 tick 被并发挡住是正常现象，
    // 用灰字呈现，否则会和「执行报错」长得一模一样。
    skipped: { label: '跳过', tone: 'muted' },
    expired: { label: '已过期', tone: 'muted' },
  };

export function describeExecutionStatus(
  status: CronExecutionRecord['status'],
): ExecutionStatusDescriptor {
  return EXECUTION_STATUS[status];
}

/** 时间轴分组桶；顺序即展示顺序。 */
type ScheduleDayBucket = 'today' | 'tomorrow' | 'week' | 'later' | 'unscheduled';

const SCHEDULE_DAY_BUCKETS: readonly ScheduleDayBucket[] = [
  'today',
  'tomorrow',
  'week',
  'later',
  'unscheduled',
];

export const SCHEDULE_BUCKET_META: Readonly<
  Record<ScheduleDayBucket, { title: string; note: string }>
> = {
  today: { title: '今天', note: '按本地时区' },
  tomorrow: { title: '明天', note: '按本地时区' },
  week: { title: '本周稍后', note: '7 天内' },
  later: { title: '更晚', note: '7 天及以后' },
  unscheduled: { title: '未排期 / 已停用', note: '启用后重新排期' },
};

interface ScheduleDayGroup {
  bucket: ScheduleDayBucket;
  jobs: CronJobRecord[];
}

interface SchedulesOverviewStats {
  total: number;
  enabled: number;
  running: number;
  /** 单次（`at`）任务数，用于概览卡的补充说明。 */
  singleShot: number;
  /** 今天（本地时区）尚未到点、且已启用的执行次数。 */
  todayUpcoming: number;
  /** 今天最近的一次待执行；没有则为 null。 */
  nextToday: { id: string; name: string; nextFireAt: number } | null;
  /** 最近一次执行失败的任务（详情用于顶部告警条）。 */
  failures: Array<{ id: string; name: string; lastFiredAt: number | null; error: string | null }>;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 本地时区当天 00:00 的 epoch 毫秒。 */
export function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 目标时间相对「今天」的**本地**日差：0 = 今天、1 = 明天、-1 = 昨天。 */
export function localDayDiff(targetMs: number, nowMs: number): number {
  return Math.round((startOfLocalDay(targetMs) - startOfLocalDay(nowMs)) / 86_400_000);
}

/** 任务是否已排期（启用且有下一次执行时间）。 */
function isScheduled(job: CronJobRecord): boolean {
  return job.status === 'enabled' && job.nextFireAt !== null;
}

export function bucketOf(job: CronJobRecord, nowMs: number): ScheduleDayBucket {
  if (!isScheduled(job) || job.nextFireAt === null) return 'unscheduled';
  const diff = localDayDiff(job.nextFireAt, nowMs);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return 'week';
  return 'later';
}

/**
 * 按本地日期分组并排序：桶顺序固定为今天 → 明天 → 本周稍后 → 更晚 → 未排期；
 * 已排期桶内按 `nextFireAt` 升序，未排期桶按名称排序（时间轴视图据此直接渲染）。
 */
export function groupByDay(jobs: readonly CronJobRecord[], nowMs: number): ScheduleDayGroup[] {
  const buckets = new Map<ScheduleDayBucket, CronJobRecord[]>();
  for (const bucket of SCHEDULE_DAY_BUCKETS) buckets.set(bucket, []);
  for (const job of jobs) {
    buckets.get(bucketOf(job, nowMs))?.push(job);
  }
  return SCHEDULE_DAY_BUCKETS.flatMap((bucket) => {
    const list = buckets.get(bucket) ?? [];
    if (list.length === 0) return [];
    const sorted = list.toSorted((left, right) => {
      if (bucket === 'unscheduled') return left.name.localeCompare(right.name, 'zh-Hans-CN');
      return (left.nextFireAt ?? 0) - (right.nextFireAt ?? 0);
    });
    return [{ bucket, jobs: sorted }];
  });
}

/** 24 小时轨道上的横向位置（0–1）；用于概览卡的「今天的执行分布」。 */
export function trackMarkRatio(ms: number): number {
  const date = new Date(ms);
  return (date.getHours() * 60 + date.getMinutes()) / 1440;
}

/**
 * 调度展示文案。
 *
 * `at`（单次）必须由**客户端本地时区**渲染：网关派生的 `scheduleDisplay` 用的是
 * 进程时区（Docker 常为 UTC），直接用会和同页历史时间差 8 小时。
 */
export function formatScheduleText(job: CronJobRecord): string {
  if (job.schedule_kind === 'at' && job.schedule_at !== null) {
    return formatTimestamp(job.schedule_at);
  }
  return job.scheduleDisplay;
}

/** `HH:mm`（本地时区）。 */
export function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 相对当前时刻的中文描述：`12 分钟后` / `3 小时前`；`null` → `已停用`。 */
export function formatRelativeToNow(ms: number | null, nowMs: number): string {
  if (ms === null) return '已停用';
  const diff = ms - nowMs;
  const suffix = diff < 0 ? '前' : '后';
  const absMs = Math.abs(diff);
  // 用原始毫秒判「不到 1 分钟」：先 round 会把 30 秒四舍五入成「1 分钟后」。
  if (absMs < 60_000) return `不到 1 分钟${suffix}`;
  const minutes = Math.round(absMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟${suffix}`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时${suffix}`;
  return `${Math.round(minutes / 1440)} 天${suffix}`;
}

/** 概览卡 KPI 与失败告警所需的一次性派生结果。 */
export function summarize(jobs: readonly CronJobRecord[], nowMs: number): SchedulesOverviewStats {
  const enabledJobs = jobs.filter((job) => job.status === 'enabled');
  const upcomingToday = enabledJobs
    .flatMap((job) =>
      job.nextFireAt !== null &&
      job.nextFireAt >= nowMs &&
      localDayDiff(job.nextFireAt, nowMs) === 0
        ? [{ id: job.id, name: job.name, nextFireAt: job.nextFireAt }]
        : [],
    )
    .sort((left, right) => left.nextFireAt - right.nextFireAt);

  return {
    total: jobs.length,
    enabled: enabledJobs.length,
    running: jobs.filter((job) => job.running === true).length,
    singleShot: jobs.filter((job) => job.schedule_kind === 'at').length,
    todayUpcoming: upcomingToday.length,
    nextToday: upcomingToday[0] ?? null,
    failures: jobs.flatMap((job) =>
      job.lastExecution?.status === 'failed'
        ? [
            {
              id: job.id,
              name: job.name,
              lastFiredAt: job.lastFiredAt,
              error: job.lastExecution.error ?? null,
            },
          ]
        : [],
    ),
  };
}
