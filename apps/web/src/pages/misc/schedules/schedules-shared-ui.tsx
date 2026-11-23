import type { CronExecutionRecord, CronJobRecord } from '@openAwork/web-client';
import {
  formatTimestamp,
  type ScheduleDeliveryMode,
} from '../../../components/schedules/schedule-form-utils.js';
import type { SchedulesHistorySnapshot, SchedulesJobActions } from './schedules-view-types.js';
import { describeExecutionStatus } from './schedules-view-utils.js';
import './schedules-shared-ui.css';

/**
 * 卡片视图与时间轴视图共用的原子件：状态徽章 / 执行结果徽章 / 投递方式控件 /
 * 动作按钮组。
 *
 * 抽出来的唯一目的是**两个视图的行为必须逐字一致**（尤其投递方式：渠道任务
 * 只能是纯文本，见 `SchedulesPage.test.tsx` 对 `combobox` 的断言）。
 */

const DELIVERY_OPTIONS: ReadonlyArray<{ value: ScheduleDeliveryMode; label: string }> = [
  { value: 'desktop', label: '通知我' },
  { value: 'session', label: '投到会话' },
  { value: 'none', label: '不投递' },
];

const KIND_LABEL: Readonly<Record<CronJobRecord['schedule_kind'], string>> = {
  cron: 'cron',
  every: '间隔',
  at: '单次',
};

/** 启停态徽章；「运行中」只改徽章，不影响启用/停用按钮可用性。 */
export function JobStatusBadge({ job }: { job: CronJobRecord }) {
  if (job.running) {
    return (
      <span className="sch-badge" data-tone="running">
        <i className="sch-dot sch-dot-pulse" />
        运行中
      </span>
    );
  }
  if (job.status === 'enabled') {
    return (
      <span className="sch-badge" data-tone="success">
        <i className="sch-dot" />
        已启用
      </span>
    );
  }
  return (
    <span className="sch-badge" data-tone="muted">
      <i className="sch-dot" />
      已停用
    </span>
  );
}

/** 调度类型标签（cron / 间隔 / 单次）。 */
export function ScheduleKindTag({ job }: { job: CronJobRecord }) {
  return (
    <span className="sch-tag" data-kind={job.schedule_kind}>
      {KIND_LABEL[job.schedule_kind]}
    </span>
  );
}

export function ExecutionBadge({ status }: { status: CronExecutionRecord['status'] }) {
  const descriptor = describeExecutionStatus(status);
  return (
    <span className="sch-badge" data-tone={descriptor.tone}>
      {descriptor.label}
    </span>
  );
}

/**
 * 投递方式：渠道任务（`delivery_mode === 'channel'`）**只读**渲染为文本，
 * 其余模式可改（与旧 `CronManager` 的 `onDeliveryChange` 能力等价）。
 */
export function DeliveryControl({
  job,
  disabled,
  onChange,
}: {
  job: CronJobRecord;
  disabled: boolean;
  onChange: (jobId: string, mode: ScheduleDeliveryMode) => void;
}) {
  if (job.delivery_mode === 'channel') {
    return (
      <span className="sch-muted" title="结果投递方式：渠道回发">
        渠道回发
      </span>
    );
  }
  return (
    <select
      className="sch-select"
      aria-label="结果投递方式"
      title={`结果投递方式：${job.delivery_mode}`}
      value={job.delivery_mode}
      disabled={disabled}
      onChange={(event) => onChange(job.id, event.target.value as ScheduleDeliveryMode)}
    >
      {DELIVERY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** 行内动作组：立即运行 / 启停 / 执行历史（可选） / 删除。 */
export function JobActionButtons({
  job,
  actions,
  withHistory,
}: {
  job: CronJobRecord;
  actions: SchedulesJobActions;
  withHistory: boolean;
}) {
  const busy = actions.busyJobId === job.id;
  const isRunning = job.running === true;
  return (
    <div className="sch-actions">
      <button
        type="button"
        className="sch-btn sch-btn-accent"
        disabled={busy || isRunning}
        onClick={() => actions.onRunNow(job.id)}
      >
        {isRunning ? '运行中…' : '立即运行'}
      </button>
      {job.status === 'enabled' ? (
        <button
          type="button"
          className="sch-btn sch-btn-danger"
          disabled={busy}
          onClick={() => actions.onDisable(job.id)}
        >
          禁用
        </button>
      ) : (
        <button
          type="button"
          className="sch-btn sch-btn-success"
          disabled={busy}
          onClick={() => actions.onEnable(job.id)}
        >
          启用
        </button>
      )}
      {withHistory && (
        <button
          type="button"
          className="sch-btn"
          disabled={busy}
          onClick={() => actions.onOpenHistory(job.id, job.name)}
        >
          执行历史
        </button>
      )}
      <button
        type="button"
        className="sch-btn sch-btn-ghost"
        aria-label="删除任务"
        title="删除任务"
        disabled={busy}
        onClick={() => actions.onDelete(job.id)}
      >
        ✕
      </button>
    </div>
  );
}

/** 单次执行耗时；`finished_at` 缺失（在途 / 网关未记录）时显示 `—`。 */
function formatDuration(startedAt: number, finishedAt: number | null): string {
  if (finishedAt === null || finishedAt < startedAt) return '—';
  const elapsed = finishedAt - startedAt;
  if (elapsed < 1000) return `${elapsed} ms`;
  if (elapsed < 60_000) return `${(elapsed / 1000).toFixed(1)} s`;
  return `${Math.round(elapsed / 60_000)} 分 ${Math.round((elapsed % 60_000) / 1000)} 秒`;
}

/**
 * 某任务的执行历史（内联展开用）。两个视图共用同一实现，确保「跳过不显示成失败」
 * 「有产出摘要就展示、可跳执行现场」的行为逐字一致。
 */
export function JobHistoryList({
  snapshot,
  onOpenSession,
  limit,
}: {
  snapshot: SchedulesHistorySnapshot;
  onOpenSession: (sessionId: string) => void;
  /** 网关只对最近若干条生成产出摘要；传入时补一行说明，避免用户以为记录丢了。 */
  limit?: number;
}) {
  if (snapshot.entries.length === 0) {
    return <div className="sch-muted">该任务暂无执行历史。</div>;
  }
  return (
    <div className="sch-history">
      {limit === undefined ? null : (
        <div className="sch-muted">最多展示最近 {limit} 条，更早的执行没有产出摘要。</div>
      )}
      {snapshot.entries.map((entry) => {
        const sessionId = entry.session_id;
        return (
          <div key={entry.id} className="sch-history-entry">
            <div className="sch-history-line">
              <ExecutionBadge status={entry.status} />
              <span className="sch-muted">{formatTimestamp(entry.started_at)}</span>
              <span className="sch-muted">
                耗时 {formatDuration(entry.started_at, entry.finished_at)}
              </span>
              {sessionId ? (
                <button
                  type="button"
                  className="sch-btn sch-btn-ghost"
                  onClick={() => onOpenSession(sessionId)}
                >
                  查看执行现场
                </button>
              ) : null}
            </div>
            {entry.error ? (
              <div
                className="sch-history-error"
                // 跳过不是失败：用灰字，别用失败红（否则「被并发挡住」看起来和「执行报错」一样）。
                data-tone={entry.status === 'skipped' ? 'muted' : 'danger'}
              >
                {entry.error}
              </div>
            ) : null}
            {entry.outputPreview ? (
              <div className="sch-history-output">{entry.outputPreview}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
