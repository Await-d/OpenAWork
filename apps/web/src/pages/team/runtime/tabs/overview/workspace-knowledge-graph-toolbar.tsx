import type { ReactNode } from 'react';
import type { GraphRoleLayer } from '../../data/build-knowledge-graph.js';
import { workspaceKnowledgeRoleLayerFromSearchTerm } from '../../data/workspace-knowledge-key-classification.js';
import {
  type KnowledgeGraphColorMode,
  type KnowledgeGraphForceSettings,
  type KnowledgeGraphLabelDensity,
} from './workspace-knowledge-graph-canvas.js';
import {
  MAX_KNOWLEDGE_SEARCH_LENGTH,
  ROLE_LAYER_LABELS,
  ROLE_LAYER_ORDER,
} from './workspace-knowledge-graph-constants.js';
import {
  SegmentedToggle,
  type SegmentedToggleOption,
} from '../../shared/content-kit/SegmentedToggle.js';

export type LocalGraphDepth = 0 | 1 | 2 | 3;

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
  onColorModeChange,
  onClearQuery,
  onHideOrphansChange,
  onLabelDensityChange,
  onLocalGraphDepthChange,
  onUseAutoLocalGraph,
  onSelectRoleLayer,
  onQueryDraftChange,
}: {
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
  onColorModeChange: (mode: KnowledgeGraphColorMode) => void;
  onClearQuery: () => void;
  onHideOrphansChange: (hide: boolean) => void;
  onLabelDensityChange: (density: KnowledgeGraphLabelDensity) => void;
  onLocalGraphDepthChange: (depth: LocalGraphDepth) => void;
  onUseAutoLocalGraph: () => void;
  onSelectRoleLayer: (roleLayer: GraphRoleLayer | null) => void;
  onQueryDraftChange: (value: string) => void;
}) {
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
              ...ROLE_LAYER_ORDER.map(
                (rl): SegmentedToggleOption<string> => ({
                  value: rl,
                  label: ROLE_LAYER_LABELS[rl],
                }),
              ),
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

/* ─── 布局力控制（画布内折叠面板使用） ───────────────────── */

export function GraphForceControls({
  forceSettings,
  onForceSettingsChange,
}: {
  forceSettings: KnowledgeGraphForceSettings;
  onForceSettingsChange: (settings: KnowledgeGraphForceSettings) => void;
}) {
  return (
    <div className="workspace-knowledge-graph-force-controls">
      <GraphForceRange
        label="排斥"
        max={360}
        min={60}
        step={10}
        value={forceSettings.repel}
        onChange={(repel) => onForceSettingsChange({ ...forceSettings, repel })}
      />
      <GraphForceRange
        label="连线"
        max={180}
        min={56}
        step={4}
        value={forceSettings.distance}
        onChange={(distance) => onForceSettingsChange({ ...forceSettings, distance })}
      />
      <GraphForceRange
        label="中心"
        max={0.2}
        min={0.02}
        step={0.01}
        value={forceSettings.center}
        onChange={(center) => onForceSettingsChange({ ...forceSettings, center })}
      />
      <GraphForceRange
        label="拉力"
        max={0.5}
        min={0.05}
        step={0.01}
        value={forceSettings.link}
        onChange={(link) => onForceSettingsChange({ ...forceSettings, link })}
      />
    </div>
  );
}

function GraphForceRange({
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <label className="workspace-knowledge-graph-force-range">
      <span>{label}</span>
      <input
        type="range"
        aria-label={`图谱${label}`}
        max={max}
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}
