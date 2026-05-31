import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as RuntimeModule from '../../routes/command-loop-runtime.js';
import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { Message } from '@openAwork/shared';

/**
 * Regression (§0.134, loop finalization unhandled rejection / wedged session):
 * scheduleLoopExecution launches runLoopExecution fire-and-forget via
 * `void runLoopExecution(...).finally(...)`. RalphLoopImpl.run swallows its own
 * iteration errors, but runLoopExecution then awaited finalizeLoopExecution —
 * which does filesystem + SQLite writes with NO internal guard. A throw there
 * (e.g. taskManager.loadOrCreate failing) used to (a) reject the fire-and-forget
 * promise → unhandled rejection (project-forbidden) AND (b) abort finalization
 * before the active-loop metadata marker was cleared, leaving the session stuck
 * showing a loop that never finishes.
 *
 * We make taskManager.loadOrCreate throw, then assert: the session's
 * active-loop marker is de-wedged (proving the degraded-cleanup catch ran) and
 * no unhandledRejection escapes.
 */

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let runtime: typeof RuntimeModule;
let workspaceRoot: string;

const USER_ID = 'u-loop-finalize';
const SESSION_ID = 'sess-loop-finalize';
const TASK_ID = 'task-loop-finalize';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  runtime = await import('../../routes/command-loop-runtime.js');
  await dbModule.connectDb();
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'loop-finalize-'));
  dbModule.sqliteRun(
    "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')",
    [USER_ID, `${USER_ID}@example.com`],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'loop session', ?, 'running')`,
    [
      SESSION_ID,
      USER_ID,
      JSON.stringify({ activeLoopKind: 'ralph', activeLoopTaskId: TASK_ID }),
    ],
  );
});

afterEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function readActiveLoopKind(): unknown {
  const row = dbModule.sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [SESSION_ID],
  );
  if (!row) return undefined;
  return (JSON.parse(row.metadata_json) as Record<string, unknown>)['activeLoopKind'];
}

/** taskManager whose loadOrCreate always rejects, forcing finalize to throw. */
function throwingTaskManager(): AgentTaskManagerImpl {
  const stub = {
    loadOrCreate: async () => {
      throw new Error('task graph store offline');
    },
    save: async () => undefined,
    updateTask: () => undefined,
    completeTask: () => undefined,
    failTask: () => undefined,
  };
  return stub as unknown as AgentTaskManagerImpl;
}

async function waitForCleared(timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readActiveLoopKind() === undefined) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('runLoopExecution finalize 失败韧性', () => {
  it('finalize 抛错时不产生未捕获 rejection，并清除 session 的 active-loop 标记', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      // Marker is set before the loop runs.
      expect(readActiveLoopKind()).toBe('ralph');

      runtime.scheduleLoopExecution({
        completionPromise: 'DONE',
        kind: 'ralph',
        maxIterations: 1,
        sessionId: SESSION_ID,
        strategy: 'continue',
        target: 'do the thing',
        taskId: TASK_ID,
        taskTitle: 'Loop task',
        userId: USER_ID,
        workspaceRoot,
        taskManager: throwingTaskManager(),
        summarizeMessages: (_messages: Message[]) => 'summary',
        extractLatestUserGoal: (_messages: Message[]) => 'goal',
        findLatestWorkflowPlan: async () => null,
      });

      await waitForCleared();
      // The degraded-cleanup catch must have de-wedged the session.
      expect(readActiveLoopKind()).toBeUndefined();
      // Give any stray rejection a tick to surface.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
