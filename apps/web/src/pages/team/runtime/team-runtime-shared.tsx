import type { CSSProperties } from 'react';
import type {
  AgentTeamsConversationCard,
  AgentTeamsTaskCard,
  AgentTeamsMessageCard,
  AgentTeamsReviewCard,
} from './team-runtime-reference-mock.js';
import type { IconKey } from './TeamIcons.js';

export const SHELL_BACKGROUND = 'var(--bg)';

export const SURFACE_STYLE: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--card-bg)',
  boxShadow: 'var(--shadow-sm)',
};

export const PANEL_STYLE: CSSProperties = {
  ...SURFACE_STYLE,
  borderRadius: 10,
};

export const CONV_TYPE_META: Record<
  AgentTeamsConversationCard['type'],
  { color: string; icon: IconKey; label: string }
> = {
  broadcast: { color: 'var(--accent)', icon: 'broadcast', label: '广播' },
  direct: { color: 'var(--accent)', icon: 'direct', label: '单播' },
  question: { color: 'var(--warning)', icon: 'question', label: '提问' },
  result: { color: 'var(--success)', icon: 'check', label: '结果' },
};

export const PRIORITY_META: Record<
  AgentTeamsTaskCard['priority'],
  { color: string; bg: string; label: string }
> = {
  high: {
    color: 'var(--danger)',
    bg: 'color-mix(in oklch, var(--danger) 14%, transparent)',
    label: '高',
  },
  medium: {
    color: 'var(--warning)',
    bg: 'color-mix(in oklch, var(--warning) 14%, transparent)',
    label: '中',
  },
  low: {
    color: 'var(--text-3)',
    bg: 'color-mix(in oklch, var(--text-3) 14%, transparent)',
    label: '低',
  },
};

export const MSG_TYPE_META: Record<
  AgentTeamsMessageCard['type'],
  { color: string; icon: IconKey; label: string }
> = {
  update: { color: 'var(--accent)', icon: 'sync', label: '同步' },
  question: { color: 'var(--warning)', icon: 'question', label: '提问' },
  result: { color: 'var(--success)', icon: 'check', label: '结果' },
  error: { color: 'var(--danger)', icon: 'x', label: '阻塞' },
};

export const REVIEW_STATUS_META: Record<
  AgentTeamsReviewCard['status'],
  { color: string; bg: string; label: string }
> = {
  pending: {
    color: 'var(--warning)',
    bg: 'color-mix(in oklch, var(--warning) 14%, transparent)',
    label: '待审',
  },
  approved: {
    color: 'var(--success)',
    bg: 'color-mix(in oklch, var(--success) 14%, transparent)',
    label: '已通过',
  },
  rejected: {
    color: 'var(--danger)',
    bg: 'color-mix(in oklch, var(--danger) 14%, transparent)',
    label: '已驳回',
  },
};

export const REVIEW_TYPE_META: Record<
  AgentTeamsReviewCard['type'],
  { color: string; icon: IconKey; label: string }
> = {
  code: { color: 'var(--accent)', icon: 'code', label: '代码' },
  design: { color: 'var(--accent)', icon: 'design', label: '设计' },
  content: { color: 'var(--warning)', icon: 'content', label: '内容' },
  security: { color: 'var(--danger)', icon: 'security', label: '安全' },
};

export const TREND_META: Record<string, { color: string; icon: IconKey }> = {
  up: { color: 'var(--success)', icon: 'trend-up' },
  down: { color: 'var(--danger)', icon: 'trend-down' },
  stable: { color: 'var(--text-3)', icon: 'trend-stable' },
};
