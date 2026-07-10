import type { CSSProperties } from 'react';

export const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 800,
  display: 'grid',
  placeItems: 'center',
  background: 'color-mix(in srgb, var(--bg-base) 76%, transparent)',
  backdropFilter: 'blur(4px)',
  padding: 'var(--spacing-4)',
};

export const MODAL_STYLE: CSSProperties = {
  position: 'relative',
  width: 'min(880px, calc(100vw - 32px))',
  maxHeight: '92dvh',
  overflowY: 'auto',
  borderRadius: 'var(--radius-xl)',
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  boxShadow: 'var(--shadow-lg)',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
};

export const HERO_PANE_STYLE: CSSProperties = {
  background:
    'linear-gradient(160deg, color-mix(in srgb, var(--accent) 90%, var(--bg-overlay)) 0%, color-mix(in srgb, var(--accent) 55%, var(--bg-overlay)) 100%)',
  color: 'var(--fg-on-accent)',
  padding: 'var(--spacing-6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--spacing-4)',
  position: 'relative',
  overflow: 'hidden',
};

export const HERO_DECOR_STYLE: CSSProperties = {
  position: 'absolute',
  right: 'var(--spacing-6)',
  top: 'var(--spacing-6)',
  width: 'calc(var(--spacing-12) * 2)',
  height: 1,
  background: 'linear-gradient(90deg, transparent, var(--accent-border))',
  pointerEvents: 'none',
};

export const HERO_DECOR_2_STYLE: CSSProperties = {
  position: 'absolute',
  left: 'var(--spacing-6)',
  bottom: 'var(--spacing-6)',
  width: 'calc(var(--spacing-12) * 2 + var(--spacing-6))',
  height: 1,
  background: 'linear-gradient(90deg, var(--contrast-border), transparent)',
  pointerEvents: 'none',
};

export const HERO_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--spacing-1)',
  padding: '4px 10px',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--accent-border)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0,
  alignSelf: 'flex-start',
  textTransform: 'uppercase',
  position: 'relative',
};

export const HERO_TITLE_STYLE: CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  lineHeight: 1.3,
  position: 'relative',
};

export const HERO_DESC_STYLE: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.7,
  color: 'var(--fg-on-accent)',
  position: 'relative',
};

export const HERO_LIST_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--spacing-2)',
  marginTop: 'auto',
  fontSize: 11,
  color: 'var(--fg-on-accent)',
  position: 'relative',
};

export const HERO_LIST_ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--spacing-2)',
  lineHeight: 1.5,
};

export const HERO_LIST_ICON_STYLE: CSSProperties = {
  width: '18px',
  height: '18px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-border)',
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
};

export const FORM_PANE_STYLE: CSSProperties = {
  padding: 'var(--spacing-6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--spacing-4)',
  minWidth: 0,
};

export const FORM_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 'var(--spacing-3)',
};

export const FIELD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--spacing-1)',
};

export const LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-default)',
};

export const HINT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

export const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base))',
  color: 'var(--fg-strong)',
  fontSize: 13,
  fontFamily: 'inherit',
  transition: 'border-color 120ms ease',
};

export const INPUT_ERROR_STYLE: CSSProperties = {
  ...INPUT_STYLE,
  borderColor: 'var(--danger)',
};

export const TEXTAREA_STYLE: CSSProperties = {
  ...INPUT_STYLE,
  resize: 'vertical',
  minHeight: 'calc(var(--spacing-8) + var(--spacing-6))',
};

export const ACTIONS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 'var(--spacing-2)',
  marginTop: 'var(--spacing-1)',
};

export const PRIMARY_BUTTON_STYLE: CSSProperties = {
  padding: '9px 22px',
  borderRadius: 'var(--radius-md)',
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--spacing-1)',
  transition:
    'background var(--dur-micro) var(--ease-micro), transform var(--dur-micro) var(--ease-micro), box-shadow var(--dur-micro) var(--ease-micro)',
};

export const SECONDARY_BUTTON_STYLE: CSSProperties = {
  padding: '9px 18px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 13,
  cursor: 'pointer',
  transition:
    'background var(--dur-micro) var(--ease-micro), border-color var(--dur-micro) var(--ease-micro), color var(--dur-micro) var(--ease-micro)',
};

export const ERROR_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--danger)',
  background: 'var(--danger-muted)',
  padding: 'var(--spacing-2) var(--spacing-3)',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--danger-border)',
};

export const FIELD_ERROR_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--danger)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-1)',
};

export const HEADER_TITLE_STYLE: CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  color: 'var(--fg-strong)',
};

export const HEADER_DESC_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
  marginTop: 'var(--spacing-1)',
};
