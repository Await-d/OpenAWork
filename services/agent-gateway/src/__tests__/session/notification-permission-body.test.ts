import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as NotificationStoreModule from '../../session/notification-store.js';
import { createPermissionAskedEvent } from '../../session/session-permission-events.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let notificationStore: typeof NotificationStoreModule;

const USER_ID = 'u-notification-body';
const SESSION_ID = 'sess-notification-body';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  notificationStore = await import('../../session/notification-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM notifications', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'notification-body@example.com',
  ]);
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'notification body session', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('permission notification body', () => {
  it('writes requestId into permission_asked notification body for exact frontend matching', () => {
    notificationStore.buildNotificationFromRunEvent({
      id: 'notif-perm-1',
      sessionId: SESSION_ID,
      userId: USER_ID,
      event: createPermissionAskedEvent({
        requestId: 'perm-123',
        toolName: 'mcp_call',
        scope: 'open_websearch:fetch_web:fp-open_websearch',
        reason: '需要调用 MCP 工具',
        riskLevel: 'high',
        previewAction: '调用 open_websearch/fetch_web {"url":"https://example.com"}',
      }),
    });

    const stored = dbModule.sqliteGet<{ body: string }>(
      'SELECT body FROM notifications WHERE id = ? LIMIT 1',
      ['notif-perm-1'],
    );

    expect(stored?.body).toBe(
      'requestId=perm-123\n需要调用 MCP 工具\n调用 open_websearch/fetch_web {"url":"https://example.com"}\nopen_websearch:fetch_web:fp-open_websearch\nhigh',
    );
  });
});
