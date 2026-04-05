import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildSessionFileChangesProjectionMock,
  createSharedSessionCommentMock,
  filterVisibleSessionMessagesMock,
  getSharedSessionForRecipientMock,
  listSharedSessionCommentsMock,
  listSessionFileDiffsMock,
  listSessionMessagesMock,
  listSessionRunEventsMock,
  listSessionSnapshotsMock,
  listSessionTodosMock,
  listSharedSessionsForRecipientMock,
  reconcileSessionRuntimeMock,
  sqliteGetMock,
} = vi.hoisted(() => ({
  buildSessionFileChangesProjectionMock: vi.fn(() => ({
    summary: {
      snapshotCount: 0,
      sourceKinds: [],
      totalAdditions: 0,
      totalDeletions: 0,
      totalFileDiffs: 0,
    },
  })),
  createSharedSessionCommentMock: vi.fn(),
  filterVisibleSessionMessagesMock: vi.fn((messages: unknown[]) => messages),
  getSharedSessionForRecipientMock: vi.fn(),
  listSharedSessionCommentsMock: vi.fn<
    () => Array<{
      authorEmail: string;
      content: string;
      createdAt: string;
      id: string;
      sessionId: string;
    }>
  >(() => []),
  listSessionFileDiffsMock: vi.fn(() => []),
  listSessionMessagesMock: vi.fn<
    () => Array<{ content: string; id: string; role: 'assistant' | 'user' }>
  >(() => []),
  listSessionRunEventsMock: vi.fn(() => []),
  listSessionSnapshotsMock: vi.fn(() => []),
  listSessionTodosMock: vi.fn(() => []),
  listSharedSessionsForRecipientMock: vi.fn(),
  reconcileSessionRuntimeMock: vi.fn(async () => ({ status: 'running' })),
  sqliteGetMock: vi.fn(() => undefined),
}));

vi.mock('../auth.js', () => ({
  requireAuth: async (request: { user?: { email: string; sub: string } }) => {
    request.user = { sub: 'viewer-1', email: 'viewer@openawork.local' };
  },
}));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: { succeed: () => undefined, fail: () => undefined },
  }),
}));

vi.mock('../session-shared-access.js', () => ({
  getSharedSessionForRecipient: getSharedSessionForRecipientMock,
  listSharedSessionsForRecipient: listSharedSessionsForRecipientMock,
}));

vi.mock('../session-message-store.js', () => ({
  filterVisibleSessionMessages: filterVisibleSessionMessagesMock,
  listSessionMessages: listSessionMessagesMock,
}));

vi.mock('../session-shared-comment-store.js', () => ({
  createSharedSessionComment: createSharedSessionCommentMock,
  listSharedSessionComments: listSharedSessionCommentsMock,
}));

vi.mock('../session-runtime-reconciler.js', () => ({
  reconcileSessionRuntime: reconcileSessionRuntimeMock,
}));

vi.mock('../session-workspace-metadata.js', () => ({
  sanitizeSessionMetadataJson: (value: string) => value,
}));

vi.mock('../todo-tools.js', () => ({
  listSessionTodos: listSessionTodosMock,
}));

vi.mock('../session-run-events.js', () => ({
  listSessionRunEvents: listSessionRunEventsMock,
}));

vi.mock('../session-file-changes-projection.js', () => ({
  buildSessionFileChangesProjection: buildSessionFileChangesProjectionMock,
}));

vi.mock('../session-file-diff-store.js', () => ({
  listSessionFileDiffs: listSessionFileDiffsMock,
}));

vi.mock('../session-snapshot-store.js', () => ({
  listSessionSnapshots: listSessionSnapshotsMock,
}));

vi.mock('../db.js', () => ({
  sqliteGet: sqliteGetMock,
}));

import { registerSessionSharedReadRoutes } from '../routes/session-shared-read-routes.js';

describe('session shared read routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSharedSessionsForRecipientMock.mockReturnValue([
      {
        session: {
          id: 'shared-session-1',
          title: '上线回顾',
          stateStatus: 'paused',
          workspacePath: '/repo/apps/api',
          createdAt: '2026-04-04T03:00:00.000Z',
          updatedAt: '2026-04-04T03:30:00.000Z',
          metadataJson: JSON.stringify({ workingDirectory: '/repo/apps/api' }),
        },
        ownerUserId: 'owner-1',
        permission: 'comment',
        messagesJson: '[]',
        shareCreatedAt: '2026-04-04T04:00:00.000Z',
        shareUpdatedAt: '2026-04-04T04:15:00.000Z',
        sharedByEmail: 'owner@openawork.local',
      },
    ]);
    getSharedSessionForRecipientMock.mockReturnValue({
      session: {
        id: 'shared-session-1',
        title: '上线回顾',
        stateStatus: 'paused',
        workspacePath: '/repo/apps/api',
        createdAt: '2026-04-04T03:00:00.000Z',
        updatedAt: '2026-04-04T03:30:00.000Z',
        metadataJson: JSON.stringify({ workingDirectory: '/repo/apps/api' }),
      },
      ownerUserId: 'owner-1',
      permission: 'comment',
      messagesJson: '[]',
      shareCreatedAt: '2026-04-04T04:00:00.000Z',
      shareUpdatedAt: '2026-04-04T04:15:00.000Z',
      sharedByEmail: 'owner@openawork.local',
    });
    listSessionMessagesMock.mockReturnValue([
      { id: 'm-1', role: 'user', content: '请帮我复盘今天的上线。' },
    ]);
    listSharedSessionCommentsMock.mockReturnValue([
      {
        id: 'c-1',
        sessionId: 'shared-session-1',
        authorEmail: 'viewer@openawork.local',
        content: '我补充一下事故发生时间线。',
        createdAt: '2026-04-04T05:00:00.000Z',
      },
    ]);
    createSharedSessionCommentMock.mockReturnValue({
      id: 'c-2',
      sessionId: 'shared-session-1',
      authorEmail: 'viewer@openawork.local',
      content: '我先补一条评论',
      createdAt: '2026-04-04T05:10:00.000Z',
    });
  });

  it('lists sessions shared with the current recipient email', async () => {
    const app = Fastify();
    await registerSessionSharedReadRoutes(app);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/sessions/shared-with-me?limit=10' });

    expect(response.statusCode).toBe(200);
    expect(listSharedSessionsForRecipientMock).toHaveBeenCalledWith({
      email: 'viewer@openawork.local',
      limit: 10,
      offset: 0,
    });
    expect(JSON.parse(response.body)).toEqual({
      sessions: [
        expect.objectContaining({
          title: '上线回顾',
          permission: 'comment',
          workspacePath: '/repo/apps/api',
        }),
      ],
    });

    await app.close();
  });

  it('returns a shared session detail using the owner context for read-only data', async () => {
    const app = Fastify();
    await registerSessionSharedReadRoutes(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/sessions/shared-with-me/shared-session-1',
    });

    expect(response.statusCode).toBe(200);
    expect(getSharedSessionForRecipientMock).toHaveBeenCalledWith({
      email: 'viewer@openawork.local',
      sessionId: 'shared-session-1',
    });
    expect(listSessionMessagesMock).toHaveBeenCalledWith({
      sessionId: 'shared-session-1',
      userId: 'owner-1',
      legacyMessagesJson: '[]',
    });
    expect(JSON.parse(response.body)).toMatchObject({
      share: {
        permission: 'comment',
        sharedByEmail: 'owner@openawork.local',
        stateStatus: 'running',
      },
      comments: [
        {
          authorEmail: 'viewer@openawork.local',
          content: '我补充一下事故发生时间线。',
        },
      ],
      session: {
        state_status: 'running',
        title: '上线回顾',
        messages: [{ role: 'user', content: '请帮我复盘今天的上线。' }],
      },
    });

    await app.close();
  });

  it('creates a shared session comment for comment permission users', async () => {
    const app = Fastify();
    await registerSessionSharedReadRoutes(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/shared-with-me/shared-session-1/comments',
      payload: { content: '我先补一条评论' },
    });

    expect(response.statusCode).toBe(201);
    expect(createSharedSessionCommentMock).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      sessionId: 'shared-session-1',
      authorUserId: 'viewer-1',
      authorEmail: 'viewer@openawork.local',
      content: '我先补一条评论',
    });

    await app.close();
  });

  it('rejects shared session comments for view-only recipients', async () => {
    getSharedSessionForRecipientMock.mockReturnValueOnce({
      session: {
        id: 'shared-session-1',
        title: '上线回顾',
        stateStatus: 'paused',
        workspacePath: '/repo/apps/api',
        createdAt: '2026-04-04T03:00:00.000Z',
        updatedAt: '2026-04-04T03:30:00.000Z',
        metadataJson: JSON.stringify({ workingDirectory: '/repo/apps/api' }),
      },
      ownerUserId: 'owner-1',
      permission: 'view',
      messagesJson: '[]',
      shareCreatedAt: '2026-04-04T04:00:00.000Z',
      shareUpdatedAt: '2026-04-04T04:15:00.000Z',
      sharedByEmail: 'owner@openawork.local',
    });

    const app = Fastify();
    await registerSessionSharedReadRoutes(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/shared-with-me/shared-session-1/comments',
      payload: { content: '不该允许的评论' },
    });

    expect(response.statusCode).toBe(403);
    expect(createSharedSessionCommentMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('still returns shared comments for view-only recipients', async () => {
    getSharedSessionForRecipientMock.mockReturnValueOnce({
      session: {
        id: 'shared-session-1',
        title: '上线回顾',
        stateStatus: 'paused',
        workspacePath: '/repo/apps/api',
        createdAt: '2026-04-04T03:00:00.000Z',
        updatedAt: '2026-04-04T03:30:00.000Z',
        metadataJson: JSON.stringify({ workingDirectory: '/repo/apps/api' }),
      },
      ownerUserId: 'owner-1',
      permission: 'view',
      messagesJson: '[]',
      shareCreatedAt: '2026-04-04T04:00:00.000Z',
      shareUpdatedAt: '2026-04-04T04:15:00.000Z',
      sharedByEmail: 'owner@openawork.local',
    });

    const app = Fastify();
    await registerSessionSharedReadRoutes(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/sessions/shared-with-me/shared-session-1',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      share: {
        permission: 'view',
      },
      comments: [
        {
          authorEmail: 'viewer@openawork.local',
          content: '我补充一下事故发生时间线。',
        },
      ],
    });

    await app.close();
  });

  it('allows operate permission recipients to create shared comments', async () => {
    getSharedSessionForRecipientMock.mockReturnValueOnce({
      session: {
        id: 'shared-session-1',
        title: '上线回顾',
        stateStatus: 'paused',
        workspacePath: '/repo/apps/api',
        createdAt: '2026-04-04T03:00:00.000Z',
        updatedAt: '2026-04-04T03:30:00.000Z',
        metadataJson: JSON.stringify({ workingDirectory: '/repo/apps/api' }),
      },
      ownerUserId: 'owner-1',
      permission: 'operate',
      messagesJson: '[]',
      shareCreatedAt: '2026-04-04T04:00:00.000Z',
      shareUpdatedAt: '2026-04-04T04:15:00.000Z',
      sharedByEmail: 'owner@openawork.local',
    });

    const app = Fastify();
    await registerSessionSharedReadRoutes(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/shared-with-me/shared-session-1/comments',
      payload: { content: 'operate 权限也能留言' },
    });

    expect(response.statusCode).toBe(201);
    expect(createSharedSessionCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'shared-session-1',
        content: 'operate 权限也能留言',
      }),
    );

    await app.close();
  });

  it('returns 404 when the current recipient has no matching shared session', async () => {
    getSharedSessionForRecipientMock.mockReturnValueOnce(null);

    const app = Fastify();
    await registerSessionSharedReadRoutes(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/sessions/shared-with-me/missing-session',
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: 'Shared session not found' });

    await app.close();
  });
});
