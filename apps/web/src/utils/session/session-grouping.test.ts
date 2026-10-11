import { describe, expect, it } from 'vitest';
import type { Session } from '../../hooks/workspace/useSessions.js';
import {
  UNBOUND_WORKSPACE_GROUP_KEY,
  UNBOUND_WORKSPACE_LABEL,
  buildWorkspaceSessionCollections,
  filterSessionTreeGroupsByMatcher,
  filterSessionTreeGroupsByQuery,
  getWorkspaceGroupKey,
  groupSessionsByWorkspace,
  isWorkspaceGroupCollapsed,
  listWorkspaceIdentitiesFromSessions,
  resolveSessionWorkspaceBindingById,
  resolveWorkspaceGroupDisplayName,
} from './session-grouping.js';
import type {
  WorkspaceIdentity,
  WorkspaceSessionTreeGroup,
  WorkspaceSessionTreeNode,
} from './session-grouping.js';

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
    groupKey: getWorkspaceGroupKey(workspacePath),
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

    const groups = groupSessionsByWorkspace(
      [zeta, alpha],
      [{ workspacePath: '/repo/idle', sshConnectionId: null }],
    );

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

  it('两台主机上的同名远端目录分成两个组，不再合并', () => {
    const onHostA: Session = {
      ...makeSession('host-a', 'A 机会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-a',
        workingDirectory: '/srv/app',
      }),
    };
    const onHostB: Session = {
      ...makeSession('host-b', 'B 机会话'),
      updated_at: '2026-07-08T08:00:00.000Z',
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-b',
        workingDirectory: '/srv/app',
      }),
    };

    const groups = groupSessionsByWorkspace([onHostA, onHostB]);

    // 路径完全相同、只有主机不同——曾经在这里被合成一个工作区。
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.sshConnectionId).sort()).toEqual(['ssh-a', 'ssh-b']);
    expect(groups.every((group) => group.workspacePath === '/srv/app')).toBe(true);
    expect(groups.every((group) => group.sessions.length === 1)).toBe(true);
  });

  it('同名远端目录与同名本地目录也分成两个组', () => {
    const remote: Session = {
      ...makeSession('remote', '远端会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-a',
        workingDirectory: '/srv/app',
      }),
    };
    const local: Session = {
      ...makeSession('local', '本地会话'),
      updated_at: '2026-07-08T08:00:00.000Z',
      metadata_json: JSON.stringify({ workingDirectory: '/srv/app' }),
    };

    const groups = groupSessionsByWorkspace([remote, local]);

    expect(groups).toHaveLength(2);
  });

  it('闲置占位组按主机区分：远端空组不会被同名的本地空组吸附', () => {
    const saved: WorkspaceIdentity[] = [
      { workspacePath: '/srv/app', sshConnectionId: 'ssh-a' },
      { workspacePath: '/srv/app', sshConnectionId: null },
    ];

    const groups = groupSessionsByWorkspace([], saved);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.sshConnectionId).sort()).toEqual([null, 'ssh-a']);
  });
});

describe('getWorkspaceGroupKey', () => {
  it('本地工作区返回裸路径，与历史键保持一致', () => {
    expect(getWorkspaceGroupKey('/srv/app')).toBe('/srv/app');
    expect(getWorkspaceGroupKey('/srv/app', null)).toBe('/srv/app');
  });

  it('不同主机的同名目录得到不同的键', () => {
    expect(getWorkspaceGroupKey('/srv/app', 'ssh-a')).not.toBe(
      getWorkspaceGroupKey('/srv/app', 'ssh-b'),
    );
  });

  it('远端键与本地键不相等', () => {
    expect(getWorkspaceGroupKey('/srv/app', 'ssh-a')).not.toBe(getWorkspaceGroupKey('/srv/app'));
  });

  it('未绑定工作区忽略连接维度，返回统一占位键', () => {
    expect(getWorkspaceGroupKey(null)).toBe(UNBOUND_WORKSPACE_GROUP_KEY);
    expect(getWorkspaceGroupKey(null, 'ssh-a')).toBe(UNBOUND_WORKSPACE_GROUP_KEY);
  });
});

describe('isWorkspaceGroupCollapsed', () => {
  it('命中当前键时判定为折叠', () => {
    const collapsed = new Set([getWorkspaceGroupKey('/srv/app', 'ssh-a')]);

    expect(isWorkspaceGroupCollapsed(collapsed, '/srv/app', 'ssh-a')).toBe(true);
    expect(isWorkspaceGroupCollapsed(collapsed, '/srv/app', 'ssh-b')).toBe(false);
  });

  it('回落到升级前的裸路径键（本地与远端都兼容旧偏好）', () => {
    const collapsed = new Set(['/srv/app']);

    expect(isWorkspaceGroupCollapsed(collapsed, '/srv/app', 'ssh-a')).toBe(true);
    expect(isWorkspaceGroupCollapsed(collapsed, '/srv/app', null)).toBe(true);
    expect(isWorkspaceGroupCollapsed(collapsed, '/srv/other', 'ssh-a')).toBe(false);
  });
});

describe('buildWorkspaceSessionCollections', () => {
  it('同名跨主机的会话在计数表与批量删除集合里也各自独立', () => {
    const hostA: Session = {
      ...makeSession('host-a', 'A 机会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-a',
        workingDirectory: '/srv/app',
      }),
    };
    const hostB: Session = {
      ...makeSession('host-b', 'B 机会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-b',
        workingDirectory: '/srv/app',
      }),
    };

    const collections = buildWorkspaceSessionCollections([hostA, hostB]);
    const keyA = getWorkspaceGroupKey('/srv/app', 'ssh-a');
    const keyB = getWorkspaceGroupKey('/srv/app', 'ssh-b');

    expect(collections.sessionCountByWorkspace.get(keyA)).toBe(1);
    expect(collections.sessionCountByWorkspace.get(keyB)).toBe(1);
    expect(collections.sessionIdsByGroupKey.get(keyA)).toEqual(['host-a']);
    expect(collections.sessionIdsByGroupKey.get(keyB)).toEqual(['host-b']);
  });

  /**
   * 回归锁定：分组自带 `groupKey`，渲染层一律用它查计数表与折叠态。
   *
   * 曾出现过 `/sessions` 页用裸路径重算 groupKey 的问题——远端分组的计数静默变成 0、
   * 折叠失效，且不报任何错。这里断言 group 自带的键与计数表严格对齐，让「用错键」
   * 在测试期就暴露。
   */
  it('group.groupKey 是计数表与批量删除集合的唯一可取键', () => {
    const hostA: Session = {
      ...makeSession('host-a', 'A 机会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-a',
        workingDirectory: '/srv/app',
      }),
    };
    const hostB: Session = {
      ...makeSession('host-b', 'B 机会话'),
      updated_at: '2026-07-08T08:00:00.000Z',
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-b',
        workingDirectory: '/srv/app',
      }),
    };
    const local: Session = {
      ...makeSession('local', '本地会话'),
      updated_at: '2026-07-09T08:00:00.000Z',
      metadata_json: JSON.stringify({ workingDirectory: '/srv/app' }),
    };

    const collections = buildWorkspaceSessionCollections([hostA, hostB, local]);

    for (const group of collections.groups) {
      expect(group.groupKey).toBe(getWorkspaceGroupKey(group.workspacePath, group.sshConnectionId));
      expect(collections.sessionCountByWorkspace.get(group.groupKey)).toBe(group.sessions.length);
      expect(collections.sessionIdsByGroupKey.get(group.groupKey)).toEqual(
        group.sessions.map((session) => session.id),
      );
    }

    // 三个同名工作区、三个互不相同的键；裸路径查表必然拿不到远端分组。
    expect(collections.groups.map((group) => group.groupKey)).toHaveLength(3);
    expect(new Set(collections.groups.map((group) => group.groupKey)).size).toBe(3);
    expect(
      collections.groups
        .filter((group) => group.sshConnectionId !== null)
        .every((group) => collections.sessionCountByWorkspace.has(group.groupKey)),
    ).toBe(true);
  });

  it('闲置占位组的 groupKey 同样带连接维度', () => {
    const collections = buildWorkspaceSessionCollections(
      [],
      [
        { workspacePath: '/srv/app', sshConnectionId: 'ssh-a' },
        { workspacePath: '/srv/app', sshConnectionId: null },
      ],
    );

    expect(collections.groups.map((group) => group.groupKey)).toEqual([
      getWorkspaceGroupKey('/srv/app', 'ssh-a'),
      '/srv/app',
    ]);
  });

  it('未绑定工作区的 groupKey 恒为占位键，与连接维度无关', () => {
    const unbound: Session = makeSession('unbound', '无工作区会话');

    const groups = groupSessionsByWorkspace([unbound]);

    expect(groups[0]?.groupKey).toBe(UNBOUND_WORKSPACE_GROUP_KEY);
    expect(groups[0]?.sshConnectionId).toBeFalsy();
  });
});

describe('listWorkspaceIdentitiesFromSessions', () => {
  it('同名跨主机的目录分别返回各自的工作区身份', () => {
    const hostA: Session = {
      ...makeSession('host-a', 'A 机会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-a',
        workingDirectory: '/srv/app',
      }),
    };
    const hostB: Session = {
      ...makeSession('host-b', 'B 机会话'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-b',
        workingDirectory: '/srv/app',
      }),
    };
    const local: Session = {
      ...makeSession('local', '本地会话'),
      metadata_json: JSON.stringify({ workingDirectory: '/srv/app' }),
    };

    const identities = listWorkspaceIdentitiesFromSessions([hostA, hostB, local]);

    expect(identities).toHaveLength(3);
    expect(identities).toContainEqual({ workspacePath: '/srv/app', sshConnectionId: 'ssh-a' });
    expect(identities).toContainEqual({ workspacePath: '/srv/app', sshConnectionId: 'ssh-b' });
    expect(identities).toContainEqual({ workspacePath: '/srv/app', sshConnectionId: null });
  });

  it('同一工作区只保留一条身份', () => {
    const first: Session = {
      ...makeSession('first', '会话一'),
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-a',
        workingDirectory: '/srv/app',
      }),
    };
    const second: Session = {
      ...makeSession('second', '会话二'),
      updated_at: '2026-07-08T08:00:00.000Z',
      metadata_json: JSON.stringify({
        sshConnectionId: 'ssh-a',
        workingDirectory: '/srv/app',
      }),
    };

    expect(listWorkspaceIdentitiesFromSessions([first, second])).toEqual([
      { workspacePath: '/srv/app', sshConnectionId: 'ssh-a' },
    ]);
  });

  it('跳过未绑定工作区的会话', () => {
    expect(listWorkspaceIdentitiesFromSessions([makeSession('unbound', '无工作区')])).toEqual([]);
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
