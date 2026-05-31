import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuditLogModule from '../../infra/audit-log.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let auditLog: typeof AuditLogModule;

const SESSION_ID = 'sess-audit';
const USER_ID = 'u-audit';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  auditLog = await import('../../infra/audit-log.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM audit_logs', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'audit session', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterEach(() => {
  auditLog.__setAuditLogRetentionForTesting(null);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function countAuditLogs(): number {
  return (
    dbModule.sqliteGet<{ c: number }>('SELECT COUNT(*) AS c FROM audit_logs', [])?.c ?? 0
  );
}

describe('audit_logs retention', () => {
  it('超过全局行上限时保留最近 N 行、删最旧', () => {
    // Cap at 5 rows, prune-check every insert for determinism.
    auditLog.__setAuditLogRetentionForTesting(5, 1);

    for (let i = 0; i < 20; i++) {
      auditLog.writeAuditLog({
        sessionId: SESSION_ID,
        category: 'tool',
        sourceName: `tool-${i}`,
        requestId: `req-${i}`,
        output: { message: `run ${i}` },
        isError: false,
      });
    }

    expect(countAuditLogs()).toBe(5);

    // The 5 surviving rows must be the most recent (tool-15..tool-19).
    const rows = dbModule.sqliteAll<{ tool_name: string }>(
      'SELECT tool_name FROM audit_logs ORDER BY id ASC',
      [],
    );
    expect(rows.map((r) => r.tool_name)).toEqual([
      'tool-15',
      'tool-16',
      'tool-17',
      'tool-18',
      'tool-19',
    ]);
  });

  it('retention=0 关闭裁剪时所有行保留', () => {
    auditLog.__setAuditLogRetentionForTesting(0, 1);

    for (let i = 0; i < 12; i++) {
      auditLog.writeAuditLog({
        sessionId: SESSION_ID,
        category: 'tool',
        sourceName: `tool-${i}`,
        requestId: `req-${i}`,
        isError: false,
      });
    }

    expect(countAuditLogs()).toBe(12);
  });
});
