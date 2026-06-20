import type {
  GraphMemoryType,
  GraphNode,
  GraphRoleLayer,
} from '../../data/build-knowledge-graph.js';
import { StatusPill } from '@openAwork/shared-ui';
import {
  MAX_KNOWLEDGE_VALUE_LENGTH,
  ROLE_LAYER_LABELS,
  ROLE_LAYER_ORDER,
} from './workspace-knowledge-graph-constants.js';
import type { LocalGraphDepth } from './workspace-knowledge-graph-toolbar.js';
import { SectionPanel } from '../../shared/content-kit/SectionPanel.js';
import {
  SegmentedToggle,
} from '../../shared/content-kit/SegmentedToggle.js';

export function KnowledgeNodeInspector({
  activeRoleLayer,
  error,
  localGraphAutoApplied,
  localGraphDepth,
  message,
  node,
  onLocalGraphDepthChange,
  onPersist,
  onToggleRoleLayer,
  onUseAllRoleLayers,
  onUseAutoLocalGraph,
  persistable,
  selectedRoleLayers,
  saving,
}: {
  activeRoleLayer: GraphRoleLayer | null;
  error: string | null;
  localGraphAutoApplied: boolean;
  localGraphDepth: LocalGraphDepth;
  message: string | null;
  node: GraphNode | null;
  onLocalGraphDepthChange: (depth: LocalGraphDepth) => void;
  onPersist: () => void;
  onToggleRoleLayer: (roleLayer: GraphRoleLayer) => void;
  onUseAllRoleLayers: () => void;
  onUseAutoLocalGraph: () => void;
  persistable: boolean;
  selectedRoleLayers: GraphRoleLayer[] | null;
  saving: boolean;
}) {
  const rawValueLength = node ? rawKnowledgeValueLengthForNode(node) : 0;
  const disabledReason = nodePersistDisabledReason(node, persistable);

  return (
    <aside className={`workspace-knowledge-graph-inspector${node ? '' : ' is-empty'}`}>
      {!node ? (
        <div className="workspace-knowledge-graph-inspector-empty">
          <span className="workspace-knowledge-graph-inspector-icon">◉</span>
          <span className="workspace-knowledge-graph-inspector-title">节点详情</span>
          <span className="workspace-knowledge-graph-inspector-description">
            选择一个知识节点后，可以查看来源、摘要和入库状态。
          </span>
        </div>
      ) : (
        <>
          <header className="workspace-knowledge-graph-inspector-header">
            <span className="workspace-knowledge-graph-inspector-kicker">
              {nodeKindLabel(node)}
            </span>
            <h3
              className="workspace-knowledge-graph-inspector-title"
              title={node.label}
            >
              {node.label}
            </h3>
            <span
              className="workspace-knowledge-graph-inspector-source"
              title={
                `${nodeKindLabel(node)} · ${node.sourceRef ?? node.state ?? 'workspace'}`
              }
            >
              {node.sourceRef ?? node.state ?? 'workspace'}
            </span>
          </header>

          <SectionPanel style={{ padding: '8px 10px', gap: 6 }}>
            <div className="workspace-knowledge-graph-inspector-badges">
              {nodePersistenceBadge(node, persistable) ? (
                <StatusPill
                  label={nodePersistenceBadge(node, persistable) ?? ''}
                  color={node.persistedMemoryId ? 'success' : 'muted'}
                />
              ) : null}
              {node.memoryType ? (
                <StatusPill label={memoryTypeLabel(node.memoryType)} color="info" />
              ) : null}
              {nodeRoleLayerBadgeLabel(node, activeRoleLayer) ? (
                <StatusPill
                  label={nodeRoleLayerBadgeLabel(node, activeRoleLayer) ?? ''}
                  color="accent"
                />
              ) : null}
            </div>

            <p className="workspace-knowledge-graph-inspector-summary">
              {node.detail ?? '暂无摘要。'}
            </p>

            {rawValueLength > MAX_KNOWLEDGE_VALUE_LENGTH ? (
              <span className="workspace-knowledge-graph-inspector-notice">
                入库会保留前 {MAX_KNOWLEDGE_VALUE_LENGTH} 个字符。
              </span>
            ) : null}

            {node.persistedMemoryId && persistable ? (
              <span className="workspace-knowledge-graph-inspector-notice is-info">
                更新会保留当前已入库正文，并同步 AI 层级读取范围。
              </span>
            ) : null}
          </SectionPanel>

          {persistable ? (
            <RoleLayerScopeSelector
              activeRoleLayer={activeRoleLayer}
              selectedRoleLayers={selectedRoleLayers}
              onToggleRoleLayer={onToggleRoleLayer}
              onUseAllRoleLayers={onUseAllRoleLayers}
            />
          ) : null}

          {disabledReason ? (
            <span className="workspace-knowledge-graph-inspector-notice">{disabledReason}</span>
          ) : null}

          <SectionPanel title="邻域范围" style={{ padding: '8px 10px', gap: 6 }}>
            <span className="workspace-knowledge-graph-inspector-section-note">
              {localGraphAutoApplied
                ? `已自动打开 ${localGraphDepth} 跳邻域`
                : localGraphDepth === 0
                  ? '当前显示全图'
                  : `当前显示 ${localGraphDepth} 跳邻域`}
            </span>
            <div className="workspace-knowledge-graph-inspector-depth-row">
              <button
                type="button"
                className={`workspace-knowledge-graph-toggle-btn is-sm${
                  localGraphAutoApplied ? ' is-active' : ''
                }`}
                aria-pressed={localGraphAutoApplied}
                onClick={onUseAutoLocalGraph}
              >
                自动
              </button>
              <SegmentedToggle
                size="sm"
                ariaLabel="节点详情局部图范围"
                value={String(localGraphAutoApplied ? 0 : localGraphDepth)}
                onChange={(val) => onLocalGraphDepthChange(Number(val) as LocalGraphDepth)}
                options={[
                  { value: '0', label: '全图' },
                  { value: '1', label: '1跳' },
                  { value: '2', label: '2跳' },
                  { value: '3', label: '3跳' },
                ]}
                style={{ flex: 1 }}
              />
            </div>
          </SectionPanel>

          <button
            type="button"
            className="workspace-knowledge-graph-persist-button"
            disabled={!persistable || saving}
            onClick={onPersist}
          >
            {saving ? '入库中…' : persistButtonLabel(node)}
          </button>

          {message ? (
            <span role="status" className="workspace-knowledge-graph-inspector-message">
              {message}
            </span>
          ) : null}

          {error ? (
            <span role="alert" className="workspace-knowledge-graph-inspector-message is-error">
              {error}
            </span>
          ) : null}
        </>
      )}
    </aside>
  );
}

function nodePersistDisabledReason(
  node: GraphNode | null,
  persistable: boolean,
): string | null {
  if (!node || persistable) return null;
  if (node.kind === 'workspace') {
    return '工作区根节点用于定位知识范围，不会作为知识条目入库。';
  }
  if (node.kind === 'category') {
    return '分类节点用于组织图谱，不会作为知识条目入库。';
  }
  return '该节点缺少可入库来源或知识类型。';
}

function nodePersistenceBadge(
  node: GraphNode,
  persistable: boolean,
): string | null {
  if (node.kind === 'workspace' || node.kind === 'category') return null;
  if (node.persistedMemoryId) return '已入库';
  return persistable ? '未入库' : '不可入库';
}

function nodeRoleLayerBadgeLabel(
  node: GraphNode,
  activeRoleLayer: GraphRoleLayer | null,
): string | null {
  if (node.kind === 'workspace' || node.kind === 'category') return null;
  if (
    node.persistedMemoryId &&
    activeRoleLayer &&
    node.roleLayers !== null &&
    !node.roleLayers.includes(activeRoleLayer)
  ) {
    return `当前层不可读`;
  }

  if (!node.roleLayers) return null;

  const labels = node.roleLayers.map((rl) => ROLE_LAYER_LABELS[rl]);
  return labels.length > 2 ? `${labels[0]} +${labels.length - 1}` : labels.join(' / ');
}

function persistButtonLabel(node: GraphNode): string {
  return node.persistedMemoryId ? '更新入库范围' : '入库到知识库';
}

function rawKnowledgeValueLengthForNode(node: GraphNode): number {
  const persistedValue = node.persistedValue?.trim();
  const value =
    node.persistedMemoryId && persistedValue
      ? persistedValue
      : (node.content ?? node.detail ?? node.label).trim();
  return value.length;
}

/* ─── AI 层级读取范围选择器 ────────────────────────────────── */

function RoleLayerScopeSelector({
  activeRoleLayer,
  onToggleRoleLayer,
  onUseAllRoleLayers,
  selectedRoleLayers,
}: {
  activeRoleLayer: GraphRoleLayer | null;
  onToggleRoleLayer: (roleLayer: GraphRoleLayer) => void;
  onUseAllRoleLayers: () => void;
  selectedRoleLayers: GraphRoleLayer[] | null;
}) {
  return (
    <SectionPanel
      title="AI 层级读取范围"
      hint={
        activeRoleLayer
          ? `当前预览层：${ROLE_LAYER_LABELS[activeRoleLayer]}`
          : undefined
      }
      style={{ padding: '8px 10px', gap: 6 }}
    >
      <div className="workspace-knowledge-graph-inspector-button-row">
        <button
          type="button"
          className={`workspace-knowledge-graph-toggle-btn is-sm${
            selectedRoleLayers === null ? ' is-active' : ''
          }`}
          onClick={onUseAllRoleLayers}
        >
          全部
        </button>
        {ROLE_LAYER_ORDER.map((roleLayer) => (
          <button
            key={roleLayer}
            type="button"
            className={`workspace-knowledge-graph-toggle-btn is-sm${
              selectedRoleLayers !== null && selectedRoleLayers.includes(roleLayer)
                ? ' is-active'
                : ''
            }`}
            onClick={() => onToggleRoleLayer(roleLayer)}
          >
            {ROLE_LAYER_LABELS[roleLayer]}
          </button>
        ))}
      </div>
    </SectionPanel>
  );
}

function memoryTypeLabel(type: GraphMemoryType): string {
  switch (type) {
    case 'instruction':
      return '规则';
    case 'project_context':
      return '项目上下文';
    case 'learned_pattern':
      return '经验';
    case 'preference':
      return '偏好';
    case 'fact':
      return '事实';
  }
}

function nodeKindLabel(node: GraphNode): string {
  switch (node.kind) {
    case 'workspace':
      return '工作区';
    case 'category':
      return '分类';
    case 'architecture':
      return '架构';
    case 'constitution':
      return '团队规则';
    case 'memory':
      return '记忆';
    case 'knowledge':
      return '知识';
    case 'artifact':
      return '产物';
  }
}
