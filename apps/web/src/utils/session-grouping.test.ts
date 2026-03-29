import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceSessionCollections,
  countSessionsByWorkspace,
  filterSessionTreeGroupsByQuery,
  groupSessionTreesByWorkspace,
  groupSessionsByWorkspace,
  UNBOUND_WORKSPACE_GROUP_KEY,
} from './session-grouping.js';

describe('groupSessionsByWorkspace', () => {
  it('groups sessions by working directory and sorts sessions by recent activity', () => {
    const groups = groupSessionsByWorkspace([
      {
        id: 's3',
        title: 'C',
        updated_at: '2026-03-21T08:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
      },
      {
        id: 's2',
        title: 'B',
        updated_at: '2026-03-21T09:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/beta' }),
      },
      {
        id: 's1',
        title: 'A',
        updated_at: '2026-03-21T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ workspacePath: '/repo/alpha', workspaceLabel: 'alpha' });
    expect(groups[0]?.sessions.map((session: { id: string }) => session.id)).toEqual(['s1', 's3']);
    expect(groups[1]).toMatchObject({ workspacePath: '/repo/beta', workspaceLabel: 'beta' });
  });

  it('sorts workspace groups by the latest session update time', () => {
    const groups = groupSessionsByWorkspace([
      {
        id: 'beta-1',
        title: 'Beta newer',
        updated_at: '2026-03-21T11:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/beta' }),
      },
      {
        id: 'alpha-1',
        title: 'Alpha older',
        updated_at: '2026-03-21T09:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
      },
    ]);

    expect(groups.map((group) => group.workspacePath)).toEqual(['/repo/beta', '/repo/alpha']);
  });

  it('places sessions without workingDirectory into the unbound group', () => {
    const groups = groupSessionsByWorkspace([
      {
        id: 's1',
        title: 'No workspace',
        updated_at: '2026-03-21T10:00:00.000Z',
      },
      {
        id: 's2',
        title: 'Broken metadata',
        updated_at: '2026-03-21T09:00:00.000Z',
        metadata_json: 'not-json',
      },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        workspacePath: null,
        workspaceLabel: '未绑定工作区',
        sessions: [expect.objectContaining({ id: 's1' }), expect.objectContaining({ id: 's2' })],
      }),
    ]);
  });

  it('includes saved workspaces even when they do not have sessions yet', () => {
    const groups = groupSessionsByWorkspace(
      [
        {
          id: 's1',
          title: 'Bound session',
          updated_at: '2026-03-21T10:00:00.000Z',
          metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
        },
      ],
      ['/repo/empty', '/repo/alpha'],
    );

    expect(groups).toEqual([
      expect.objectContaining({
        workspacePath: '/repo/alpha',
        workspaceLabel: 'alpha',
        sessions: [expect.objectContaining({ id: 's1' })],
      }),
      expect.objectContaining({
        workspacePath: '/repo/empty',
        workspaceLabel: 'empty',
        sessions: [],
      }),
    ]);
  });

  it('counts sessions by workspace with one pass', () => {
    const counts = countSessionsByWorkspace([
      {
        id: 's1',
        title: 'Alpha 1',
        updated_at: '2026-03-21T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
      },
      {
        id: 's2',
        title: 'Alpha 2',
        updated_at: '2026-03-21T11:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
      },
      {
        id: 's3',
        title: 'Unbound',
        updated_at: '2026-03-21T12:00:00.000Z',
      },
    ]);

    expect(counts.get('/repo/alpha')).toBe(2);
    expect(counts.get(UNBOUND_WORKSPACE_GROUP_KEY)).toBe(1);
  });

  it('inherits the parent workspace for child sessions without their own binding', () => {
    const groups = groupSessionsByWorkspace([
      {
        id: 'parent',
        title: '父会话',
        updated_at: '2026-03-21T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
      },
      {
        id: 'child',
        title: '子会话',
        updated_at: '2026-03-21T09:00:00.000Z',
        metadata_json: JSON.stringify({ parentSessionId: 'parent' }),
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.workspacePath).toBe('/repo/alpha');
    expect(groups[0]?.sessions.map((session) => session.id)).toEqual(['parent', 'child']);
  });
});

describe('groupSessionTreesByWorkspace', () => {
  it('builds parent-child trees within a workspace group', () => {
    const groups = groupSessionTreesByWorkspace([
      {
        id: 'parent',
        title: '父会话',
        updated_at: '2026-03-21T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
      },
      {
        id: 'child-1',
        title: '子会话 1',
        updated_at: '2026-03-21T09:30:00.000Z',
        metadata_json: JSON.stringify({
          parentSessionId: 'parent',
          workingDirectory: '/repo/alpha',
        }),
      },
      {
        id: 'child-2',
        title: '子会话 2',
        updated_at: '2026-03-21T09:00:00.000Z',
        metadata_json: JSON.stringify({ parentSessionId: 'parent' }),
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.roots).toHaveLength(1);
    expect(groups[0]?.roots[0]?.session.id).toBe('parent');
    expect(groups[0]?.roots[0]?.children.map((node) => node.session.id)).toEqual([
      'child-1',
      'child-2',
    ]);
  });

  it('keeps parent nodes visible when only a child matches the search query', () => {
    const groups = groupSessionTreesByWorkspace([
      {
        id: 'parent',
        title: '父会话',
        updated_at: '2026-03-21T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
      },
      {
        id: 'child',
        title: '命中的子会话',
        updated_at: '2026-03-21T09:30:00.000Z',
        metadata_json: JSON.stringify({ parentSessionId: 'parent' }),
      },
    ]);

    const filteredGroups = filterSessionTreeGroupsByQuery(groups, '命中');

    expect(filteredGroups[0]?.sessions.map((session) => session.id)).toEqual(['parent', 'child']);
    expect(filteredGroups[0]?.roots).toHaveLength(1);
    expect(filteredGroups[0]?.roots[0]?.session.id).toBe('parent');
    expect(filteredGroups[0]?.roots[0]?.children[0]?.session.id).toBe('child');
  });
});

describe('buildWorkspaceSessionCollections', () => {
  it('builds reusable counts, session ids, and trees from a single grouping pass', () => {
    const collections = buildWorkspaceSessionCollections(
      [
        {
          id: 'parent',
          title: '父会话',
          updated_at: '2026-03-21T10:00:00.000Z',
          metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
        },
        {
          id: 'child',
          title: '子会话',
          updated_at: '2026-03-21T09:30:00.000Z',
          metadata_json: JSON.stringify({ parentSessionId: 'parent' }),
        },
      ],
      ['/repo/empty'],
    );

    expect(collections.groups.map((group) => group.workspacePath)).toEqual([
      '/repo/alpha',
      '/repo/empty',
    ]);
    expect(collections.sessionCountByWorkspace.get('/repo/alpha')).toBe(2);
    expect(collections.sessionIdsByGroupKey.get('/repo/alpha')).toEqual(['parent', 'child']);
    expect(collections.treeGroups[0]?.roots[0]?.session.id).toBe('parent');
    expect(collections.treeGroups[1]?.sessions).toEqual([]);
  });
});
