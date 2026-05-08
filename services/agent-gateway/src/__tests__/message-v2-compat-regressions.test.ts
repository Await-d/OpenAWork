import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  emitEvent: vi.fn(),
  sqliteAll: vi.fn<() => unknown[]>(() => []),
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  upsertSearchDocument: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteAll: mocks.sqliteAll,
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
}));

vi.mock('../sync-event.js', () => ({
  emitEvent: mocks.emitEvent,
  MessageEvents: {
    Created: { type: 'message.created', version: 1 },
    PartCreated: { type: 'message.part.created', version: 1 },
    PartUpdated: { type: 'message.part.updated', version: 1 },
    Removed: { type: 'message.removed', version: 1 },
  },
  publishBusEvent: vi.fn(),
  SessionBusEvents: {},
  SessionEvents: {},
  TodoBusEvents: {},
}));

vi.mock('../message-v2-projectors.js', () => ({}));

vi.mock('../session-search-store.js', () => ({
  upsertSessionMessageSearchDocument: mocks.upsertSearchDocument,
}));

import { appendSessionMessageV2 } from '../message-v2-adapter.js';
import { filterCompacted } from '../message-to-model-messages.js';
import { hasSessionMessage } from '../session-message-rating-store.js';
import type { MessageID, MessageWithParts, PartID } from '../message-v2-schema.js';

function asMessageId(id: string): MessageID {
  return id as MessageID;
}

function asPartId(id: string): PartID {
  return id as PartID;
}

function userMessage(id: string, parts: MessageWithParts['parts'] = []): MessageWithParts {
  return {
    info: {
      id: asMessageId(id),
      sessionID: 'session-1',
      role: 'user',
      time: { created: 1 },
    },
    parts,
  };
}

function assistantSummary(id: string, parentID: string): MessageWithParts {
  return {
    info: {
      id: asMessageId(id),
      sessionID: 'session-1',
      role: 'assistant',
      time: { created: 1 },
      parentID: asMessageId(parentID),
      summary: true,
      finish: 'stop',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [],
  };
}

describe('message-v2 compatibility regressions', () => {
  beforeEach(() => {
    mocks.emitEvent.mockClear();
    mocks.sqliteAll.mockReset();
    mocks.sqliteAll.mockReturnValue([]);
    mocks.sqliteGet.mockReset();
    mocks.sqliteRun.mockClear();
    mocks.upsertSearchDocument.mockClear();
  });

  it('mirrors v2 writes into the legacy search index path', () => {
    mocks.sqliteGet.mockReturnValue({ max_seq: null });

    appendSessionMessageV2({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'user',
      messageId: 'message-1',
      createdAt: 123,
      content: [{ type: 'text', text: 'needle-v2-search' }],
    });

    expect(mocks.sqliteRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO session_messages'),
      expect.arrayContaining(['message-1', 'session-1', 'user-1', 1, 'user']),
    );
    expect(mocks.upsertSearchDocument).toHaveBeenCalledWith({
      contentJson: JSON.stringify([{ type: 'text', text: 'needle-v2-search' }]),
      id: 'message-1',
      role: 'user',
      sessionId: 'session-1',
      userId: 'user-1',
    });
  });

  it('persists assistant provider usage on the V2 message info', () => {
    mocks.sqliteGet.mockReturnValue({ max_seq: null });

    const message = appendSessionMessageV2({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      messageId: 'message-usage',
      createdAt: 123,
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 130,
        reasoningTokens: 5,
        cacheReadTokens: 5,
      },
    });

    expect(message.providerUsage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 130,
      reasoningTokens: 5,
      cacheReadTokens: 5,
    });
    const createdCall = mocks.emitEvent.mock.calls.find(
      (call) =>
        (call[0] as { definition?: { type?: string } }).definition?.type === 'message.created',
    );
    expect(createdCall?.[0]).toMatchObject({
      data: {
        info: {
          role: 'assistant',
          tokens: {
            input: 100,
            output: 20,
            reasoning: 5,
            cache: { read: 5, write: 0 },
            total: 130,
          },
        },
      },
    });
  });

  it('clears existing request-role mirrors before replaceExisting writes', () => {
    const clientRequestId = 'parent-req:tool:task-call-1';
    mocks.sqliteAll
      .mockReturnValueOnce([
        {
          id: 'old-tool-message',
          data: JSON.stringify({
            id: 'old-tool-message',
            sessionID: 'session-1',
            role: 'tool',
            clientRequestId,
            time: { created: 111 },
          }),
        },
      ])
      .mockReturnValueOnce([{ id: 'old-tool-message' }]);
    mocks.sqliteGet.mockReturnValue({ max_seq: 0 });

    appendSessionMessageV2({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'tool',
      messageId: 'new-tool-message',
      createdAt: 123,
      clientRequestId,
      replaceExisting: true,
      content: [{ type: 'text', text: 'replacement tool result' }],
    });

    expect(mocks.emitEvent).toHaveBeenCalledWith({
      definition: { type: 'message.removed', version: 1 },
      aggregateID: 'session-1',
      data: { sessionID: 'session-1', messageID: 'old-tool-message' },
    });

    const deleteLegacyCallIndex = mocks.sqliteRun.mock.calls.findIndex((call) =>
      String(call[0]).includes('DELETE FROM session_messages\n     WHERE session_id = ?'),
    );
    const insertLegacyCallIndex = mocks.sqliteRun.mock.calls.findIndex((call) =>
      String(call[0]).includes('INSERT INTO session_messages'),
    );

    expect(deleteLegacyCallIndex).toBeGreaterThanOrEqual(0);
    expect(insertLegacyCallIndex).toBeGreaterThan(deleteLegacyCallIndex);
    expect(mocks.sqliteRun).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM session_messages_fts'),
      ['old-tool-message'],
    );
  });

  it('keeps legacy stream tool-result writes idempotent', () => {
    const streamRouteSource = readFileSync(new URL('../routes/stream.ts', import.meta.url), 'utf8');
    const toolResultWrite = streamRouteSource.match(
      /appendSessionMessageV2\(\{[\s\S]*?role: 'tool',[\s\S]*?clientRequestId: createToolResultRequestId\(input\.clientRequestId, toolCallId\),[\s\S]*?replaceExisting: true,[\s\S]*?\}\);/,
    );

    expect(toolResultWrite).not.toBeNull();
  });

  it('recognizes message_v2 rows when validating message ratings', () => {
    mocks.sqliteGet.mockReturnValue({ id: 'message-v2-only' });

    expect(
      hasSessionMessage({
        messageId: 'message-v2-only',
        sessionId: 'session-1',
        userId: 'user-1',
      }),
    ).toBe(true);

    expect(mocks.sqliteGet).toHaveBeenCalledWith(expect.stringContaining('FROM message_v2'), [
      'session-1',
      'user-1',
      'message-v2-only',
      'session-1',
      'user-1',
      'message-v2-only',
    ]);
  });

  it('orders compaction summary before retained tail messages', () => {
    const compaction = userMessage('m3', [
      {
        id: asPartId('p1'),
        sessionID: 'session-1',
        messageID: asMessageId('m3'),
        type: 'compaction',
        auto: true,
        tailStartID: asMessageId('m1'),
      },
    ]);
    const result = filterCompacted([
      userMessage('m0'),
      userMessage('m1'),
      userMessage('m2'),
      compaction,
      assistantSummary('m4', 'm3'),
      userMessage('m5'),
    ]);

    expect(result.map((msg) => msg.info.id)).toEqual(['m3', 'm4', 'm1', 'm2', 'm5']);
  });
});
