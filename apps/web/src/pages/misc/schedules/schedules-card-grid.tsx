import { formatTimestamp } from '../../../components/schedules/schedule-form-utils.js';
import {
  DeliveryControl,
  ExecutionBadge,
  JobActionButtons,
  JobHistoryList,
  JobStatusBadge,
  ScheduleKindTag,
} from './schedules-shared-ui.js';
import type { SchedulesDensity, SchedulesViewCommonProps } from './schedules-view-types.js';
import { formatRelativeToNow, formatScheduleText } from './schedules-view-utils.js';
import './schedules-card-grid.css';

/**
 * 卡片视图 props：在公共契约之上只多一个 `density`。
 *
 * 密度是**卡片网格独有**的概念（时间轴单列竖排），故不放进
 * `SchedulesViewCommonProps`，免得时间轴被迫接收无意义入参。
 */
export interface SchedulesCardGridProps extends SchedulesViewCommonProps {
  density: SchedulesDensity;
}

/**
 * 卡片视图：一张卡一个任务，把「下一次什么时候跑」放大成卡片的视觉主体。
 *
 * 历史只在**本卡内联**展开（`historyView.jobId` 命中时），一次只挂一份，
 * 避免为每张卡各拉一次历史请求。
 */
export function SchedulesCardGrid({
  jobs,
  nowMs,
  actions,
  historyView,
  historyJobId,
  onOpenSession,
  emptyText,
  historyLimit,
  density,
}: SchedulesCardGridProps) {
  if (jobs.length === 0) {
    return <div className="sch-empty">{emptyText}</div>;
  }

  return (
    <div className="sch-grid" data-density={density}>
      {jobs.map((job) => {
        const lastExecution = job.lastExecution;
        const historyOpen = historyView !== null && historyView.jobId === job.id;
        return (
          <article
            key={job.id}
            className="sch-card"
            data-disabled={job.status !== 'enabled'}
            data-running={job.running === true}
          >
            <div className="sch-card-top">
              <div className="sch-card-title">
                {/* h2 而非 h3：页头是 h1，跳到 h3 违反 heading-order。 */}
                <h2>{job.name}</h2>
                <p>{job.prompt}</p>
              </div>
              <JobStatusBadge job={job} />
            </div>

            <div className="sch-countdown">
              <span className="sch-countdown-value">
                {job.nextFireAt === null
                  ? job.status === 'enabled'
                    ? '待排期'
                    : '已停用'
                  : formatRelativeToNow(job.nextFireAt, nowMs)}
              </span>
              <span className="sch-countdown-note">
                {job.nextFireAt === null
                  ? '启用后重新排期'
                  : `${formatTimestamp(job.nextFireAt)} 执行`}
              </span>
            </div>

            <dl className="sch-card-meta">
              <div>
                <dt>调度</dt>
                <dd>
                  <ScheduleKindTag job={job} />
                  <span className="sch-mono">{formatScheduleText(job)}</span>
                </dd>
              </div>
              <div>
                <dt>上次结果</dt>
                <dd>
                  {lastExecution === null ? (
                    <span className="sch-muted">尚未执行</span>
                  ) : (
                    <>
                      <ExecutionBadge status={lastExecution.status} />
                      <span className="sch-muted">{formatTimestamp(job.lastFiredAt)}</span>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>投递方式</dt>
                <dd>
                  <DeliveryControl
                    job={job}
                    disabled={actions.busyJobId === job.id}
                    onChange={actions.onDeliveryChange}
                  />
                </dd>
              </div>
              <div>
                <dt>累计运行</dt>
                <dd>{job.fireCount} 次</dd>
              </div>
            </dl>

            {lastExecution?.status === 'failed' && lastExecution.error ? (
              <div className="sch-card-error">{lastExecution.error}</div>
            ) : null}

            <div className="sch-card-foot">
              <JobActionButtons job={job} actions={actions} withHistory />
              {historyJobId === job.id ? (
                <span className="sch-muted">正在加载执行历史…</span>
              ) : null}
            </div>

            {historyOpen && historyView !== null ? (
              <div className="sch-card-history">
                <JobHistoryList
                  snapshot={historyView}
                  onOpenSession={onOpenSession}
                  limit={historyLimit}
                />
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
