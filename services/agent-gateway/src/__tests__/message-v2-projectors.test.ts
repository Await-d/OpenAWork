import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── In-memory db mock ────────────────────────────────────────────────
//
// We only care about which DELETE statements the projectors fire when
// `MessageEvents.Removed` is emitted. The `safeUpsert` helper in the
// projector module reads the sessions row to resolve user_id; the
// remove projector does not, but we still satisfy the interface for
// completeness.
// ──────────────────────────────────────────────────────────────────────

const recordedSql: Array<{ sql: string; params: unknown[] }> = [];

// Tracks event_sequences across emitEvent calls — `allocateNextSeq`
// hits an INSERT … ON CONFLICT … RETURNING seq and expects a row back.
const seqByAggregate = new Map<string, number>();

vi.mock('../db.js', () => ({
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
      // Treat every event id as fresh — we are the only emitter.
      return undefined;
    }
    return undefined;
  },
  sqliteAll: () => [],
  sqliteTransaction: (fn: () => unknown) => fn(),
}));

// Side-effect import registers all projectors against the real
// `sync-event.ts` registry. We then drive the registry via `emitEvent`
// from the same module.
import './../message-v2-projectors.js';
import { MessageEvents, emitEvent } from '../sync-event.js';

describe('message-v2 projectors — Removed', () => {
  beforeEach(() => {
    recordedSql.length = 0;
  });

  it('cascades into both v2 source-of-truth tables and the v1 search mirror', () => {
    emitEvent({
      definition: MessageEvents.Removed,
      aggregateID: 'session-A',
      data: { sessionID: 'session-A', messageID: 'msg-A' },
    });

    const tables = recordedSql
      .filter((row) => row.sql.startsWith('DELETE FROM '))
      .map((row) => {
        const match = row.sql.match(/DELETE FROM (\S+)/);
        return match ? match[1] : 'UNKNOWN';
      });

    // V2 main tables PLUS the legacy mirror + FTS — the regression we
    // are guarding against is the projector forgetting to clean
    // session_messages and session_messages_fts.
    expect(tables).toEqual(['part_v2', 'message_v2', 'session_messages', 'session_messages_fts']);
  });

  it('keys all DELETEs by the messageID payload', () => {
    emitEvent({
      definition: MessageEvents.Removed,
      aggregateID: 'session-B',
      data: { sessionID: 'session-B', messageID: 'msg-B' },
    });

    const deleteRows = recordedSql.filter((row) => row.sql.startsWith('DELETE FROM '));
    for (const row of deleteRows) {
      // session_messages_fts uses message_id; v2 tables use id; either
      // way the first parameter must be the messageID we emitted.
      expect(row.params[0]).toBe('msg-B');
    }
  });
});
