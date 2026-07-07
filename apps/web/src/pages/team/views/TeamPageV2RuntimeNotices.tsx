import type { CSSProperties } from 'react';
import type { TeamPageMode } from '../runtime/hooks/use-team-page-state.js';
import {
  getRuntimeResumeNoticeDotStyle,
  getRuntimeResumeNoticeStyle,
  type RuntimeResumeNotice,
} from './team-page-v2-runtime-resume-notice.js';

const PAUSED_RIBBON_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 14px',
  background: 'color-mix(in srgb, var(--warning) 14%, var(--bg-overlay))',
  border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
  borderRadius: 14,
  boxShadow: 'var(--shadow-sm)',
  backdropFilter: 'blur(14px)',
  fontSize: 12,
  color: 'var(--warning)',
  flexShrink: 0,
};

const PAUSED_DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 'var(--radius-pill)',
  background: 'var(--warning)',
  boxShadow: '0 0 0 4px var(--warning-subtle)',
  flexShrink: 0,
};

interface TeamPageV2RuntimeNoticesProps {
  readonly canManageSelectedRuntimeTree: boolean;
  readonly effectiveMode: TeamPageMode;
  readonly isMobile: boolean;
  readonly pauseResumeBusy: boolean;
  readonly runtimeControlError: string | null;
  readonly runtimeResumeNotice: RuntimeResumeNotice | null;
  readonly onRequestResumeAll: () => void | Promise<void>;
}

export function TeamPageV2RuntimeNotices({
  canManageSelectedRuntimeTree,
  effectiveMode,
  isMobile,
  pauseResumeBusy,
  runtimeControlError,
  runtimeResumeNotice,
  onRequestResumeAll,
}: TeamPageV2RuntimeNoticesProps) {
  const noticeMargin = isMobile ? 0 : '12px 16px 0';
  const noticeRadius = isMobile ? 0 : 14;
  const resumeDisabled = !canManageSelectedRuntimeTree || pauseResumeBusy;

  return (
    <>
      {effectiveMode === 'paused' ? (
        <div
          style={{
            ...PAUSED_RIBBON_STYLE,
            margin: noticeMargin,
            borderRadius: noticeRadius,
          }}
          role="alert"
        >
          <span aria-hidden style={PAUSED_DOT_STYLE} />
          <span style={{ fontWeight: 600 }}>团队已暂停</span>
          <span style={{ color: 'var(--fg-muted)', flex: 1 }}>所有运行中的 LLM 调用已停止</span>
          <button
            className="team-v2-control team-v2-control--transparent"
            type="button"
            onClick={() => void onRequestResumeAll()}
            disabled={resumeDisabled}
            style={{
              padding: '3px 12px',
              borderRadius: 6,
              border: '1px solid color-mix(in srgb, var(--success) 50%, transparent)',
              color: 'var(--success)',
              fontSize: 11,
              fontWeight: 700,
              cursor: resumeDisabled ? 'not-allowed' : 'pointer',
              opacity: resumeDisabled ? 0.6 : 1,
            }}
          >
            {pauseResumeBusy ? '恢复中…' : '全部恢复'}
          </button>
        </div>
      ) : null}
      {runtimeResumeNotice ? (
        <div
          role="status"
          aria-live="polite"
          style={getRuntimeResumeNoticeStyle({
            isMobile,
            phase: runtimeResumeNotice.phase,
            truncated: runtimeResumeNotice.truncated,
          })}
        >
          <span
            aria-hidden
            style={getRuntimeResumeNoticeDotStyle({
              phase: runtimeResumeNotice.phase,
              truncated: runtimeResumeNotice.truncated,
            })}
          />
          <span style={{ fontWeight: 700 }}>{runtimeResumeNotice.title}</span>
          <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>
            {runtimeResumeNotice.detail}
          </span>
        </div>
      ) : null}
      {runtimeControlError ? (
        <div
          role="alert"
          style={{
            margin: noticeMargin,
            padding: '8px 14px',
            border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
            borderRadius: noticeRadius,
            background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-overlay))',
            color: 'var(--danger)',
            fontSize: 12,
            boxShadow: 'var(--shadow-sm)',
            backdropFilter: 'blur(14px)',
          }}
        >
          {runtimeControlError}
        </div>
      ) : null}
    </>
  );
}
