import type { ReactNode } from 'react';
import type { GraphRoleLayer } from '../../data/build-knowledge-graph.js';
import { workspaceKnowledgeRoleLayerFromSearchTerm } from '../../data/workspace-knowledge-key-classification.js';
import {
  type KnowledgeGraphColorMode,
  type KnowledgeGraphLabelDensity,
} from './graph/knowledge-graph-canvas.js';
import {
  MAX_KNOWLEDGE_SEARCH_LENGTH,
  ROLE_LAYER_LABELS,
  ROLE_LAYER_ORDER,
} from './graph/knowledge-graph-constants.js';
import {
  SegmentedToggle,
  type SegmentedToggleOption,
} from '../../shared/content-kit/SegmentedToggle.js';

export type LocalGraphDepth = 0 | 1 | 2 | 3;

/** 可见折叠分组的「展开 <分组>」控件；`blocked` 为真时该分组在当前视口下无法展开。 */
export interface GraphExpandGroupControl {
  readonly id: string;
  readonly label: string;
  readonly blocked: boolean;
}

export interface GraphToolbarProps {
  activeRoleLayer: GraphRoleLayer | null;
  appliedQuery: string;
  colorMode: KnowledgeGraphColorMode;
  hideOrphans: boolean;
  labelDensity: KnowledgeGraphLabelDensity;
  localGraphEnabled: boolean;
  localGraphAutoApplied: boolean;
  localGraphDepth: LocalGraphDepth;
  queryDraft: string;
  onApplyQuery: () => void;
  onCollapseAll?: () => void;
  onColorModeChange: (mode: KnowledgeGraphColorMode) => void;
  onClearQuery: () => void;
  onExpandAll?: () => void;
  /** 规模感知：图谱过大时禁用「展开全部」，改由点击分组逐层钻取。 */
  expandAllDisabled?: boolean;
  /** 禁用原因；渲染为 `title` 与 `aria-describedby`，让鼠标与读屏都能得到解释。 */
  expandAllDisabledReason?: string;
  /** 可见的折叠分组：逐组展开入口，被容量拒绝的分组渲染为禁用态。 */
  expandGroups?: readonly GraphExpandGroupControl[];
  onExpandGroup?: (nodeId: string) => void;
  onHideOrphansChange: (hide: boolean) => void;
  onLabelDensityChange: (density: KnowledgeGraphLabelDensity) => void;
  onLocalGraphDepthChange: (depth: LocalGraphDepth) => void;
  onUseAutoLocalGraph: () => void;
  onSelectRoleLayer: (roleLayer: GraphRoleLayer | null) => void;
  onQueryDraftChange: (value: string) => void;
}

/** 分组被容量拒绝时的提示；与顶部容量横幅同义，用于 `title`。 */
const EXPAND_GROUP_BLOCKED_HINT =
  '当前容器尺寸下该分组的子节点过多，无法展开；请放大窗口或使用搜索定位。';

export function GraphToolbar({
  activeRoleLayer,
  appliedQuery,
  colorMode,
  hideOrphans,
  labelDensity,
  localGraphEnabled,
  localGraphAutoApplied,
  localGraphDepth,
  queryDraft,
  onApplyQuery,
  onCollapseAll,
  onColorModeChange,
  onClearQuery,
  onExpandAll,
  expandAllDisabled,
  expandAllDisabledReason,
  expandGroups,
  onExpandGroup,
  onHideOrphansChange,
  onLabelDensityChange,
  onLocalGraphDepthChange,
  onUseAutoLocalGraph,
  onSelectRoleLayer,
  onQueryDraftChange,
}: GraphToolbarProps) {
  const normalizedQueryDraft = queryDraft.trim();
  const inferredRoleLayer = workspaceKnowledgeRoleLayerFromSearchTerm(normalizedQueryDraft);
  const effectiveQueryDraft = inferredRoleLayer === undefined ? normalizedQueryDraft : '';
  const queryApplyDisabled =
    effectiveQueryDraft === appliedQuery &&
    (inferredRoleLayer === undefined || inferredRoleLayer === activeRoleLayer);

  const roleLayerValue = activeRoleLayer ?? '__all__';
  const effectiveDepth = localGraphEnabled && !localGraphAutoApplied ? localGraphDepth : 0;

  return (
    <div className="workspace-knowledge-graph-toolbar">
      {/* 第一行：搜索框 + 着色 + 标签 + 筛选 */}
      <div className="workspace-knowledge-graph-toolbar-row">
        <div className="workspace-knowledge-graph-toolbar-search">
          <input
            aria-label="查询工作区知识"
            className="workspace-knowledge-graph-search"
            maxLength={MAX_KNOWLEDGE_SEARCH_LENGTH}
            value={queryDraft}
            onChange={(event) => onQueryDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && !queryApplyDisabled) {
                onApplyQuery();
              }
            }}
            placeholder="查询知识、记忆、架构或产物…"
          />
          <button
            type="button"
            className="workspace-knowledge-graph-action-btn"
            disabled={queryApplyDisabled}
            onClick={onApplyQuery}
          >
            查询
          </button>
          {appliedQuery ? (
            <button
              type="button"
              className="workspace-knowledge-graph-action-btn is-ghost"
              onClick={onClearQuery}
            >
              清除
            </button>
          ) : null}
        </div>

        <div className="workspace-knowledge-graph-toolbar-toggles">
          <SegmentedToggle
            size="sm"
            ariaLabel="图谱着色方式"
            value={colorMode}
            onChange={(v) => onColorModeChange(v as KnowledgeGraphColorMode)}
            options={[
              { value: 'group', label: '分组' },
              { value: 'role', label: '层级' },
              { value: 'persistence', label: '入库' },
            ]}
          />
          <SegmentedToggle
            size="sm"
            ariaLabel="标签显示密度"
            value={labelDensity}
            onChange={(v) => onLabelDensityChange(v as KnowledgeGraphLabelDensity)}
            options={[
              { value: 'auto', label: '自动' },
              { value: 'all', label: '全部' },
              { value: 'focus', label: '焦点' },
            ]}
          />
          <button
            type="button"
            className={`workspace-knowledge-graph-toggle-btn${hideOrphans ? ' is-active' : ''}`}
            aria-pressed={hideOrphans}
            onClick={() => onHideOrphansChange(!hideOrphans)}
          >
            隐藏孤点
          </button>
        </div>
      </div>

      {appliedQuery ? (
        <span className="workspace-knowledge-graph-toolbar-query">当前查询：{appliedQuery}</span>
      ) : null}

      {/* 第二行：层级 + 邻域 */}
      <div className="workspace-knowledge-graph-toolbar-row">
        <ToolbarField label="层级">
          <SegmentedToggle
            size="sm"
            ariaLabel="AI 层级预览"
            value={roleLayerValue}
            onChange={(val) =>
              onSelectRoleLayer(val === '__all__' ? null : (val as GraphRoleLayer))
            }
            options={[
              ...ROLE_LAYER_ORDER.map((rl): SegmentedToggleOption<string> => ({
                value: rl,
                label: ROLE_LAYER_LABELS[rl],
              })),
              { value: '__all__', label: '全部' },
            ]}
          />
        </ToolbarField>

        <ToolbarField
          label="邻域"
          status={localGraphStatus(localGraphEnabled, localGraphDepth, localGraphAutoApplied)}
        >
          <div className="workspace-knowledge-graph-toolbar-inline-group">
            <button
              type="button"
              className={`workspace-knowledge-graph-toggle-btn${localGraphEnabled && localGraphAutoApplied ? ' is-active' : ''}`}
              disabled={!localGraphEnabled}
              onClick={onUseAutoLocalGraph}
              title={localGraphEnabled ? '按所选节点自动打开默认邻域' : '选择节点后自动显示邻域'}
            >
              自动
            </button>
            <SegmentedToggle
              size="sm"
              ariaLabel="局部图深度"
              value={String(effectiveDepth)}
              onChange={(val) => {
                if (!localGraphEnabled && val === '0') return;
                onLocalGraphDepthChange(Number(val) as LocalGraphDepth);
              }}
              options={[
                { value: '0', label: '全图' },
                { value: '1', label: '1跳' },
                { value: '2', label: '2跳' },
                { value: '3', label: '3跳' },
              ]}
              style={{ opacity: localGraphEnabled ? 1 : 0.5 }}
            />
          </div>
        </ToolbarField>

        {onExpandAll && onCollapseAll ? (
          <ToolbarField label="展开">
            <div className="workspace-knowledge-graph-toolbar-inline-group">
              <button
                type="button"
                className="workspace-knowledge-graph-toggle-btn"
                disabled={expandAllDisabled === true}
                aria-disabled={expandAllDisabled === true}
                aria-describedby={expandAllDisabled ? 'graph-expand-all-hint' : undefined}
                title={expandAllDisabled ? expandAllDisabledReason : '展开全部聚合节点'}
                onClick={onExpandAll}
              >
                展开全部
              </button>
              <button
                type="button"
                className="workspace-knowledge-graph-toggle-btn"
                title="收起全部到顶层"
                onClick={onCollapseAll}
              >
                收起全部
              </button>
              {expandGroups?.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className="workspace-knowledge-graph-toggle-btn"
                  disabled={group.blocked}
                  aria-disabled={group.blocked}
                  title={group.blocked ? EXPAND_GROUP_BLOCKED_HINT : `展开 ${group.label}`}
                  onClick={() => onExpandGroup?.(group.id)}
                >
                  展开 {group.label}
                </button>
              ))}
              {expandAllDisabled ? (
                <span
                  id="graph-expand-all-hint"
                  className="workspace-knowledge-graph-toolbar-hint"
                  role="status"
                >
                  {expandAllDisabledReason}
                </span>
              ) : null}
            </div>
          </ToolbarField>
        ) : null}
      </div>
    </div>
  );
}

function ToolbarField({
  children,
  label,
  status,
}: {
  children: ReactNode;
  label: string;
  status?: string;
}) {
  return (
    <div className="workspace-knowledge-graph-toolbar-field">
      <span className="workspace-knowledge-graph-toolbar-field-label">
        {label}
        {status ? (
          <span className="workspace-knowledge-graph-toolbar-field-status">{status}</span>
        ) : null}
      </span>
      {children}
    </div>
  );
}

function localGraphStatus(
  _localGraphEnabled: boolean,
  localGraphDepth: LocalGraphDepth,
  localGraphAutoApplied: boolean,
): string {
  if (localGraphDepth === 0) return '全图';
  return `${localGraphAutoApplied ? '自动 ' : ''}${localGraphDepth}跳`;
}
