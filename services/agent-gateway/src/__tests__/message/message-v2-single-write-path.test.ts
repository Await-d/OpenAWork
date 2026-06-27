import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MessageID,
  MessageInfo,
  MessagePart,
  PartID,
  TextPart,
} from '../../message/message-v2-schema.js';

// ─── In-memory db mock — covers every table the V2 store now writes to.
//
// The Phase 2.1 single write path means insertMessage / updateMessage /
// insertPart / updatePart / deletePart / updatePartDelta / deleteMessage /
// truncateMessagesAfter all funnel into emitEvent → projector → SQL. We
// model just the four tables those projectors touch (message_v2, part_v2,
// event_log, event_sequences) plus the sessions row needed for the FK
// look-up the projector performs.
// ───────────────────────────────────────────────────────────────────────

interface MessageRow {
  id: string;
  session_id: string;
  user_id: string;
  time_created: number;
  data: string;
}

interface PartRow {
  id: string;
  message_id: string;
  session_id: string;
  user_id: string;
  time_created: number;
  data: string;
}

interface EventLogRow {
  id: string;
  aggregate_id: string;
  seq: number;
  type: string;
  version: number;
  data: string;
  timestamp: number;
}

interface SequencesRow {
  aggregate_id: string;
  seq: number;
}

interface SessionRow {
  id: string;
  user_id: string;
}

let messageRows: MessageRow[] = [];
let partRows: PartRow[] = [];
let eventLog: EventLogRow[] = [];
let sequences: SequencesRow[] = [];
let sessionRows: SessionRow[] = [];

function findMessage(id: string): MessageRow | undefined {
  return messageRows.find((row) => row.id === id);
}

function findPart(id: string): PartRow | undefined {
  return partRows.find((row) => row.id === id);
}

vi.mock('../../infra/db.js', () => ({
  sqliteRun: (...args: unknown[]) => {
    const [sql, params] = args as [string, unknown[]];
    if (sql.includes('INSERT') && sql.includes('message_v2')) {
      const row: MessageRow = {
        id: params[0] as string,
        session_id: params[1] as string,
        user_id: params[2] as string,
        time_created: params[3] as number,
        data: params[4] as string,
      };
      const existing = messageRows.findIndex((r) => r.id === row.id);
      if (existing >= 0) {
        // ON CONFLICT DO UPDATE SET data = excluded.data
        messageRows[existing]!.data = row.data;
      } else {
        messageRows.push(row);
      }
      return;
    }
    if (sql.includes('INSERT') && sql.includes('part_v2')) {
      const row: PartRow = {
        id: params[0] as string,
        message_id: params[1] as string,
        session_id: params[2] as string,
        user_id: params[3] as string,
        time_created: params[4] as number,
        data: params[5] as string,
      };
      const existing = partRows.findIndex((r) => r.id === row.id);
      if (existing >= 0) {
        partRows[existing]!.data = row.data;
      } else {
        partRows.push(row);
      }
      return;
    }
    if (sql.includes('INSERT INTO event_log')) {
      eventLog.push({
        id: params[0] as string,
        aggregate_id: params[1] as string,
        seq: params[2] as number,
        type: params[3] as string,
        version: params[4] as number,
        data: params[5] as string,
        timestamp: params[6] as number,
      });
      return;
    }
    if (sql.includes('UPDATE') && sql.includes('part_v2') && sql.includes('SET data')) {
      const id = params[params.length - 1] as string;
      const row = partRows.find((r) => r.id === id);
      if (row) row.data = params[0] as string;
      return;
    }
    if (sql.includes('DELETE FROM part_v2')) {
      // DELETE FROM part_v2 WHERE id = ? AND message_id = ? AND session_id = ?
      // OR DELETE FROM part_v2 WHERE message_id = ? AND session_id = ?
      if (sql.includes('WHERE id = ?')) {
        const id = params[0] as string;
        partRows = partRows.filter((r) => r.id !== id);
      } else {
        const messageId = params[0] as string;
        const sessionId = params[1] as string;
        partRows = partRows.filter(
          (r) => !(r.message_id === messageId && r.session_id === sessionId),
        );
      }
      return;
    }
    if (sql.includes('DELETE FROM message_v2')) {
      // Either single delete or bulk IN(...) delete
      const ids = sql.includes('id IN (') ? (params.slice(2) as string[]) : [params[0] as string];
      messageRows = messageRows.filter((r) => !ids.includes(r.id));
      return;
    }
  },
  sqliteGet: (...args: unknown[]) => {
    const [sql, params] = args as [string, unknown[]];
    if (sql.includes('FROM sessions WHERE id')) {
      const row = sessionRows.find((r) => r.id === params[0]);
      return row ? { user_id: row.user_id } : undefined;
    }
    if (sql.includes('FROM message_v2') && sql.includes('WHERE id')) {
      return findMessage(params[0] as string);
    }
    if (
      sql.includes('SELECT data FROM part_v2') &&
      sql.includes('WHERE id') &&
      sql.includes('message_id') &&
      sql.includes('session_id')
    ) {
      // Projector's PartDelta SELECT: WHERE id = ? AND message_id = ? AND session_id = ?
      const id = params[0] as string;
      const messageId = params[1] as string;
      const sessionId = params[2] as string;
      return partRows.find(
        (r) => r.id === id && r.message_id === messageId && r.session_id === sessionId,
      );
    }
    if (
      sql.includes('SELECT message_id FROM part_v2') &&
      sql.includes('WHERE id') &&
      sql.includes('session_id')
    ) {
      // deletePart's id-resolution SELECT: WHERE id = ? AND session_id = ?
      const id = params[0] as string;
      const sessionId = params[1] as string;
      const row = partRows.find((r) => r.id === id && r.session_id === sessionId);
      return row ? { message_id: row.message_id } : undefined;
    }
    if (sql.includes('FROM part_v2') && sql.includes('WHERE id')) {
      return findPart(params[0] as string);
    }
    if (sql.includes('FROM event_sequences')) {
      const row = sequences.find((r) => r.aggregate_id === params[0]);
      return row ? { seq: row.seq } : undefined;
    }
    if (sql.includes('INSERT INTO event_sequences')) {
      const aggregateId = params[0] as string;
      const existing = sequences.find((r) => r.aggregate_id === aggregateId);
      if (existing) {
        existing.seq += 1;
        return { seq: existing.seq };
      }
      sequences.push({ aggregate_id: aggregateId, seq: 1 });
      return { seq: 1 };
    }
    if (sql.includes('FROM event_log WHERE id')) {
      return eventLog.find((row) => row.id === params[0]);
    }
    return undefined;
  },
  sqliteAll: (...args: unknown[]) => {
    const [sql, params] = args as [string, unknown[]];
    if (sql.includes('FROM message_v2') && sql.includes('session_id')) {
      const sessionId = params[0] as string;
      const userId = params[1] as string;
      // truncateMessagesAfter's SELECT carries `time_created >= (SELECT ...) AND id >= ?`
      // which we can model directly off the boundary message id (params[2]/[3]).
      if (sql.includes('time_created >=') && sql.includes('id >= ?')) {
        const boundaryId = params[3] as string;
        const boundaryRow = messageRows.find((r) => r.id === boundaryId);
        if (!boundaryRow) return [];
        return messageRows
          .filter(
            (r) =>
              r.session_id === sessionId &&
              r.user_id === userId &&
              r.time_created >= boundaryRow.time_created &&
              r.id >= boundaryId,
          )
          .sort((a, b) => a.time_created - b.time_created || a.id.localeCompare(b.id));
      }
      return messageRows.filter((r) => r.session_id === sessionId && r.user_id === userId);
    }
    if (sql.includes('FROM part_v2') && sql.includes('message_id')) {
      return partRows.filter((r) => r.message_id === params[0]);
    }
    if (sql.includes('FROM part_v2') && sql.includes('session_id')) {
      return partRows.filter((r) => r.session_id === params[0]);
    }
    return [];
  },
  sqliteTransaction: (fn: () => unknown) => fn(),
}));

import {
  deleteMessage,
  deletePart,
  insertMessage,
  insertPart,
  truncateMessagesAfter,
  updateMessage,
  updatePart,
  updatePartDelta,
} from '../../message/message-store-v2.js';

const SESSION_ID = 'session-2';
const USER_ID = 'user-2';

function makeUserMessage(id: string, time: number): MessageInfo {
  return {
    id: id as MessageID,
    sessionID: SESSION_ID,
    role: 'user',
    time: { created: time },
  };
}

function makeTextPart(messageId: string, partId: string, text: string): TextPart {
  return {
    id: partId as PartID,
    sessionID: SESSION_ID,
    messageID: messageId as MessageID,
    type: 'text',
    text,
  };
}

beforeEach(() => {
  messageRows = [];
  partRows = [];
  eventLog = [];
  sequences = [];
  sessionRows = [{ id: SESSION_ID, user_id: USER_ID }];
});

describe('message-store-v2 single write path (Phase 2.1)', () => {
  it('insertMessage emits message.created and projects to message_v2', () => {
    const info = makeUserMessage('msg-1', 100);

    insertMessage({ sessionId: SESSION_ID, userId: USER_ID, info });

    expect(messageRows).toHaveLength(1);
    expect(messageRows[0]).toMatchObject({
      id: 'msg-1',
      session_id: SESSION_ID,
      user_id: USER_ID,
      time_created: 100,
    });
    expect(eventLog.map((e) => e.type)).toEqual(['message.created']);
    expect(eventLog[0]!.aggregate_id).toBe(SESSION_ID);
    expect(eventLog[0]!.seq).toBe(1);
  });

  it('updateMessage emits message.updated and upserts the row idempotently', () => {
    const info = makeUserMessage('msg-2', 200);
    insertMessage({ sessionId: SESSION_ID, userId: USER_ID, info });

    const updated: MessageInfo = { ...info, time: { created: 250 } };
    updateMessage({ sessionId: SESSION_ID, userId: USER_ID, info: updated });

    expect(messageRows).toHaveLength(1);
    const stored = JSON.parse(messageRows[0]!.data) as { time: { created: number } };
    expect(stored.time.created).toBe(250);
    expect(eventLog.map((e) => e.type)).toEqual(['message.created', 'message.updated']);
  });

  it('deleteMessage emits message.removed and the projector tears down the row', () => {
    const info = makeUserMessage('msg-3', 300);
    insertMessage({ sessionId: SESSION_ID, userId: USER_ID, info });

    deleteMessage({ sessionId: SESSION_ID, userId: USER_ID, messageId: info.id });

    expect(messageRows).toHaveLength(0);
    expect(eventLog.map((e) => e.type)).toEqual(['message.created', 'message.removed']);
  });

  it('insertPart emits part.created and stores the part with derived time_created', () => {
    insertMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      info: makeUserMessage('msg-4', 1000),
    });
    const part = makeTextPart('msg-4', 'p-1', 'hello');

    insertPart({ sessionId: SESSION_ID, userId: USER_ID, part });

    expect(partRows).toHaveLength(1);
    expect(partRows[0]).toMatchObject({
      id: 'p-1',
      message_id: 'msg-4',
      session_id: SESSION_ID,
      user_id: USER_ID,
    });
    expect(eventLog.map((e) => e.type)).toContain('message.part.created');
  });

  it('updatePart emits part.updated and overwrites the data column', () => {
    insertMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      info: makeUserMessage('msg-5', 1000),
    });
    const initial = makeTextPart('msg-5', 'p-2', 'first');
    insertPart({ sessionId: SESSION_ID, userId: USER_ID, part: initial });
    const next: MessagePart = { ...initial, text: 'second' };

    updatePart({ sessionId: SESSION_ID, userId: USER_ID, part: next });

    const stored = JSON.parse(partRows[0]!.data) as { text: string };
    expect(stored.text).toBe('second');
    const types = eventLog.map((e) => e.type);
    expect(types).toContain('message.part.created');
    expect(types).toContain('message.part.updated');
  });

  it('deletePart emits part.removed when the part exists', () => {
    insertMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      info: makeUserMessage('msg-6', 1000),
    });
    const part = makeTextPart('msg-6', 'p-3', 'gone');
    insertPart({ sessionId: SESSION_ID, userId: USER_ID, part });

    deletePart({ sessionId: SESSION_ID, partId: part.id });

    expect(partRows).toHaveLength(0);
    expect(eventLog.map((e) => e.type)).toContain('message.part.removed');
  });

  it('deletePart is a no-op (no event) when the part does not exist', () => {
    deletePart({ sessionId: SESSION_ID, partId: 'p-missing' as PartID });
    expect(eventLog).toHaveLength(0);
  });

  it('updatePartDelta emits part.delta and the projector appends to the data field', () => {
    insertMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      info: makeUserMessage('msg-7', 1000),
    });
    const part = makeTextPart('msg-7', 'p-4', 'pre');
    insertPart({ sessionId: SESSION_ID, userId: USER_ID, part });

    updatePartDelta({
      sessionId: SESSION_ID,
      messageId: part.messageID,
      partId: part.id,
      field: 'text',
      delta: 'fix',
    });

    const stored = JSON.parse(partRows[0]!.data) as { text: string };
    expect(stored.text).toBe('prefix');
    expect(eventLog.map((e) => e.type)).toContain('message.part.delta');
  });

  it('truncateMessagesAfter emits a message.removed event per truncated message', () => {
    insertMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      info: makeUserMessage('msg-keep', 1),
    });
    insertMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      info: makeUserMessage('msg-truncate-1', 2),
    });
    insertMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      info: makeUserMessage('msg-truncate-2', 3),
    });

    const removed = truncateMessagesAfter({
      sessionId: SESSION_ID,
      userId: USER_ID,
      messageId: 'msg-truncate-1' as MessageID,
    });

    expect(removed).toEqual(['msg-truncate-1', 'msg-truncate-2']);
    expect(messageRows.map((r) => r.id)).toEqual(['msg-keep']);
    const removedEvents = eventLog.filter((e) => e.type === 'message.removed');
    expect(removedEvents).toHaveLength(2);
  });

  it('truncateMessagesAfter chunks bulk deletes under the SQLite bind limit', () => {
    insertMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      info: makeUserMessage('msg-0000', 0),
    });
    for (let index = 1; index <= 1200; index += 1) {
      const id = `msg-${index.toString().padStart(4, '0')}`;
      insertMessage({
        sessionId: SESSION_ID,
        userId: USER_ID,
        info: makeUserMessage(id, index),
      });
    }

    const removed = truncateMessagesAfter({
      sessionId: SESSION_ID,
      userId: USER_ID,
      messageId: 'msg-0001' as MessageID,
    });

    expect(removed).toHaveLength(1200);
    const deleteCalls = eventLog.filter((event) => event.type === 'message.removed');
    expect(deleteCalls).toHaveLength(1200);
    expect(messageRows).toHaveLength(1);
  });

  it('event_log entries carry monotonic seq per session aggregate', () => {
    insertMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      info: makeUserMessage('msg-a', 1),
    });
    insertMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      info: makeUserMessage('msg-b', 2),
    });
    insertMessage({
      sessionId: SESSION_ID,
      userId: USER_ID,
      info: makeUserMessage('msg-c', 3),
    });

    const seqs = eventLog.map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3]);
    expect(eventLog.every((e) => e.aggregate_id === SESSION_ID)).toBe(true);
  });
});
