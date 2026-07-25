import type { TeamPageMode } from '../runtime/hooks/use-team-page-state.js';
import {
  getRuntimeResumeNoticeDotStyle,
  getRuntimeResumeNoticeStyle,
  type RuntimeResumeNotice,
} from './team-page-v2-runtime-resume-notice.js';

interface TeamPageV2RuntimeNoticesProps {
  readonly canManageSelectedRuntimeTree: boolean;
  readonly effectiveMode: TeamPageMode;
  readonly isMobile: boolean;
  readonly pauseResumeBusy: boolean;
  readonly runtimeControlError: string | null;
  readonly runtimeResumeNotice: RuntimeResumeNotice | null;
  readonly onRequestResumeAll: () => void | Promise<void>;
}

/**
 * 顶部瞬时通知：只保留恢复进度 / 控制错误。
 * 暂停态横幅已收敛到 TeamStatusBar（已暂停 + 全部恢复），避免重复。
 */
export function TeamPageV2RuntimeNotices({
  canManageSelectedRuntimeTree: _canManageSelectedRuntimeTree,
  effectiveMode: _effectiveMode,
  isMobile,
  pauseResumeBusy: _pauseResumeBusy,
  runtimeControlError,
  runtimeResumeNotice,
  onRequestResumeAll: _onRequestResumeAll,
}: TeamPageV2RuntimeNoticesProps) {
  const noticeMargin = isMobile ? 0 : '12px 16px 0';
  const noticeRadius = isMobile ? 0 : 14;

  return (
    <>
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
