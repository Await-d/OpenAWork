import type { CSSProperties } from 'react';
import type { createTeamPhaseAClient, SoulRoleLayer } from '@openAwork/web-client';

export type TeamPhaseAClient = ReturnType<typeof createTeamPhaseAClient>;

export const ROLE_LAYER_ORDER: readonly SoulRoleLayer[] = [
  'reception',
  'pm1',
  'pm2',
  'executor',
  'reviewer',
];

export const ROLE_LAYER_LABEL: Record<SoulRoleLayer, string> = {
  reception: '接待',
  pm1: '任务规划 PM1',
  pm2: '开发管控 PM2',
  executor: '执行',
  reviewer: '评审',
};

export const PANEL_INSET_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
};

export const SECTION_HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  paddingBottom: 8,
  borderBottom: '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
};

export const TEXTAREA_STYLE: CSSProperties = {
  width: '100%',
  minHeight: 220,
  padding: 10,
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
  color: 'var(--fg-strong)',
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 12,
  lineHeight: 1.5,
  resize: 'vertical',
};

export const PRIMARY_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 30,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-overlay))',
  color: 'var(--fg-strong)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700,
};

export const SECONDARY_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 30,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
  color: 'var(--fg-default)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

export const TINY_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

export const ERROR_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--danger)',
  paddingTop: 4,
};

export const SUCCESS_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--success)',
  paddingTop: 4,
};

export const CJK_DESCRIPTION_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.6,
  lineBreak: 'strict',
  overflowWrap: 'break-word',
  wordBreak: 'keep-all',
};

export const CJK_DESCRIPTION_STACK_STYLE: CSSProperties = {
  ...CJK_DESCRIPTION_STYLE,
  display: 'grid',
  gap: 4,
};

export const INLINE_PHRASE_STYLE: CSSProperties = {
  whiteSpace: 'nowrap',
};

export interface SaveFeedback {
  kind: 'idle' | 'saving' | 'success' | 'error';
  message?: string;
}
