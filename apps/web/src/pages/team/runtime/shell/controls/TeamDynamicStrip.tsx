import { useState, type CSSProperties } from 'react';
import type { TeamDynamicEntry, TeamDynamicTone } from './team-dynamic-events.js';

const COLLAPSED_VISIBLE_ENTRY_COUNT = 3;
const COLLAPSED_VISIBLE_ACTION_COUNT = 2;

const STRIP_WRAPPER_STYLE: CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'flex-start',
  margin: '4px 0 0',
};

const STRIP_STYLE: CSSProperties = {
  display: 'grid',
  gap: 5,
  width: '78%',
  maxWidth: '100%',
  padding: '7px 9px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 55%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base)) 0%, color-mix(in srgb, var(--bg-overlay) 62%, transparent) 100%)',
  boxShadow: 'var(--shadow-sm)',
  flexShrink: 0,
  maxHeight: 240,
  overflowY: 'auto',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
};

const HEADER_TITLE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
};

const HEADER_LABEL_STYLE: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--fg-muted)',
};

const HEADER_COUNT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 18,
  height: 18,
  padding: '0 6px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-base) 55%, var(--bg-overlay))',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 800,
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
};

const LIST_STYLE: CSSProperties = {
  display: 'grid',
  gap: 5,
};

const CARD_BASE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 5,
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid transparent',
  background: 'color-mix(in srgb, var(--bg-base) 30%, var(--bg-overlay))',
};

const CARD_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
};

const CARD_TITLE_STYLE: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 800,
  color: 'var(--fg-strong)',
  lineHeight: 1.4,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const CARD_SUMMARY_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-default)',
  lineHeight: 1.45,
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
};

const CARD_DETAIL_STYLE: CSSProperties = {
  fontSize: 10.5,
  color: 'var(--fg-muted)',
  lineHeight: 1.35,
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical',
};

const META_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};

const TIME_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
  marginLeft: 'auto',
};

const ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};

const FOOTER_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  paddingTop: 2,
};

const TOGGLE_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 22,
  padding: '0 8px',
  borderRadius: 'var(--radius-pill, 9999px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 58%, transparent)',
  background: 'color-mix(in srgb, var(--bg-base) 52%, var(--bg-overlay))',
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 700,
  cursor: 'pointer',
};

function toneColor(tone: TeamDynamicTone): string {
  switch (tone) {
    case 'danger':
      return 'var(--complement)';
    case 'warning':
      return 'var(--contrast)';
    case 'success':
      return 'var(--accent)';
    default:
      return 'var(--aux)';
  }
}

function toneIcon(tone: TeamDynamicTone): string {
  switch (tone) {
    case 'danger':
      return '!';
    case 'warning':
      return '•';
    case 'success':
      return '✓';
    default:
      return 'i';
  }
}

function badgeStyle(color: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    minHeight: 18,
    padding: '0 6px',
    borderRadius: 999,
    border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
    background: `color-mix(in srgb, ${color} 10%, transparent)`,
    color,
    fontSize: 9.5,
    fontWeight: 800,
    letterSpacing: '0.02em',
  };
}

function TeamDynamicCard({ entry }: { entry: TeamDynamicEntry }) {
  const color = toneColor(entry.tone);
  const accentBadgeStyle = badgeStyle(color);
  const visibleActions = entry.actions?.slice(0, COLLAPSED_VISIBLE_ACTION_COUNT) ?? [];
  const hiddenActionCount = Math.max(0, (entry.actions?.length ?? 0) - visibleActions.length);

  return (
    <article
      style={{
        ...CARD_BASE_STYLE,
        borderColor: `color-mix(in srgb, ${color} 26%, transparent)`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${color} 6%, var(--bg-overlay)) 0%, color-mix(in srgb, var(--bg-base) 18%, transparent) 100%)`,
      }}
    >
      <div style={CARD_HEADER_STYLE}>
        <span
          aria-hidden="true"
          style={{
            ...accentBadgeStyle,
            width: 20,
            minWidth: 20,
            height: 20,
            padding: 0,
            justifyContent: 'center',
            borderRadius: 6,
            flexShrink: 0,
          }}
        >
          {toneIcon(entry.tone)}
        </span>
        <div style={{ display: 'grid', gap: 2, minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <strong style={CARD_TITLE_STYLE}>{entry.title}</strong>
            {entry.count > 1 ? (
              <span style={{ ...badgeStyle('var(--fg-muted)'), color: 'var(--fg-default)' }}>
                ×{entry.count}
              </span>
            ) : null}
            <time style={TIME_STYLE}>{entry.timeLabel}</time>
          </div>
          <div style={META_ROW_STYLE}>
            {entry.layerLabel ? <span style={accentBadgeStyle}>{entry.layerLabel}</span> : null}
            <span style={badgeStyle('var(--fg-muted)')}>{entry.eventLabel}</span>
          </div>
        </div>
      </div>
      <div style={CARD_SUMMARY_STYLE}>{entry.summary}</div>
      {entry.detail && entry.detail !== entry.summary ? (
        <div style={CARD_DETAIL_STYLE}>{entry.detail}</div>
      ) : null}
      {visibleActions.length > 0 ? (
        <div style={ACTIONS_STYLE}>
          {visibleActions.map((action) => (
            <span key={action} style={accentBadgeStyle}>
              {action}
            </span>
          ))}
          {hiddenActionCount > 0 ? (
            <span style={{ ...badgeStyle('var(--fg-muted)'), color: 'var(--fg-default)' }}>
              +{hiddenActionCount}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function TeamDynamicStrip({ entries }: { entries: TeamDynamicEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) {
    return null;
  }

  const visibleEntries = expanded ? entries : entries.slice(0, COLLAPSED_VISIBLE_ENTRY_COUNT);
  const hiddenEntryCount = Math.max(0, entries.length - visibleEntries.length);

  return (
    <section style={STRIP_WRAPPER_STYLE} aria-label="团队推送通知">
      <div style={STRIP_STYLE}>
        <div style={HEADER_STYLE}>
          <div style={HEADER_TITLE_STYLE}>
            <span aria-hidden="true" style={{ color: 'var(--aux)', fontSize: 12 }}>
              ●
            </span>
            <span style={HEADER_LABEL_STYLE}>团队动态</span>
          </div>
          <span style={HEADER_COUNT_STYLE}>{entries.length}</span>
        </div>
        <div style={LIST_STYLE}>
          {visibleEntries.map((entry) => (
            <TeamDynamicCard key={entry.id} entry={entry} />
          ))}
        </div>
        {entries.length > COLLAPSED_VISIBLE_ENTRY_COUNT ? (
          <div style={FOOTER_STYLE}>
            <button
              type="button"
              style={TOGGLE_BUTTON_STYLE}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? '收起动态' : `展开其余 ${hiddenEntryCount} 条`}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
