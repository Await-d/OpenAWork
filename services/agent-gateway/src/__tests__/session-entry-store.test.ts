import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent, StreamChunk } from '@openAwork/shared';

// ─── In-memory db mock — mirrors the pattern used by message-v2-store.test.ts ───

interface SessionEntryRow {
  id: string;
  session_id: string;
  user_id: string;
  client_request_id: string | null;
  seq: number;
  type: string;
  timestamp: number;
  data: string;
}

interface SessionRow {
  id: string;
  user_id: string;
}

let sessionRows: SessionRow[] = [];
let entryRows: SessionEntryRow[] = [];

vi.mock('../db.js', () => ({
  sqliteRun: (...args: unknown[]) => {
    const [sql, params] = args as [string, unknown[]];
    if (sql.includes('INSERT') && sql.includes('session_entry')) {
      entryRows.push({
        id: params[0] as string,
        session_id: params[1] as string,
        user_id: params[2] as string,
        client_request_id: (params[3] as string | null) ?? null,
        seq: params[4] as number,
        type: params[5] as string,
        timestamp: params[6] as number,
        data: params[7] as string,
      });
    }
  },
  sqliteGet: (...args: unknown[]) => {
    const [sql, params] = args as [string, unknown[]];
    if (sql.includes('FROM sessions WHERE id')) {
      const row = sessionRows.find((r) => r.id === params[0]);
      return row ? { user_id: row.user_id } : undefined;
    }
    if (sql.includes('MAX(seq)')) {
      const sessionId = params[0] as string;
      const matching = entryRows.filter((r) => r.session_id === sessionId);
      const max = matching.reduce<number | null>((acc, row) => {
        return acc === null || row.seq > acc ? row.seq : acc;
      }, null);
      return { max_seq: max };
    }
    return undefined;
  },
  sqliteAll: (...args: unknown[]) => {
    const [sql, params] = args as [string, unknown[]];
    if (sql.includes('FROM session_entry')) {
      const sessionId = params[0] as string;
      const filtered = entryRows.filter((r) => r.session_id === sessionId);
      return filtered.sort((a, b) => a.seq - b.seq);
    }
    return [];
  },
  sqliteTransaction: (fn: () => void) => fn(),
}));

import {
  appendSessionEvent,
  createStreamSessionEventState,
  listSessionEvents,
  persistStreamChunkAsSessionEvents,
  replaySessionEntries,
  translateRunEventToSessionEvent,
  translateStreamChunkToSessionEvents,
} from '../session-entry-store.js';
import type {
  SessionEvent,
  SessionEventID,
} from '../session-event.js';

beforeEach(() => {
  sessionRows = [{ id: 'session-1', user_id: 'user-1' }];
  entryRows = [];
});

describe('session-entry-store', () => {
  it('appendSessionEvent persists and getSeq increments per session', () => {
    const a = appendSessionEvent({
      sessionId: 'session-1',
      event: {
        id: 'evt-1' as SessionEventID,
        type: 'text.delta',
        timestamp: 100,
        delta: 'hi',
      },
    });
    const b = appendSessionEvent({
      sessionId: 'session-1',
      event: {
        id: 'evt-2' as SessionEventID,
        type: 'text.delta',
        timestamp: 101,
        delta: 'there',
      },
    });
    expect(a?.id).toBe('evt-1');
    expect(b?.id).toBe('evt-2');
    expect(entryRows).toHaveLength(2);
    expect(entryRows[0]!.seq).toBe(1);
    expect(entryRows[1]!.seq).toBe(2);
  });

  it('appendSessionEvent returns null when the session is unknown', () => {
    const result = appendSessionEvent({
      sessionId: 'session-missing',
      event: {
        id: 'evt-x' as SessionEventID,
        type: 'text.delta',
        timestamp: 1,
        delta: '?',
      },
    });
    expect(result).toBeNull();
    expect(entryRows).toHaveLength(0);
  });

  it('listSessionEvents decodes rows back into the SessionEvent union', () => {
    appendSessionEvent({
      sessionId: 'session-1',
      event: {
        id: 'evt-text' as SessionEventID,
        type: 'text.delta',
        timestamp: 100,
        delta: 'hello',
      },
    });
    appendSessionEvent({
      sessionId: 'session-1',
      event: {
        id: 'evt-tool' as SessionEventID,
        type: 'tool.success',
        timestamp: 101,
        callID: 'call-x',
        title: 'read',
        output: 'ok',
        provider: { executed: true },
      },
    });
    const events = listSessionEvents({ sessionId: 'session-1' });
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('text.delta');
    expect(events[1]!.type).toBe('tool.success');
  });

  it('replaySessionEntries reconstructs an assistant entry from persisted events', () => {
    const persist = (event: SessionEvent) =>
      appendSessionEvent({ sessionId: 'session-1', event });

    persist({
      id: 'e1' as SessionEventID,
      type: 'prompt',
      timestamp: 1,
      text: 'hi',
    });
    persist({
      id: 'e2' as SessionEventID,
      type: 'step.started',
      timestamp: 2,
      model: { id: 'gpt', providerID: 'openai' },
    });
    persist({ id: 'e3' as SessionEventID, type: 'text.delta', timestamp: 3, delta: 'world' });
    persist({
      id: 'e4' as SessionEventID,
      type: 'step.ended',
      timestamp: 4,
      reason: 'end_turn',
      cost: 0,
      tokens: { input: 0, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    });

    const entries = replaySessionEntries('session-1');
    expect(entries.map((e) => e.type)).toEqual(['user', 'assistant']);
    if (entries[1]!.type === 'assistant') {
      expect(entries[1]!.content).toEqual([{ type: 'text', text: 'world' }]);
    }
  });

  describe('translateRunEventToSessionEvent', () => {
    it('maps a successful tool_result RunEvent to tool.success', () => {
      const runEvent: RunEvent = {
        type: 'tool_result',
        toolCallId: 'c1',
        toolName: 'read',
        output: 'file body',
        isError: false,
      };
      const event = translateRunEventToSessionEvent({
        event: runEvent,
        fallbackTimestamp: 50,
      });
      expect(event?.type).toBe('tool.success');
      if (event?.type === 'tool.success') {
        expect(event.callID).toBe('c1');
        expect(event.output).toBe('file body');
        expect(event.title).toBe('read');
      }
    });

    it('maps a failing tool_result RunEvent to tool.error', () => {
      const runEvent: RunEvent = {
        type: 'tool_result',
        toolCallId: 'c2',
        toolName: 'shell',
        output: 'permission denied',
        isError: true,
      };
      const event = translateRunEventToSessionEvent({ event: runEvent });
      expect(event?.type).toBe('tool.error');
      if (event?.type === 'tool.error') {
        expect(event.callID).toBe('c2');
        expect(event.error).toBe('permission denied');
      }
    });

    it('maps a completed compaction RunEvent to compacted with overflow when applicable', () => {
      const runEvent: RunEvent = {
        type: 'compaction',
        summary: 'done',
        trigger: 'automatic',
        phase: 'completed',
        cause: 'usage_overflow',
      };
      const event = translateRunEventToSessionEvent({ event: runEvent });
      expect(event?.type).toBe('compacted');
      if (event?.type === 'compacted') {
        expect(event.auto).toBe(true);
        expect(event.overflow).toBe(true);
      }
    });

    it('skips compaction phases that are not "completed"', () => {
      const event = translateRunEventToSessionEvent({
        event: {
          type: 'compaction',
          summary: 'starting',
          trigger: 'manual',
          phase: 'started',
        },
      });
      expect(event).toBeNull();
    });

    it('returns null for RunEvents without an opencode counterpart', () => {
      expect(
        translateRunEventToSessionEvent({
          event: { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2, round: 0 },
        }),
      ).toBeNull();
    });
  });

  describe('translateStreamChunkToSessionEvents', () => {
    it('emits text.started exactly once before subsequent text.delta events', () => {
      const state = createStreamSessionEventState();
      const first: StreamChunk = { type: 'text_delta', delta: 'A' };
      const second: StreamChunk = { type: 'text_delta', delta: 'B' };
      const evts1 = translateStreamChunkToSessionEvents(first, state, 100);
      const evts2 = translateStreamChunkToSessionEvents(second, state, 101);
      expect(evts1.map((e) => e.type)).toEqual(['text.started', 'text.delta']);
      expect(evts2.map((e) => e.type)).toEqual(['text.delta']);
    });

    it('emits tool.input.started exactly once per callID', () => {
      const state = createStreamSessionEventState();
      const first: StreamChunk = {
        type: 'tool_call_delta',
        toolCallId: 'c1',
        toolName: 'read',
        inputDelta: '{"x":',
      };
      const second: StreamChunk = {
        type: 'tool_call_delta',
        toolCallId: 'c1',
        toolName: 'read',
        inputDelta: '1}',
      };
      const evts1 = translateStreamChunkToSessionEvents(first, state, 100);
      const evts2 = translateStreamChunkToSessionEvents(second, state, 101);
      expect(evts1.map((e) => e.type)).toEqual(['tool.input.started', 'tool.input.delta']);
      expect(evts2.map((e) => e.type)).toEqual(['tool.input.delta']);
    });

    it('resets reasoning state on thinking_end so the next thinking_start can re-open', () => {
      const state = createStreamSessionEventState();
      translateStreamChunkToSessionEvents(
        { type: 'thinking_start' },
        state,
        1,
      );
      translateStreamChunkToSessionEvents(
        { type: 'thinking_delta', delta: 'why' },
        state,
        2,
      );
      translateStreamChunkToSessionEvents({ type: 'thinking_end' }, state, 3);
      const reopened = translateStreamChunkToSessionEvents(
        { type: 'thinking_start' },
        state,
        4,
      );
      expect(reopened.map((e) => e.type)).toEqual(['reasoning.started']);
    });

    it('persistStreamChunkAsSessionEvents writes events into session_entry', () => {
      const state = createStreamSessionEventState();
      persistStreamChunkAsSessionEvents({
        sessionId: 'session-1',
        chunk: { type: 'text_delta', delta: 'hi' },
        state,
      });
      const types = listSessionEvents({ sessionId: 'session-1' }).map((e) => e.type);
      expect(types).toEqual(['text.started', 'text.delta']);
    });
  });
});
