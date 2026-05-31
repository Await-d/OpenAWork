/**
 * 模板列表侧边栏（按分组显示）。
 *
 * 分组：推荐起步 / 系统默认 / 我的模板
 * 每张卡片展示：模板名 + scale + 重点 + 成员人数 + 五层进度色条
 */

import type { CSSProperties } from 'react';
import { TEAM_RUNTIME_LAYER_ORDER, type FixedTeamMemberSlot } from '@openAwork/shared';
import type { WorkflowTemplateMetadata, WorkflowTemplateRecord } from '@openAwork/web-client';
import { TEAM_LAYER_META } from './template-architecture.js';
import { isSeedTemplate } from './template-roster-state.js';

interface Props {
  templates: WorkflowTemplateRecord[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (templateId: string) => void;
  onCreate: () => void;
  canCreate: boolean;
}

const SCALE_LABELS: Record<string, string> = {
  small: '小型',
  medium: '中型',
  large: '大型',
  full: '完整',
};

function getMemberSlots(template: WorkflowTemplateRecord): FixedTeamMemberSlot[] {
  const team = (template.metadata as WorkflowTemplateMetadata | undefined)?.teamTemplate;
  if (Array.isArray(team?.memberSlots) && team.memberSlots.length > 0) {
    return team.memberSlots;
  }
  // Fallback: derive layer info from nodes (legacy templates)
  return [];
}

function getGroup(template: WorkflowTemplateRecord): {
  id: 'recommended' | 'system' | 'user';
  label: string;
  priority: number;
} {
  if (template.metadata?.teamTemplate?.recommendedDefault) {
    return { id: 'recommended', label: '推荐起步', priority: 0 };
  }
  if (isSeedTemplate(template)) {
    return { id: 'system', label: '系统默认', priority: 1 };
  }
  return { id: 'user', label: '我的模板', priority: 2 };
}

export function TemplateListSidebar({
  templates,
  selectedId,
  loading,
  onSelect,
  onCreate,
  canCreate,
}: Props) {
  // Group + sort
  const grouped = new Map<
    string,
    { label: string; priority: number; items: WorkflowTemplateRecord[] }
  >();
  for (const template of templates) {
    const group = getGroup(template);
    const existing = grouped.get(group.id);
    if (existing) {
      existing.items.push(template);
    } else {
      grouped.set(group.id, { label: group.label, priority: group.priority, items: [template] });
    }
  }
  const sortedGroups = Array.from(grouped.values()).sort((a, b) => a.priority - b.priority);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: '1fr auto',
        height: '100%',
        minWidth: 0,
        overflow: 'hidden',
        background: 'var(--bg-overlay)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ overflowY: 'auto', overflowX: 'hidden', padding: '8px 8px 16px' }}>
        {loading && templates.length === 0 ? (
          <div style={{ display: 'grid', gap: 6, padding: '8px 0' }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: 64,
                  borderRadius: 10,
                  background: 'var(--bg-surface)',
                  opacity: 0.4,
                }}
              />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <EmptyState canCreate={canCreate} onCreate={onCreate} />
        ) : (
          sortedGroups.map((group, gi) => (
            <div key={group.label} style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: 'var(--fg-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  padding: gi === 0 ? '4px 6px' : '8px 6px 4px',
                }}
              >
                {group.label} · {group.items.length}
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                {group.items.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    selected={selectedId === template.id}
                    onClick={() => onSelect(template.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {canCreate && (
        <div style={{ padding: 10, borderTop: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            onClick={onCreate}
            style={{
              width: '100%',
              minHeight: 36,
              borderRadius: 8,
              border: '1px dashed color-mix(in oklch, var(--accent) 50%, transparent)',
              color: 'var(--accent)',
              background: 'color-mix(in oklch, var(--accent) 6%, transparent)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            + 组建新模板
          </button>
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  selected,
  onClick,
}: {
  template: WorkflowTemplateRecord;
  selected: boolean;
  onClick: () => void;
}) {
  const team = template.metadata?.teamTemplate;
  const slots = getMemberSlots(template);
  const layerCounts = new Map<string, number>();
  for (const slot of slots) {
    layerCounts.set(slot.layer, (layerCounts.get(slot.layer) ?? 0) + 1);
  }
  const total = slots.length;
  const focus = team?.templateFocus ?? '';
  const scale = team?.templateScale ? SCALE_LABELS[team.templateScale] : null;

  const cardStyle: CSSProperties = {
    appearance: 'none',
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'left',
    padding: '10px 12px',
    borderRadius: 10,
    border: selected
      ? '1px solid color-mix(in oklch, var(--accent) 70%, transparent)'
      : '1px solid transparent',
    background: selected ? 'color-mix(in oklch, var(--accent) 10%, transparent)' : 'transparent',
    cursor: 'pointer',
    display: 'grid',
    gap: 6,
  };

  return (
    <button type="button" onClick={onClick} className="ui-hover-surface" style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--fg-strong)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {template.name}
        </span>
        <span style={{ fontSize: 9, color: 'var(--fg-muted)', flexShrink: 0 }}>{total} 人</span>
      </div>

      {(focus || scale) && (
        <div
          style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}
        >
          {scale && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--success)',
                padding: '1px 6px',
                borderRadius: 4,
                background: 'color-mix(in oklch, var(--success) 10%, transparent)',
              }}
            >
              {scale}
            </span>
          )}
          {focus && (
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 9,
                color: 'var(--fg-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {focus}
            </span>
          )}
        </div>
      )}

      {/* Layer composition bar */}
      {total > 0 && (
        <div
          style={{
            display: 'flex',
            height: 4,
            borderRadius: 2,
            overflow: 'hidden',
            background: 'var(--bg-surface)',
          }}
        >
          {TEAM_RUNTIME_LAYER_ORDER.map((layer) => {
            const count = layerCounts.get(layer) ?? 0;
            if (count === 0) return null;
            const width = `${(count / total) * 100}%`;
            return (
              <span
                key={layer}
                title={`${TEAM_LAYER_META[layer].label} · ${count} 人`}
                style={{
                  width,
                  background: TEAM_LAYER_META[layer].color,
                  flexShrink: 0,
                }}
              />
            );
          })}
        </div>
      )}
    </button>
  );
}

function EmptyState({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 10,
        placeItems: 'center',
        padding: '40px 16px',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--fg-muted)', maxWidth: 220, lineHeight: 1.6 }}>
        暂无模板。组建一个新模板来沉淀团队 roster。
      </span>
      {canCreate && (
        <button
          type="button"
          onClick={onCreate}
          style={{
            padding: '7px 16px',
            borderRadius: 8,
            border: '1px dashed color-mix(in oklch, var(--accent) 50%, transparent)',
            background: 'color-mix(in oklch, var(--accent) 6%, transparent)',
            color: 'var(--accent)',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          + 组建新模板
        </button>
      )}
    </div>
  );
}
