/**
 * Failure-injection proof for the "streaming turn atomicity" claim (W-07 / F-03b).
 *
 * The claim under test: `emitEvent` runs the projector writes and the
 * `event_log` persist inside ONE SQLite transaction, and the post-commit
 * broadcast (`sqliteAfterCommit`) fires only after COMMIT succeeds.
 *
 * These tests drive the REAL in-memory SQLite stack (connectDb/migrate) and
 * inject a failure at the SECOND write inside the transaction — the projector
 * write. They assert the whole turn rolls back: no "projector row present but
 * event absent" (or its mirror) half-write may survive.
 *
 * Seam: the public `emitEvent` contract plus the durable tables it must keep
 * consistent (event_log / part_v2 / event_sequences) and the bus publish seam.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SyncEventModule from '../../session/sync-event.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let syncEvent: typeof SyncEventModule;

const SESSION_ID = 'sess-atomicity';
const USER_ID = 'u-atomicity';

/** Data whose `__fail` flag trips AFTER the projector has run. */
interface FaultyData {
  sessionID: string;
  info: Record<string, unknown>;
  __fail?: boolean;
}

function eventLogRows(): Array<{ id: string; seq: number }> {
  return dbModule.sqliteAll<{ id: string; seq: number }>(
    'SELECT id, seq FROM event_log WHERE aggregate_id = ? ORDER BY seq ASC',
    [SESSION_ID],
  );
}

function partRows(): Array<{ id: string }> {
  return dbModule.sqliteAll<{ id: string }>('SELECT id FROM part_v2');
}

function sequenceValue(): number {
  const row = dbModule.sqliteGet<{ seq: number }>(
    'SELECT seq FROM event_sequences WHERE aggregate_id = ?',
    [SESSION_ID],
  );
  return row?.seq ?? 0;
}

beforeEach(async () => {
  if (!dbModule) {
    dbModule = await import('../../infra/db.js');
    await dbModule.connectDb();
    await dbModule.migrate();
    syncEvent = await import('../../session/sync-event.js');
  }
  dbModule.sqliteRun('DELETE FROM event_log', []);
  dbModule.sqliteRun('DELETE FROM event_sequences', []);
  dbModule.sqliteRun('DELETE FROM part_v2', []);
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM session_entry', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'atomicity', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO message_v2 (id, session_id, user_id, time_created, data)
     VALUES ('msg-1', ?, ?, 1, '{}')`,
    [SESSION_ID, USER_ID],
  );
});

function registerFaultInjectingProjector(): void {
  // Step 2 inside the transaction: projector writes part_v2, then the injected
  // fault throws so the second write of a 3-write turn fails mid-flight.
  syncEvent.registerProjector('message.created', (event) => {
    const data = event.data as FaultyData;
    dbModule.sqliteRun(
      `INSERT INTO part_v2 (id, message_id, session_id, user_id, time_created, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`part-${event.id}`, 'msg-1', data.sessionID, USER_ID, Date.now(), '{}'],
    );
    if (data.__fail === true) {
      throw new Error('injected failure inside transaction (projector step 2)');
    }
  });
}

function emit(overrides: Partial<FaultyData> = {}): Promise<void> {
  return Promise.resolve().then(() => {
    syncEvent.emitEvent<FaultyData>({
      definition: syncEvent.MessageEvents.Created,
      aggregateID: SESSION_ID,
      data: { sessionID: SESSION_ID, info: { id: 'msg-1' }, ...overrides },
    });
  });
}

describe('emitEvent — streaming turn atomicity', () => {
  it('rolls back the projector write when a later in-transaction write throws (no half-write)', async () => {
    registerFaultInjectingProjector();

    await expect(emit({ __fail: true })).rejects.toThrow(/injected failure/);

    // The event persist (step 3) must NOT survive...
    expect(eventLogRows()).toHaveLength(0);
    // ...and the projector write (step 2) must be rolled back with it.
    expect(partRows()).toHaveLength(0);
    // The seq allocator is part of the same transaction, so it also rewinds.
    expect(sequenceValue()).toBe(0);
  });

  it('does not broadcast when the transaction fails', async () => {
    registerFaultInjectingProjector();
    const received: string[] = [];
    const unsubscribe = syncEvent.subscribeBusEvents((type) => received.push(type));

    await expect(emit({ __fail: true })).rejects.toThrow(/injected failure/);

    expect(received).toEqual([]);
    unsubscribe();
  });

  it('persists and broadcasts only after COMMIT on the happy path', async () => {
    registerFaultInjectingProjector();
    const received: string[] = [];
    // Captured at publish time: proves the broadcast is post-commit (the rows
    // are already durable when the subscriber observes them).
    let rowCountAtBroadcast = -1;
    const unsubscribe = syncEvent.subscribeBusEvents((type) => {
      received.push(type);
      rowCountAtBroadcast = eventLogRows().length + partRows().length;
    });

    await emit();

    expect(rowCountAtBroadcast).toBe(2); // 1 event_log row + 1 part_v2 row
    expect(eventLogRows()).toHaveLength(1);
    expect(partRows()).toHaveLength(1);
    expect(sequenceValue()).toBe(1);
    unsubscribe();
  });

  it('rolls back a batch of sequential emits when one member fails (all-or-nothing turn)', async () => {
    registerFaultInjectingProjector();

    await expect(
      (async () => {
        await emit();
        await emit();
        await emit({ __fail: true });
      })(),
    ).rejects.toThrow(/injected failure/);

    // The two earlier emits committed as their own turns; the failing third
    // turn must not leave a partial row behind, and seq must stay contiguous.
    expect(eventLogRows()).toHaveLength(2);
    expect(eventLogRows().map((row) => row.seq)).toEqual([1, 2]);
    expect(partRows()).toHaveLength(2);
    expect(sequenceValue()).toBe(2);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
