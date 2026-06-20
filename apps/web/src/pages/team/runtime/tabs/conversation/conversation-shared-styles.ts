import type { CSSProperties } from 'react';

export const CONVERSATION_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 700,
};

export const CONVERSATION_INFO_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
};

export const CONVERSATION_SECTION_HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '12px 14px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
  flexShrink: 0,
};

export const CONVERSATION_META_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
};
