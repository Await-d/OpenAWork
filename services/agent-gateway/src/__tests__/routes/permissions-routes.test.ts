import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as PermissionsRoutesModule from '../../routes/permissions.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamResumeContextModule from '../../team/team-resume-context.js';
import type * as WorkspaceSafetyModule from '../../workspace/workspace-safety.js';

const mocks = vi.hoisted(() => ({
  persistWorkspacePermanentPermission: vi.fn(),
  publishSessionRunEvent: vi.fn(),
  resumeApprovedPermissionRequest: vi.fn(),
  resumeRejectedPermissionRequest: vi.fn(),
  setPersistedSessionStateStatus: vi.fn(),
}));

vi.mock('../../workspace/workspace-safety.js', async () => {
  const actual = await vi.importActual<typeof WorkspaceSafetyModule>(
    '../../workspace/workspace-safety.js',
  );
  return {
    ...actual,
    persistWorkspacePermanentPermission: mocks.persistWorkspacePermanentPermission,
  };
});

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: mocks.publishSessionRunEvent,
}));

vi.mock('../../routes/stream-runtime.js', () => ({
  resumeApprovedPermissionRequest: mocks.resumeApprovedPermissionRequest,
  resumeRejectedPermissionRequest: mocks.resumeRejectedPermissionRequest,
}));

vi.mock('../../routes/stream.js', () => ({
  setPersistedSessionStateStatus: mocks.setPersistedSessionStateStatus,
  streamRequestSchema: {
    parse: (value: unknown) => value,
  },
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'permissions-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let permissionsRoutes: typeof PermissionsRoutesModule.permissionsRoutes;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamResumeContext: typeof TeamResumeContextModule;

const SESSION_ID = 'sess-permissions-routes';
const USER_ID = 'u-permissions-routes';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(permissionsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'permissions@example.com' })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(sessionId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'permission session', '{}', 'idle')`,
    [sessionId, USER_ID],
  );
}

function seedPendingPermissionRequest(
  requestId: string,
  requestPayload?: Record<string, unknown>,
): void {
  dbModule.sqliteRun(
    `INSERT INTO permission_requests
      (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status)
     VALUES (?, ?, 'bash', 'ls -la', 'inspect workspace', 'medium', 'ls -la', ?, NULL, '["ls *"]', 'pending')`,
    [requestId, SESSION_ID, JSON.stringify(requestPayload ?? {})],
  );
}

function buildPermissionResumePayload(clientRequestId: string): Record<string, unknown> {
  return {
    clientRequestId,
    nextRound: 1,
    rawInput: { command: 'ls -la' },
    requestData: {
      clientRequestId,
      message: '恢复团队会话',
    },
    toolCallId: 'tool-call-1',
  };
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  permissionsRoutes = (await import('../../routes/permissions.js')).permissionsRoutes;
  teamResumeContext = await import('../../team/team-resume-context.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM permission_decision_logs', []);
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedSession(SESSION_ID);
  mocks.persistWorkspacePermanentPermission.mockReset();
  mocks.publishSessionRunEvent.mockReset();
  mocks.resumeApprovedPermissionRequest.mockReset();
  mocks.resumeApprovedPermissionRequest.mockResolvedValue(undefined);
  mocks.resumeRejectedPermissionRequest.mockReset();
  mocks.resumeRejectedPermissionRequest.mockResolvedValue(undefined);
  mocks.setPersistedSessionStateStatus.mockReset();
  delete process.env['OPENAWORK_CONTINUE_ON_DENY'];
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('permissions routes error contracts', () => {
  it('POST /sessions/:sessionId/permissions/reply 在永久权限写入失败时返回中文 500', async () => {
    seedPendingPermissionRequest('perm-1');
    mocks.persistWorkspacePermanentPermission.mockImplementation(() => {
      throw new Error('disk full');
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${SESSION_ID}/permissions/reply`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          requestId: 'perm-1',
          decision: 'permanent',
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        name: 'InternalError',
        data: {
          message: '保存永久权限规则失败。',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('continue-on-deny 级联拒绝同 clientRequestId 的 pending 权限时保留内部恢复登记', async () => {
    process.env['OPENAWORK_CONTINUE_ON_DENY'] = 'true';
    const clientRequestId = teamResumeContext.buildTeamResumeClientRequestId(SESSION_ID);
    const resumePayload = buildPermissionResumePayload(clientRequestId);
    seedPendingPermissionRequest('perm-primary', resumePayload);
    seedPendingPermissionRequest('perm-secondary', resumePayload);
    teamResumeContext.rememberInternalTeamResumeRequest({
      clientRequestId,
      rootSessionId: SESSION_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${SESSION_ID}/permissions/reply`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          requestId: 'perm-primary',
          decision: 'reject',
          feedback: '请换一种方式',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(
        teamResumeContext.getInternalTeamResumeRootSessionId({
          clientRequestId,
          sessionId: SESSION_ID,
          userId: USER_ID,
        }),
      ).toBe(SESSION_ID);
      expect(mocks.resumeRejectedPermissionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          feedback: '请换一种方式',
          sessionId: SESSION_ID,
          userId: USER_ID,
          payload: expect.objectContaining({
            clientRequestId,
            toolCallId: 'tool-call-1',
            toolName: 'bash',
          }),
        }),
      );
      expect(mocks.setPersistedSessionStateStatus).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        status: 'running',
        userId: USER_ID,
      });
    } finally {
      teamResumeContext.clearInternalTeamResumeRequest(clientRequestId);
      delete process.env['OPENAWORK_CONTINUE_ON_DENY'];
      await app.close();
    }
  });
});
