import { useCallback, useState, type CSSProperties } from 'react';
import { EmptyState } from '../../shared/content-kit/index.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import type {
  HandoffEntry,
  LayerNode,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { CONVERSATION_SECTION_HEADER_STYLE } from './conversation-shared-styles.js';

// ─── Types ────────────────────────────────────────────────────────────

/** 按目标会话聚合后的交接记录组（一个对话 = 一个 toSessionId）。 */
export interface SessionHandoffGroup {
  /** 聚合键：目标会话 ID。 */
  sessionId: string;
  /** 该会话下的所有 handoff 条目（按 updatedAt 降序）。 */
  entries: HandoffEntry[];
  /** 目标层级角色。 */
  toRoleLayer: TeamRoleLayer;
  /** 来源层级角色（取自最新一条 handoff）。 */
  fromRoleLayer: TeamRoleLayer;
  /** 综合状态：优先取最新条目的状态。 */
  state: HandoffEntry['state'];
  /** 最新摘要（取自最新有 summary 的条目）。 */
  summary: string | undefined;
  /** 最新更新时间。 */
  updatedAt: number;
}

export interface LayerFlowTimelineSection {
  /** 该层下的会话分组（替代原来的 items: HandoffEntry[]）。 */
  groups: SessionHandoffGroup[];
  layer: TeamRoleLayer;
}

// ─── Styles ──────────────────────────────────────────────────────────

const TIMELINE_SCROLL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  gap: 16,
  padding: '12px',
  alignContent: 'start',
};

const TIMELINE_SECTION_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const TIMELINE_SECTION_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 4px',
  borderRadius: 'var(--radius-sm, 6px)',
  background: 'color-mix(in srgb, var(--bg-overlay) 50%, transparent)',
  borderBottom:
    '1px solid color-mix(in srgb, var(--border-subtle, var(--border-default)) 40%, transparent)',
};

const TIMELINE_SECTION_TITLE_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const TIMELINE_SECTION_META_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
  marginLeft: 'auto',
  padding: '1px 6px',
  borderRadius: 'var(--radius-pill, 9999px)',
  background: 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
};

const STATE_LABELS: Record<string, string> = {
  idle: '空闲',
  pending: '等待中',
  claimed: '已认领',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATE_COLOR: Record<string, string> = {
  idle: 'var(--fg-muted)',
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--accent)',
  failed: 'var(--danger)',
  cancelled: 'var(--fg-muted)',
};

// ─── Session Group Row (可展开的会话级行) ───────────────────────────

function SessionGroupRow({
  group,
  expanded,
  onToggle,
  onSelectHandoff,
  selectedHandoffId,
  toDisplayName,
}: {
  group: SessionHandoffGroup;
  expanded: boolean;
  onToggle: () => void;
  onSelectHandoff: (entry: HandoffEntry) => void;
  selectedHandoffId: string | null;
  toDisplayName?: string | null;
}) {
  const toId = getRoleLayerIdentity(group.toRoleLayer);
  const fromId = getRoleLayerIdentity(group.fromRoleLayer);
  const color = STATE_COLOR[group.state] ?? 'var(--fg-muted)';
  const isSelected = group.entries.some((e) => e.id === selectedHandoffId);

  const borderStyle = isSelected
    ? `1px solid color-mix(in srgb, ${color} 55%, transparent)`
    : '1px solid color-mix(in srgb, var(--border-default) 35%, transparent)';

  const backgroundStyle = isSelected
    ? `color-mix(in srgb, ${color} 8%, var(--bg-overlay))`
    : 'color-mix(in srgb, var(--bg-overlay) 75%, var(--bg-base))';

  return (
    <div style={{ display: 'grid', gap: 2 }}>
      {/* 会话级行 */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="team-card-soft"
        style={{
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          padding: '10px 10px 10px 12px',
          borderRadius: 'var(--radius-md, 8px)',
          border: borderStyle,
          background: backgroundStyle,
          cursor: 'pointer',
          width: '100%',
          position: 'relative',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        {/* 左侧色条 */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 8,
            bottom: 8,
            width: 3,
            borderRadius: 'var(--radius-pill, 9999px)',
            background: toId.color,
            opacity: isSelected ? 1 : 0.5,
          }}
        />
        {/* 头部行：来源 → 目标 | 状态 | 数量 */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {/* 展开/收起箭头 */}
          <span
            aria-hidden
            style={{
              fontSize: 9,
              color: 'var(--fg-subtle)',
              transition: 'transform 0.2s ease',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 12,
              flexShrink: 0,
            }}
          >
            ▶
          </span>
          <span aria-hidden style={{ fontSize: 12 }}>
            {fromId.icon}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-strong)' }}>
            {fromId.short}
          </span>
          <span aria-hidden style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
            →
          </span>
          <span aria-hidden style={{ fontSize: 12 }}>
            {toId.icon}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-strong)' }}>
            {toId.short}
          </span>
          {toDisplayName ? (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm, 6px)',
                background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                color: 'var(--accent)',
                maxWidth: 80,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={toDisplayName}
            >
              {toDisplayName}
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '1px 7px',
              borderRadius: 'var(--radius-pill, 9999px)',
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
              color,
            }}
          >
            {STATE_LABELS[group.state] ?? group.state}
          </span>
          {/* 消息数量角标 */}
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--fg-subtle)',
              padding: '0 4px',
              borderRadius: 'var(--radius-sm, 4px)',
              background: 'color-mix(in srgb, var(--fg-subtle) 8%, transparent)',
            }}
          >
            {group.entries.length} 条消息
          </span>
        </span>
        {/* 摘要行（只显示最新一条的摘要） */}
        {group.summary ? (
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-muted)',
              lineHeight: 1.45,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              paddingLeft: 17,
            }}
          >
            {group.summary}
          </span>
        ) : null}
        {/* 时间 */}
        <span
          style={{
            fontSize: 9,
            color: 'var(--fg-subtle)',
            fontVariantNumeric: 'tabular-nums',
            paddingLeft: 17,
          }}
        >
          {new Date(group.updatedAt).toLocaleTimeString('zh-CN')}
        </span>
      </button>

      {/* 展开的子项列表 */}
      {expanded ? (
        <div
          style={{
            display: 'grid',
            gap: 3,
            paddingLeft: 16,
            paddingTop: 4,
            paddingBottom: 4,
            borderLeft: '2px solid color-mix(in srgb, var(--border-subtle) 50%, transparent)',
            marginLeft: 10,
          }}
        >
          {group.entries.map((entry) => {
            const entryColor = STATE_COLOR[entry.state] ?? 'var(--fg-muted)';
            const entrySelected = selectedHandoffId === entry.id;

            const entryBorderStyle = entrySelected
              ? `1px solid color-mix(in srgb, ${entryColor} 45%, transparent)`
              : '1px solid color-mix(in srgb, var(--border-default) 25%, transparent)';

            const entryBackgroundStyle = entrySelected
              ? `color-mix(in srgb, ${entryColor} 6%, var(--bg-overlay))`
              : 'color-mix(in srgb, var(--bg-overlay) 50%, var(--bg-base))';

            return (
              <button
                key={entry.id}
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelectHandoff(entry);
                }}
                className="team-card-soft"
                style={{
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  padding: '6px 8px 6px 10px',
                  borderRadius: 'var(--radius-sm, 6px)',
                  border: entryBorderStyle,
                  background: entryBackgroundStyle,
                  cursor: 'pointer',
                  width: '100%',
                  transition: 'border-color 0.12s, background 0.12s',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '0 5px',
                      borderRadius: 'var(--radius-pill, 9999px)',
                      background: `color-mix(in srgb, ${entryColor} 12%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${entryColor} 22%, transparent)`,
                      color: entryColor,
                      flexShrink: 0,
                    }}
                  >
                    {STATE_LABELS[entry.state] ?? entry.state}
                  </span>
                  {entry.summary ? (
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--fg-default)',
                        lineHeight: 1.35,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                      title={entry.summary}
                    >
                      {entry.summary}
                    </span>
                  ) : (
                    <span style={{ flex: 1, fontSize: 10, color: 'var(--fg-subtle)' }}>
                      （无摘要）
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: 8,
                    color: 'var(--fg-subtle)',
                    fontVariantNumeric: 'tabular-nums',
                    paddingLeft: 2,
                  }}
                >
                  {new Date(entry.updatedAt).toLocaleTimeString('zh-CN')}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────

export interface LayerFlowTimelinePanelProps {
  sections: LayerFlowTimelineSection[];
  selectedHandoffId: string | null;
  onSelectHandoff: (entry: HandoffEntry) => void;
  /** layer store nodes，用于查找 handoff 目标 session 的角色实例名称 */
  nodes?: Map<string, LayerNode>;
}

// ─── Panel ──────────────────────────────────────────────────────────

export function LayerFlowTimelinePanel({
  sections,
  selectedHandoffId,
  onSelectHandoff,
  nodes,
}: LayerFlowTimelinePanelProps) {
  /** 展开状态：key = sessionId */
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((sessionId: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  return (
    <>
      <div style={CONVERSATION_SECTION_HEADER_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>层级交接记录</strong>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          按层级角色的会话聚合查看，点击展开查看每条交接详情。
        </span>
      </div>
      <div style={TIMELINE_SCROLL_STYLE}>
        {sections.length === 0 ? (
          <EmptyState emoji="📭" title="暂无层间消息" compact style={{ flex: 1 }} />
        ) : (
          sections.map((section) => {
            const identity = getRoleLayerIdentity(section.layer);
            return (
              <section key={section.layer} style={TIMELINE_SECTION_STYLE}>
                <div style={TIMELINE_SECTION_HEADER_STYLE}>
                  <span style={TIMELINE_SECTION_TITLE_STYLE}>
                    <span
                      aria-hidden
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 18,
                        height: 18,
                        borderRadius: 'var(--radius-sm, 6px)',
                        background: `color-mix(in srgb, ${identity.color} 14%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${identity.color} 30%, transparent)`,
                        fontSize: 10,
                      }}
                    >
                      {identity.icon}
                    </span>
                    {identity.label}
                  </span>
                  <span style={TIMELINE_SECTION_META_STYLE}>
                    {section.groups.length} 个会话 ·{' '}
                    {section.groups.reduce((sum, g) => sum + g.entries.length, 0)} 条记录
                  </span>
                </div>
                {section.groups.map((group) => {
                  const targetNode = nodes ? (nodes.get(group.sessionId) ?? null) : null;
                  return (
                    <SessionGroupRow
                      key={group.sessionId}
                      group={group}
                      expanded={expandedKeys.has(group.sessionId)}
                      onToggle={() => toggleExpand(group.sessionId)}
                      onSelectHandoff={onSelectHandoff}
                      selectedHandoffId={selectedHandoffId}
                      toDisplayName={targetNode ? (targetNode.displayName ?? null) : null}
                    />
                  );
                })}
              </section>
            );
          })
        )}
      </div>
    </>
  );
}
