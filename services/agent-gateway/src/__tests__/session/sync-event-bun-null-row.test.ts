import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression: bun:sqlite's `Statement.get(...)` returns `null` (not
// `undefined`) when no row matches. Pre-fix, `isEventProcessed` used
// `row !== undefined` and treated `null` as "already processed", which
// caused the desktop sidecar's emitEvent to early-return on every call —
// projectors never wrote message_v2/part_v2 and event_log stayed empty.
// This test pins the behaviour by simulating bun:sqlite via a mock that
// returns `null` for missed lookups; if the regression returns, emitEvent
// will skip the INSERT INTO event_log SQL and the assertion below fails.

const recordedSql: Array<{ sql: string; params: unknown[] }> = [];
const seqByAggregate = new Map<string, number>();

vi.mock('../../infra/db.js', () => ({
  sqliteRun: (sql: string, params: unknown[]) => {
    recordedSql.push({ sql, params });
  },
  sqliteGet: (sql: string, params: unknown[]) => {
    if (sql.includes('INSERT INTO event_sequences')) {
      const aggregateId = params[0] as string;
      const next = (seqByAggregate.get(aggregateId) ?? 0) + 1;
      seqByAggregate.set(aggregateId, next);
      return { seq: next };
    }
    if (sql.includes('SELECT id FROM event_log')) {
      // Simulate bun:sqlite: missing row returns `null`, not `undefined`.
      return null as unknown as undefined;
    }
    return undefined;
  },
  sqliteAll: () => [],
  sqliteTransaction: (fn: () => unknown) => fn(),
}));

import { MessageEvents, emitEvent } from '../../session/sync-event.js';

describe('emitEvent — bun:sqlite null-row compatibility', () => {
  beforeEach(() => {
    recordedSql.length = 0;
  });

  it('still persists event_log when sqliteGet returns null for a missed lookup', () => {
    emitEvent({
      definition: MessageEvents.Created,
      aggregateID: 'session-X',
      data: { sessionID: 'session-X', info: { id: 'msg-X' } },
    });

    const eventLogInserts = recordedSql.filter((row) => row.sql.includes('INSERT INTO event_log'));
    expect(eventLogInserts).toHaveLength(1);
    // sanity: aggregate id is forwarded
    expect(eventLogInserts[0]?.params[1]).toBe('session-X');
  });
});
