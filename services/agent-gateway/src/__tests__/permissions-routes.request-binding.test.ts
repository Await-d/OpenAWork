import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteGetMock: vi.fn(),
  sqliteAllMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  publishSessionRunEventMock: vi.fn(),
  resumeApprovedPermissionRequestMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  requireAuth: (_request: unknown, _reply: unknown, done: () => void) => done(),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  WORKSPACE_ACCESS_RESTRICTED: false,
  sqliteGet: mocks.sqliteGetMock,
  sqliteAll: mocks.sqliteAllMock,
  sqliteRun: mocks.sqliteRunMock,
}));

vi.mock('../session-run-events.js', () => ({
  publishSessionRunEvent: mocks.publishSessionRunEventMock,
}));

vi.mock('../routes/stream-runtime.js', () => ({
  resumeApprovedPermissionRequest: mocks.resumeApprovedPermissionRequestMock,
}));

describe('permissions request binding', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteRunMock.mockReset();
    mocks.publishSessionRunEventMock.mockReset();
    mocks.resumeApprovedPermissionRequestMock.mockReset();
    mocks.resumeApprovedPermissionRequestMock.mockResolvedValue(undefined);
    mocks.sqliteGetMock.mockReturnValue({ id: 'session-a', user_id: 'user-a' });

    const { permissionsRoutes } = await import('../routes/permissions.js');
    const requestWorkflowPlugin = (await import('../request-workflow.js')).default;
    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request: FastifyRequest) => {
      (request as typeof request & { user: { sub: string } }).user = { sub: 'user-a' };
    });
    await app.register(requestWorkflowPlugin);
    await app.register(permissionsRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it('stores and publishes a request-scoped clientRequestId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-a/permissions/requests',
      payload: {
        toolName: 'bash',
        scope: '/repo',
        reason: 'need shell',
        riskLevel: 'high',
        clientRequestId: 'req-1',
      },
    });

    expect(response.statusCode).toBe(201);
    const insertParams = mocks.sqliteRunMock.mock.calls[0]?.[1] as unknown[];
    expect(JSON.parse(String(insertParams?.[7]))).toEqual({ clientRequestId: 'req-1' });
    expect(mocks.publishSessionRunEventMock).toHaveBeenCalledWith(
      'session-a',
      expect.objectContaining({ type: 'permission_asked' }),
      { clientRequestId: 'req-1' },
    );
  });

  it('preserves agentId when resuming an approved permission request', async () => {
    mocks.sqliteGetMock
      .mockReturnValueOnce({ id: 'session-a', user_id: 'user-a' })
      .mockReturnValueOnce({
        id: 'permission-1',
        session_id: 'session-a',
        tool_name: 'bash',
        scope: '/repo',
        reason: 'need shell',
        risk_level: 'high',
        preview_action: null,
        status: 'pending',
        decision: null,
        request_payload_json: JSON.stringify({
          clientRequestId: 'req-2',
          nextRound: 2,
          rawInput: { command: 'pwd' },
          requestData: {
            agentId: 'hephaestus',
            clientRequestId: 'req-2',
            message: '请继续实现',
          },
          toolCallId: 'tool-1',
        }),
        created_at: '2026-04-02T00:00:00.000Z',
      });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-a/permissions/reply',
      payload: {
        requestId: 'permission-1',
        decision: 'once',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.resumeApprovedPermissionRequestMock).toHaveBeenCalledWith({
      payload: expect.objectContaining({
        clientRequestId: 'req-2',
        requestData: expect.objectContaining({
          agentId: 'hephaestus',
          clientRequestId: 'req-2',
          message: '请继续实现',
        }),
        toolCallId: 'tool-1',
        toolName: 'bash',
      }),
      sessionId: 'session-a',
      userId: 'user-a',
    });
  });
});
