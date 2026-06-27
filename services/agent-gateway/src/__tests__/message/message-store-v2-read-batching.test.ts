import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MessageID,
  MessageV2Row,
  PartID,
  PartV2Row,
} from '../../message/message-v2-schema.js';

const SESSION_ID = 'session-read-batch';
const USER_ID = 'user-read-batch';
const TOTAL_MESSAGE_COUNT = 1200;
const PAGE_LIMIT = 1100;
const SQLITE_PARAM_LIMIT = 900;

let messageRows: MessageV2Row[] = [];
let partRows: PartV2Row[] = [];
let partQueryParamCounts: number[] = [];

vi.mock('../../infra/db.js', () => ({
  sqliteAll: (sql: string, params: readonly unknown[] = []) => {
    if (sql.includes('FROM message_v2') && sql.includes('ORDER BY time_created ASC, id ASC')) {
      return messageRows.filter((row) => row.session_id === params[0] && row.user_id === params[1]);
    }

    if (sql.includes('FROM message_v2') && sql.includes('ORDER BY time_created DESC, id DESC')) {
      const limit = Number(params.at(-1));
      return [...messageRows]
        .filter((row) => row.session_id === params[0] && row.user_id === params[1])
        .sort(
          (left, right) =>
            right.time_created - left.time_created || right.id.localeCompare(left.id),
        )
        .slice(0, limit);
    }

    if (sql.includes('FROM part_v2') && sql.includes('message_id IN (')) {
      partQueryParamCounts.push(params.length);
      if (params.length > SQLITE_PARAM_LIMIT) {
        throw new Error('too many SQL variables');
      }

      const sessionId = params[0];
      const messageIds = new Set(params.slice(1) as string[]);
      return partRows
        .filter((row) => row.session_id === sessionId && messageIds.has(row.message_id))
        .sort(
          (left, right) =>
            left.message_id.localeCompare(right.message_id) || left.id.localeCompare(right.id),
        );
    }

    return [];
  },
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
}));

vi.mock('../../session/sync-event.js', () => ({
  emitEvent: vi.fn(),
  MessageEvents: {},
  publishBusEvent: vi.fn(),
  SessionBusEvents: {},
  SessionEvents: {},
  TodoBusEvents: {},
}));

vi.mock('../../session/session-entry-store.js', () => ({
  appendSessionEvent: vi.fn(),
}));

vi.mock('../../message/message-v2-projectors.js', () => ({}));

import { listMessagesWithParts, pageMessagesWithParts } from '../../message/message-store-v2.js';

function makeMessageId(index: number): MessageID {
  return `message-${index.toString().padStart(4, '0')}` as MessageID;
}

function makePartId(index: number): PartID {
  return `part-${index.toString().padStart(4, '0')}` as PartID;
}

function makeMessageRow(index: number): MessageV2Row {
  return {
    id: makeMessageId(index),
    session_id: SESSION_ID,
    user_id: USER_ID,
    time_created: index,
    data: JSON.stringify({
      role: 'user',
      time: { created: index },
    }),
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z',
  };
}

function makePartRow(index: number): PartV2Row {
  return {
    id: makePartId(index),
    message_id: makeMessageId(index),
    session_id: SESSION_ID,
    user_id: USER_ID,
    time_created: index,
    data: JSON.stringify({
      type: 'text',
      text: `part-${index}`,
    }),
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z',
  };
}

beforeEach(() => {
  messageRows = Array.from({ length: TOTAL_MESSAGE_COUNT }, (_, index) =>
    makeMessageRow(index + 1),
  );
  partRows = Array.from({ length: TOTAL_MESSAGE_COUNT }, (_, index) => makePartRow(index + 1));
  partQueryParamCounts = [];
});

describe('message-store-v2 read batching', () => {
  it('chunks part lookups for large transcript reads', () => {
    const messages = listMessagesWithParts({
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(messages).toHaveLength(TOTAL_MESSAGE_COUNT);
    expect(messages[0]?.parts).toHaveLength(1);
    expect(messages[0]?.parts[0]).toMatchObject({
      type: 'text',
      text: 'part-1',
    });
    expect(partQueryParamCounts.length).toBeGreaterThan(1);
    expect(Math.max(...partQueryParamCounts)).toBeLessThanOrEqual(SQLITE_PARAM_LIMIT);
  });

  it('chunks part lookups for large paged reads', () => {
    const page = pageMessagesWithParts({
      sessionId: SESSION_ID,
      userId: USER_ID,
      limit: PAGE_LIMIT,
    });

    expect(page.items).toHaveLength(PAGE_LIMIT);
    expect(page.more).toBe(true);
    expect(page.cursor).toBeDefined();
    expect(page.items[0]?.parts).toHaveLength(1);
    expect(page.items[0]?.parts[0]).toMatchObject({
      type: 'text',
      text: 'part-101',
    });
    expect(partQueryParamCounts.length).toBeGreaterThan(1);
    expect(Math.max(...partQueryParamCounts)).toBeLessThanOrEqual(SQLITE_PARAM_LIMIT);
  });
});
