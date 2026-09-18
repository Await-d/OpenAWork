/**
 * 知识图谱 · 「未找到匹配知识」视图。
 *
 * 从 `WorkspaceKnowledgeGraphView` 拆出的独立空态页面：保留完整工具栏，让用户可以直接
 * 修改查询 / 层级 / 过滤条件，而不是掉进一个只能返回的死胡同。
 */

import { EmptyState } from '../../shared/content-kit/index.js';
import { TabContainer } from '../TabContainer.js';
import { ROLE_LAYER_LABELS } from './graph/knowledge-graph-constants.js';
import { GraphToolbar, type GraphToolbarProps } from './workspace-knowledge-graph-toolbar.js';

export function KnowledgeGraphNoMatchView({
  graphSubtitle,
  toolbar,
  workspaceKnowledgeError,
  workspaceKnowledgeLoading,
}: {
  graphSubtitle: string;
  toolbar: GraphToolbarProps;
  workspaceKnowledgeError: string | null;
  workspaceKnowledgeLoading: boolean;
}) {
  const emptyTitle = workspaceKnowledgeError
    ? '图谱加载失败'
    : workspaceKnowledgeLoading
      ? '查询工作区知识中…'
      : '未找到匹配知识';
  const emptyDescription = workspaceKnowledgeNoMatchDescription({
    activeRoleLayer: toolbar.activeRoleLayer,
    appliedQuery: toolbar.appliedQuery,
    hideOrphans: toolbar.hideOrphans,
    workspaceKnowledgeError,
    workspaceKnowledgeLoading,
  });
  return (
    <TabContainer title="知识图谱" subtitle={graphSubtitle} scroll={false}>
      <div className="workspace-knowledge-graph-content">
        <GraphToolbar {...toolbar} />
        <EmptyState emoji="🕸️" title={emptyTitle} description={emptyDescription} />
      </div>
    </TabContainer>
  );
}

function workspaceKnowledgeNoMatchDescription({
  activeRoleLayer,
  appliedQuery,
  hideOrphans,
  workspaceKnowledgeError,
  workspaceKnowledgeLoading,
}: {
  activeRoleLayer: GraphToolbarProps['activeRoleLayer'];
  appliedQuery: string;
  hideOrphans: boolean;
  workspaceKnowledgeError: string | null;
  workspaceKnowledgeLoading: boolean;
}): string {
  if (workspaceKnowledgeError) {
    return workspaceKnowledgeError;
  }
  if (workspaceKnowledgeLoading) {
    return appliedQuery
      ? `正在查询「${appliedQuery}」相关的工作区知识。`
      : '正在加载当前筛选下的工作区知识。';
  }
  if (appliedQuery) {
    return `没有找到与「${appliedQuery}」匹配的工作区知识节点。`;
  }
  if (activeRoleLayer) {
    return `${ROLE_LAYER_LABELS[activeRoleLayer]}层当前没有可读取的工作区知识。可以切回全部层级，或调整知识入库读取范围。`;
  }
  if (hideOrphans) {
    return '隐藏孤点后没有可展示的知识节点。可以关闭隐藏孤点查看完整工作区知识。';
  }
  return '当前筛选下没有可展示的工作区知识节点。';
}
