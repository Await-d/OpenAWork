/**
 * TeamBottomStatusBar · 统一底部状态条
 *
 * 把原先堆叠在 topBar 下方的多条状态提示整合为一条底部状态栏：
 *   - 团队运行进度（TeamStatusBar）
 *   - 暂停/恢复按钮
 *   - 恢复中提示
 *   - 运行控制错误
 *   - Handoff 聚焦横幅
 *
 * 底部状态条的好处：
 *   1. 释放顶部空间，让对话区和面板区获得最大高度
 *   2. 状态信息天然属于「全局脚注」，放底部不打断阅读流
 *   3. 多条状态不再垂直堆叠挤压内容区
 */

import { type CSSProperties, type ReactNode } from 'react';
import type { AgentTeamsFooterStat } from '../../data/team-runtime-types.js';
import { TeamStatusBar } from '../header/TeamStatusBar.js';

const BAR_ROOT_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 12px',
  height: 36,
  flexShrink: 0,
  background: 'var(--bg-overlay)',
  borderTop: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
  fontSize: 11,
  overflow: 'hidden',
};

const STATUS_SEGMENT_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
};

const PAUSED_TAG_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--warning) 14%, transparent)',
  border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
  color: 'var(--warning)',
  fontSize: 10,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const RESUME_NOTICE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 8px',
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const ERROR_TAG_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
  color: 'var(--danger)',
  fontSize: 10,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 320,
};

const ACTION_BTN_BASE: CSSProperties = {
  padding: '3px 12px',
  borderRadius: 6,
  border: 'none',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const FOOTER_STAT_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '1px 7px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--bg-surface) 80%, transparent)',
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const FOOTER_STAT_VALUE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

const FOOTER_LEAD_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 7px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const PAUSE_BTN_STYLE: CSSProperties = {
  ...ACTION_BTN_BASE,
  background: 'color-mix(in srgb, var(--fg-muted) 12%, transparent)',
  color: 'var(--fg-default)',
};

const RESUME_BTN_STYLE: CSSProperties = {
  ...ACTION_BTN_BASE,
  background: 'color-mix(in srgb, var(--success) 16%, transparent)',
  color: 'var(--success)',
};

const FOCUS_BANNER_SEGMENT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 8px',
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
  border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
  flexShrink: 0,
  maxWidth: 400,
  overflow: 'hidden',
};

export interface TeamBottomStatusBarProps {
  /** 是否暂停态 */
  paused: boolean;
  /** 当前选中的会话 ID */
  selectedSessionId: string | null;
  /** 暂停回调 */
  onPauseAll?: () => void;
  /** 恢复回调 */
  onResumeAll?: () => void;
  /** 恢复中提示文本 */
  resumeNoticeTitle?: string | null;
  /** 恢复提示详情 */
  resumeNoticeDetail?: string | null;
  /** 关闭恢复提示 */
  onDismissResumeNotice?: () => void;
  /** 运行控制错误 */
  runtimeError?: string | null;
  /** Handoff 聚焦信息 */
  focusHandoffId?: string | null;
  focusHandoffLabel?: ReactNode | null;
  /** 聚焦跳转按钮 */
  focusActions?: ReactNode;
  /** 清除聚焦 */
  onClearFocus?: () => void;
  /** 暂停/恢复按钮是否禁用 */
  controlDisabled?: boolean;
  /** 按钮文字（暂停中 / 恢复中） */
  controlBusy?: boolean;
  /** 底部统计前导文本（如"活跃 3 / 共 5"） */
  footerLead?: string | null;
  /** 底部统计药丸（总/运行/等待/异常等） */
  footerStats?: AgentTeamsFooterStat[] | null;
}

export function TeamBottomStatusBar({
  paused,
  selectedSessionId,
  onPauseAll,
  onResumeAll,
  resumeNoticeTitle,
  resumeNoticeDetail,
  onDismissResumeNotice,
  runtimeError,
  focusHandoffId,
  focusHandoffLabel,
  focusActions,
  onClearFocus,
  controlDisabled,
  controlBusy,
  footerLead,
  footerStats,
}: TeamBottomStatusBarProps) {
  return (
    <footer style={BAR_ROOT_STYLE} role="contentinfo" aria-label="团队状态栏">
      {/* 左侧：运行状态 + 进度 */}
      <div style={STATUS_SEGMENT_STYLE}>
        {paused ? (
          <span style={PAUSED_TAG_STYLE} role="alert">
            <span aria-hidden>⏸</span>
            已暂停
          </span>
        ) : null}

        {resumeNoticeTitle ? (
          <span style={RESUME_NOTICE_STYLE} role="status" aria-live="polite">
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'dot-pulse 1.2s ease-in-out infinite',
              }}
            />
            {resumeNoticeTitle}
            {resumeNoticeDetail ? (
              <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>
                · {resumeNoticeDetail}
              </span>
            ) : null}
            {onDismissResumeNotice ? (
              <button
                type="button"
                onClick={onDismissResumeNotice}
                aria-label="关闭恢复提示"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            ) : null}
          </span>
        ) : null}

        {runtimeError ? (
          <span style={ERROR_TAG_STYLE} role="alert" title={runtimeError}>
            <span aria-hidden>⚠</span>
            {runtimeError}
          </span>
        ) : null}

        {focusHandoffId ? (
          <span style={FOCUS_BANNER_SEGMENT_STYLE}>
            <span
              style={{
                color: 'var(--accent)',
                fontSize: 10,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {focusHandoffLabel ?? `聚焦 #${focusHandoffId.slice(0, 8)}`}
            </span>
            {focusActions}
            {onClearFocus ? (
              <button
                type="button"
                onClick={onClearFocus}
                aria-label="清除定位"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            ) : null}
          </span>
        ) : null}

        {/* TeamStatusBar 自带进度/层级/时间 */}
        <TeamStatusBar
          paused={paused}
          selectedSessionId={selectedSessionId}
          onPauseAll={undefined}
          onResumeAll={undefined}
        />
      </div>

      {/* 中间：统计药丸（footerLead + footerStats） */}
      {footerLead || (footerStats && footerStats.length > 0) ? (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
          }}
        >
          {footerLead ? (
            <span style={FOOTER_LEAD_STYLE} title={footerLead}>
              {footerLead}
            </span>
          ) : null}
          {footerStats?.map((stat) => (
            <span
              key={stat.label}
              style={FOOTER_STAT_PILL_STYLE}
              title={`${stat.label} ${stat.value}`}
            >
              <span>{stat.label}</span>
              <span style={FOOTER_STAT_VALUE_STYLE}>{stat.value}</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* 右侧：暂停/恢复按钮 */}
      {onPauseAll && !paused && !controlDisabled ? (
        <button
          type="button"
          onClick={onPauseAll}
          className="team-v2-control team-v2-control--transparent"
          style={PAUSE_BTN_STYLE}
        >
          全部暂停
        </button>
      ) : null}
      {onResumeAll && paused ? (
        <button
          type="button"
          onClick={onResumeAll}
          disabled={controlDisabled}
          className="team-v2-control team-v2-control--transparent"
          style={{
            ...RESUME_BTN_STYLE,
            opacity: controlDisabled ? 0.6 : 1,
            cursor: controlDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          {controlBusy ? '恢复中…' : '全部恢复'}
        </button>
      ) : null}
    </footer>
  );
}
