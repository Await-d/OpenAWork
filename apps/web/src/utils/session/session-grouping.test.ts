import { describe, expect, it } from 'vitest';
import type { Session } from '../../hooks/workspace/useSessions.js';
import {
  UNBOUND_WORKSPACE_LABEL,
  filterSessionTreeGroupsByMatcher,
  filterSessionTreeGroupsByQuery,
  groupSessionsByWorkspace,
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
