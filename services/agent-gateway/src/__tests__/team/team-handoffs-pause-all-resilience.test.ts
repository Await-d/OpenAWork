/**
 * Regression (§0.110, per-handoff control-signal fan-out isolation):
 * POST /team/sessions/:id/pause-all (and resume-all) first commits the tree
 * pause atomically via pauseTeamRuntimeTree, then loops over every paused
 * handoff to fan out control signals + scheduler events. Before the fix that
 * loop had no per-handoff guard, so one handoff's getHandoff throwing aborted
 * the loop AND skipped the aggregate `scheduler.all-paused` event + audit log +
 * HTTP reply — 500-ing a pause that had ALREADY taken effect and leaving the UI
 * without the terminal notification. The loop now isolates per handoff.
 *
 * We partial-mock the handoff store so one paused handoff's getHandoff throws,
 * then assert pause-all still returns 200 and still emits the aggregate event.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamHandoffsModule from '../../routes/team-handoffs.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as TeamEventsBusModule from '../../handoff/bus/team-events-bus.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

// Handoff IDs whose getHandoff should throw. Populated per test after the
// records are created (their ids aren't known until then).
const poisonHandoffIds = new Set<string>();

vi.mock('../../handoff/store/handoff-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof HandoffStoreModule>();
  return {
    ...actual,
    getHandoff: (input: { userId: string; handoffId: string }) => {
      if (poisonHandoffIds.has(input.handoffId)) {
        throw new Error('simulated getHandoff failure');
      }
      return actual.getHandoff(input);
    },
  };
});

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamHandoffsRoutes: typeof TeamHandoffsModule.teamHandoffsRoutes;
let store: typeof HandoffStoreModule;
let teamEventsBus: typeof TeamEventsBusModule;

const USER_ID = 'u-pauseall-rt';
const FROM_SESSION_ID = 's-pauseall-from';
const PM1_SESSION_ID = 's-pauseall-pm1';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamHandoffsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` })}`;
}

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function seedSession(
  sessionId: string,
  input?: { roleLayer?: string | null; teamParentSessionId?: string | null },
): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer, team_parent_session_id)
     VALUES (?, ?, 'demo', '{}', ?, ?)`,
    [sessionId, USER_ID, input?.roleLayer ?? null, input?.teamParentSessionId ?? null],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  const auth = await import('../../infra/auth.js');
  authPlugin = auth.default;
  const requestWorkflow = await import('../../runtime/request-workflow.js');
  requestWorkflowPlugin = requestWorkflow.default;
  const team = await import('../../routes/team-handoffs.js');
  teamHandoffsRoutes = team.teamHandoffsRoutes;
  store = await import('../../handoff/store/handoff-store.js');
  teamEventsBus = await import('../../handoff/bus/team-events-bus.js');
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  poisonHandoffIds.clear();
  teamEventsBus.__clearTeamEventsBusForTesting();
  dbModule.sqliteRun('DELETE FROM team_audit_logs', []);
  dbModule.sqliteRun('DELETE FROM session_inbound_messages', []);
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  seedSession(FROM_SESSION_ID, { roleLayer: 'reception' });
  seedSession(PM1_SESSION_ID, { roleLayer: 'pm1', teamParentSessionId: FROM_SESSION_ID });
});

describe('POST /team/sessions/:id/pause-all per-handoff resilience', () => {
  it('单个 handoff 的 getHandoff 抛错时仍返回 200 并发出汇总 all-paused 事件', async () => {
    const app = await buildApp();
    const events: TeamEventsBusModule.TeamEventEnvelope[] = [];
    const unsubscribe = teamEventsBus.subscribeToTeamEvents((event) => events.push(event));
    try {
      // Running reception→pm1 handoff (bound to the pm1 child session).
      const running = store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
      });
      store.claimHandoff({ handoffId: running.id, claimToken: 'tok-pauseall' });
      store.startHandoff({
        handoffId: running.id,
        claimToken: 'tok-pauseall',
        toSessionId: PM1_SESSION_ID,
      });

      // Pending pm1→pm2 handoff under the same tree.
      const pending = store.createHandoff({
        userId: USER_ID,
        fromSessionId: PM1_SESSION_ID,
        fromRoleLayer: 'pm1',
        toRoleLayer: 'pm2',
      });

      // Poison the pending handoff so its getHandoff throws mid-loop.
      poisonHandoffIds.add(pending.id);

      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${FROM_SESSION_ID}/pause-all`,
        headers: { authorization: bearer(app) },
        payload: { reason: 'network-degraded' },
      });

      // Before the fix the throwing getHandoff aborted the handler → 500.
      expect(res.statusCode).toBe(200);

      // The aggregate all-paused event still fired despite the poison handoff.
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'scheduler.all-paused', userId: USER_ID }),
      );

      // The healthy (running) handoff still received its pause_signal inbound.
      const inbound = dbModule.sqliteGet<{ message_type: string }>(
        `SELECT message_type FROM session_inbound_messages WHERE to_session_id = ? ORDER BY created_at DESC LIMIT 1`,
        [PM1_SESSION_ID],
      );
      expect(inbound?.message_type).toBe('pause_signal');

      // The tree pause itself committed (handoffs flagged paused).
      const pausedCount = dbModule.sqliteGet<{ n: number }>(
        `SELECT COUNT(*) AS n FROM handoff_records WHERE paused = 1`,
        [],
      );
      expect(pausedCount?.n).toBeGreaterThanOrEqual(2);
    } finally {
      unsubscribe();
      await app.close();
    }
  });
});
