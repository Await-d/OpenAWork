/**
 * Durable, user-scoped `permanent` permission grants.
 *
 * Regression guard for: a 「永久允许」 decision must apply to the SAME user's
 * newly created sessions, and must survive deletion of the granting session —
 * previously the grant lived only on a session-owned `permission_requests` row
 * (`ON DELETE CASCADE`) plus a gitignored workspace file that was never written.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as GrantsModule from '../../permission/permission-grants-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let grants: typeof GrantsModule;

const USER_ID = 'u-perm-grants';
const SESSION_ID = 'sess-perm-grants';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  grants = await import('../../permission/permission-grants-store.js');
}, 60000);

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM permission_grants', []);
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'grants session', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('permission grants store', () => {
  it('matches a broad pattern and rejects an unrelated command', () => {
    grants.upsertPermissionGrant({ userId: USER_ID, toolName: 'bash', scope: 'ls *' });

    expect(grants.findMatchingPermissionGrant(USER_ID, 'bash', 'ls /tmp')).not.toBeNull();
    expect(grants.findMatchingPermissionGrant(USER_ID, 'bash', 'git status')).toBeNull();
  });

  it('survives deletion of the granting session', () => {
    grants.upsertPermissionGrant({ userId: USER_ID, toolName: 'bash', scope: 'ls *' });

    dbModule.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);

    expect(grants.findMatchingPermissionGrant(USER_ID, 'bash', 'ls /tmp')).not.toBeNull();
  });

  it('deduplicates repeated grants for the same user/tool/scope', () => {
    grants.upsertPermissionGrant({ userId: USER_ID, toolName: 'bash', scope: 'ls *' });
    grants.upsertPermissionGrant({ userId: USER_ID, toolName: 'bash', scope: 'ls *' });

    expect(grants.listPermissionGrantsForTool(USER_ID, 'bash')).toHaveLength(1);
  });

  it('backfills legacy permanent rows using always_json patterns', () => {
    dbModule.sqliteRun(
      `INSERT INTO permission_requests
         (id, session_id, tool_name, scope, reason, risk_level, status, decision, always_json)
       VALUES ('req-backfill', ?, 'bash', 'git status', 'r', 'medium', 'approved', 'permanent', '["git *"]')`,
      [SESSION_ID],
    );
    dbModule.setAppMetaValue('permission_grants_backfill_v1', '0');

    dbModule.migratePermanentPermissionGrants();

    expect(grants.findMatchingPermissionGrant(USER_ID, 'bash', 'git status')).not.toBeNull();
    expect(grants.findMatchingPermissionGrant(USER_ID, 'bash', 'ls /tmp')).toBeNull();
  });

  it('backfill falls back to the original scope when always_json is empty', () => {
    dbModule.sqliteRun(
      `INSERT INTO permission_requests
         (id, session_id, tool_name, scope, reason, risk_level, status, decision, always_json)
       VALUES ('req-backfill-2', ?, 'bash', 'echo hello', 'r', 'medium', 'approved', 'permanent', '[]')`,
      [SESSION_ID],
    );
    dbModule.setAppMetaValue('permission_grants_backfill_v1', '0');

    dbModule.migratePermanentPermissionGrants();

    expect(grants.findMatchingPermissionGrant(USER_ID, 'bash', 'echo hello')).not.toBeNull();
    expect(grants.findMatchingPermissionGrant(USER_ID, 'bash', 'wget http://x')).toBeNull();
  });

  it('reconcile deletes grants not present in the submitted allow rules', () => {
    grants.upsertPermissionGrant({ userId: USER_ID, toolName: 'bash', scope: 'ls *' });
    grants.upsertPermissionGrant({ userId: USER_ID, toolName: 'edit', scope: '*' });

    grants.reconcilePermissionGrants(USER_ID, [
      { permission: 'bash', pattern: 'ls *', action: 'allow' },
    ]);

    const remaining = grants.listPermissionGrantsForUser(USER_ID);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.scope).toBe('ls *');
  });

  it('reconcile with empty rules clears all grants', () => {
    grants.upsertPermissionGrant({ userId: USER_ID, toolName: 'bash', scope: 'ls *' });

    grants.reconcilePermissionGrants(USER_ID, []);

    expect(grants.listPermissionGrantsForUser(USER_ID)).toHaveLength(0);
  });
});
