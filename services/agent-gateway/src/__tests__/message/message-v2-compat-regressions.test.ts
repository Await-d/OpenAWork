import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  emitEvent: vi.fn(),
  sqliteAll: vi.fn<() => unknown[]>(() => []),
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  upsertSearchDocument: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteAll: mocks.sqliteAll,
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
}));

vi.mock('../../session/sync-event.js', () => ({
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

vi.mock('../../message/message-v2-projectors.js', () => ({}));

vi.mock('../../session/session-search-store.js', () => ({
  upsertSessionMessageSearchDocument: mocks.upsertSearchDocument,
}));

import { appendSessionMessageV2, v2ToV1Message } from '../../message/message-v2-adapter.js';
import { filterCompacted, toModelMessages } from '../../message/message-to-model-messages.js';
import { hasSessionMessage } from '../../session/session-message-rating-store.js';
import type { MessageID, MessageWithParts, PartID } from '../../message/message-v2-schema.js';
import { buildCompactionMarkerContent } from '../../compaction/compaction-marker.js';
import { unifiedConversationToNativeMessages } from '../../v2-runtime/upstream/native-message-bridge.js';

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

function textMessage(id: string, role: 'user' | 'assistant', text: string): MessageWithParts {
  const messageId = asMessageId(id);
  const part = {
    id: asPartId(`${id}-part`),
    sessionID: 'session-1',
    messageID: messageId,
    type: 'text' as const,
    text,
  };

  if (role === 'assistant') {
    return {
      info: {
        id: messageId,
        sessionID: 'session-1',
        role: 'assistant',
        time: { created: 1 },
        finish: 'stop',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [part],
    };
  }

  return {
    info: {
      id: messageId,
      sessionID: 'session-1',
      role: 'user',
      time: { created: 1 },
    },
    parts: [part],
  };
}

function legacyCompactionMarker(
  id: string,
  summary: string,
  tailStartMessageId?: string,
): MessageWithParts {
  const messageId = asMessageId(id);
  const marker = buildCompactionMarkerContent({
    markerType: 'compaction_marker',
    source: 'openAwork',
    summary,
    trigger: 'manual',
    ...(tailStartMessageId ? { tailStartMessageId } : {}),
  });
  const markerText = marker.content[0];
  if (!markerText || markerText.type !== 'text') {
    throw new Error('expected compaction marker text');
  }

  return {
    info: {
      id: messageId,
      sessionID: 'session-1',
      role: 'assistant',
      time: { created: 1 },
      finish: 'stop',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: asPartId(`${id}-part`),
        sessionID: 'session-1',
        messageID: messageId,
        type: 'text',
        text: markerText.text,
      },
    ],
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

  it('persists assistant agent identity on both emitted info and returned message', () => {
    mocks.sqliteGet.mockReturnValue({ max_seq: null });

    const message = appendSessionMessageV2({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      agentId: 'prometheus',
      messageId: 'message-agent',
      createdAt: 123,
      content: [{ type: 'text', text: '由规划层输出' }],
    });

    expect((message as unknown as { agentId?: string }).agentId).toBe('prometheus');
    const createdCall = mocks.emitEvent.mock.calls.find(
      (call) =>
        (call[0] as { definition?: { type?: string } }).definition?.type === 'message.created',
    );
    expect(createdCall?.[0]).toMatchObject({
      data: {
        info: {
          role: 'assistant',
          agent: 'prometheus',
        },
      },
    });
  });

  it('persists assistant route metadata and rehydrates model/provider on reads', () => {
    mocks.sqliteGet.mockReturnValue({ max_seq: null });

    const message = appendSessionMessageV2({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      messageId: 'message-route-meta',
      createdAt: 123,
      modelID: 'gpt-5.4',
      providerID: 'openai-fast',
      content: [{ type: 'text', text: '走 Fast 路由' }],
    });

    expect(message).toMatchObject({
      id: 'message-route-meta',
      role: 'assistant',
      model: 'gpt-5.4',
      providerId: 'openai-fast',
    });
    const createdCall = mocks.emitEvent.mock.calls.find(
      (call) =>
        (call[0] as { definition?: { type?: string } }).definition?.type === 'message.created',
    );
    expect(createdCall?.[0]).toMatchObject({
      data: {
        info: {
          role: 'assistant',
          modelID: 'gpt-5.4',
          providerID: 'openai-fast',
        },
      },
    });

    expect(
      v2ToV1Message({
        info: {
          id: asMessageId('message-route-meta'),
          sessionID: 'session-1',
          role: 'assistant',
          time: { created: 123 },
          modelID: 'gpt-5.4',
          providerID: 'openai-fast',
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [
          {
            id: asPartId('part-route-meta'),
            sessionID: 'session-1',
            messageID: asMessageId('message-route-meta'),
            type: 'text',
            text: '走 Fast 路由',
          },
        ],
      }),
    ).toMatchObject({
      id: 'message-route-meta',
      role: 'assistant',
      model: 'gpt-5.4',
      providerId: 'openai-fast',
      content: [{ type: 'text', text: '走 Fast 路由' }],
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

  it('replaces existing assistant request-role mirrors for error writes', () => {
    const clientRequestId = 'parent-req:assistant:error-1';
    mocks.sqliteAll.mockReturnValueOnce([]).mockReturnValueOnce([{ id: 'old-assistant-message' }]);
    mocks.sqliteGet.mockReturnValue({ max_seq: 0 });

    appendSessionMessageV2({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      messageId: 'new-assistant-message',
      createdAt: 123,
      clientRequestId,
      replaceExisting: true,
      status: 'error',
      content: [{ type: 'text', text: '[错误: STREAM_ERROR] boom' }],
    });

    const deleteLegacyCallIndex = mocks.sqliteRun.mock.calls.findIndex((call) =>
      String(call[0]).includes('DELETE FROM session_messages\n     WHERE session_id = ?'),
    );
    const insertLegacyCallIndex = mocks.sqliteRun.mock.calls.findIndex((call) =>
      String(call[0]).includes('INSERT INTO session_messages'),
    );

    expect(deleteLegacyCallIndex).toBeGreaterThanOrEqual(0);
    expect(insertLegacyCallIndex).toBeGreaterThan(deleteLegacyCallIndex);
  });

  it('legacy request-role unique index冲突时会先清理旧镜像再重试写入', () => {
    const clientRequestId = 'parent-req:assistant:retry-1';
    let insertAttempts = 0;
    mocks.sqliteAll.mockReturnValue([{ id: 'stale-legacy-message' }]);
    mocks.sqliteGet.mockReturnValue({ max_seq: 0 });
    mocks.sqliteRun.mockImplementation((sql: string) => {
      if (!sql.includes('INSERT INTO session_messages')) {
        return;
      }

      insertAttempts += 1;
      if (insertAttempts === 1) {
        throw new Error(
          'UNIQUE constraint failed: session_messages.session_id, session_messages.client_request_id, session_messages.role',
        );
      }
    });

    expect(() =>
      appendSessionMessageV2({
        sessionId: 'session-1',
        userId: 'user-1',
        role: 'assistant',
        messageId: 'assistant-retry-message',
        createdAt: 123,
        clientRequestId,
        status: 'error',
        content: [{ type: 'text', text: '[错误: STREAM_ERROR] boom' }],
      }),
    ).not.toThrow();

    expect(insertAttempts).toBe(2);
    expect(mocks.sqliteRun).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM session_messages_fts'),
      ['stale-legacy-message'],
    );
    expect(mocks.sqliteRun).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM session_messages\n     WHERE session_id = ?'),
      ['session-1', 'user-1', clientRequestId, 'assistant'],
    );
  });

  it('chunks large request-role deletes to stay under SQLite variable limits', () => {
    const clientRequestId = 'parent-req:tool:bulk-delete';
    const existingRows = Array.from({ length: 1200 }, (_, index) => ({
      id: `old-tool-message-${index}`,
      data: JSON.stringify({
        id: `old-tool-message-${index}`,
        sessionID: 'session-1',
        role: 'tool',
        clientRequestId,
        time: { created: index },
      }),
    }));
    mocks.sqliteAll.mockReturnValueOnce(existingRows).mockReturnValueOnce([]);
    mocks.sqliteGet.mockReturnValue({ max_seq: 0 });

    appendSessionMessageV2({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'tool',
      messageId: 'new-tool-message-bulk',
      createdAt: 123,
      clientRequestId,
      replaceExisting: true,
      content: [{ type: 'text', text: 'replacement tool result' }],
    });

    const deleteCalls = mocks.sqliteRun.mock.calls.filter((call) =>
      String(call[0]).includes(
        'DELETE FROM message_v2 WHERE session_id = ? AND user_id = ? AND id IN (',
      ),
    );

    expect(deleteCalls.length).toBeGreaterThan(1);
    expect(
      deleteCalls.every((call) => Array.isArray(call[1]) && (call[1] as unknown[]).length <= 900),
    ).toBe(true);
  });

  it('keeps legacy stream tool-result writes idempotent', () => {
    const streamRouteSource = readFileSync(
      new URL('../../routes/stream.ts', import.meta.url),
      'utf8',
    );
    const toolResultWrite = streamRouteSource.match(
      /appendSessionMessageV2\(\{[\s\S]*?role: 'tool',[\s\S]*?clientRequestId: createToolResultRequestId\(input\.clientRequestId, toolCallId\),[\s\S]*?replaceExisting: true,[\s\S]*?\}\);/,
    );

    expect(toolResultWrite).not.toBeNull();
  });

  it('keeps stream error writes idempotent', () => {
    const streamRouteSource = readFileSync(
      new URL('../../routes/stream.ts', import.meta.url),
      'utf8',
    );
    const streamModelRoundSource = readFileSync(
      new URL('../../routes/stream-model-round.ts', import.meta.url),
      'utf8',
    );

    expect(streamRouteSource).toMatch(
      /buildErrorContent\('STREAM_ERROR', String\(err\)\)[\s\S]*?replaceExisting: true/,
    );
    // The error message argument was refactored behind
    // `buildUserFacingStreamErrorMessage(...)`; the invariant guarded here is
    // that both upstream-error and generic stream-error writes still go
    // through `buildErrorContent` and set `replaceExisting: true` (idempotent
    // re-write of the same request-scoped assistant message). Match any
    // single message identifier so a future rename does not silently drop
    // the idempotency assertion.
    expect(streamModelRoundSource).toMatch(
      /buildErrorContent\('V2_UPSTREAM_ERROR', \w+(?:, \w+)?\)[\s\S]*?replaceExisting: true/,
    );
    expect(streamModelRoundSource).toMatch(
      /buildErrorContent\('STREAM_ERROR', \w+(?:, \w+)?\)[\s\S]*?replaceExisting: true/,
    );
  });

  it('keeps final assistant writes idempotent for the same request scope', () => {
    const streamModelRoundSource = readFileSync(
      new URL('../../routes/stream-model-round.ts', import.meta.url),
      'utf8',
    );

    expect(streamModelRoundSource).toMatch(
      /appendSessionMessageV2\(\{[\s\S]*?role: 'assistant',[\s\S]*?clientRequestId:[\s\S]*?replaceExisting: true,[\s\S]*?modelID: input\.route\.model/ms,
    );
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

  it('trims legacy compaction marker history and keeps its retained tail', () => {
    const result = filterCompacted([
      textMessage('old-1', 'user', '旧历史 1'),
      textMessage('tail-1', 'user', '近期历史 1'),
      textMessage('tail-2', 'assistant', '近期回复 2'),
      legacyCompactionMarker('compact-1', '压缩摘要', 'tail-1'),
      textMessage('new-1', 'user', '压缩后的新问题'),
    ]);

    expect(result.map((message) => message.info.id)).toEqual([
      'compact-1',
      'tail-1',
      'tail-2',
      'new-1',
    ]);
  });

  it('converts legacy compaction marker to summary context instead of sending marker JSON', () => {
    const filtered = filterCompacted([
      textMessage('old-1', 'user', '旧历史 1'),
      textMessage('tail-1', 'user', '近期历史 1'),
      legacyCompactionMarker('compact-1', '压缩摘要', 'tail-1'),
      textMessage('new-1', 'user', '压缩后的新问题'),
    ]);

    expect(toModelMessages(filtered)).toEqual([
      { role: 'user', content: 'What did we do so far?' },
      { role: 'assistant', content: '压缩摘要' },
      { role: 'user', content: '近期历史 1' },
      { role: 'user', content: '压缩后的新问题' },
    ]);
  });

  it('does not send persisted assistant-event or command-card mirrors to the model', () => {
    const assistantEvent = textMessage('assistant-event-1', 'assistant', '压缩展示卡片');
    assistantEvent.info.clientRequestId = 'assistant_event:compaction:run-1';
    const commandCard = textMessage('command-card-1', 'assistant', '命令结果展示卡片');
    commandCard.info.clientRequestId = 'command-card:slash-compact:run-1';
    const user = textMessage('user-1', 'user', '继续执行');

    expect(toModelMessages([assistantEvent, commandCard, user])).toEqual([
      { role: 'user', content: '继续执行' },
    ]);
  });

  it('uses the newest legacy marker when an older marker is inside the retained tail', () => {
    const result = filterCompacted([
      textMessage('old-1', 'user', '旧历史 1'),
      legacyCompactionMarker('compact-1', '第一次摘要'),
      textMessage('tail-1', 'user', '保留的近期历史'),
      legacyCompactionMarker('compact-2', '第二次摘要', 'compact-1'),
      textMessage('new-1', 'user', '压缩后的新问题'),
    ]);

    expect(result.map((message) => message.info.id)).toEqual([
      'compact-2',
      'compact-1',
      'tail-1',
      'new-1',
    ]);
  });

  it('falls back to the latest legacy marker when its tail anchor is missing', () => {
    const result = filterCompacted([
      textMessage('old-1', 'user', '旧历史 1'),
      textMessage('old-2', 'assistant', '旧回复 2'),
      legacyCompactionMarker('compact-1', '压缩摘要', 'missing-tail'),
      textMessage('new-1', 'user', '压缩后的新问题'),
    ]);

    expect(result.map((message) => message.info.id)).toEqual(['compact-1', 'new-1']);
  });

  it('keeps a newer V2 compaction boundary ahead of an older legacy marker in the tail', () => {
    const compaction = userMessage('compact-v2', [
      {
        id: asPartId('compact-v2-part'),
        sessionID: 'session-1',
        messageID: asMessageId('compact-v2'),
        type: 'compaction',
        auto: false,
        tailStartID: asMessageId('compact-1'),
      },
    ]);
    const result = filterCompacted([
      legacyCompactionMarker('compact-1', '第一次摘要'),
      textMessage('tail-1', 'user', '保留的近期历史'),
      compaction,
      assistantSummary('compact-v2-summary', 'compact-v2'),
      textMessage('new-1', 'user', '压缩后的新问题'),
    ]);

    expect(result.map((message) => message.info.id)).toEqual([
      'compact-v2',
      'compact-v2-summary',
      'compact-1',
      'tail-1',
      'new-1',
    ]);
  });

  // Regression: OpenAI Responses API tool_call cache stability.
  // The persisted-message → native upstream round-trip must preserve
  // `tool-call.providerMetadata.openai.itemId` (`fc_xxx`) all the
  // way through V1 (`ToolCallContent.providerMetadata`) → V2
  // (`ToolPart.metadata.providerMetadata`) → V1 (read path) →
  // unified (`AssistantToolCall.providerMetadata`) so the bridge
  // can rebuild `function_call.id` on later rounds. Otherwise the
  // upstream prompt-cache prefix from this point on misses on every
  // subsequent request after a tool call (the original bug report:
  // "搜索工具调用后缓存全失").
  it('persists tool_call.providerMetadata as ToolPart.metadata.providerMetadata on append', () => {
    mocks.sqliteGet.mockReturnValue({ max_seq: null });

    appendSessionMessageV2({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      messageId: 'message-tool-call',
      createdAt: 123,
      content: [
        {
          type: 'tool_call',
          toolCallId: 'call_websearch',
          toolName: 'web_search',
          input: { query: 'react 19' },
          providerMetadata: { openai: { itemId: 'fc_websearch_001' } },
        },
      ],
    });

    const partCreated = mocks.emitEvent.mock.calls.find(
      (call) =>
        (call[0] as { definition?: { type?: string } }).definition?.type === 'message.part.created',
    );
    expect(partCreated).toBeDefined();
    const part = (
      partCreated?.[0] as {
        data: { part: { type: string; metadata?: Record<string, unknown> } };
      }
    ).data.part;
    expect(part.type).toBe('tool');
    expect(part.metadata).toEqual({
      providerMetadata: { openai: { itemId: 'fc_websearch_001' } },
    });
  });

  it('round-trips ToolPart.metadata.providerMetadata into AssistantToolCall via toModelMessages', () => {
    const sessionId = 'session-1';
    const messageId = asMessageId('m-assistant-1');
    const message: MessageWithParts = {
      info: {
        id: messageId,
        sessionID: sessionId,
        role: 'assistant',
        time: { created: 1 },
        finish: 'stop',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          id: asPartId('p1'),
          sessionID: sessionId,
          messageID: messageId,
          type: 'tool',
          callID: 'call_websearch',
          tool: 'web_search',
          state: { status: 'pending', input: { query: 'r' }, raw: '{"query":"r"}' },
          metadata: {
            providerMetadata: { openai: { itemId: 'fc_websearch_001' } },
          },
        },
      ],
    };

    const unified = toModelMessages([message]);
    // toModelMessages may also synthesise a follow-up tool result
    // entry for any pending ToolPart (so the prompt is well-formed
    // even mid-flight); we only care that the assistant turn carries
    // the round-tripped providerMetadata.
    const assistant = unified.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    if (assistant?.role !== 'assistant') return;
    expect(assistant.toolCalls).toEqual([
      {
        id: 'call_websearch',
        name: 'web_search',
        arguments: '{"query":"r"}',
        providerMetadata: { openai: { itemId: 'fc_websearch_001' } },
      },
    ]);
  });

  it('drops ToolPart.metadata.providerMetadata when replaying against a different model', () => {
    const sessionId = 'session-1';
    const messageId = asMessageId('m-assistant-2');
    const message: MessageWithParts = {
      info: {
        id: messageId,
        sessionID: sessionId,
        role: 'assistant',
        time: { created: 1 },
        finish: 'stop',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        // Synthetic provider/model on the persisted assistant turn so
        // toModelMessages can recognise the cross-model replay case.
        providerID: 'openai',
        modelID: 'gpt-4o',
      },
      parts: [
        {
          id: asPartId('p1'),
          sessionID: sessionId,
          messageID: messageId,
          type: 'tool',
          callID: 'call_websearch',
          tool: 'web_search',
          state: { status: 'pending', input: {}, raw: '{}' },
          metadata: {
            providerMetadata: { openai: { itemId: 'fc_websearch_001' } },
          },
        },
      ],
    };

    const unified = toModelMessages([message], {
      currentModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
    });
    const assistant = unified.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    if (assistant?.role !== 'assistant') return;
    expect(assistant.toolCalls).toEqual([
      { id: 'call_websearch', name: 'web_search', arguments: '{}' },
    ]);
  });

  it('replays tool image attachments as a synthetic user image message', () => {
    const sessionId = 'session-1';
    const messageId = asMessageId('m-assistant-image-tool');
    const message: MessageWithParts = {
      info: {
        id: messageId,
        sessionID: sessionId,
        role: 'assistant',
        time: { created: 1 },
        finish: 'stop',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          id: asPartId('p-tool-image'),
          sessionID: sessionId,
          messageID: messageId,
          type: 'tool',
          callID: 'call_desktop_image',
          tool: 'desktop_control',
          state: {
            status: 'completed',
            input: { action: 'screenshot' },
            output: '{"success":true,"artifactId":"artifact-screen-1"}',
            title: 'desktop_control',
            metadata: {},
            time: { start: 1, end: 2 },
            attachments: [
              {
                id: asPartId('p-tool-image-attachment'),
                sessionID: sessionId,
                messageID: messageId,
                type: 'file',
                inputType: 'input_image',
                mime: 'image/png',
                artifactId: 'artifact-screen-1',
                filename: 'desktop-control-screenshot.png',
                url: '',
              },
            ],
          },
        },
      ],
    };

    expect(toModelMessages([message])).toEqual([
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          {
            id: 'call_desktop_image',
            name: 'desktop_control',
            arguments: '{"action":"screenshot"}',
          },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'call_desktop_image',
        toolName: 'desktop_control',
        content: '{"success":true,"artifactId":"artifact-screen-1"}',
      },
      {
        role: 'user',
        content: '[Tool returned the following attachments]',
        syntheticKind: 'tool-attachments',
        sourceToolCallId: 'call_desktop_image',
        images: [
          {
            artifactId: 'artifact-screen-1',
            fileName: 'desktop-control-screenshot.png',
            mimeType: 'image/png',
          },
        ],
      },
    ]);
  });

  it('re-truncates oversized desktop tool outputs when replaying to the model', () => {
    const sessionId = 'session-1';
    const messageId = asMessageId('m-assistant-desktop-truncate');
    const longOutput = 'x'.repeat(20_000);
    const message: MessageWithParts = {
      info: {
        id: messageId,
        sessionID: sessionId,
        role: 'assistant',
        time: { created: 1 },
        finish: 'stop',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          id: asPartId('p-tool-truncate'),
          sessionID: sessionId,
          messageID: messageId,
          type: 'tool',
          callID: 'call_desktop_truncate',
          tool: 'desktop_control',
          state: {
            status: 'completed',
            input: { action: 'click', x: 1, y: 2 },
            output: longOutput,
            title: 'desktop_control',
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
      ],
    };

    const toolResult = toModelMessages([message]).find(
      (entry): entry is Extract<ReturnType<typeof toModelMessages>[number], { role: 'tool' }> =>
        entry.role === 'tool',
    );

    expect(toolResult).toBeDefined();
    expect(toolResult?.content.length).toBeLessThan(longOutput.length);
    expect(toolResult?.content).toContain('[输出已截断');
  });

  it('replays Responses reasoning item metadata through the native message shape', () => {
    const sessionId = 'session-reasoning-item';
    const messageId = asMessageId('m-reasoning-item');
    const message: MessageWithParts = {
      info: {
        id: messageId,
        sessionID: sessionId,
        role: 'assistant',
        time: { created: 1 },
        finish: 'stop',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          id: asPartId('p-reasoning-item'),
          sessionID: sessionId,
          messageID: messageId,
          type: 'reasoning',
          text: 'summary-1',
          itemId: 'rs_metadata_reasoning:0',
          metadata: { encryptedContent: 'encrypted-1', summary: 'summary-1' },
          time: { start: 1, end: 2 },
        },
      ],
    };

    expect(toModelMessages([message])).toEqual([
      {
        role: 'assistant',
        content: null,
        reasoning: {
          text: 'summary-1',
          itemId: 'rs_metadata_reasoning:0',
          encryptedContent: 'encrypted-1',
          summary: 'summary-1',
        },
      },
    ]);
    const native = unifiedConversationToNativeMessages(toModelMessages([message]));
    expect(native[0]?.content[0]).toMatchObject({
      type: 'reasoning',
      providerMetadata: {
        openai: {
          itemId: 'rs_metadata_reasoning:0',
          reasoningEncryptedContent: 'encrypted-1',
          summary: 'summary-1',
        },
      },
    });
  });
});
