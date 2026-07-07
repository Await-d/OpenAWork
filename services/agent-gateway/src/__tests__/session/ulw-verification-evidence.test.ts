import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as EvidenceModule from '../../session/ulw-verification-evidence.js';
import type * as SessionRunEventsModule from '../../session/session-run-events.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let evidence: typeof EvidenceModule;
let sessionRunEvents: typeof SessionRunEventsModule;

const USER_ID = 'u-ulw-evidence';
const SESSION_ID = 'sess-ulw-evidence';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  evidence = await import('../../session/ulw-verification-evidence.js');
  sessionRunEvents = await import('../../session/session-run-events.js');
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM session_run_events', []);
  dbModule.sqliteRun('DELETE FROM artifact_versions', []);
  dbModule.sqliteRun('DELETE FROM artifacts', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'ULW evidence session', '{}', 'running')`,
    [SESSION_ID, USER_ID],
  );
});

describe('recordUlwVerificationEvidence', () => {
  it('写入验证证据 artifact，并持久化 task_update 与 audit_ref 事件', () => {
    const result = evidence.recordUlwVerificationEvidence({
      note: 'review passed',
      prompt: 'finish the workflow',
      sessionId: SESSION_ID,
      status: 'passed',
      taskId: 'task-ulw',
      taskTitle: 'UltraWork Loop',
      userId: USER_ID,
    });

    const artifact = dbModule.sqliteGet<{ content: string; title: string }>(
      'SELECT title, content FROM artifacts WHERE id = ? AND session_id = ? AND user_id = ?',
      [result.artifactId, SESSION_ID, USER_ID],
    );
    expect(artifact?.title).toBe('ULW verification passed');
    expect(artifact?.content).toContain('review passed');

    const events = sessionRunEvents.listSessionRunEventsByRequest({
      clientRequestId: result.clientRequestId,
      sessionId: SESSION_ID,
    });
    expect(events).toEqual([
      expect.objectContaining({
        status: 'done',
        taskId: 'task-ulw',
        type: 'task_update',
      }),
      expect.objectContaining({
        auditLogId: result.artifactId,
        type: 'audit_ref',
      }),
    ]);
  });

  it('失败验证写入 failed task_update 和失败证据正文', () => {
    const result = evidence.recordUlwVerificationEvidence({
      note: 'missing required smoke evidence',
      prompt: 'finish the workflow',
      sessionId: SESSION_ID,
      status: 'failed',
      taskId: 'task-ulw',
      taskTitle: 'UltraWork Loop',
      userId: USER_ID,
    });

    const artifact = dbModule.sqliteGet<{ content: string; title: string }>(
      'SELECT title, content FROM artifacts WHERE id = ? AND session_id = ? AND user_id = ?',
      [result.artifactId, SESSION_ID, USER_ID],
    );
    expect(artifact?.title).toBe('ULW verification failed');
    expect(artifact?.content).toContain('missing required smoke evidence');

    const events = sessionRunEvents.listSessionRunEventsByRequest({
      clientRequestId: result.clientRequestId,
      sessionId: SESSION_ID,
    });
    expect(events[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        taskId: 'task-ulw',
        type: 'task_update',
      }),
    );
  });
});
