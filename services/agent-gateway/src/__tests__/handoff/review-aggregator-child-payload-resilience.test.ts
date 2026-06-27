/**
 * Regression (§0.112, review aggregation per-child payload tolerance):
 * checkAllChildrenCompleted reads a pm2 handoff's dispatchedHandoffIds, loads
 * the child handoff rows, and maps each into a HandoffRecord. The per-child
 * `JSON.parse(payload_json)` was unguarded — one corrupt child payload (crash
 * mid-write, disk error, hand-edited DB) threw the whole children.map(...),
 * and since this runs on every watcher tick via pm2-quality-review-reconciler,
 * that pm2's review could NEVER aggregate (every reconcile re-threw on the same
 * row) even with §0.101's per-candidate tick guard. The parse is now tolerant.
 * We seed one healthy + one corrupt child and assert the call returns both
 * (corrupt payload degraded to null) without throwing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ReviewAggregatorModule from '../../handoff/workflow/review-aggregator.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let reviewAggregator: typeof ReviewAggregatorModule;

const USER_ID = 'u-review-agg';
const FROM_SESSION_ID = 's-review-agg-from';
const PM2_HANDOFF_ID = 'h-pm2-agg';
const GOOD_CHILD_ID = 'h-child-good';
const POISON_CHILD_ID = 'h-child-poison';

function seedUserAndSession(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'review-agg@example.com',
  ]);
  dbModule.sqliteRun(
    "INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json) VALUES (?, ?, 'demo', '{}')",
    [FROM_SESSION_ID, USER_ID],
  );
}

function seedChildHandoff(id: string, state: string, payloadJson: string): void {
  dbModule.sqliteRun(
    `INSERT INTO handoff_records
       (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, payload_json, state)
     VALUES (?, ?, ?, 'pm2', 'executor', NULL, ?, ?)`,
    [id, USER_ID, FROM_SESSION_ID, payloadJson, state],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  reviewAggregator = await import('../../handoff/workflow/review-aggregator.js');
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUserAndSession();
});

describe('checkAllChildrenCompleted per-child payload resilience', () => {
  it('单个子 handoff payload_json 损坏时不抛出，仍返回全部子记录', () => {
    // pm2 handoff whose result_json lists the two child ids.
    dbModule.sqliteRun(
      `INSERT INTO handoff_records
         (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, payload_json, state, result_json)
       VALUES (?, ?, ?, 'pm1', 'pm2', ?, '{}', 'completed', ?)`,
      [
        PM2_HANDOFF_ID,
        USER_ID,
        FROM_SESSION_ID,
        FROM_SESSION_ID,
        JSON.stringify({ dispatchedHandoffIds: [GOOD_CHILD_ID, POISON_CHILD_ID] }),
      ],
    );
    // Healthy child: valid JSON payload. Poison child: invalid JSON.
    seedChildHandoff(GOOD_CHILD_ID, 'completed', JSON.stringify({ goal: 'ok' }));
    seedChildHandoff(POISON_CHILD_ID, 'completed', '{not valid json');

    let result: ReturnType<typeof reviewAggregator.checkAllChildrenCompleted> | undefined;
    // Must not throw despite the poison child's corrupt payload_json.
    expect(() => {
      result = reviewAggregator.checkAllChildrenCompleted(PM2_HANDOFF_ID);
    }).not.toThrow();

    // Both children mapped; all terminal → allDone true.
    expect(result?.allDone).toBe(true);
    expect(result?.children.map((c) => c.id).sort()).toEqual(
      [GOOD_CHILD_ID, POISON_CHILD_ID].sort(),
    );
    // The corrupt payload degraded to null; the healthy one parsed.
    const poison = result?.children.find((c) => c.id === POISON_CHILD_ID);
    const good = result?.children.find((c) => c.id === GOOD_CHILD_ID);
    expect(poison?.payload).toBeNull();
    expect(good?.payload).toEqual({ goal: 'ok' });
  });

  it('大批量 dispatchedHandoffIds 也能完整读取子 handoff', () => {
    const childIds = Array.from({ length: 905 }, (_, index) => `h-child-bulk-${index}`);
    dbModule.sqliteRun(
      `INSERT INTO handoff_records
         (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, payload_json, state, result_json)
       VALUES (?, ?, ?, 'pm1', 'pm2', ?, '{}', 'completed', ?)`,
      [
        PM2_HANDOFF_ID,
        USER_ID,
        FROM_SESSION_ID,
        FROM_SESSION_ID,
        JSON.stringify({ dispatchedHandoffIds: childIds }),
      ],
    );

    for (const childId of childIds) {
      seedChildHandoff(childId, 'completed', JSON.stringify({ goal: childId }));
    }

    const result = reviewAggregator.checkAllChildrenCompleted(PM2_HANDOFF_ID);

    expect(result.allDone).toBe(true);
    expect(result.children).toHaveLength(childIds.length);
    expect(result.children[0]?.id).toBe(childIds[0]);
    expect(result.children.at(-1)?.id).toBe(childIds.at(-1));
  });
});
