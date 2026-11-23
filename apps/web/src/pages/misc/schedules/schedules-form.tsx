import { useState, type CSSProperties } from 'react';
import type { ScheduleFormDraft } from '../../../components/schedules/schedule-form-utils.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { SchedulesSessionPicker } from './schedules-session-picker.js';
import { useSessionOptions } from './use-session-options.js';

/**
 * 新建定时任务的表单（从 `SchedulesPage.tsx` 原样搬出）。
 *
 * 保留既有的字段顺序、占位文案与「cron 5 段 / 间隔最小 1 分钟」提示：
 * 这些文案是用户据以填对参数的唯一说明，不随布局调整而改动。
 */

const KIND_OPTIONS = [
  { value: 'cron', label: 'cron 表达式' },
  { value: 'every', label: '固定间隔' },
  { value: 'at', label: '单次（到点执行）' },
] as const;

export function ScheduleForm({
  draft,
  submitting,
  onChange,
  onSubmit,
}: {
  draft: ScheduleFormDraft;
  submitting: boolean;
  onChange: (next: ScheduleFormDraft) => void;
  onSubmit: () => void;
}) {
  const patch = (partial: Partial<ScheduleFormDraft>) => onChange({ ...draft, ...partial });
  /** 「投递到指定会话」的目标会话选择（打开时才拉会话列表）。 */
  const [pickingSession, setPickingSession] = useState(false);
  const token = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const {
    sessions,
    loading: sessionsLoading,
    error: sessionsError,
  } = useSessionOptions({ enabled: pickingSession, gatewayUrl, token });

  return (
    <div className="sch-form">
      <span className="section-label">新建定时任务</span>
      <div className="sch-form-row">
        <input
          type="text"
          placeholder="任务名称"
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
          style={inputStyle}
        />
        <select
          value={draft.kind}
          onChange={(event) => patch({ kind: event.target.value as ScheduleFormDraft['kind'] })}
          style={inputStyle}
          aria-label="调度类型"
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {draft.kind === 'cron' && (
          <>
            <input
              type="text"
              placeholder="0 9 * * *"
              value={draft.cronExpr}
              onChange={(event) => patch({ cronExpr: event.target.value })}
              style={{ ...inputStyle, minWidth: 160, fontFamily: 'monospace' }}
              aria-label="cron 表达式"
            />
            <input
              type="text"
              placeholder="时区（如 Asia/Shanghai）"
              value={draft.tz}
              onChange={(event) => patch({ tz: event.target.value })}
              style={{ ...inputStyle, minWidth: 160 }}
              aria-label="时区"
            />
          </>
        )}

        {draft.kind === 'every' && (
          <>
            <input
              type="number"
              min={1}
              value={draft.everyValue}
              onChange={(event) => patch({ everyValue: event.target.value })}
              style={{ ...inputStyle, minWidth: 90 }}
              aria-label="间隔数值"
            />
            <select
              value={draft.everyUnit}
              onChange={(event) =>
                patch({ everyUnit: event.target.value as ScheduleFormDraft['everyUnit'] })
              }
              style={inputStyle}
              aria-label="间隔单位"
            >
              <option value="minutes">分钟</option>
              <option value="hours">小时</option>
              <option value="days">天</option>
            </select>
          </>
        )}

        {draft.kind === 'at' && (
          <input
            type="datetime-local"
            value={draft.atLocal}
            onChange={(event) => patch({ atLocal: event.target.value })}
            style={inputStyle}
            aria-label="触发时间"
          />
        )}
      </div>

      <textarea
        placeholder="任务提示词：到点后让 AI 做什么（例如「总结今天的未读邮件并发送到这里」）"
        value={draft.prompt}
        onChange={(event) => patch({ prompt: event.target.value })}
        rows={3}
        style={{ ...inputStyle, minWidth: '100%', resize: 'vertical', lineHeight: 1.5 }}
      />

      {/* 投递方式：任务跑完的结果送到哪里。不选「不投递」时产出会真正出现在
          用户能看到的地方（桌面通知 / 指定会话），避免「跑了但什么都没有」。 */}
      <div className="sch-form-row">
        <select
          value={draft.deliveryMode}
          onChange={(event) =>
            patch({ deliveryMode: event.target.value as ScheduleFormDraft['deliveryMode'] })
          }
          style={inputStyle}
          aria-label="结果投递方式"
        >
          <option value="desktop">结果通知我（桌面 / 网页）</option>
          <option value="session">投递到指定会话</option>
          <option value="none">不投递（只看执行历史）</option>
        </select>
        {draft.deliveryMode === 'session' && (
          <>
            <button
              type="button"
              className="sch-btn"
              onClick={() => setPickingSession(true)}
              aria-label="选择目标会话"
            >
              {draft.deliveryTarget.trim().length > 0 ? '更换会话' : '选择会话'}
            </button>
            {/* 会话 id 直接显示出来：执行器按 id 查会话，用户需要核对选对没选对。 */}
            <span className="sch-mono" aria-label="目标会话 id">
              {draft.deliveryTarget.trim().length > 0 ? draft.deliveryTarget : '尚未选择会话'}
            </span>
          </>
        )}
        <span className="sch-muted">
          {draft.deliveryMode === 'none'
            ? '任务会正常执行，但产出不会主动送达——只能在执行历史里查看。'
            : '失败时同样会通知，不会出现「静默失败」。'}
        </span>
      </div>

      <div className="sch-form-row">
        <button
          type="button"
          className="sch-btn sch-btn-accent"
          disabled={submitting}
          onClick={onSubmit}
        >
          {submitting ? '创建中…' : '创建任务'}
        </button>
        <span className="sch-muted">cron 使用 5 段表达式（分 时 日 月 周）；间隔最小 1 分钟。</span>
      </div>

      {pickingSession && (
        <SchedulesSessionPicker
          jobName={draft.name.trim().length > 0 ? draft.name.trim() : '新任务'}
          sessions={sessions}
          loading={sessionsLoading}
          error={sessionsError}
          busy={false}
          onSelect={(sessionId) => {
            patch({ deliveryTarget: sessionId });
            setPickingSession(false);
          }}
          onDismiss={() => setPickingSession(false)}
        />
      )}
    </div>
  );
}

const inputStyle: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  background: 'var(--bg-base)',
  color: 'var(--fg-strong)',
  padding: '0.45rem 0.6rem',
  fontSize: 12,
  minWidth: 140,
};
