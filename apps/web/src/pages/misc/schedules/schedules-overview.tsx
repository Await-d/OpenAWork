import type { CronJobRecord } from '@openAwork/web-client';
import { formatTimestamp } from '../../../components/schedules/schedule-form-utils.js';
import type { SchedulesJobActions } from './schedules-view-types.js';
import { formatClock, localDayDiff, summarize, trackMarkRatio } from './schedules-view-utils.js';
import './schedules-overview.css';

/**
 * 概览卡：结论先行 —— KPI ×4 + 今天的执行分布（24 小时轨道）+ 失败告警条。
 *
 * 数据全部由 `jobs` + `nowMs` 本地派生（`summarize` / `trackMarkRatio`），
 * 不额外发请求；`nowMs` 由页面注入，便于测试固定时间。
 */
export function SchedulesOverview({
  jobs,
  nowMs,
  actions,
}: {
  jobs: CronJobRecord[];
  nowMs: number;
  actions: SchedulesJobActions;
}) {
  const stats = summarize(jobs, nowMs);
  // 今天的执行分布只看「尚未到点、已启用、nextFireAt 落在本地当天」的任务：
  // 已跑过的轮次不该出现在未来轨道上。
  const marks = jobs.flatMap((job) => {
    if (job.status !== 'enabled' || job.nextFireAt === null) return [];
    if (job.nextFireAt < nowMs || localDayDiff(job.nextFireAt, nowMs) !== 0) return [];
    return [{ id: job.id, name: job.name, at: job.nextFireAt, kind: job.schedule_kind }];
  });

  return (
    <section className="sch-overview" aria-label="定时任务概览">
      <div className="sch-kpis">
        <Kpi
          label="任务总数"
          value={stats.total}
          unit="条"
          note={stats.singleShot > 0 ? `${stats.singleShot} 条为单次任务` : '全部为周期性任务'}
        />
        <Kpi
          label="启用中"
          value={stats.enabled}
          unit="条"
          tone="success"
          note={stats.running > 0 ? `${stats.running} 条正在执行` : '暂无执行中的任务'}
        />
        <Kpi
          label="今日还将执行"
          value={stats.todayUpcoming}
          unit="次"
          tone="accent"
          note={
            stats.nextToday === null
              ? '今天没有待执行任务'
              : `最近：${stats.nextToday.name} ${formatClock(stats.nextToday.nextFireAt)}`
          }
        />
        <Kpi
          label="最近失败"
          value={stats.failures.length}
          unit="条"
          tone={stats.failures.length > 0 ? 'danger' : undefined}
          note={stats.failures.length > 0 ? '需人工确认产出' : '最近一轮全部正常'}
        />
      </div>

      <div className="sch-overview-side">
        <div className="sch-overview-side-head">
          <strong>今天的执行分布</strong>
          <span className="sch-muted">
            还有 {stats.todayUpcoming} 次 · 现在 {formatClock(nowMs)}
          </span>
        </div>
        <div className="sch-track">
          <div className="sch-track-hours">
            {/* 每 6 小时一个标签：真机走查发现每 3 小时一标时，窄内容区下
                「0 时」会被折成两行、刻度条被撑高。 */}
            {Array.from({ length: 24 }, (_unused, hour) => (
              <span key={hour}>{hour % 6 === 0 ? `${hour}时` : ''}</span>
            ))}
          </div>
          {marks.map((mark) => (
            <i
              key={mark.id}
              className="sch-track-mark"
              data-kind={mark.kind}
              style={{ left: `${trackMarkRatio(mark.at) * 100}%` }}
              title={`${formatClock(mark.at)} ${mark.name}`}
            />
          ))}
          <i className="sch-track-now" style={{ left: `${trackMarkRatio(nowMs) * 100}%` }} />
        </div>
        <div className="sch-legend">
          <span>
            <i className="sch-legend-dot" data-kind="cron" /> cron
          </span>
          <span>
            <i className="sch-legend-dot" data-kind="every" /> 间隔
          </span>
          <span>
            <i className="sch-legend-dot" data-kind="at" /> 单次
          </span>
        </div>
      </div>

      {stats.failures.length > 0 && (
        // 失败必须推到页面顶部：任务「显示成功但什么都没做」是历史缺陷，
        // 不能退回成只藏在执行历史里。
        <div className="sch-alert" role="alert">
          <div className="sch-alert-head">⚠ {stats.failures.length} 个任务最近一次执行失败</div>
          <div className="sch-alert-list">
            {stats.failures.map((failure) => (
              <div key={failure.id} className="sch-alert-row">
                <strong>{failure.name}</strong>
                <span className="sch-muted">{formatTimestamp(failure.lastFiredAt)}</span>
                <span className="sch-alert-reason">{failure.error ?? '未记录失败原因'}</span>
                <button
                  type="button"
                  className="sch-btn"
                  disabled={actions.busyJobId === failure.id}
                  onClick={() => actions.onRunNow(failure.id)}
                >
                  立即重跑
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Kpi({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: number;
  unit: string;
  note: string;
  tone?: 'success' | 'accent' | 'danger';
}) {
  return (
    <div className="sch-kpi">
      <span className="sch-kpi-label">{label}</span>
      <span className="sch-kpi-value" data-tone={tone ?? 'default'}>
        {value}
        <small>{unit}</small>
      </span>
      <span className="sch-kpi-note">{note}</span>
    </div>
  );
}
