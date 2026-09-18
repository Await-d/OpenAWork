/**
 * 知识图谱 · hover 提示框内容构建（纯 DOM，不依赖 G6）。
 *
 * 鼠标悬停节点时展示：标签、类型 / 产物阶段（取 `PHASE_LABELS`）、详情摘录，
 * 以及「已入库」标记。样式全部由 `knowledge-graph-tooltip.css` 里的类名 + E · Nebula
 * CSS 变量承载，本模块不写入任何颜色。
 */

import type { GraphNodeKind } from '../../../data/build-knowledge-graph.js';
import { PHASE_LABELS, PHASE_ORDER, phaseRank } from './knowledge-graph-constants.js';
import type { GraphNodeModel } from './knowledge-graph-model.js';

const KIND_LABELS: Record<GraphNodeKind, string> = {
  artifact: '产物',
  architecture: '架构',
  category: '分类',
  constitution: '规则',
  knowledge: '知识',
  memory: '记忆',
  workspace: '工作区',
};

const DETAIL_EXCERPT_MAX = 120;

export const GRAPH_TOOLTIP_CLASS = 'knowledge-graph-tooltip';
export const GRAPH_TOOLTIP_TITLE_CLASS = 'knowledge-graph-tooltip-title';
export const GRAPH_TOOLTIP_META_CLASS = 'knowledge-graph-tooltip-meta';
export const GRAPH_TOOLTIP_KIND_CLASS = 'knowledge-graph-tooltip-kind';
export const GRAPH_TOOLTIP_PERSISTED_CLASS = 'knowledge-graph-tooltip-persisted';
export const GRAPH_TOOLTIP_DETAIL_CLASS = 'knowledge-graph-tooltip-detail';

function phaseLabel(phase: string | null): string | null {
  if (!phase) {
    return null;
  }
  const rank = phaseRank(phase);
  if (rank < 0) {
    return phase;
  }
  const key = PHASE_ORDER[rank];
  return key ? PHASE_LABELS[key] : phase;
}

/** 类型标签；artifact 额外拼接 `PHASE_LABELS` 中的阶段文案。 */
export function graphTooltipKindLabel(node: GraphNodeModel): string {
  const kindLabel = KIND_LABELS[node.kind];
  const phase = node.kind === 'artifact' ? phaseLabel(node.phase) : null;
  return phase ? `${kindLabel} · ${phase}` : kindLabel;
}

/** 详情摘录：优先 `detail`，回退正文；超长截断并加省略号。 */
export function graphTooltipDetail(node: GraphNodeModel): string | null {
  const raw = (node.detail ?? '').trim() || (node.node.content ?? '').trim();
  if (raw.length === 0) {
    return null;
  }
  return raw.length > DETAIL_EXCERPT_MAX ? `${raw.slice(0, DETAIL_EXCERPT_MAX)}…` : raw;
}

export function buildGraphTooltipElement(node: GraphNodeModel): HTMLElement {
  const root = document.createElement('div');
  root.className = GRAPH_TOOLTIP_CLASS;

  const title = document.createElement('div');
  title.className = GRAPH_TOOLTIP_TITLE_CLASS;
  title.textContent = node.label;
  root.appendChild(title);

  const meta = document.createElement('div');
  meta.className = GRAPH_TOOLTIP_META_CLASS;
  const kind = document.createElement('span');
  kind.className = GRAPH_TOOLTIP_KIND_CLASS;
  kind.textContent = graphTooltipKindLabel(node);
  meta.appendChild(kind);
  if (node.persisted) {
    const persisted = document.createElement('span');
    persisted.className = GRAPH_TOOLTIP_PERSISTED_CLASS;
    persisted.textContent = '已入库';
    meta.appendChild(persisted);
  }
  root.appendChild(meta);

  const detail = graphTooltipDetail(node);
  if (detail) {
    const detailElement = document.createElement('p');
    detailElement.className = GRAPH_TOOLTIP_DETAIL_CLASS;
    detailElement.textContent = detail;
    root.appendChild(detailElement);
  }

  return root;
}
