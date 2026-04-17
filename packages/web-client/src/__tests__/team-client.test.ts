import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTeamClient } from '../team.js';

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('team client runtime APIs', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the aggregated team runtime read model', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(200, {
        auditLogs: [],
        members: [],
        messages: [],
        sessionShares: [],
        sessions: [],
        sharedSessions: [],
        tasks: [],
      }),
    );

    const client = createTeamClient('http://gateway.test');
    const result = await client.getRuntime('token-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://gateway.test/team/runtime');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer token-1' },
    });
    expect(result).toEqual({
      auditLogs: [],
      members: [],
      messages: [],
      sessionShares: [],
      sessions: [],
      sharedSessions: [],
      tasks: [],
    });
  });

  it('throws on team runtime load failure', async () => {
    fetchMock.mockResolvedValue(createJsonResponse(500, { error: 'runtime failed' }));

    const client = createTeamClient('http://gateway.test');

    await expect(client.getRuntime('token-2')).rejects.toThrow('Failed to load team runtime: 500');
  });

  it('requests a workspace-scoped team runtime read model when teamWorkspaceId is provided', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(200, {
        auditLogs: [],
        members: [],
        messages: [],
        runtimeTaskGroups: [],
        sessionShares: [],
        sessions: [],
        sharedSessions: [],
        tasks: [],
      }),
    );

    const client = createTeamClient('http://gateway.test');
    await client.getRuntime('token-1', { teamWorkspaceId: 'workspace-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://gateway.test/team/runtime?teamWorkspaceId=workspace-1',
    );
  });

  it('lists and reads team workspace roots', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(200, [
          {
            id: 'workspace-1',
            name: 'Web 工作区',
            description: '负责 Web Team Runtime',
            visibility: 'private',
            defaultWorkingRoot: '/repo/apps/web',
            createdByUserId: 'user-1',
            createdAt: '2026-03-22T00:00:00.000Z',
            updatedAt: '2026-03-22T01:00:00.000Z',
          },
        ]),
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          id: 'workspace-1',
          name: 'Web 工作区',
          description: '负责 Web Team Runtime',
          visibility: 'private',
          defaultWorkingRoot: '/repo/apps/web',
          createdByUserId: 'user-1',
          createdAt: '2026-03-22T00:00:00.000Z',
          updatedAt: '2026-03-22T01:00:00.000Z',
        }),
      );

    const client = createTeamClient('http://gateway.test');
    const list = await client.listWorkspaces('token-1');
    const detail = await client.getWorkspace('token-1', 'workspace-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://gateway.test/team/workspaces');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://gateway.test/team/workspaces/workspace-1');
    expect(list[0]?.id).toBe('workspace-1');
    expect(detail.defaultWorkingRoot).toBe('/repo/apps/web');
  });

  it('creates and updates a team workspace root', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(201, {
          id: 'workspace-1',
          name: 'Web 工作区',
          description: null,
          visibility: 'private',
          defaultWorkingRoot: '/repo/apps/web',
          createdByUserId: 'user-1',
          createdAt: '2026-03-22T00:00:00.000Z',
          updatedAt: '2026-03-22T01:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          id: 'workspace-1',
          name: 'Web 工作区（更新）',
          description: null,
          visibility: 'private',
          defaultWorkingRoot: '/repo/apps/web',
          createdByUserId: 'user-1',
          createdAt: '2026-03-22T00:00:00.000Z',
          updatedAt: '2026-03-22T02:00:00.000Z',
        }),
      );

    const client = createTeamClient('http://gateway.test');
    const created = await client.createWorkspace('token-1', {
      name: 'Web 工作区',
      defaultWorkingRoot: '/repo/apps/web',
    });
    const updated = await client.updateWorkspace('token-1', 'workspace-1', {
      name: 'Web 工作区（更新）',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://gateway.test/team/workspaces');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://gateway.test/team/workspaces/workspace-1');
    expect(created.id).toBe('workspace-1');
    expect(updated.name).toBe('Web 工作区（更新）');
  });

  it('creates a team-owned thread under a workspace', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(201, {
        id: 'session-1',
        title: 'Web 工作区',
        state_status: 'idle',
        metadata_json: JSON.stringify({
          teamWorkspaceId: 'workspace-1',
          workingDirectory: '/repo/apps/web',
        }),
      }),
    );

    const client = createTeamClient('http://gateway.test');
    const thread = await client.createThread('token-1', 'workspace-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://gateway.test/team/workspaces/workspace-1/threads',
    );
    expect(thread.id).toBe('session-1');
  });

  it('creates a team session with optional agents and template source metadata', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(201, {
        id: 'session-2',
        title: '研究团队 2026-04-16',
        state_status: 'idle',
        metadata_json: JSON.stringify({
          teamWorkspaceId: 'workspace-1',
          teamDefinition: {
            source: { kind: 'blank' },
          },
          workingDirectory: '/repo/apps/web',
        }),
      }),
    );

    const client = createTeamClient('http://gateway.test');
    const session = await client.createSession('token-1', 'workspace-1', {
      title: '研究团队 2026-04-16',
      optionalAgentIds: ['atlas'],
      source: { kind: 'blank' },
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://gateway.test/team/workspaces/workspace-1/sessions',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      title: '研究团队 2026-04-16',
      optionalAgentIds: ['atlas'],
      source: { kind: 'blank' },
    });
    expect(session.id).toBe('session-2');
  });

  it('loads a workspace-scoped team snapshot', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(200, {
        workspace: {
          id: 'workspace-1',
          name: 'Web 工作区',
          description: '负责 Web Team Runtime',
          visibility: 'private',
          defaultWorkingRoot: '/repo/apps/web',
          createdByUserId: 'user-1',
          createdAt: '2026-03-22T00:00:00.000Z',
          updatedAt: '2026-03-22T01:00:00.000Z',
        },
        sessions: [],
        sharedSessions: [],
        sessionShares: [],
        runtimeTaskGroups: [],
      }),
    );

    const client = createTeamClient('http://gateway.test');
    const snapshot = await client.getWorkspaceSnapshot('token-1', 'workspace-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://gateway.test/team/workspaces/workspace-1/runtime',
    );
    expect(snapshot.workspace.id).toBe('workspace-1');
  });

  it('imports a session into a workspace through the team bridge contract', async () => {
    fetchMock.mockResolvedValue(createJsonResponse(201, { sessionId: 'imported-1' }));

    const client = createTeamClient('http://gateway.test');
    const result = await client.importIntoWorkspace('token-1', 'workspace-1', {
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://gateway.test/team/workspaces/workspace-1/imports',
    );
    expect(result.sessionId).toBe('imported-1');
  });
});
