/**
 * 融合侧栏 Chat 会话分组的构建逻辑。
 *
 * 把「搜索态 / 非搜索态」「置顶分区」两类数据来源合并成统一的渲染模型，
 * 使列表组件只消费一种结构。
 *
 * 规则：
 * - 搜索态：以过滤后的会话树为唯一渲染源，计数取命中数，
 *   避免出现「组标题仍在、下面却没有会话」的空组；此态不单独抽出置顶分区。
 * - 非搜索态：保留全部已保存工作区分组（含暂未创建会话的空组），
 *   置顶会话统一收敛到顶部「置顶」分区，并计入该分区而非原工作区。
 */

import type { Session } from '../../../hooks/workspace/useSessions.js';
import { getWorkspaceGroupKey } from '../../../utils/session/session-grouping.js';
import type {
  WorkspaceSessionGroup,
  WorkspaceSessionTreeGroup,
  WorkspaceSessionTreeNode,
} from '../../../utils/session/session-grouping.js';

/** 置顶分区使用的分组键（与未绑定工作区分组键区分开）。 */
export const PINNED_SESSION_GROUP_KEY = '__pinned__';

export interface FusionChatGroupRow {
  key: string;
  workspacePath: string | null;
  workspaceLabel: string;
  sessionCount: number;
  roots: WorkspaceSessionTreeNode<Session>[];
  /** 置顶分区：不提供「在此工作区新建会话」入口 */
  isPinnedGroup: boolean;
}

export interface BuildFusionChatGroupsParams {
  groupedSessions: readonly WorkspaceSessionGroup<Session>[];
  groupedSessionTrees: readonly WorkspaceSessionTreeGroup<Session>[];
  sessionCountByWorkspace: ReadonlyMap<string, number>;
  isSearching: boolean;
  isPinned: (sessionId: string) => boolean;
}

export function buildFusionChatGroups({
  groupedSessions,
  groupedSessionTrees,
  sessionCountByWorkspace,
  isSearching,
  isPinned,
}: BuildFusionChatGroupsParams): FusionChatGroupRow[] {
  const findTreeGroup = (workspacePath: string | null) => {
    const groupKey = getWorkspaceGroupKey(workspacePath);
    return groupedSessionTrees.find(
      (candidate) => getWorkspaceGroupKey(candidate.workspacePath) === groupKey,
    );
  };

  // 搜索态：只渲染有命中的分组，计数为命中数。
  if (isSearching) {
    return groupedSessionTrees.map((treeGroup) => ({
      key: getWorkspaceGroupKey(treeGroup.workspacePath),
      workspacePath: treeGroup.workspacePath,
      workspaceLabel: treeGroup.workspaceLabel,
      sessionCount: treeGroup.sessions.length,
      roots: treeGroup.roots,
      isPinnedGroup: false,
    }));
  }

  const pinnedNodes: WorkspaceSessionTreeNode<Session>[] = [];
  for (const treeGroup of groupedSessionTrees) {
    collectPinnedNodes(treeGroup.roots, isPinned, pinnedNodes);
  }
  const pinnedCountByGroupKey = new Map<string, number>();
  for (const treeGroup of groupedSessionTrees) {
    const groupKey = getWorkspaceGroupKey(treeGroup.workspacePath);
    pinnedCountByGroupKey.set(groupKey, countPinnedNodes(treeGroup.roots, isPinned));
  }

  const rows: WorkingGroupRow[] = groupedSessions.map((group) => {
    const groupKey = getWorkspaceGroupKey(group.workspacePath);
    const treeGroup = findTreeGroup(group.workspacePath);
    const roots = stripPinnedNodes(treeGroup?.roots ?? [], isPinned);
    const pinnedCount = pinnedCountByGroupKey.get(groupKey) ?? 0;

    return {
      key: groupKey,
      workspacePath: group.workspacePath,
      workspaceLabel: group.workspaceLabel,
      sessionCount: Math.max(0, (sessionCountByWorkspace.get(groupKey) ?? 0) - pinnedCount),
      roots,
      isPinnedGroup: false,
      latestUpdatedAt: findLatestUpdatedAt(roots),
    };
  });

  // 最近使用的项目排前面：有会话的先行，其后按组内最近活动时间倒序。
  rows.sort(compareGroupsByRecentActivity);
  const orderedRows: FusionChatGroupRow[] = rows.map(({ latestUpdatedAt: _latest, ...row }) => row);

  if (pinnedNodes.length > 0) {
    orderedRows.unshift({
      key: PINNED_SESSION_GROUP_KEY,
      workspacePath: null,
      workspaceLabel: '置顶',
      sessionCount: pinnedNodes.length,
      roots: pinnedNodes,
      isPinnedGroup: true,
    });
  }

  return orderedRows;
}

/** 统计一组会话树中处于运行中的会话数量（含子会话）。 */
export function countRunningSessions(nodes: readonly WorkspaceSessionTreeNode<Session>[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.session.state_status === 'running') {
      count += 1;
    }
    count += countRunningSessions(node.children);
  }
  return count;
}

interface WorkingGroupRow extends FusionChatGroupRow {
  latestUpdatedAt: string | null;
}

function compareGroupsByRecentActivity(a: WorkingGroupRow, b: WorkingGroupRow): number {
  // 会话的会话组永远沉底：不参与「最近活动」排序，
  // 避免它的会话刚更新过就顶到已绑定工作区分组上方。
  const aUnbound = a.workspacePath === null;
  const bUnbound = b.workspacePath === null;
  if (aUnbound !== bUnbound) {
    return aUnbound ? 1 : -1;
  }

  const aHasSessions = a.roots.length > 0;
  const bHasSessions = b.roots.length > 0;
  if (aHasSessions !== bHasSessions) {
    return aHasSessions ? -1 : 1;
  }

  if (aHasSessions && bHasSessions) {
    const byUpdatedAt = (b.latestUpdatedAt ?? '').localeCompare(a.latestUpdatedAt ?? '');
    if (byUpdatedAt !== 0) {
      return byUpdatedAt;
    }
  }

  return a.workspaceLabel.localeCompare(b.workspaceLabel, undefined, { sensitivity: 'base' });
}

function findLatestUpdatedAt(nodes: readonly WorkspaceSessionTreeNode<Session>[]): string | null {
  let latest: string | null = null;
  for (const node of nodes) {
    if (latest === null || node.session.updated_at.localeCompare(latest) > 0) {
      latest = node.session.updated_at;
    }
    const childLatest = findLatestUpdatedAt(node.children);
    if (childLatest !== null && (latest === null || childLatest.localeCompare(latest) > 0)) {
      latest = childLatest;
    }
  }
  return latest;
}

function collectPinnedNodes(
  nodes: readonly WorkspaceSessionTreeNode<Session>[],
  isPinned: (sessionId: string) => boolean,
  collected: WorkspaceSessionTreeNode<Session>[],
): void {
  for (const node of nodes) {
    if (isPinned(node.session.id)) {
      collected.push({ session: node.session, children: [] });
    }
    collectPinnedNodes(node.children, isPinned, collected);
  }
}

function countPinnedNodes(
  nodes: readonly WorkspaceSessionTreeNode<Session>[],
  isPinned: (sessionId: string) => boolean,
): number {
  let count = 0;
  for (const node of nodes) {
    if (isPinned(node.session.id)) {
      count += 1;
    }
    count += countPinnedNodes(node.children, isPinned);
  }
  return count;
}

/**
 * 从树中移除已置顶的会话节点；被移除节点的子节点提升到父级，避免会话丢失。
 */
function stripPinnedNodes(
  nodes: readonly WorkspaceSessionTreeNode<Session>[],
  isPinned: (sessionId: string) => boolean,
): WorkspaceSessionTreeNode<Session>[] {
  const result: WorkspaceSessionTreeNode<Session>[] = [];

  for (const node of nodes) {
    const children = stripPinnedNodes(node.children, isPinned);
    if (isPinned(node.session.id)) {
      result.push(...children);
      continue;
    }
    result.push({ session: node.session, children });
  }

  return result;
}
