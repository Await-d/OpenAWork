/**
 * Regression (§0.101, team dispatch loop): the watcher's
 * reconcilePendingPm2QualityReviews runs at the tail of tickOnce and awaits
 * reconcilePm2QualityReview per running pm2 handoff. That function's own catch
 * handler does SQLite + audit work that can itself throw, so the call can
 * reject. Without per-candidate isolation one poison pm2 review aborted the
 * whole sweep — starving every other pending review AND rejecting the entire
 * tick. We mock the reconciler to throw for one of two seeded pm2 handoffs and
 * assert tickOnce still resolves and the healthy review is still attempted.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as WatcherModule from '../../handoff/runner/watcher.js';
import type * as TeamEventsBusModule from '../../handoff/bus/team-events-bus.js';
import type * as Pm2ReconcilerModule from '../../handoff/runner/pm2-quality-review-reconciler.js';
import {
  InProcessScheduler,
  __resetBackgroundTaskSchedulerForTesting,
} from '../../handoff/runner/scheduler.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
}));

// Make reconcilePm2QualityReview throw for one poison handoff, resolve for the
// rest, so we can prove the per-candidate guard isolates the failure.
const POISON_PM2_HANDOFF_ID = 'h-pm2-poison';
const reconcileMock = vi.fn(async (input: { pm2HandoffId: string }) => {
  if (input.pm2HandoffId === POISON_PM2_HANDOFF_ID) {
    throw new Error('simulated quality-review reconcile failure');
  }
  return { status: 'noop' as const };
});
vi.mock('../../handoff/runner/pm2-quality-review-reconciler.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Pm2ReconcilerModule>();
  return {
    ...actual,
    reconcilePm2QualityReview: (input: Parameters<typeof actual.reconcilePm2QualityReview>[0]) =>
      reconcileMock(input),
  };
});

let dbModule: typeof DbModule;
let watcherModule: typeof WatcherModule;
let teamEventsBus: typeof TeamEventsBusModule;

const USER_ID = 'u-watcher-pm2';
const FROM_SESSION_ID = 's-watcher-pm2-from';
const HEALTHY_PM2_HANDOFF_ID = 'h-pm2-healthy';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json)
     VALUES (?, ?, 'demo', '{}')`,
    [sessionId, USER_ID],
  );
}

function seedRunningPm2Handoff(handoffId: string, toSessionId: string): void {
  seedSession(toSessionId);
  dbModule.sqliteRun(
    `INSERT INTO handoff_records
       (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, state)
     VALUES (?, ?, ?, 'pm1', 'pm2', ?, 'running')`,
    [handoffId, USER_ID, FROM_SESSION_ID, toSessionId],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  watcherModule = await import('../../handoff/runner/watcher.js');
  teamEventsBus = await import('../../handoff/bus/team-events-bus.js');
});

beforeEach(() => {
  teamEventsBus.__clearTeamEventsBusForTesting();
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'watcher-pm2@example.com');
  seedSession(FROM_SESSION_ID);
  __resetBackgroundTaskSchedulerForTesting();
  reconcileMock.mockClear();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('HandoffWatcher pm2 quality-review reconcile resilience', () => {
  it('单个 pm2 评审协调抛错时不中断整轮，其余 pm2 仍被协调', async () => {
    seedRunningPm2Handoff(POISON_PM2_HANDOFF_ID, 's-watcher-pm2-poison-to');
    seedRunningPm2Handoff(HEALTHY_PM2_HANDOFF_ID, 's-watcher-pm2-healthy-to');

    const watcher = new watcherModule.HandoffWatcher({
      taskRunner: async () => {},
      scheduler: new InProcessScheduler(),
    });

    // Must resolve (not reject) despite the poison reconcile throwing.
    await expect(watcher.tickOnce()).resolves.toBeTruthy();

    // Both pm2 handoffs were visited — the poison one threw but did not stop
    // the healthy one from being reconciled in the same tick.
    const reconciledIds = reconcileMock.mock.calls.map((call) => call[0].pm2HandoffId);
    expect(reconciledIds).toContain(POISON_PM2_HANDOFF_ID);
    expect(reconciledIds).toContain(HEALTHY_PM2_HANDOFF_ID);
  });
});
