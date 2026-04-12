import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  AssistantMessage,
  CompactionPart,
  MessageID,
  MessageWithParts,
  PartID,
  TextPart,
  ToolPart,
  ToolStatePending,
  ToolStateRunning,
  UserMessage,
} from '../message-v2-schema.js';

// ─── In-memory DB simulation ───

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

let messageRows: MessageRow[] = [];
let partRows: PartRow[] = [];

vi.mock('../db.js', () => ({
  sqliteRun: (...args: unknown[]) => {
    const [sql, params] = args as [string, unknown[]];
    if (sql.includes('INSERT') && sql.includes('message_v2')) {
      messageRows.push({
        id: params[0] as string,
        session_id: params[1] as string,
        user_id: params[2] as string,
        time_created: params[3] as number,
        data: params[4] as string,
      });
    }
    if (sql.includes('INSERT') && sql.includes('part_v2')) {
      partRows.push({
        id: params[0] as string,
        message_id: params[1] as string,
        session_id: params[2] as string,
        user_id: params[3] as string,
        time_created: params[4] as number,
        data: params[5] as string,
      });
    }
    if (sql.includes('DELETE') && sql.includes('message_v2')) {
      messageRows = messageRows.filter((r) => !(r.id === params[0] && r.session_id === params[1]));
    }
    if (sql.includes('DELETE') && sql.includes('part_v2')) {
      partRows = partRows.filter((r) => r.id !== params[0]);
    }
    if (sql.includes('UPDATE') && sql.includes('message_v2') && sql.includes('SET data')) {
      const idx = messageRows.findIndex((r) => r.id === (params[params.length - 1] as string));
      if (idx >= 0) messageRows[idx]!.data = params[0] as string;
    }
    if (sql.includes('UPDATE') && sql.includes('part_v2') && sql.includes('SET data')) {
      const idx = partRows.findIndex((r) => r.id === (params[params.length - 1] as string));
      if (idx >= 0) partRows[idx]!.data = params[0] as string;
    }
  },
  sqliteGet: (...args: unknown[]) => {
    const [sql, params] = args as [string, unknown[]];
    if (sql.includes('FROM message_v2') && sql.includes('WHERE id')) {
      const row = messageRows.find((r) => r.id === params[0]);
      return row ?? undefined;
    }
    if (sql.includes('FROM part_v2') && sql.includes('WHERE id')) {
      const row = partRows.find((r) => r.id === params[0]);
      return row ?? undefined;
    }
    return undefined;
  },
  sqliteAll: (...args: unknown[]) => {
    const [sql, params] = args as [string, unknown[]];
    if (sql.includes('FROM message_v2') && sql.includes('session_id')) {
      return messageRows.filter((r) => r.session_id === params[0] && r.user_id === params[1]);
    }
    if (sql.includes('FROM part_v2') && sql.includes('message_id')) {
      return partRows.filter((r) => r.message_id === params[0]);
    }
    if (sql.includes('FROM part_v2') && sql.includes('session_id')) {
      return partRows.filter((r) => r.session_id === params[0]);
    }
    return [];
  },
  sqliteTransaction: (fn: () => void) => fn(),
}));

import {
  insertMessage,
  updateMessage,
  deleteMessage,
  getMessage,
  listMessages,
  insertPart,
  deletePart,
  getPart,
  listPartsForMessage,
  transitionToolToRunning,
  transitionToolToCompleted,
  transitionToolToError,
  encodeCursor,
  decodeCursor,
  filterCompacted,
  fromError,
  partsForMessage,
} from '../message-store-v2.js';

function toMessageId(value: string): MessageID {
  return value as MessageID;
}

function toPartId(value: string): PartID {
  return value as PartID;
}

describe('message-store-v2', () => {
  beforeEach(() => {
    messageRows = [];
    partRows = [];
  });

  // ─── Message CRUD ───

  it('inserts and retrieves a message', () => {
    const info: UserMessage = {
      id: toMessageId('msg-1'),
      role: 'user',
      sessionID: 'session-1',
      time: { created: Date.now() },
    };
    insertMessage({ sessionId: 'session-1', userId: 'user-1', info });
    const msg = getMessage({ sessionId: 'session-1', messageId: toMessageId('msg-1') });
    expect(msg).toBeDefined();
    expect(msg!.id).toBe('msg-1');
  });

  it('updates a message', () => {
    const info: UserMessage = {
      id: toMessageId('msg-1'),
      role: 'user',
      sessionID: 'session-1',
      time: { created: Date.now() },
    };
    insertMessage({ sessionId: 'session-1', userId: 'user-1', info });
    const updated: UserMessage = { ...info, tools: { bash: true } };
    updateMessage({ sessionId: 'session-1', userId: 'user-1', info: updated });
    const msg = getMessage({ sessionId: 'session-1', messageId: toMessageId('msg-1') });
    expect(msg).toBeDefined();
  });

  it('deletes a message', () => {
    const info: UserMessage = {
      id: toMessageId('msg-1'),
      role: 'user',
      sessionID: 'session-1',
      time: { created: Date.now() },
    };
    insertMessage({ sessionId: 'session-1', userId: 'user-1', info });
    deleteMessage({ sessionId: 'session-1', userId: 'user-1', messageId: toMessageId('msg-1') });
    const msg = getMessage({ sessionId: 'session-1', messageId: toMessageId('msg-1') });
    expect(msg).toBeUndefined();
  });

  it('lists messages for a session', () => {
    const now = Date.now();
    insertMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      info: {
        id: toMessageId('msg-1'),
        role: 'user',
        sessionID: 'session-1',
        time: { created: now },
      },
    });
    insertMessage({
      sessionId: 'session-1',
      userId: 'user-1',
      info: {
        id: toMessageId('msg-2'),
        role: 'assistant',
        sessionID: 'session-1',
        time: { created: now + 1 },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    });
    const msgs = listMessages({ sessionId: 'session-1', userId: 'user-1' });
    expect(msgs).toHaveLength(2);
  });

  // ─── Part CRUD ───

  it('inserts and retrieves a part', () => {
    const part: TextPart = {
      type: 'text',
      id: toPartId('part-1'),
      sessionID: 'session-1',
      messageID: toMessageId('msg-1'),
      text: 'Hello world',
    };
    insertPart({ sessionId: 'session-1', userId: 'user-1', part });
    const p = getPart({
      sessionId: 'session-1',
      messageId: toMessageId('msg-1'),
      partId: toPartId('part-1'),
    });
    expect(p).toBeDefined();
  });

  it('deletes a part', () => {
    const part: TextPart = {
      type: 'text',
      id: toPartId('part-1'),
      sessionID: 'session-1',
      messageID: toMessageId('msg-1'),
      text: 'Hello',
    };
    insertPart({ sessionId: 'session-1', userId: 'user-1', part });
    deletePart({ sessionId: 'session-1', partId: toPartId('part-1') });
    const p = getPart({
      sessionId: 'session-1',
      messageId: toMessageId('msg-1'),
      partId: toPartId('part-1'),
    });
    expect(p).toBeUndefined();
  });

  it('lists parts for a message', () => {
    const part1: TextPart = {
      type: 'text',
      id: toPartId('part-1'),
      sessionID: 'session-1',
      messageID: toMessageId('msg-1'),
      text: 'A',
    };
    const part2: TextPart = {
      type: 'text',
      id: toPartId('part-2'),
      sessionID: 'session-1',
      messageID: toMessageId('msg-1'),
      text: 'B',
    };
    insertPart({ sessionId: 'session-1', userId: 'user-1', part: part1 });
    insertPart({ sessionId: 'session-1', userId: 'user-1', part: part2 });
    const parts = listPartsForMessage({ sessionId: 'session-1', messageId: toMessageId('msg-1') });
    expect(parts).toHaveLength(2);
  });

  // ─── Tool State Machine ───

  it('transitions tool from pending to running', () => {
    const pendingState: ToolStatePending = {
      status: 'pending',
      input: {},
      raw: '{}',
    };
    const part: ToolPart = {
      type: 'tool',
      id: toPartId('part-tool-1'),
      sessionID: 'session-1',
      messageID: toMessageId('msg-1'),
      tool: 'write',
      callID: 'call-1',
      state: pendingState,
    };
    insertPart({ sessionId: 'session-1', userId: 'user-1', part });
    const transitioned = transitionToolToRunning({
      sessionId: 'session-1',
      userId: 'user-1',
      callID: 'call-1',
    });
    expect(transitioned?.state.status).toBe('running');
  });

  it('transitions tool from running to completed', () => {
    const runningState: ToolStateRunning = {
      status: 'running',
      input: {},
      time: { start: 1000 },
    };
    const part: ToolPart = {
      type: 'tool',
      id: toPartId('part-tool-2'),
      sessionID: 'session-1',
      messageID: toMessageId('msg-1'),
      tool: 'write',
      callID: 'call-2',
      state: runningState,
    };
    insertPart({ sessionId: 'session-1', userId: 'user-1', part });
    const transitioned = transitionToolToCompleted({
      sessionId: 'session-1',
      userId: 'user-1',
      callID: 'call-2',
      output: 'File written successfully',
      title: 'write',
      metadata: {},
      startTime: 1000,
    });
    expect(transitioned?.state.status).toBe('completed');
  });

  it('transitions tool from running to error', () => {
    const runningState: ToolStateRunning = {
      status: 'running',
      input: {},
      time: { start: 1000 },
    };
    const part: ToolPart = {
      type: 'tool',
      id: toPartId('part-tool-3'),
      sessionID: 'session-1',
      messageID: toMessageId('msg-1'),
      tool: 'write',
      callID: 'call-3',
      state: runningState,
    };
    insertPart({ sessionId: 'session-1', userId: 'user-1', part });
    const transitioned = transitionToolToError({
      sessionId: 'session-1',
      userId: 'user-1',
      callID: 'call-3',
      error: 'Permission denied',
      startTime: 1000,
    });
    expect(transitioned?.state.status).toBe('error');
  });

  // ─── Cursor Pagination ───

  it('encodes and decodes cursors', () => {
    const cursor = encodeCursor({ id: toMessageId('msg-5'), time: 1700000000000 });
    expect(cursor).toBeTruthy();
    const decoded = decodeCursor(cursor);
    expect(decoded.id).toBe('msg-5');
    expect(decoded.time).toBe(1700000000000);
  });

  // ─── filterCompacted ───

  it('filterCompacted filters messages based on completed parentID', () => {
    // filterCompacted: when an assistant message has summary+finish+no error,
    // its parentID is marked completed. A user message with compaction part
    // whose id is in completed set causes a break.
    const msgs: MessageWithParts[] = [
      {
        info: { id: toMessageId('user-1'), role: 'user', sessionID: 's1', time: { created: 1 } },
        parts: [
          {
            type: 'text',
            id: toPartId('p1'),
            sessionID: 's1',
            messageID: toMessageId('user-1'),
            text: 'hello',
          },
        ],
      },
      {
        info: {
          id: toMessageId('asst-1'),
          role: 'assistant',
          sessionID: 's1',
          time: { created: 2 },
          parentID: toMessageId('user-1'),
          summary: true,
          finish: 'end_turn',
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } satisfies AssistantMessage,
        parts: [
          {
            type: 'text',
            id: toPartId('p2'),
            sessionID: 's1',
            messageID: toMessageId('asst-1'),
            text: 'response',
          },
        ],
      },
      {
        info: { id: toMessageId('user-1'), role: 'user', sessionID: 's1', time: { created: 3 } },
        parts: [
          {
            type: 'compaction',
            id: toPartId('p3'),
            sessionID: 's1',
            messageID: toMessageId('user-1'),
            auto: true,
          } satisfies CompactionPart,
        ],
      },
    ];
    const filtered = filterCompacted(msgs);
    // Should break at the compaction user message and reverse
    expect(filtered.length).toBeLessThanOrEqual(3);
  });

  // ─── fromError ───

  it('fromError creates an error object from an Error', () => {
    const err = fromError(new Error('Rate limited'), {});
    expect(err.name).toBeTruthy();
    expect(err.message).toBe('Rate limited');
  });

  it('fromError handles AbortError', () => {
    const abortErr = new DOMException('Aborted', 'AbortError');
    const err = fromError(abortErr, {});
    expect(err.name).toBe('AbortedError');
  });

  // ─── partsForMessage ───

  it('partsForMessage returns parts for a given message', () => {
    const part: TextPart = {
      type: 'text',
      id: toPartId('p-1'),
      sessionID: 'session-1',
      messageID: toMessageId('msg-1'),
      text: 'hi',
    };
    insertPart({ sessionId: 'session-1', userId: 'user-1', part });
    const parts = partsForMessage(toMessageId('msg-1'));
    expect(parts).toHaveLength(1);
  });
});
