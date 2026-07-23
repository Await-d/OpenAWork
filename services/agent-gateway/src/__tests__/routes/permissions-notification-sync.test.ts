import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as PermissionsRoutesModule from '../../routes/permissions.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
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
process.env['JWT_SECRET'] = 'permissions-notification-sync-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let permissionsRoutes: typeof PermissionsRoutesModule.permissionsRoutes;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;

const SESSION_ID = 'sess-permission-notification-sync';
const USER_ID = 'u-permission-notification-sync';

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
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'permissions-sync@example.com' })}`;
}

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'permissions-sync@example.com',
  ]);
}

function seedSession(): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'permission sync session', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
}

function seedPendingPermissionRequest(requestId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO permission_requests
      (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status)
     VALUES (?, ?, 'bash', 'git status -sb', 'inspect workspace', 'medium', '执行命令: git status -sb', '{}', NULL, '["git status *","git *"]', 'pending')`,
    [requestId, SESSION_ID],
  );
}

function seedPermissionNotification(notificationId: string, requestId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO notifications (id, user_id, session_id, event_type, title, body, status, created_at)
     VALUES (?, ?, ?, 'permission_asked', '等待权限 · bash', ?, 'unread', datetime('now'))`,
    [
      notificationId,
      USER_ID,
      SESSION_ID,
      `requestId=${requestId}\n需要执行工作区命令\n执行命令: git status -sb\ngit status -sb\nmedium`,
    ],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  permissionsRoutes = (await import('../../routes/permissions.js')).permissionsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM notifications', []);
  dbModule.sqliteRun('DELETE FROM permission_decision_logs', []);
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  seedSession();
  mocks.persistWorkspacePermanentPermission.mockReset();
  mocks.publishSessionRunEvent.mockReset();
  mocks.resumeApprovedPermissionRequest.mockReset();
  mocks.resumeApprovedPermissionRequest.mockResolvedValue(undefined);
  mocks.resumeRejectedPermissionRequest.mockReset();
  mocks.resumeRejectedPermissionRequest.mockResolvedValue(undefined);
  mocks.setPersistedSessionStateStatus.mockReset();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('permissions reply notification sync', () => {
  it('普通审批成功后会把对应 permission_asked 通知标记为已读', async () => {
    seedPendingPermissionRequest('perm-1');
    seedPermissionNotification('notif-perm-1', 'perm-1');

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
          decision: 'session',
        },
      });

      expect(response.statusCode).toBe(200);

      const notification = dbModule.sqliteGet<{ status: string }>(
        'SELECT status FROM notifications WHERE id = ? LIMIT 1',
        ['notif-perm-1'],
      );
      expect(notification?.status).toBe('read');
    } finally {
      await app.close();
    }
  });

  it('重复提交已处理权限时返回 409，并把对应通知标记为已读', async () => {
    seedPendingPermissionRequest('perm-already');
    seedPermissionNotification('notif-perm-already', 'perm-already');
    dbModule.sqliteRun(
      `UPDATE permission_requests SET status = 'approved', decision = 'session' WHERE id = ?`,
      ['perm-already'],
    );

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
          requestId: 'perm-already',
          decision: 'session',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: '权限请求已处理，无法重复提交。' });

      const notification = dbModule.sqliteGet<{ status: string }>(
        'SELECT status FROM notifications WHERE id = ? LIMIT 1',
        ['notif-perm-already'],
      );
      expect(notification?.status).toBe('read');
    } finally {
      await app.close();
    }
  });

  it('拒绝触发级联时，会把主请求和级联请求的通知一起标记为已读', async () => {
    seedPendingPermissionRequest('perm-primary');
    seedPendingPermissionRequest('perm-secondary');
    seedPermissionNotification('notif-perm-primary', 'perm-primary');
    seedPermissionNotification('notif-perm-secondary', 'perm-secondary');

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
        },
      });

      expect(response.statusCode).toBe(200);

      const rows = dbModule.sqliteAll<{ id: string; status: string }>(
        'SELECT id, status FROM notifications WHERE session_id = ? ORDER BY id ASC',
        [SESSION_ID],
      );
      expect(rows).toEqual([
        { id: 'notif-perm-primary', status: 'read' },
        { id: 'notif-perm-secondary', status: 'read' },
      ]);
    } finally {
      await app.close();
    }
  });
});
