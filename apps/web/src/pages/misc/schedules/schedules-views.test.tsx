import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CronExecutionRecord, CronJobRecord } from '@openAwork/web-client';
import { formatTimestamp } from '../../../components/schedules/schedule-form-utils.js';
import { SchedulesCardGrid, type SchedulesCardGridProps } from './schedules-card-grid.js';
import { SchedulesOverview } from './schedules-overview.js';
import { SchedulesTimeline } from './schedules-timeline.js';
import type {
  SchedulesHistorySnapshot,
  SchedulesJobActions,
  SchedulesViewCommonProps,
} from './schedules-view-types.js';

/** 固定「现在」：2026-11-02 14:20 本地时区。 */
const NOW = new Date(2026, 10, 2, 14, 20).getTime();

function ms(month: number, day: number, hour: number, minute = 0): number {
  return new Date(2026, month - 1, day, hour, minute).getTime();
}

function job(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-a',
    name: '每日同步',
    schedule_kind: 'cron',
    schedule_at: null,
    schedule_every: null,
    schedule_expr: '0 9 * * *',
    schedule_tz: 'Asia/Shanghai',
    prompt: '同步今天的待办',
    enabled: true,
    delete_after_run: false,
    delivery_mode: 'desktop',
    delivery_target: null,
    last_fired_at: null,
    fire_count: 0,
    scheduleKind: 'cron',
    scheduleDisplay: '每天 9 点',
    status: 'enabled',
    running: false,
    fireCount: 0,
    lastFiredAt: null,
    nextFireAt: null,
    lastExecution: null,
    ...overrides,
  };
}

function actions(): SchedulesJobActions {
  return {
    busyJobId: null,
    onEnable: vi.fn(),
    onDisable: vi.fn(),
    onRunNow: vi.fn(),
    onDelete: vi.fn(),
    onDeliveryChange: vi.fn(),
    onOpenHistory: vi.fn(),
  };
}

function commonProps(overrides: Partial<SchedulesViewCommonProps> = {}): SchedulesViewCommonProps {
  return {
    jobs: [job()],
    nowMs: NOW,
    actions: actions(),
    historyView: null,
    historyJobId: null,
    onOpenSession: vi.fn(),
    emptyText: '暂无定时规则，点击上方「添加任务」创建第一个。',
    historyLimit: 5,
    ...overrides,
  };
}

/** 卡片视图比公共契约多一个必填 `density`（`SchedulesCardGridProps`）。 */
function cardProps(overrides: Partial<SchedulesCardGridProps> = {}): SchedulesCardGridProps {
  return { ...commonProps(), density: 'comfortable', ...overrides };
}

function failedExecution(): CronExecutionRecord {
  return {
    id: 'exec-failed',
    job_id: 'job-fail',
    status: 'failed',
    started_at: ms(11, 2, 10),
    finished_at: ms(11, 2, 10, 2),
    error: '模型调用超时（120s）',
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SchedulesOverview', () => {
  const failedJob = job({
    id: 'job-fail',
    name: '每周五周报',
    nextFireAt: null,
    lastFiredAt: ms(11, 2, 10),
    lastExecution: failedExecution(),
  });
  const runningToday = job({
    id: 'job-run',
    name: '服务健康巡检',
    running: true,
    nextFireAt: ms(11, 2, 14, 30),
  });
  const tomorrow = job({ id: 'job-tomorrow', name: '每日站会摘要', nextFireAt: ms(11, 3, 9) });

  it('给出四项 KPI，并把失败任务推到顶部告警条', () => {
    render(
      <SchedulesOverview
        jobs={[failedJob, runningToday, tomorrow]}
        nowMs={NOW}
        actions={actions()}
      />,
    );

    expect(screen.getByText('任务总数')).toBeTruthy();
    expect(screen.getByText('启用中')).toBeTruthy();
    expect(screen.getByText('今日还将执行')).toBeTruthy();
    expect(screen.getByText('最近失败')).toBeTruthy();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('1 个任务最近一次执行失败');
    expect(alert.textContent).toContain('每周五周报');
    expect(alert.textContent).toContain('模型调用超时（120s）');
    // 「今日还将执行」的补充说明取最近的一次待执行（14:30 的巡检）。
    expect(screen.getByText('最近：服务健康巡检 14:30')).toBeTruthy();
  });

  it('今天的执行轨道只标出尚未到点的任务', () => {
    const pastToday = job({ id: 'job-past', name: '已跑过', nextFireAt: ms(11, 2, 9) });
    const { container } = render(
      <SchedulesOverview
        jobs={[runningToday, pastToday, tomorrow]}
        nowMs={NOW}
        actions={actions()}
      />,
    );

    expect(container.querySelectorAll('.sch-track-mark')).toHaveLength(1);
  });

  it('没有失败任务时不渲染告警条', () => {
    render(<SchedulesOverview jobs={[tomorrow]} nowMs={NOW} actions={actions()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SchedulesCardGrid', () => {
  it('渠道任务只读展示投递方式，其余任务可就地改', () => {
    render(
      <SchedulesCardGrid
        {...cardProps({
          jobs: [
            job({ id: 'job-channel', name: '渠道任务', delivery_mode: 'channel' }),
            job({ id: 'job-desktop', name: '通知任务' }),
          ],
        })}
      />,
    );

    expect(screen.getByText('渠道回发')).toBeTruthy();
    // 两个任务里只有非渠道任务渲染投递下拉。
    expect(screen.getAllByRole('combobox', { name: '结果投递方式' })).toHaveLength(1);
  });

  it('放大显示下次执行倒计时，并给出绝对时间', () => {
    const next = NOW + 10 * 60_000;
    render(<SchedulesCardGrid {...cardProps({ jobs: [job({ nextFireAt: next })] })} />);

    expect(screen.getByText('10 分钟后')).toBeTruthy();
    expect(screen.getByText(`${formatTimestamp(next)} 执行`)).toBeTruthy();
  });

  it('把 density 透传到网格的 data-density（CSS 据此换档）', () => {
    const { container } = render(<SchedulesCardGrid {...cardProps({ density: 'compact' })} />);

    expect(container.querySelector('.sch-grid')?.getAttribute('data-density')).toBe('compact');
  });

  it('「执行历史」按钮把任务交给页面（不自行请求）', () => {
    const props = cardProps();
    render(<SchedulesCardGrid {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '执行历史' }));

    expect(props.actions.onOpenHistory).toHaveBeenCalledExactlyOnceWith('job-a', '每日同步');
  });

  it('历史命中当前任务时内联展开，可跳到执行现场', () => {
    const snapshot: SchedulesHistorySnapshot = {
      jobId: 'job-a',
      jobName: '每日同步',
      entries: [
        {
          id: 'exec-1',
          job_id: 'job-a',
          status: 'completed',
          started_at: ms(11, 2, 9),
          finished_at: ms(11, 2, 9, 1),
          session_id: 'sess-1',
          outputPreview: '今日要点：3 条待办',
        },
      ],
    };
    const props = cardProps({ historyView: snapshot });
    render(<SchedulesCardGrid {...props} />);

    expect(screen.getByText('今日要点：3 条待办')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看执行现场' }));
    expect(props.onOpenSession).toHaveBeenCalledExactlyOnceWith('sess-1');
  });

  it('列表为空时给出调用方指定的空态文案', () => {
    render(
      <SchedulesCardGrid {...cardProps({ jobs: [], emptyText: '没有符合筛选条件的任务。' })} />,
    );
    expect(screen.getByText('没有符合筛选条件的任务。')).toBeTruthy();
  });
});

describe('SchedulesTimeline', () => {
  it('按本地日差分组，未排期任务单独成组', () => {
    render(
      <SchedulesTimeline
        {...commonProps({
          jobs: [
            job({ id: 'job-today', name: '今晚归档', nextFireAt: ms(11, 2, 23, 30) }),
            job({ id: 'job-tomorrow', name: '每日站会摘要', nextFireAt: ms(11, 3, 9) }),
            job({ id: 'job-off', name: '夜间备份', status: 'disabled', nextFireAt: null }),
          ],
        })}
      />,
    );

    expect(screen.getByRole('region', { name: '今天' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '明天' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '未排期 / 已停用' })).toBeTruthy();
    // 时间列显示本地时钟；未排期任务没有时间点。
    expect(screen.getByText('23:30')).toBeTruthy();
    expect(screen.getAllByText('09:00')).toHaveLength(1);
  });

  it('分组头带当天日期与任务数', () => {
    render(
      <SchedulesTimeline {...commonProps({ jobs: [job({ nextFireAt: ms(11, 2, 23, 30) })] })} />,
    );

    const group = screen.getByRole('region', { name: '今天' });
    expect(group.textContent).toContain('11 月 2 日');
    expect(group.textContent).toContain('1 个任务');
  });
});
