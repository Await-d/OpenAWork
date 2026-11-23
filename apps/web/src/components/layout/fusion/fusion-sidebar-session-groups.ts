/**
 * 融合侧栏 Chat 会话分组的构建逻辑。
 *
 * 把「搜索态 / 非搜索态」两类数据来源合并成统一的渲染模型，
 * 使列表组件只消费一种结构。
 *
 * 规则：
 * - 搜索态：以过滤后的会话树为唯一渲染源，计数取命中数，
 *   避免出现「组标题仍在、下面却没有会话」的空组。
 * - 非搜索态：保留全部已保存工作区分组（含暂未创建会话的空组）。
 *
 * 置顶**不在这里抽分区**：置顶是「工作区内置顶」语义，组内置顶优先由
 * `groupSessionsByWorkspace`（`pinnedSessionIds` 参数）在排序阶段完成，
 * 渲染层只按工作区落位。此前把置顶会话汇总成跨工作区的顶部「置顶」分组，
 * 会让会话脱离它所属的工作区——用户在原工作区里反而找不到它，也丢失了
 * 父子层级（子会话被提升成根节点）。新增任何「把会话搬出工作区」的渲染逻辑
 * 都与此语义冲突，不要恢复。
 */

import type { Session } from '../../../hooks/workspace/useSessions.js';
import type {
  WorkspaceSessionGroup,
  WorkspaceSessionTreeGroup,
  WorkspaceSessionTreeNode,
} from '../../../utils/session/session-grouping.js';

export interface FusionChatGroupRow {
  key: string;
  workspacePath: string | null;
  workspaceLabel: string;
  /** 组内会话绑定的 SSH 连接 id；非空表示该工作区是远端目录。 */
  sshConnectionId: string | null;
  sessionCount: number;
  roots: WorkspaceSessionTreeNode<Session>[];
}

export interface BuildFusionChatGroupsParams {
  groupedSessions: readonly WorkspaceSessionGroup<Session>[];
  groupedSessionTrees: readonly WorkspaceSessionTreeGroup<Session>[];
  sessionCountByWorkspace: ReadonlyMap<string, number>;
  isSearching: boolean;
}

export function buildFusionChatGroups({
  groupedSessions,
  groupedSessionTrees,
  sessionCountByWorkspace,
  isSearching,
}: BuildFusionChatGroupsParams): FusionChatGroupRow[] {
  const findTreeGroup = (groupKey: string) =>
    groupedSessionTrees.find((candidate) => candidate.groupKey === groupKey);

  // 搜索态：只渲染有命中的分组，计数为命中数。
  if (isSearching) {
    return groupedSessionTrees.map((treeGroup) => ({
      key: treeGroup.groupKey,
      workspacePath: treeGroup.workspacePath,
      workspaceLabel: treeGroup.workspaceLabel,
      sshConnectionId: treeGroup.sshConnectionId ?? null,
      sessionCount: treeGroup.sessions.length,
      roots: treeGroup.roots,
    }));
  }

  // 非搜索态：计数与树都由会话集合原样带来——置顶会话仍计入它所属的工作区，
  // 位置由组内排序（置顶优先）决定，不参与这里的任何抽取。
  const rows: FusionChatGroupRow[] = groupedSessions.map((group) => {
    const groupKey = group.groupKey;
    const treeGroup = findTreeGroup(groupKey);

    return {
      key: groupKey,
      workspacePath: group.workspacePath,
      workspaceLabel: group.workspaceLabel,
      sshConnectionId: group.sshConnectionId ?? null,
      sessionCount: sessionCountByWorkspace.get(groupKey) ?? 0,
      roots: treeGroup?.roots ?? [],
    };
  });

  // 活跃工作区排前面；同为活跃（或同为闲置）时按名称字母序，
  // 让列表位置稳定可预期，不随会话更新而跳动。
  rows.sort(compareWorkspaceGroups);

  return rows;
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

/**
 * 工作区分组排序。
 *
 * 规则：
 * - 未绑定工作区的「会话」分组永远沉底，不参与字母排序；
 * - 活跃分组（有会话）排在闲置分组之前；
 * - 同为活跃或同为闲置时按名称字母序，保证多个工作区同时活跃也不会
 *   因会话更新而互相抢位，列表位置稳定可预期。
 */
function compareWorkspaceGroups(a: FusionChatGroupRow, b: FusionChatGroupRow): number {
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

  return a.workspaceLabel.localeCompare(b.workspaceLabel, undefined, { sensitivity: 'base' });
}
