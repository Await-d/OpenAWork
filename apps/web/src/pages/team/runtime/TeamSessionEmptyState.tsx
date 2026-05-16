/**
 * TeamSessionEmptyState · Phase 2a 增强
 *
 * 当 team session 加载完成但没有任何消息时显示的空状态。
 *
 * 出现时机（按 SessionConversationView 渲染条件）：
 * - messages.length === 0
 * - !visibleStreaming
 * - !remoteSessionBusyState
 *
 * 此时这个 session 处于"已创建但未开始执行"的态——通常是 b 还未对它发起
 * stream 调用。我们给用户一个清晰的状态指示 + 角色介绍 + 等待动画。
 *
 * 关联：
 * - TeamSessionView 通过 emptyContent slot 注入本组件
 * - TeamSubstateProgressBar 仍在顶部显示 layer + state 徽章
 */

import type { CSSProperties } from 'react';

export interface TeamSessionEmptyStateProps {
  /** session 的 role_layer（来自 sessions 表）。null 时显示通用文案。 */
  roleLayer?: string | null;
  /** session 的 state_status（idle/running/paused）。 */
  stateStatus?: 'idle' | 'running' | 'paused' | null;
  /** session loading 中。 */
  isLoading?: boolean;
}

const ROLE_INFO: Record<
  string,
  { emoji: string; title: string; description: string; accentLight: string; accentDark: string }
> = {
  reception: {
    emoji: '🎙️',
    title: '接待 Agent (b)',
    description: '负责理解用户意图、路由请求并在前台与你保持对话。',
    accentLight: 'color-mix(in srgb, #6366f1 20%, var(--surface))',
    accentDark: '#6366f1',
  },
  pm1: {
    emoji: '📋',
    title: '任务规划 PM1 (c)',
    description: '将需求拆解为 spec / plan / tasks 三件套产物链。',
    accentLight: 'color-mix(in srgb, #0ea5e9 18%, var(--surface))',
    accentDark: '#0ea5e9',
  },
  pm2: {
    emoji: '🎯',
    title: '开发管控 PM2 (d)',
    description: '对照宪法做合规检查，将任务包派发给执行团队并做双重 review。',
    accentLight: 'color-mix(in srgb, #10b981 18%, var(--surface))',
    accentDark: '#10b981',
  },
  executor: {
    emoji: '⚡',
    title: '执行者 (e)',
    description: '按 dispatch 包实现代码改动，遵循 architecture / constitution 约束。',
    accentLight: 'color-mix(in srgb, #f59e0b 18%, var(--surface))',
    accentDark: '#f59e0b',
  },
  reviewer: {
    emoji: '🔍',
    title: '评审 (g)',
    description: '对比产物与 spec / plan，给出结构化 review 报告。',
    accentLight: 'color-mix(in srgb, #ec4899 18%, var(--surface))',
    accentDark: '#ec4899',
  },
};

const KEYFRAMES = `
@keyframes team-empty-fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes team-empty-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
@keyframes team-empty-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

const CONTAINER_STYLE: CSSProperties = {
  margin: 'auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 24px',
  gap: 18,
  maxWidth: 520,
  width: '100%',
  animation: 'team-empty-fade-up 0.45s ease both',
};

const HERO_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 56,
  height: 56,
  borderRadius: 16,
  fontSize: 28,
  marginBottom: 4,
};

const TITLE_STYLE: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: 'var(--text)',
  margin: 0,
  textAlign: 'center',
};

const DESCRIPTION_STYLE: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  color: 'var(--text-2)',
  margin: 0,
  textAlign: 'center',
};

const STATUS_ROW_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 14px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
  fontSize: 12,
  color: 'var(--text-2)',
  fontWeight: 600,
};

const STATUS_DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--accent)',
  animation: 'team-empty-pulse 1.6s ease-in-out infinite',
  flexShrink: 0,
};

const SPINNER_STYLE: CSSProperties = {
  width: 14,
  height: 14,
  border: '2px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  borderTopColor: 'var(--accent)',
  borderRadius: '50%',
  animation: 'team-empty-spin 0.9s linear infinite',
  flexShrink: 0,
};

const HINT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-3)',
  textAlign: 'center',
  marginTop: 4,
  fontStyle: 'italic',
};

function statusLabel(status: 'idle' | 'running' | 'paused' | null | undefined): string {
  if (status === 'running') return '运行中';
  if (status === 'paused') return '已暂停';
  if (status === 'idle') return '空闲';
  return '未知';
}

export function TeamSessionEmptyState({
  roleLayer,
  stateStatus,
  isLoading,
}: TeamSessionEmptyStateProps) {
  const info = roleLayer ? ROLE_INFO[roleLayer] : null;
  const showSpinner = isLoading;

  return (
    <div style={CONTAINER_STYLE}>
      <style>{KEYFRAMES}</style>
      <div
        style={{
          ...HERO_BADGE_STYLE,
          background: info?.accentLight ?? 'color-mix(in srgb, var(--accent) 15%, var(--surface))',
          color: info?.accentDark ?? 'var(--accent)',
        }}
        aria-hidden="true"
      >
        {info?.emoji ?? '💬'}
      </div>

      <h3 style={TITLE_STYLE}>{info?.title ?? '团队会话'}</h3>

      <p style={DESCRIPTION_STYLE}>
        {info?.description ??
          '该会话已创建但尚未开始执行。等待 b 派发任务，或团队上游推进协议后该会话会自动进入运行态。'}
      </p>

      <div style={STATUS_ROW_STYLE} aria-live="polite">
        {showSpinner ? (
          <span style={SPINNER_STYLE} aria-hidden="true" />
        ) : (
          <span style={STATUS_DOT_STYLE} aria-hidden="true" />
        )}
        <span>状态：{showSpinner ? '加载中…' : statusLabel(stateStatus)}</span>
      </div>

      <div style={HINT_STYLE}>
        消息会在 LLM 循环开始后实时出现。该视图与 chat 共用同一份对话布局。
      </div>
    </div>
  );
}
