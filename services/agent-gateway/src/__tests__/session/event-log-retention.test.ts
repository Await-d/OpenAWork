import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SyncEventModule from '../../session/sync-event.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let syncEvent: typeof SyncEventModule;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  syncEvent = await import('../../session/sync-event.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM event_log', []);
  dbModule.sqliteRun('DELETE FROM event_sequences', []);
});

afterEach(() => {
  syncEvent.__setEventLogRetentionForTesting(null);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function countEventLog(): number {
  return dbModule.sqliteGet<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM event_log', [])?.cnt ?? 0;
}

describe('event_log retention', () => {
  it('超过全局上限时按 rowid 保留最近 N 行、删除更旧行', () => {
    // Cap at 5 rows, prune-check every insert so it triggers deterministically.
    syncEvent.__setEventLogRetentionForTesting(5, 1);

    for (let i = 0; i < 30; i++) {
      syncEvent.emitEvent({
        definition: syncEvent.MessageEvents.Created,
        aggregateID: `agg-${i}`,
        data: { sessionID: `agg-${i}`, info: { id: `msg-${i}` } },
      });
    }

    // Exactly the cap remains, and they are the most-recently-inserted rows.
    expect(countEventLog()).toBe(5);
    const rows = dbModule.sqliteAll<{ aggregate_id: string }>(
      'SELECT aggregate_id FROM event_log ORDER BY rowid ASC',
      [],
    );
    expect(rows.map((r) => r.aggregate_id)).toEqual([
      'agg-25',
      'agg-26',
      'agg-27',
      'agg-28',
      'agg-29',
    ]);
  });

  it('retention=0 关闭裁剪时全部保留', () => {
    syncEvent.__setEventLogRetentionForTesting(0, 1);

    for (let i = 0; i < 12; i++) {
      syncEvent.emitEvent({
        definition: syncEvent.MessageEvents.Created,
        aggregateID: `keep-${i}`,
        data: { sessionID: `keep-${i}`, info: { id: `msg-${i}` } },
      });
    }

    expect(countEventLog()).toBe(12);
  });
});
