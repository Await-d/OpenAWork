import { formatTimestamp } from '../../../components/schedules/schedule-form-utils.js';
import {
  DeliveryControl,
  ExecutionBadge,
  JobActionButtons,
  JobHistoryList,
  JobStatusBadge,
  ScheduleKindTag,
} from './schedules-shared-ui.js';
import type { SchedulesViewCommonProps } from './schedules-view-types.js';
import {
  SCHEDULE_BUCKET_META,
  formatClock,
  formatRelativeToNow,
  formatScheduleText,
  groupByDay,
} from './schedules-view-utils.js';
import './schedules-timeline.css';

/** 分组头里的「11 月 2 日」（本地时区，只用于今天/明天两桶）。 */
function formatLocalDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/**
 * 时间轴视图：按**本地日差**分组（今天 / 明天 / 本周稍后 / 更晚 / 未排期），
 * 左侧时间列 + 竖轴 + 任务卡，回答「什么时候跑」而不是「有哪些任务」。
 *
 * 注意每个任务只出现在它的**下一轮**位置：间隔型任务一天内的中间轮次不在此列，
 * 因此卡片上同时给出调度表达式，避免被误读成「一天只跑一次」。
 */
export function SchedulesTimeline({
  jobs,
  nowMs,
  actions,
  historyView,
  historyJobId,
  onOpenSession,
  emptyText,
  historyLimit,
}: SchedulesViewCommonProps) {
  const groups = groupByDay(jobs, nowMs);
  if (groups.length === 0) {
    return <div className="sch-empty">{emptyText}</div>;
  }

  return (
    <div className="sch-timeline">
      {/* D-03 语义消歧：轨道/分组只画「下一轮」，必须写明白，否则间隔型任务
          会被读成「一天只跑一次」。 */}
      <p className="sch-timeline-note">
        按每个任务的<strong>下一次</strong>执行时间排布：间隔型任务一天内的中间轮次不在此列。
      </p>
      {groups.map((group) => {
        const meta = SCHEDULE_BUCKET_META[group.bucket];
        const note =
          group.bucket === 'today'
            ? formatLocalDate(nowMs)
            : group.bucket === 'tomorrow'
              ? formatLocalDate(nowMs + 86_400_000)
              : meta.note;
        return (
          <section key={group.bucket} className="sch-group" aria-label={meta.title}>
            <header className="sch-group-head">
              <strong>{meta.title}</strong>
              <span className="sch-muted">
                {note} · {group.jobs.length} 个任务
              </span>
              <span className="sch-group-line" />
            </header>

            {group.jobs.map((job) => {
              const lastExecution = job.lastExecution;
              const historyOpen = historyView !== null && historyView.jobId === job.id;
              return (
                <div key={job.id} className="sch-entry">
                  <div className="sch-entry-time">
                    <span className="sch-entry-clock">
                      {job.nextFireAt === null ? '—' : formatClock(job.nextFireAt)}
                    </span>
                    <small>
                      {job.nextFireAt === null
                        ? '未排期'
                        : formatRelativeToNow(job.nextFireAt, nowMs)}
                    </small>
                  </div>
                  <div className="sch-entry-rail">
                    <i className="sch-entry-dot" data-kind={job.schedule_kind} />
                  </div>

                  <article
                    className="sch-entry-card"
                    data-disabled={job.status !== 'enabled'}
                    data-running={job.running === true}
                  >
                    <div className="sch-entry-top">
                      <span className="sch-entry-name">{job.name}</span>
                      <ScheduleKindTag job={job} />
                      <span className="sch-mono">{formatScheduleText(job)}</span>
                      <JobStatusBadge job={job} />
                    </div>
                    <p className="sch-entry-prompt">{job.prompt}</p>

                    <div className="sch-entry-meta">
                      <span>
                        上次结果：
                        {lastExecution === null ? (
                          <span className="sch-muted">尚未执行</span>
                        ) : (
                          <>
                            <ExecutionBadge status={lastExecution.status} />
                            <span className="sch-muted">{formatTimestamp(job.lastFiredAt)}</span>
                          </>
                        )}
                      </span>
                      <span>
                        投递方式：
                        <DeliveryControl
                          job={job}
                          disabled={actions.busyJobId === job.id}
                          onChange={actions.onDeliveryChange}
                        />
                      </span>
                      <span className="sch-muted">累计运行 {job.fireCount} 次</span>
                    </div>

                    {lastExecution?.status === 'failed' && lastExecution.error ? (
                      <div className="sch-entry-error">最近一次失败：{lastExecution.error}</div>
                    ) : null}

                    <div className="sch-entry-foot">
                      <JobActionButtons job={job} actions={actions} withHistory />
                      {historyJobId === job.id ? (
                        <span className="sch-muted">正在加载执行历史…</span>
                      ) : null}
                    </div>

                    {historyOpen && historyView !== null ? (
                      <div className="sch-entry-history">
                        <JobHistoryList
                          snapshot={historyView}
                          onOpenSession={onOpenSession}
                          limit={historyLimit}
                        />
                      </div>
                    ) : null}
                  </article>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
