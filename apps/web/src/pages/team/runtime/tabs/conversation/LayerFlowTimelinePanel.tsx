import { useCallback, useState, type CSSProperties } from 'react';
import { EmptyState } from '../../shared/content-kit/index.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import type {
  HandoffEntry,
  LayerNode,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { CONVERSATION_SECTION_HEADER_STYLE } from './conversation-shared-styles.js';
import { SessionGroupRow, type SessionHandoffGroup } from './LayerFlowSessionGroupRow.js';

// ─── Types ────────────────────────────────────────────────────────────

export type { SessionHandoffGroup } from './LayerFlowSessionGroupRow.js';

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
  whiteSpace: 'nowrap',
  wordBreak: 'keep-all',
  overflowWrap: 'normal',
  flexShrink: 0,
};

const TIMELINE_SECTION_META_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
  wordBreak: 'keep-all',
  overflowWrap: 'normal',
  fontVariantNumeric: 'tabular-nums',
  marginLeft: 'auto',
  padding: '1px 6px',
  borderRadius: 'var(--radius-pill, 9999px)',
  background: 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
  flexShrink: 0,
};

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
