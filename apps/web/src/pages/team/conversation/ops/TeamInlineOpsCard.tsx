import type { CSSProperties } from 'react';

/* ── tone config ─────────────────────────────────────────────── */

const TONE_TINT: Record<string, string> = {
  progress: 'var(--color-info, #3b82f6)',
  block: 'var(--color-warning, #eab308)',
  fail: 'var(--color-danger, #ef4444)',
  done: 'var(--color-success, #22c55e)',
};

/* ── style constants ─────────────────────────────────────────── */

function cardStyle(tone: string): CSSProperties {
  const tint = TONE_TINT[tone] ?? 'var(--fg-muted)';
  return {
    display: 'flex',
    gap: 0,
    borderRadius: 10,
    border: `1px solid color-mix(in srgb, ${tint} 25%, transparent)`,
    background: 'var(--bg-overlay)',
    overflow: 'hidden',
  };
}

const COLOR_BAR_STYLE: CSSProperties = {
  width: 3,
  flexShrink: 0,
  alignSelf: 'stretch',
  borderRadius: '10px 0 0 10px',
};

function colorBarTint(tone: string): CSSProperties {
  return { background: TONE_TINT[tone] ?? 'var(--fg-muted)' };
}

const BODY_WRAP: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flex: 1,
  minWidth: 0,
  padding: '7px 10px 7px 8px',
};

const TITLE_STYLE: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  lineHeight: '17px',
  color: 'var(--fg-default)',
};

const TEXT_STYLE: CSSProperties = {
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--fg-muted)',
};

const TIME_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const CODE_STYLE: CSSProperties = {
  fontSize: 10.5,
  fontFamily: 'var(--font-mono, monospace)',
  padding: '2px 6px',
  borderRadius: 4,
  background: 'color-mix(in srgb, var(--fg-muted) 8%, transparent)',
  color: 'var(--fg-muted)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  maxHeight: 60,
  overflow: 'auto',
};

const ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};

function btnStyle(variant?: string): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: '18px',
    cursor: 'pointer',
    border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
    background: 'color-mix(in srgb, var(--bg-overlay) 80%, transparent)',
    color: 'var(--fg-muted)',
    transition: 'background 160ms ease, color 120ms ease',
  };
  if (variant === 'primary') {
    return {
      ...base,
      background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
      color: 'var(--accent)',
      borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
    };
  }
  if (variant === 'danger') {
    return {
      ...base,
      background: 'color-mix(in srgb, var(--color-danger, #ef4444) 12%, transparent)',
      color: 'var(--color-danger, #ef4444)',
      borderColor: 'color-mix(in srgb, var(--color-danger, #ef4444) 25%, transparent)',
    };
  }
  return base;
}

const ARTIFACT_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 6,
  fontSize: 10.5,
  fontWeight: 500,
  lineHeight: '18px',
  cursor: 'pointer',
  border: '1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-muted)',
  textDecoration: 'underline',
  textDecorationStyle: 'dotted',
  textDecorationColor: 'color-mix(in srgb, var(--fg-muted) 40%, transparent)',
  transition: 'color 120ms ease',
};

const DONE_NOTE_STYLE: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 500,
  color: 'var(--color-success, #22c55e)',
  whiteSpace: 'nowrap',
};

/* ── props ───────────────────────────────────────────────────── */

export interface InlineOpsAction {
  id: string;
  label: string;
  variant?: 'primary' | 'danger' | 'default';
  onClick?: () => void;
}

export interface InlineOpsArtifact {
  id: string;
  label: string;
  onClick?: () => void;
}

export interface TeamInlineOpsCardProps {
  tone: 'progress' | 'block' | 'fail' | 'done';
  title: string;
  body?: string;
  timeLabel?: string;
  code?: string;
  actions?: InlineOpsAction[];
  artifacts?: InlineOpsArtifact[];
  doneNote?: string;
}

/* ── component ───────────────────────────────────────────────── */

export function TeamInlineOpsCard({
  tone,
  title,
  body,
  timeLabel,
  code,
  actions,
  artifacts,
  doneNote,
}: TeamInlineOpsCardProps) {
  return (
    <div style={cardStyle(tone)}>
      <div style={{ ...COLOR_BAR_STYLE, ...colorBarTint(tone) }} />
      <div style={BODY_WRAP}>
        {/* header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={TITLE_STYLE}>{title}</span>
          {timeLabel != null && timeLabel !== '' && <span style={TIME_STYLE}>{timeLabel}</span>}
          {doneNote != null && doneNote !== '' && <span style={DONE_NOTE_STYLE}>{doneNote}</span>}
        </div>

        {/* body */}
        {body != null && body !== '' && <span style={TEXT_STYLE}>{body}</span>}

        {/* code */}
        {code != null && code !== '' && (
          <pre style={CODE_STYLE}>
            <code>{code}</code>
          </pre>
        )}

        {/* actions row */}
        {((actions != null && actions.length > 0) ||
          (artifacts != null && artifacts.length > 0)) && (
          <div style={ACTIONS_STYLE}>
            {actions?.map((a) => (
              <button key={a.id} type="button" style={btnStyle(a.variant)} onClick={a.onClick}>
                {a.label}
              </button>
            ))}
            {artifacts?.map((ar) => (
              <button key={ar.id} type="button" style={ARTIFACT_BTN_STYLE} onClick={ar.onClick}>
                {ar.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
