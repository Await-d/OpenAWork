import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildSessionFileChangesProjectionMock,
  createSharedSessionCommentMock,
  createPermissionRepliedEventMock,
  createQuestionRepliedEventMock,
  expirePendingPermissionRequestsMock,
  expirePendingQuestionRequestsMock,
  filterVisibleSessionMessagesMock,
  formatAnsweredQuestionOutputMock,
  getSharedSessionForRecipientMock,
  listSharedSessionCommentsMock,
  listSharedSessionPresenceMock,
  listSessionFileDiffsMock,
  listSessionMessagesMock,
  listSessionRunEventsMock,
  listSessionSnapshotsMock,
  listSessionTodosMock,
  listSharedSessionsForRecipientMock,
  persistWorkspacePermanentPermissionMock,
  publishSessionRunEventMock,
  reconcileSessionRuntimeMock,
  resumeAnsweredQuestionRequestMock,
  resumeApprovedPermissionRequestMock,
  shouldExitPlanModeFromAnswersMock,
  sqliteAllMock,
  sqliteGetMock,
  sqliteRunMock,
  touchSharedSessionPresenceMock,
  terminateTaskChildSessionAsTimeoutMock,
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
  createPermissionRepliedEventMock: vi.fn((input) => ({ type: 'permission_replied', ...input })),
  createQuestionRepliedEventMock: vi.fn((input) => ({ type: 'question_replied', ...input })),
  expirePendingPermissionRequestsMock: vi.fn(() => 0),
  expirePendingQuestionRequestsMock: vi.fn(() => 0),
  filterVisibleSessionMessagesMock: vi.fn((messages: unknown[]) => messages),
  formatAnsweredQuestionOutputMock: vi.fn(() => 'formatted answers'),
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
  listSharedSessionPresenceMock: vi.fn<
    () => Array<{
      active: boolean;
      firstSeenAt: string;
      lastSeenAt: string;
      viewerEmail: string;
      viewerUserId: string;
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
  persistWorkspacePermanentPermissionMock: vi.fn(),
  publishSessionRunEventMock: vi.fn(),
  reconcileSessionRuntimeMock: vi.fn(async () => ({ status: 'running' })),
  resumeAnsweredQuestionRequestMock: vi.fn(async () => undefined),
  resumeApprovedPermissionRequestMock: vi.fn(async () => undefined),
  shouldExitPlanModeFromAnswersMock: vi.fn(() => true),
  sqliteAllMock: vi.fn<(query: string, params?: unknown[]) => unknown[]>(() => []),
  sqliteGetMock: vi.fn<(query: string, params?: unknown[]) => unknown>(() => undefined),
  sqliteRunMock: vi.fn(),
  touchSharedSessionPresenceMock: vi.fn<
    () => Array<{
      active: boolean;
      firstSeenAt: string;
      lastSeenAt: string;
      viewerEmail: string;
      viewerUserId: string;
    }>
  >(() => []),
  terminateTaskChildSessionAsTimeoutMock: vi.fn(async () => undefined),
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

vi.mock('../session-permission-events.js', () => ({
  createPermissionRepliedEvent: createPermissionRepliedEventMock,
}));

vi.mock('../session-question-events.js', () => ({
  createQuestionRepliedEvent: createQuestionRepliedEventMock,
}));

vi.mock('../session-shared-comment-store.js', () => ({
  createSharedSessionComment: createSharedSessionCommentMock,
  listSharedSessionComments: listSharedSessionCommentsMock,
}));

vi.mock('../session-shared-presence-store.js', () => ({
  listSharedSessionPresence: listSharedSessionPresenceMock,
  touchSharedSessionPresence: touchSharedSessionPresenceMock,
}));

vi.mock('../session-runtime-reconciler.js', () => ({
  reconcileSessionRuntime: reconcileSessionRuntimeMock,
}));

vi.mock('../session-workspace-metadata.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    parseSessionMetadataJson: (value: string) => JSON.parse(value),
    sanitizeSessionMetadataJson: (value: string) => value,
  };
});

vi.mock('../question-tools.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    formatAnsweredQuestionOutput: formatAnsweredQuestionOutputMock,
  };
});

vi.mock('../plan-mode-tools.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    shouldExitPlanModeFromAnswers: shouldExitPlanModeFromAnswersMock,
  };
});

vi.mock('../todo-tools.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listSessionTodos: listSessionTodosMock,
  };
});

vi.mock('../session-run-events.js', () => ({
  listSessionRunEvents: listSessionRunEventsMock,
  publishSessionRunEvent: publishSessionRunEventMock,
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
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/repo',
  WORKSPACE_ROOTS: ['/repo'],
  sqliteAll: sqliteAllMock,
  sqliteGet: sqliteGetMock,
  sqliteRun: sqliteRunMock,
}));

vi.mock('../workspace-safety.js', () => ({
  persistWorkspacePermanentPermission: persistWorkspacePermanentPermissionMock,
}));

vi.mock('../tool-sandbox.js', () => ({
  terminateTaskChildSessionAsTimeout: terminateTaskChildSessionAsTimeoutMock,
}));

vi.mock('../routes/permissions.js', () => ({
  expirePendingPermissionRequests: expirePendingPermissionRequestsMock,
}));

vi.mock('../routes/questions.js', () => ({
  expirePendingQuestionRequests: expirePendingQuestionRequestsMock,
}));

vi.mock('../routes/stream-runtime.js', () => ({
  resumeAnsweredQuestionRequest: resumeAnsweredQuestionRequestMock,
  resumeApprovedPermissionRequest: resumeApprovedPermissionRequestMock,
}));

import { registerSessionSharedReadRoutes } from '../routes/session-shared-read-routes.js';

describe('session shared read routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqliteAllMock.mockReturnValue([]);
    sqliteGetMock.mockReturnValue(undefined);
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
    listSharedSessionPresenceMock.mockReturnValue([
      {
        viewerUserId: 'viewer-1',
        viewerEmail: 'viewer@openawork.local',
        firstSeenAt: '2026-04-04T04:45:00.000Z',
        lastSeenAt: '2026-04-04T05:30:00.000Z',
        active: true,
      },
    ]);
    touchSharedSessionPresenceMock.mockReturnValue([
      {
        viewerUserId: 'viewer-1',
        viewerEmail: 'viewer@openawork.local',
        firstSeenAt: '2026-04-04T04:45:00.000Z',
        lastSeenAt: '2026-04-04T05:31:00.000Z',
        active: true,
      },
    ]);
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
      presence: [
        {
          viewerEmail: 'viewer@openawork.local',
          active: true,
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

  it('touches shared presence and returns the latest viewer list', async () => {
    const app = Fastify();
    await registerSessionSharedReadRoutes(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/shared-with-me/shared-session-1/presence',
    });

    expect(response.statusCode).toBe(200);
    expect(touchSharedSessionPresenceMock).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      sessionId: 'shared-session-1',
      viewerUserId: 'viewer-1',
      viewerEmail: 'viewer@openawork.local',
    });
    expect(JSON.parse(response.body)).toEqual({
      presence: [
        expect.objectContaining({
          viewerEmail: 'viewer@openawork.local',
          active: true,
        }),
      ],
    });

    await app.close();
  });

  it('returns pending operate interactions only after expiring stale items', async () => {
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
    sqliteAllMock.mockImplementation((query: string) => {
      if (query.includes('FROM permission_requests')) {
        return [
          {
            id: 'perm-1',
            session_id: 'shared-session-1',
            tool_name: 'read_file',
            scope: '/repo/apps/api',
            reason: '需要读取配置',
            risk_level: 'medium',
            preview_action: 'read package.json',
            status: 'pending',
            decision: null,
            request_payload_json: null,
            expires_at: null,
            created_at: '2026-04-04T05:20:00.000Z',
          },
        ];
      }

      if (query.includes('FROM question_requests')) {
        return [
          {
            id: 'question-1',
            session_id: 'shared-session-1',
            user_id: 'owner-1',
            tool_name: 'Question',
            title: '请选择下一步',
            questions_json: JSON.stringify([
              {
                header: '下一步',
                question: '你希望我先处理什么？',
                options: [{ label: '修复', description: '先修问题' }],
              },
            ]),
            answer_json: null,
            request_payload_json: null,
            expires_at: null,
            status: 'pending',
            created_at: '2026-04-04T05:25:00.000Z',
          },
        ];
      }

      return [];
    });

    const app = Fastify();
    await registerSessionSharedReadRoutes(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/sessions/shared-with-me/shared-session-1',
    });

    expect(response.statusCode).toBe(200);
    expect(expirePendingPermissionRequestsMock).toHaveBeenCalledWith({
      nowMs: expect.any(Number),
      sessionId: 'shared-session-1',
    });
    expect(expirePendingQuestionRequestsMock).toHaveBeenCalledWith({
      nowMs: expect.any(Number),
      sessionId: 'shared-session-1',
    });
    expect(JSON.parse(response.body)).toMatchObject({
      share: { permission: 'operate' },
      pendingPermissions: [expect.objectContaining({ requestId: 'perm-1', toolName: 'read_file' })],
      pendingQuestions: [
        expect.objectContaining({ requestId: 'question-1', toolName: 'Question' }),
      ],
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
    expect(
      sqliteRunMock.mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string' &&
          sql.includes('INSERT INTO team_audit_logs') &&
          Array.isArray(params) &&
          params.includes('shared_comment_created') &&
          params.includes('viewer@openawork.local'),
      ),
    ).toBe(true);

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

  it('rejects shared permission replies for non-operate recipients', async () => {
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
      permission: 'comment',
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
      url: '/sessions/shared-with-me/shared-session-1/permissions/reply',
      payload: { requestId: 'perm-1', decision: 'once' },
    });

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it('rejects shared question replies for non-operate recipients', async () => {
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
      permission: 'comment',
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
      url: '/sessions/shared-with-me/shared-session-1/questions/reply',
      payload: { requestId: 'question-1', status: 'dismissed' },
    });

    expect(response.statusCode).toBe(403);

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

  it('allows operate permission recipients to reply pending permission requests', async () => {
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
    sqliteGetMock.mockImplementation((query: string, _params?: unknown[]) => {
      if (query.includes('FROM permission_requests')) {
        return {
          id: 'perm-1',
          session_id: 'shared-session-1',
          tool_name: 'read_file',
          scope: '/repo/apps/api',
          reason: '需要读取配置',
          risk_level: 'medium',
          preview_action: 'read package.json',
          status: 'pending',
          decision: null,
          request_payload_json: JSON.stringify({
            clientRequestId: 'req-1',
            toolCallId: 'tool-1',
            nextRound: 2,
            rawInput: { filePath: '/repo/apps/api/package.json' },
            requestData: { message: '继续', providerId: 'openai', model: 'gpt-4.1' },
          }),
          expires_at: null,
          created_at: '2026-04-04T04:20:00.000Z',
        };
      }
      return undefined;
    });

    const app = Fastify();
    await registerSessionSharedReadRoutes(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/shared-with-me/shared-session-1/permissions/reply',
      payload: { requestId: 'perm-1', decision: 'once' },
    });

    expect(response.statusCode).toBe(200);
    expect(sqliteRunMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE permission_requests'),
      ['approved', 'once', 'perm-1', 'shared-session-1'],
    );
    expect(
      sqliteRunMock.mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string' &&
          sql.includes('INSERT INTO team_audit_logs') &&
          Array.isArray(params) &&
          params.includes('shared_permission_replied') &&
          params.includes('viewer@openawork.local'),
      ),
    ).toBe(true);

    await app.close();
  });

  it('allows operate permission recipients to answer pending shared questions', async () => {
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
    sqliteGetMock.mockImplementation((query: string, _params?: unknown[]) => {
      if (query.includes('FROM question_requests')) {
        return {
          id: 'question-1',
          session_id: 'shared-session-1',
          user_id: 'owner-1',
          tool_name: 'Question',
          title: '请选择下一步',
          questions_json: JSON.stringify([
            {
              header: '下一步',
              question: '你希望我先处理什么？',
              options: [{ label: '修复', description: '先修问题' }],
            },
          ]),
          answer_json: null,
          request_payload_json: JSON.stringify({
            clientRequestId: 'req-2',
            toolCallId: 'tool-2',
            nextRound: 3,
            rawInput: { title: '请选择下一步' },
            requestData: { message: '继续' },
          }),
          expires_at: null,
          status: 'pending',
          created_at: '2026-04-04T04:25:00.000Z',
        };
      }
      return undefined;
    });

    const app = Fastify();
    await registerSessionSharedReadRoutes(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/shared-with-me/shared-session-1/questions/reply',
      payload: { requestId: 'question-1', status: 'answered', answers: [['修复']] },
    });

    expect(response.statusCode).toBe(200);
    expect(sqliteRunMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE question_requests'),
      ['answered', JSON.stringify([['修复']]), 'question-1', 'shared-session-1'],
    );
    expect(
      sqliteRunMock.mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string' &&
          sql.includes('INSERT INTO team_audit_logs') &&
          Array.isArray(params) &&
          params.includes('shared_question_replied') &&
          params.includes('viewer@openawork.local'),
      ),
    ).toBe(true);
    expect(resumeAnsweredQuestionRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'shared-session-1',
        userId: 'owner-1',
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
