/**
 * 模板列表侧边栏（按分组显示）。
 *
 * 分组：推荐起步 / 系统默认 / 我的模板
 * 每张卡片展示：模板名 + scale + 重点 + 成员人数 + 五层进度色条
 */

import { useMemo, useState, type CSSProperties } from 'react';
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
  /** 收藏 / 使用偏好（可选，未传时降级为无收藏/统计）。 */
  isFavorite?: (templateId: string) => boolean;
  onToggleFavorite?: (templateId: string) => void;
  usage?: Record<string, number>;
  recentIds?: Record<string, number>;
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

type GroupFilter = 'all' | 'recommended' | 'system' | 'user';

const GROUP_FILTER_OPTIONS: Array<{ value: GroupFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'recommended', label: '推荐' },
  { value: 'system', label: '系统' },
  { value: 'user', label: '我的' },
];

/** 模板可被搜索匹配的文本：名称 + 描述 + 重点 + 适用场景 + 成员显示名。 */
export function templateSearchHaystack(template: WorkflowTemplateRecord): string {
  const team = (template.metadata as WorkflowTemplateMetadata | undefined)?.teamTemplate;
  const memberNames = Array.isArray(team?.memberSlots)
    ? team.memberSlots.map((s) => s.displayName).join(' ')
    : '';
  return [
    template.name,
    template.description ?? '',
    team?.templateFocus ?? '',
    team?.recommendedFor ?? '',
    memberNames,
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * 组内排序比较器：最近使用（时间倒序）→ 使用次数（多→少）→ 维持原相对次序。
 *
 * 让「最近用过 / 常用」的模板在各分组内自然上浮（使统计不再只是装饰）。
 * 返回 0 时数组 sort 的稳定性保证保持原相对次序。
 */
export function compareByUsagePreference(
  a: WorkflowTemplateRecord,
  b: WorkflowTemplateRecord,
  recentIds?: Record<string, number>,
  usage?: Record<string, number>,
): number {
  const recentA = recentIds?.[a.id] ?? 0;
  const recentB = recentIds?.[b.id] ?? 0;
  if (recentA !== recentB) return recentB - recentA;
  const usageA = usage?.[a.id] ?? 0;
  const usageB = usage?.[b.id] ?? 0;
  if (usageA !== usageB) return usageB - usageA;
  return 0;
}

export function TemplateListSidebar({
  templates,
  selectedId,
  loading,
  onSelect,
  onCreate,
  canCreate,
  isFavorite,
  onToggleFavorite,
  usage,
  recentIds,
}: Props) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');

  // 先按搜索词 + 分组筛选，再分组排序。
  const filteredTemplates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (groupFilter !== 'all' && getGroup(t).id !== groupFilter) return false;
      if (needle && !templateSearchHaystack(t).includes(needle)) return false;
      return true;
    });
  }, [templates, search, groupFilter]);

  // 最近使用的前 3 个 id（按时间倒序），用于卡片上的「最近」标记。
  const recentTopIds = useMemo(() => {
    if (!recentIds) return new Set<string>();
    return new Set(
      Object.entries(recentIds)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id]) => id),
    );
  }, [recentIds]);

  // Group + sort（收藏单独提到最前的「收藏」组）。
  const grouped = new Map<
    string,
    { label: string; priority: number; items: WorkflowTemplateRecord[] }
  >();
  for (const template of filteredTemplates) {
    const favored = isFavorite?.(template.id) ?? false;
    const group = favored ? { id: 'favorite', label: '★ 收藏', priority: -1 } : getGroup(template);
    const existing = grouped.get(group.id);
    if (existing) {
      existing.items.push(template);
    } else {
      grouped.set(group.id, { label: group.label, priority: group.priority, items: [template] });
    }
  }
  // 组内排序：最近使用（时间倒序）→ 使用次数（多→少）→ 保持原相对次序，
  // 让「最近用过 / 常用」的模板在各分组内自然上浮（统计不再只是装饰）。
  for (const group of grouped.values()) {
    group.items.sort((a, b) => compareByUsagePreference(a, b, recentIds, usage));
  }
  const sortedGroups = Array.from(grouped.values()).sort((a, b) => a.priority - b.priority);
  const filtering = search.trim().length > 0 || groupFilter !== 'all';

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
        {/* Search + group filter (hidden during initial skeleton) */}
        {!(loading && templates.length === 0) && templates.length > 0 && (
          <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
            <div style={{ position: 'relative' }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索模板 / 成员…"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 26px 6px 9px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-base)',
                  color: 'var(--fg-strong)',
                  fontSize: 11,
                  outline: 'none',
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  title="清除"
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    appearance: 'none',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--fg-muted)',
                    cursor: 'pointer',
                    fontSize: 12,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {GROUP_FILTER_OPTIONS.map((opt) => {
                const active = groupFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setGroupFilter(opt.value)}
                    style={{
                      flex: 1,
                      appearance: 'none',
                      border: active
                        ? '1px solid color-mix(in oklch, var(--accent) 55%, transparent)'
                        : '1px solid var(--border-subtle)',
                      background: active
                        ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                        : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--fg-muted)',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '4px 0',
                      borderRadius: 7,
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
        ) : sortedGroups.length === 0 ? (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              gap: 8,
              padding: '32px 16px',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
              没有匹配的模板。
            </span>
            {filtering && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setGroupFilter('all');
                }}
                style={{
                  appearance: 'none',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  color: 'var(--accent)',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '4px 12px',
                  borderRadius: 7,
                  cursor: 'pointer',
                }}
              >
                清除筛选
              </button>
            )}
          </div>
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
                    favorite={isFavorite?.(template.id) ?? false}
                    onToggleFavorite={
                      onToggleFavorite ? () => onToggleFavorite(template.id) : undefined
                    }
                    usageCount={usage?.[template.id] ?? 0}
                    recent={recentTopIds.has(template.id)}
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
  favorite,
  onToggleFavorite,
  usageCount,
  recent,
}: {
  template: WorkflowTemplateRecord;
  selected: boolean;
  onClick: () => void;
  favorite: boolean;
  onToggleFavorite?: () => void;
  usageCount: number;
  recent: boolean;
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
    position: 'relative',
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
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="ui-hover-surface"
      style={cardStyle}
    >
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
        {recent && (
          <span
            title="最近使用过"
            style={{
              flexShrink: 0,
              fontSize: 8,
              fontWeight: 700,
              color: 'var(--accent)',
              padding: '1px 5px',
              borderRadius: 999,
              background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
            }}
          >
            最近
          </span>
        )}
        {usageCount > 0 && (
          <span
            title={`已使用 ${usageCount} 次`}
            style={{ fontSize: 9, color: 'var(--fg-muted)', flexShrink: 0 }}
          >
            ×{usageCount}
          </span>
        )}
        <span style={{ fontSize: 9, color: 'var(--fg-muted)', flexShrink: 0 }}>{total} 人</span>
        {onToggleFavorite && (
          <span
            role="button"
            tabIndex={0}
            title={favorite ? '取消收藏' : '收藏（置顶）'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite();
              }
            }}
            style={{
              flexShrink: 0,
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1,
              color: favorite ? 'var(--warning)' : 'var(--fg-subtle)',
            }}
          >
            {favorite ? '★' : '☆'}
          </span>
        )}
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
    </div>
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
