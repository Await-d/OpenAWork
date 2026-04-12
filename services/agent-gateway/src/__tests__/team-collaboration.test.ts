import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteAllMock, sqliteRunMock, sqliteGetMock } = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  sqliteGetMock: vi.fn(),
}));

const { listSharedSessionsForRecipientMock } = vi.hoisted(() => ({
  listSharedSessionsForRecipientMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({ requireAuth: async () => undefined }));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    workflowLogger: { succeed: () => undefined, fail: () => undefined },
    step: { succeed: () => undefined, fail: () => undefined },
    child: () => ({ succeed: () => undefined, fail: () => undefined }),
  }),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ROOT: '/repo',
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOTS: ['/repo'],
  sqliteAll: sqliteAllMock,
  sqliteRun: sqliteRunMock,
  sqliteGet: sqliteGetMock,
}));

vi.mock('../session-shared-access.js', () => ({
  listSharedSessionsForRecipient: listSharedSessionsForRecipientMock,
}));

import { teamRoutes } from '../routes/team.js';

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.clearAllMocks();
  let currentSharePermission: 'view' | 'comment' | 'operate' = 'comment';
  sqliteAllMock.mockImplementation((sql: string) => {
    if (sql.includes('FROM team_workspaces')) {
      return [
        {
          id: 'workspace-1',
          user_id: 'user-1',
          name: 'Web 工作区',
          description: '负责 Web Team Runtime',
          visibility: 'private',
          default_working_root: '/repo/apps/web',
          created_at: '2026-03-22T00:00:00.000Z',
          updated_at: '2026-03-22T01:00:00.000Z',
        },
      ];
    }
    if (sql.includes('FROM team_members')) {
      return [
        {
          id: 'member-1',
          name: '林雾',
          email: 'linwu@openawork.local',
          role: 'owner',
          avatar_url: null,
          status: 'working',
          created_at: '2026-03-22T00:00:00.000Z',
        },
      ];
    }
    if (sql.includes('FROM team_tasks')) {
      return [
        {
          id: 'task-1',
          title: '实现协同状态流',
          assignee_id: null,
          status: 'pending',
          priority: 'high',
          result: null,
          created_at: '2026-03-22T00:00:00.000Z',
          updated_at: '2026-03-22T00:00:00.000Z',
        },
      ];
    }
    if (sql.includes('FROM team_messages')) {
      return [
        {
          id: 'msg-1',
          sender_id: 'member-1',
          content: '任务已认领',
          type: 'update',
          created_at: '2026-03-22T00:00:00.000Z',
        },
      ];
    }
    if (sql.includes('FROM session_shares')) {
      return [
        {
          id: 'share-1',
          session_id: 'session-1',
          member_id: 'member-1',
          permission: currentSharePermission,
          created_at: '2026-03-22T00:00:00.000Z',
          updated_at: '2026-03-22T01:00:00.000Z',
          member_name: '林雾',
          member_email: 'linwu@openawork.local',
          label: '设计讨论',
          session_metadata_json: JSON.stringify({
            teamWorkspaceId: 'workspace-1',
            workingDirectory: '/repo/apps/web',
          }),
        },
      ];
    }
    if (sql.includes('FROM sessions') && sql.includes('WHERE user_id')) {
      return [
        {
          id: 'session-1',
          title: '设计讨论',
          metadata_json: JSON.stringify({
            teamWorkspaceId: 'workspace-1',
            workingDirectory: '/repo/apps/web',
          }),
          updated_at: '2026-03-22T01:00:00.000Z',
        },
        {
          id: 'session-2',
          title: '子代理检索',
          metadata_json: JSON.stringify({ parentSessionId: 'session-1' }),
          updated_at: '2026-03-22T01:10:00.000Z',
        },
        {
          id: 'session-3',
          title: '孙子代理整理',
          metadata_json: JSON.stringify({ parentSessionId: 'session-2' }),
          updated_at: '2026-03-22T01:20:00.000Z',
        },
      ];
    }
    if (sql.includes('FROM team_audit_logs')) {
      return [
        {
          id: 1,
          action: 'share_created',
          actor_user_id: 'user-1',
          actor_email: 'owner@openawork.local',
          entity_type: 'session_share',
          entity_id: 'share-1',
          summary: '已将“设计讨论”共享给 林雾（comment）',
          detail: '会话：设计讨论；成员：林雾；权限：comment',
          created_at: '2026-03-22T02:00:00.000Z',
        },
      ];
    }
    return [];
  });
  sqliteGetMock.mockImplementation((sql: string) => {
    if (sql.includes('FROM team_workspaces')) {
      return {
        id: 'workspace-1',
        user_id: 'user-1',
        name: 'Web 工作区',
        description: '负责 Web Team Runtime',
        visibility: 'private',
        default_working_root: '/repo/apps/web',
        created_at: '2026-03-22T00:00:00.000Z',
        updated_at: '2026-03-22T01:00:00.000Z',
      };
    }
    if (sql.includes('FROM team_tasks')) {
      return { id: 'task-1' };
    }
    if (sql.includes('FROM sessions')) {
      return {
        id: 'session-1',
        title: '设计讨论',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/apps/web' }),
      };
    }
    if (sql.includes('FROM team_members')) {
      return { id: 'member-1', name: '林雾', email: 'linwu@openawork.local' };
    }
    if (sql.includes('FROM session_shares')) {
      if (sql.includes('JOIN team_members')) {
        return {
          id: 'share-1',
          session_id: 'session-1',
          member_id: 'member-1',
          permission: currentSharePermission,
          created_at: '2026-03-22T00:00:00.000Z',
          updated_at: '2026-03-22T01:00:00.000Z',
          member_name: '林雾',
          member_email: 'linwu@openawork.local',
          label: '设计讨论',
          session_metadata_json: JSON.stringify({ workingDirectory: '/repo/apps/web' }),
        };
      }
      return undefined;
    }
    return { id: 'task-1' };
  });
  sqliteRunMock.mockImplementation((sql: string, params?: unknown[]) => {
    if (sql.includes('INSERT INTO session_shares') && Array.isArray(params) && params[4]) {
      currentSharePermission = params[4] as 'view' | 'comment' | 'operate';
    }

    if (sql.includes('UPDATE session_shares') && Array.isArray(params) && params[0]) {
      currentSharePermission = params[0] as 'view' | 'comment' | 'operate';
    }
  });
  listSharedSessionsForRecipientMock.mockReturnValue([
    {
      session: {
        id: 'shared-session-1',
        title: '上线回顾',
        stateStatus: 'paused',
        workspacePath: '/repo/apps/web',
        createdAt: '2026-04-04T03:00:00.000Z',
        updatedAt: '2026-04-04T03:30:00.000Z',
        metadataJson: JSON.stringify({ workingDirectory: '/repo/apps/web' }),
      },
      ownerUserId: 'owner-1',
      permission: 'comment',
      messagesJson: '[]',
      shareCreatedAt: '2026-04-04T04:00:00.000Z',
      shareUpdatedAt: '2026-04-04T04:15:00.000Z',
      sharedByEmail: 'owner@openawork.local',
    },
  ]);

  app = Fastify();
  app.decorateRequest('user', {
    getter() {
      return { sub: 'user-1', email: 'owner@openawork.local' };
    },
  });
  await app.register(teamRoutes);
  await app.ready();
});

describe('teamRoutes collaboration slice', () => {
  it('lists team workspaces for the current user', async () => {
    const res = await app.inject({ method: 'GET', url: '/team/workspaces' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
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
    ]);
  });

  it('creates a team workspace root record', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/team/workspaces',
      payload: {
        name: 'API 工作区',
        description: '负责 API Team Runtime',
        visibility: 'closed',
        defaultWorkingRoot: '/repo/apps/api',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(sqliteRunMock).toHaveBeenCalled();
  });

  it('updates a team workspace root record', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/team/workspaces/workspace-1',
      payload: { description: '更新后的说明' },
    });

    expect(res.statusCode).toBe(200);
    expect(sqliteRunMock).toHaveBeenCalled();
  });

  it('creates a team-owned thread under a workspace', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/team/workspaces/workspace-1/threads',
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    expect(sqliteRunMock).toHaveBeenCalled();
    expect(res.json()).toMatchObject({
      state_status: 'idle',
      title: 'Web 工作区',
    });
  });

  it('loads a workspace-scoped team snapshot', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/team/workspaces/workspace-1/runtime',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      workspace: {
        id: 'workspace-1',
        defaultWorkingRoot: '/repo/apps/web',
      },
      sessions: [
        expect.objectContaining({
          id: 'session-1',
          workspacePath: '/repo/apps/web',
        }),
      ],
      sharedSessions: [
        expect.objectContaining({
          sessionId: 'shared-session-1',
        }),
      ],
      sessionShares: [
        expect.objectContaining({
          sessionId: 'session-1',
        }),
      ],
    });
  });

  it('updates a team task with assignee/status/result', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/team/tasks/task-1',
      payload: {
        assigneeId: 'member-1',
        status: 'in_progress',
        result: '开始处理',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sqliteRunMock).toHaveBeenCalled();
  });

  it('creates a typed team message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/team/messages',
      payload: {
        senderId: 'member-1',
        content: '我来认领这个任务',
        type: 'question',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(sqliteRunMock).toHaveBeenCalled();
  });

  it('returns shared-ui-compatible creation payloads', async () => {
    const taskRes = await app.inject({
      method: 'POST',
      url: '/team/tasks',
      payload: {
        title: '实现协同状态流',
        priority: 'high',
        status: 'pending',
      },
    });
    const messageRes = await app.inject({
      method: 'POST',
      url: '/team/messages',
      payload: {
        senderId: 'member-1',
        content: '我来认领这个任务',
        type: 'question',
      },
    });

    expect(JSON.parse(taskRes.body)).toMatchObject({
      title: '实现协同状态流',
      status: 'pending',
      result: null,
    });
    expect(JSON.parse(messageRes.body)).toMatchObject({
      id: expect.any(String),
      memberId: 'member-1',
      type: 'question',
      timestamp: expect.any(Number),
    });
  });

  it('creates and lists session shares with permission levels', async () => {
    sqliteRunMock.mockClear();
    const createRes = await app.inject({
      method: 'POST',
      url: '/team/session-shares',
      payload: {
        sessionId: 'session-1',
        memberId: 'member-1',
        permission: 'operate',
      },
    });
    const listRes = await app.inject({ method: 'GET', url: '/team/session-shares' });

    expect(createRes.statusCode).toBe(201);
    expect(JSON.parse(createRes.body)).toMatchObject({
      sessionId: 'session-1',
      memberId: 'member-1',
      permission: 'operate',
      sessionLabel: '设计讨论',
      workspacePath: '/repo/apps/web',
    });
    expect(JSON.parse(listRes.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'share-1',
          sessionId: 'session-1',
          memberId: 'member-1',
          permission: 'operate',
          workspacePath: '/repo/apps/web',
          updatedAt: '2026-03-22T01:00:00.000Z',
        }),
      ]),
    );
    expect(
      sqliteAllMock.mock.calls.some(
        ([sql]) =>
          typeof sql === 'string' && sql.includes('sess.metadata_json AS session_metadata_json'),
      ),
    ).toBe(true);
    expect(
      sqliteRunMock.mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string' &&
          sql.includes('INSERT INTO team_audit_logs') &&
          Array.isArray(params) &&
          params.includes('share_created') &&
          params.includes('owner@openawork.local') &&
          params.includes('user-1'),
      ),
    ).toBe(true);
  });

  it('updates a session share permission and exposes audit logs', async () => {
    sqliteRunMock.mockClear();
    const updateRes = await app.inject({
      method: 'PATCH',
      url: '/team/session-shares/share-1',
      payload: {
        permission: 'operate',
      },
    });
    const auditRes = await app.inject({ method: 'GET', url: '/team/audit-logs?limit=10' });

    expect(updateRes.statusCode).toBe(200);
    expect(JSON.parse(updateRes.body)).toMatchObject({
      id: 'share-1',
      permission: 'operate',
      sessionLabel: '设计讨论',
      workspacePath: '/repo/apps/web',
    });
    expect(sqliteRunMock).toHaveBeenCalledWith(expect.stringContaining('UPDATE session_shares'), [
      'operate',
      'share-1',
      'user-1',
    ]);
    expect(
      sqliteRunMock.mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string' &&
          sql.includes('INSERT INTO team_audit_logs') &&
          Array.isArray(params) &&
          params.includes('share_permission_updated') &&
          params.includes('owner@openawork.local') &&
          params.includes('user-1'),
      ),
    ).toBe(true);
    expect(JSON.parse(auditRes.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'share_created',
          actorEmail: 'owner@openawork.local',
          entityType: 'session_share',
          entityId: 'share-1',
        }),
      ]),
    );
  });

  it('preserves the original updatedAt when session share permission is unchanged', async () => {
    sqliteRunMock.mockClear();

    const updateRes = await app.inject({
      method: 'PATCH',
      url: '/team/session-shares/share-1',
      payload: {
        permission: 'comment',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(JSON.parse(updateRes.body)).toMatchObject({
      id: 'share-1',
      permission: 'comment',
      workspacePath: '/repo/apps/web',
      updatedAt: '2026-03-22T01:00:00.000Z',
    });
    expect(
      sqliteRunMock.mock.calls.some(([sql]) =>
        typeof sql === 'string' ? sql.includes('UPDATE session_shares') : false,
      ),
    ).toBe(false);
  });

  it('logs actor attribution when deleting a session share', async () => {
    sqliteRunMock.mockClear();

    const response = await app.inject({
      method: 'DELETE',
      url: '/team/session-shares/share-1',
    });

    expect(response.statusCode).toBe(204);
    expect(
      sqliteRunMock.mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string' &&
          sql.includes('INSERT INTO team_audit_logs') &&
          Array.isArray(params) &&
          params.includes('share_deleted') &&
          params.includes('owner@openawork.local') &&
          params.includes('user-1'),
      ),
    ).toBe(true);
  });

  it('returns the aggregated team runtime read model', async () => {
    const response = await app.inject({ method: 'GET', url: '/team/runtime' });

    expect(response.statusCode).toBe(200);
    expect(listSharedSessionsForRecipientMock).toHaveBeenCalledWith({
      email: 'owner@openawork.local',
      limit: 24,
      offset: 0,
    });
    expect(JSON.parse(response.body)).toMatchObject({
      members: [expect.objectContaining({ id: 'member-1', name: '林雾' })],
      tasks: [expect.objectContaining({ id: 'task-1', title: '实现协同状态流' })],
      messages: [expect.objectContaining({ id: 'msg-1', content: '任务已认领' })],
      runtimeTaskGroups: [expect.objectContaining({ workspacePath: '/repo/apps/web' })],
      sessionShares: [expect.objectContaining({ id: 'share-1', workspacePath: '/repo/apps/web' })],
      sessions: [
        expect.objectContaining({ id: 'session-1', workspacePath: '/repo/apps/web' }),
        expect.objectContaining({ id: 'session-2', workspacePath: '/repo/apps/web' }),
        expect.objectContaining({ id: 'session-3', workspacePath: '/repo/apps/web' }),
      ],
      sharedSessions: [
        expect.objectContaining({ sessionId: 'shared-session-1', workspacePath: '/repo/apps/web' }),
      ],
      auditLogs: [expect.objectContaining({ action: 'share_created', entityId: 'share-1' })],
    });

    const runtime = JSON.parse(response.body) as {
      runtimeTaskGroups: Array<{
        sessionIds: string[];
        tasks: Array<{ id: string; status: string }>;
      }>;
    };
    expect(runtime.runtimeTaskGroups[0]?.sessionIds).toEqual(
      expect.arrayContaining(['shared-session-1']),
    );
    expect(runtime.runtimeTaskGroups[0]?.tasks.some((task) => task.status === 'cancelled')).toBe(
      false,
    );
  });
});
