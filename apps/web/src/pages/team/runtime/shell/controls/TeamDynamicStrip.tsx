import { useState, type CSSProperties } from 'react';
import type { TeamDynamicEntry, TeamDynamicTone } from './team-dynamic-events.js';

const COLLAPSED_VISIBLE_ENTRY_COUNT = 2;
const COLLAPSED_VISIBLE_ACTION_COUNT = 2;

// ─── 容器 ──────────────────────────────────────────────────────────
// 全宽、紧贴 composer 上方，不再用 78% 左对齐制造空洞。
const STRIP_WRAPPER_STYLE: CSSProperties = {
  width: '100%',
  flexShrink: 0,
  margin: '2px 0 0',
};

const STRIP_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  width: '100%',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base)) 0%, color-mix(in srgb, var(--bg-overlay) 70%, transparent) 100%)',
  boxShadow: 'var(--shadow-sm)',
  overflow: 'hidden',
};

// ─── 头部 ──────────────────────────────────────────────────────────
const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 10px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-subtle) 60%, transparent)',
  flexShrink: 0,
};

const HEADER_TITLE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
};

const HEADER_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--fg-muted)',
};

const HEADER_COUNT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 5px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  color: 'var(--accent)',
  fontSize: 9.5,
  fontWeight: 800,
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
};

// ─── 卡片列表 ──────────────────────────────────────────────────────
// 不再使用独立 overflow:auto —— 展开时全部展示，由外层布局自然撑高。
// 避免在 composer 上方出现第二个滚动条。
const LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

// ─── 单条卡片 ──────────────────────────────────────────────────────
const CARD_BASE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '7px 10px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-subtle) 40%, transparent)',
  transition: 'background 120ms ease',
};

const CARD_ICON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  minWidth: 18,
  borderRadius: 5,
  fontSize: 10,
  fontWeight: 800,
  flexShrink: 0,
  marginTop: 1,
};

const CARD_BODY_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  flex: 1,
};

const CARD_TITLE_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
};

const CARD_TITLE_STYLE: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  lineHeight: 1.35,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  flexShrink: 1,
};

const CARD_SUMMARY_STYLE: CSSProperties = {
  fontSize: 11.5,
  color: 'var(--fg-default)',
  lineHeight: 1.4,
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical',
};

const TIME_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-subtle)',
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
  marginLeft: 'auto',
};

const ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  marginTop: 2,
};

// ─── 底部展开按钮 ──────────────────────────────────────────────────
const FOOTER_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '4px 0',
};

const TOGGLE_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 20,
  padding: '0 10px',
  borderRadius: 'var(--radius-pill, 9999px)',
  border: 'none',
  background: 'transparent',
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'background 120ms ease',
};

// ─── 色彩 ──────────────────────────────────────────────────────────
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

function chipStyle(color: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '1px 5px',
    borderRadius: 4,
    border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
    background: `color-mix(in srgb, ${color} 8%, transparent)`,
    color,
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: '0.01em',
    flexShrink: 0,
  };
}

// ─── 卡片组件 ──────────────────────────────────────────────────────
function TeamDynamicCard({ entry }: { entry: TeamDynamicEntry }) {
  const color = toneColor(entry.tone);
  const visibleActions = entry.actions?.slice(0, COLLAPSED_VISIBLE_ACTION_COUNT) ?? [];
  const hiddenActionCount = Math.max(0, (entry.actions?.length ?? 0) - visibleActions.length);

  return (
    <article style={CARD_BASE_STYLE}>
      {/* 色调图标 */}
      <span
        aria-hidden="true"
        style={{
          ...CARD_ICON_STYLE,
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          color,
          border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
        }}
      >
        {toneIcon(entry.tone)}
      </span>

      {/* 主体内容 */}
      <div style={CARD_BODY_STYLE}>
        {/* 标题行：标题 + 计数 + 时间 */}
        <div style={CARD_TITLE_ROW_STYLE}>
          <strong style={CARD_TITLE_STYLE}>{entry.title}</strong>
          {entry.count > 1 ? (
            <span
              style={{
                ...chipStyle('var(--fg-muted)'),
                color: 'var(--fg-default)',
              }}
            >
              ×{entry.count}
            </span>
          ) : null}
          <time style={TIME_STYLE}>{entry.timeLabel}</time>
        </div>

        {/* 摘要（单行截断，保持简洁） */}
        <div style={CARD_SUMMARY_STYLE}>{entry.summary}</div>

        {/* 层级 + 事件标签 + 动作 */}
        {(entry.layerLabel || entry.eventLabel || visibleActions.length > 0) && (
          <div style={ACTIONS_STYLE}>
            {entry.layerLabel ? <span style={chipStyle(color)}>{entry.layerLabel}</span> : null}
            <span style={chipStyle('var(--fg-muted)')}>{entry.eventLabel}</span>
            {visibleActions.map((action) => (
              <span key={action} style={chipStyle('var(--aux)')}>
                {action}
              </span>
            ))}
            {hiddenActionCount > 0 ? (
              <span
                style={{
                  ...chipStyle('var(--fg-muted)'),
                  color: 'var(--fg-default)',
                }}
              >
                +{hiddenActionCount}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────
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
        {/* 头部 */}
        <div style={HEADER_STYLE}>
          <div style={HEADER_TITLE_STYLE}>
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                minWidth: 6,
                borderRadius: '50%',
                background: 'var(--aux)',
                flexShrink: 0,
              }}
            />
            <span style={HEADER_LABEL_STYLE}>团队动态</span>
          </div>
          <span style={HEADER_COUNT_STYLE}>{entries.length}</span>
        </div>

        {/* 卡片列表 */}
        <div style={LIST_STYLE}>
          {visibleEntries.map((entry) => (
            <TeamDynamicCard key={entry.id} entry={entry} />
          ))}
        </div>

        {/* 展开按钮 */}
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
