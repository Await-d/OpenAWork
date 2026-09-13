import { describe, expect, it } from 'vitest';
import type { Session } from '../../../hooks/workspace/useSessions.js';
import type {
  WorkspaceSessionGroup,
  WorkspaceSessionTreeGroup,
  WorkspaceSessionTreeNode,
} from '../../../utils/session/session-grouping.js';
import {
  UNBOUND_WORKSPACE_GROUP_KEY,
  UNBOUND_WORKSPACE_LABEL,
} from '../../../utils/session/session-grouping.js';
import {
  PINNED_SESSION_GROUP_KEY,
  buildFusionChatGroups,
  countRunningSessions,
} from './fusion-sidebar-session-groups.js';

function makeSession(id: string, title = id): Session {
  return {
    id,
    title,
    updated_at: '2026-07-07T08:00:00.000Z',
  };
}

function makeNode(
  session: Session,
  children: WorkspaceSessionTreeNode<Session>[] = [],
): WorkspaceSessionTreeNode<Session> {
  return { session, children };
}

function makeGroup(
  workspacePath: string | null,
  sessions: Session[],
): WorkspaceSessionGroup<Session> {
  return {
    workspacePath,
    workspaceLabel: workspacePath ?? UNBOUND_WORKSPACE_LABEL,
    sessions,
  };
}

function makeTreeGroup(
  workspacePath: string | null,
  roots: WorkspaceSessionTreeNode<Session>[],
): WorkspaceSessionTreeGroup<Session> {
  const sessions: Session[] = [];
  const visit = (node: WorkspaceSessionTreeNode<Session>) => {
    sessions.push(node.session);
    node.children.forEach(visit);
  };
  roots.forEach(visit);

  return {
    workspacePath,
    workspaceLabel: workspacePath ?? UNBOUND_WORKSPACE_LABEL,
    sessions,
    roots,
  };
}

const ROOT_A = makeSession('a', '会话 A');
const ROOT_B = makeSession('b', '会话 B');
const CHILD_B = makeSession('b-child', '会话 B 子');

describe('buildFusionChatGroups', () => {
  it('非搜索态：按工作区分组并保留空工作区组', () => {
    const rows = buildFusionChatGroups({
      groupedSessions: [makeGroup('/repo/alpha', [ROOT_A]), makeGroup('/repo/empty', [])],
      groupedSessionTrees: [makeTreeGroup('/repo/alpha', [makeNode(ROOT_A)])],
      sessionCountByWorkspace: new Map([
        ['/repo/alpha', 1],
        ['/repo/empty', 0],
      ]),
      isSearching: false,
      isPinned: () => false,
    });

    expect(rows.map((row) => row.key)).toEqual(['/repo/alpha', '/repo/empty']);
    expect(rows[1]?.sessionCount).toBe(0);
    expect(rows[1]?.roots).toEqual([]);
    expect(rows.some((row) => row.isPinnedGroup)).toBe(false);
  });

  it('非搜索态：置顶会话收敛到首个「置顶」分区并从原组扣减计数', () => {
    const rows = buildFusionChatGroups({
      groupedSessions: [makeGroup('/repo/alpha', [ROOT_A, ROOT_B])],
      groupedSessionTrees: [makeTreeGroup('/repo/alpha', [makeNode(ROOT_A), makeNode(ROOT_B)])],
      sessionCountByWorkspace: new Map([['/repo/alpha', 2]]),
      isSearching: false,
      isPinned: (sessionId) => sessionId === 'b',
    });

    expect(rows).toHaveLength(2);
    const [pinnedRow, alphaRow] = rows;
    expect(pinnedRow?.key).toBe(PINNED_SESSION_GROUP_KEY);
    expect(pinnedRow?.workspaceLabel).toBe('置顶');
    expect(pinnedRow?.isPinnedGroup).toBe(true);
    expect(pinnedRow?.sessionCount).toBe(1);
    expect(pinnedRow?.roots.map((node) => node.session.id)).toEqual(['b']);

    expect(alphaRow?.sessionCount).toBe(1);
    expect(alphaRow?.roots.map((node) => node.session.id)).toEqual(['a']);
  });

  it('非搜索态：父会话被置顶时子节点提升，不丢会话', () => {
    const rows = buildFusionChatGroups({
      groupedSessions: [makeGroup('/repo/alpha', [ROOT_B, CHILD_B])],
      groupedSessionTrees: [makeTreeGroup('/repo/alpha', [makeNode(ROOT_B, [makeNode(CHILD_B)])])],
      sessionCountByWorkspace: new Map([['/repo/alpha', 2]]),
      isSearching: false,
      isPinned: (sessionId) => sessionId === 'b',
    });

    const [pinnedRow, alphaRow] = rows;
    expect(pinnedRow?.roots.map((node) => node.session.id)).toEqual(['b']);
    expect(alphaRow?.roots.map((node) => node.session.id)).toEqual(['b-child']);
    expect(alphaRow?.sessionCount).toBe(1);
  });

  it('非搜索态：按组内最近活动倒序排列，空组沉底', () => {
    const oldSession: Session = {
      id: 'old',
      title: '旧会话',
      updated_at: '2026-07-01T00:00:00.000Z',
    };
    const newSession: Session = {
      id: 'new',
      title: '新会话',
      updated_at: '2026-09-01T00:00:00.000Z',
    };

    const rows = buildFusionChatGroups({
      groupedSessions: [
        makeGroup('/repo/old', [oldSession]),
        makeGroup('/repo/empty', []),
        makeGroup('/repo/new', [newSession]),
      ],
      groupedSessionTrees: [
        makeTreeGroup('/repo/old', [makeNode(oldSession)]),
        makeTreeGroup('/repo/new', [makeNode(newSession)]),
      ],
      sessionCountByWorkspace: new Map([
        ['/repo/old', 1],
        ['/repo/new', 1],
        ['/repo/empty', 0],
      ]),
      isSearching: false,
      isPinned: () => false,
    });

    expect(rows.map((row) => row.key)).toEqual(['/repo/new', '/repo/old', '/repo/empty']);
  });

  it('非搜索态：未指定工作区的会话组永远沉底，不参与最近活动排序', () => {
    const freshUnboundSession: Session = {
      id: 'unbound-fresh',
      title: '刚聊过的无工作区会话',
      updated_at: '2026-09-13T00:00:00.000Z',
    };
    const staleBoundSession: Session = {
      id: 'bound-stale',
      title: '较早的工作区会话',
      updated_at: '2026-07-01T00:00:00.000Z',
    };

    const rows = buildFusionChatGroups({
      groupedSessions: [
        makeGroup(null, [freshUnboundSession]),
        makeGroup('/repo/stale', [staleBoundSession]),
      ],
      groupedSessionTrees: [
        makeTreeGroup(null, [makeNode(freshUnboundSession)]),
        makeTreeGroup('/repo/stale', [makeNode(staleBoundSession)]),
      ],
      sessionCountByWorkspace: new Map([
        [UNBOUND_WORKSPACE_GROUP_KEY, 1],
        ['/repo/stale', 1],
      ]),
      isSearching: false,
      isPinned: () => false,
    });

    expect(rows.map((row) => row.workspacePath)).toEqual(['/repo/stale', null]);
    expect(rows[1]?.workspaceLabel).toBe(UNBOUND_WORKSPACE_LABEL);
  });

  it('搜索态：忽略置顶分区并使用命中计数', () => {
    const rows = buildFusionChatGroups({
      groupedSessions: [makeGroup('/repo/alpha', [ROOT_A, ROOT_B])],
      groupedSessionTrees: [makeTreeGroup('/repo/alpha', [makeNode(ROOT_A)])],
      sessionCountByWorkspace: new Map([['/repo/alpha', 2]]),
      isSearching: true,
      isPinned: (sessionId) => sessionId === 'b',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe('/repo/alpha');
    expect(rows[0]?.sessionCount).toBe(1);
    expect(rows[0]?.roots.map((node) => node.session.id)).toEqual(['a']);
  });
});

describe('countRunningSessions', () => {
  it('统计含子会话的运行中数量', () => {
    const runningParent: Session = { ...makeSession('running'), state_status: 'running' };
    const runningChild: Session = { ...makeSession('child'), state_status: 'running' };
    const idle: Session = makeSession('idle');

    expect(
      countRunningSessions([makeNode(runningParent, [makeNode(runningChild)]), makeNode(idle)]),
    ).toBe(2);
    expect(countRunningSessions([])).toBe(0);
  });
});
