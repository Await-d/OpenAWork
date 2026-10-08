import { describe, expect, it } from 'vitest';
import type { Session } from '../../hooks/workspace/useSessions.js';
import {
  UNBOUND_WORKSPACE_LABEL,
  filterSessionTreeGroupsByMatcher,
  filterSessionTreeGroupsByQuery,
  groupSessionsByWorkspace,
  resolveSessionWorkspaceBindingById,
  resolveWorkspaceGroupDisplayName,
} from './session-grouping.js';
import type { WorkspaceSessionTreeGroup, WorkspaceSessionTreeNode } from './session-grouping.js';

function makeSession(id: string, title: string): Session {
  return { id, title, updated_at: '2026-07-07T08:00:00.000Z' };
}

function makeNode(
  session: Session,
  children: WorkspaceSessionTreeNode<Session>[] = [],
): WorkspaceSessionTreeNode<Session> {
  return { session, children };
}

function makeTreeGroup(
  workspacePath: string,
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
    workspaceLabel: workspacePath,
    sessions,
    roots,
  };
}

const PARENT = makeSession('parent', '父会话');
const CHILD_MATCH = makeSession('child', '命中的子会话');
const OTHER = makeSession('other', '无关会话');

const GROUPS: WorkspaceSessionTreeGroup<Session>[] = [
  makeTreeGroup('/repo/a', [makeNode(PARENT, [makeNode(CHILD_MATCH)]), makeNode(OTHER)]),
];

describe('groupSessionsByWorkspace', () => {
  it('未指定工作区的会话组沉底，标题统一取未指定工作区描述', () => {
    const boundSession: Session = {
      ...makeSession('bound', '工作区会话'),
      metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
    };
    const unboundSession: Session = {
      ...makeSession('unbound', '无工作区会话'),
      updated_at: '2026-09-13T00:00:00.000Z',
    };

    const groups = groupSessionsByWorkspace([unboundSession, boundSession]);

    expect(groups.map((group) => group.workspacePath)).toEqual(['/repo/alpha', null]);
    expect(groups[1]?.workspaceLabel).toBe(UNBOUND_WORKSPACE_LABEL);
  });

  it('多个工作区都活跃时按名称字母序，闲置组沉底', () => {
    const alpha: Session = {
      ...makeSession('alpha', 'A 会话'),
      metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
    };
    const zeta: Session = {
      ...makeSession('zeta', 'Z 会话'),
      updated_at: '2026-09-13T00:00:00.000Z',
      metadata_json: JSON.stringify({ workingDirectory: '/repo/zeta' }),
    };

    const groups = groupSessionsByWorkspace([zeta, alpha], ['/repo/idle']);

    expect(groups.map((group) => group.workspaceLabel)).toEqual(['alpha', 'zeta', 'idle']);
  });

  it('会话组透传 SSH 连接 id：远端组非空，本地组为 null', () => {
    const sshSession: Session = {
      ...makeSession('ssh', '远端会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-1',
        workingDirectory: '/remote/repo',
      }),
    };
    const localSession: Session = {
      ...makeSession('local', '本地会话'),
      metadata_json: JSON.stringify({ workingDirectory: '/local/repo' }),
    };

    const groups = groupSessionsByWorkspace([sshSession, localSession]);
    const byPath = new Map(groups.map((group) => [group.workspacePath, group]));

    expect(byPath.get('/remote/repo')?.sshConnectionId).toBe('ssh-1');
    expect(byPath.get('/local/repo')?.sshConnectionId).toBeNull();
  });

  it('同一远端目录下的子会话继承连接 id，整组统一标记为远端', () => {
    const parent: Session = {
      ...makeSession('ssh-parent', '远端父会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-1',
        workingDirectory: '/remote/repo',
      }),
    };
    const child: Session = {
      ...makeSession('ssh-child', '子会话'),
      metadata_json: JSON.stringify({
        parentSessionId: 'ssh-parent',
        workingDirectory: '/remote/repo',
      }),
    };

    const groups = groupSessionsByWorkspace([parent, child]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sshConnectionId).toBe('ssh-1');
  });
});

describe('resolveWorkspaceGroupDisplayName', () => {
  it('有工作区时优先返回自定义名称', () => {
    expect(
      resolveWorkspaceGroupDisplayName(
        { workspacePath: '/repo/alpha', workspaceLabel: 'alpha' },
        () => '我的项目',
      ),
    ).toBe('我的项目');
  });

  it('未绑定工作区的分组沿用默认标签，不落到兜底名', () => {
    expect(
      resolveWorkspaceGroupDisplayName(
        { workspacePath: null, workspaceLabel: UNBOUND_WORKSPACE_LABEL },
        () => '不应生效',
      ),
    ).toBe(UNBOUND_WORKSPACE_LABEL);
  });
});

describe('resolveSessionWorkspaceBindingById', () => {
  it('按 id 解析会话自身本地工作区（SSH 连接 id 为 null）', () => {
    const boundSession: Session = {
      ...makeSession('bound', '工作区会话'),
      metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
    };

    expect(resolveSessionWorkspaceBindingById([boundSession], 'bound')).toEqual({
      sshConnectionId: null,
      workspacePath: '/repo/alpha',
    });
  });

  it('SSH 会话把远端路径与连接 id 成对返回', () => {
    const sshSession: Session = {
      ...makeSession('ssh-session', '远端会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-1',
        workingDirectory: '/remote/repo',
      }),
    };

    expect(resolveSessionWorkspaceBindingById([sshSession], 'ssh-session')).toEqual({
      sshConnectionId: 'ssh-1',
      workspacePath: '/remote/repo',
    });
  });

  it('自身未绑定时沿父会话链继承', () => {
    const parent: Session = {
      ...makeSession('parent', '父会话'),
      metadata_json: JSON.stringify({ workingDirectory: '/repo/parent' }),
    };
    const child: Session = {
      ...makeSession('child', '子会话'),
      metadata_json: JSON.stringify({ parentSessionId: 'parent' }),
    };

    expect(resolveSessionWorkspaceBindingById([parent, child], 'child')).toEqual({
      sshConnectionId: null,
      workspacePath: '/repo/parent',
    });
  });

  it('已确认未绑定的会话返回空绑定', () => {
    expect(
      resolveSessionWorkspaceBindingById([makeSession('unbound', '无工作区')], 'unbound'),
    ).toEqual({ sshConnectionId: null, workspacePath: null });
  });

  it('子会话沿父会话链继承 SSH 绑定', () => {
    const parent: Session = {
      ...makeSession('ssh-parent', '远端父会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-parent',
        workingDirectory: '/remote/parent',
      }),
    };
    const child: Session = {
      ...makeSession('ssh-child', '子会话'),
      metadata_json: JSON.stringify({ parentSessionId: 'ssh-parent' }),
    };

    expect(resolveSessionWorkspaceBindingById([parent, child], 'ssh-child')).toEqual({
      sshConnectionId: 'ssh-parent',
      workspacePath: '/remote/parent',
    });
  });

  it('路径与 SSH 绑定各自沿父链继承（子会话只带远端路径时连接 id 取自祖先）', () => {
    const parent: Session = {
      ...makeSession('ssh-parent', '远端父会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-parent',
        workingDirectory: '/remote/parent',
      }),
    };
    const child: Session = {
      ...makeSession('ssh-child', '子会话'),
      metadata_json: JSON.stringify({
        parentSessionId: 'ssh-parent',
        workingDirectory: '/remote/child',
      }),
    };

    expect(resolveSessionWorkspaceBindingById([parent, child], 'ssh-child')).toEqual({
      sshConnectionId: 'ssh-parent',
      workspacePath: '/remote/child',
    });
  });

  it('列表里找不到目标会话时返回 undefined', () => {
    expect(
      resolveSessionWorkspaceBindingById([makeSession('other', '其它')], 'missing'),
    ).toBeUndefined();
  });
});

describe('filterSessionTreeGroupsByQuery', () => {
  it('空查询原样返回', () => {
    expect(filterSessionTreeGroupsByQuery(GROUPS, '  ')).toBe(GROUPS);
  });

  it('命中子会话时保留父节点', () => {
    const [group] = filterSessionTreeGroupsByQuery(GROUPS, '命中');
    expect(group?.roots).toHaveLength(1);
    expect(group?.roots[0]?.session.id).toBe('parent');
    expect(group?.roots[0]?.children.map((node) => node.session.id)).toEqual(['child']);
    expect(group?.sessions.map((session) => session.id)).toEqual(['parent', 'child']);
  });
});

describe('filterSessionTreeGroupsByMatcher', () => {
  it('按自定义条件过滤（模拟标题 ∪ 内容命中）', () => {
    const contentMatchedIds = new Set(['other']);
    const [group] = filterSessionTreeGroupsByMatcher(
      GROUPS,
      (session) => session.id === 'parent' || contentMatchedIds.has(session.id),
    );

    expect(group?.roots.map((node) => node.session.id)).toEqual(['parent', 'other']);
    expect(group?.roots[0]?.children).toEqual([]);
    expect(group?.sessions.map((session) => session.id)).toEqual(['parent', 'other']);
  });

  it('无命中时返回空 roots 与空 sessions', () => {
    const [group] = filterSessionTreeGroupsByMatcher(GROUPS, () => false);
    expect(group?.roots).toEqual([]);
    expect(group?.sessions).toEqual([]);
  });
});
