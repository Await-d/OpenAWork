import { describe, expect, it } from 'vitest';
import { aggregateSessionEntries, type SessionEntryAssistant } from '../../session/session-entry.js';
import type { SessionEvent, SessionEventID } from '../../session/session-event.js';

function evt<T extends SessionEvent>(value: Omit<T, 'id'> & { id?: string }): T {
  return {
    ...(value as object),
    id: (value.id ?? `evt-${Math.random().toString(36).slice(2, 10)}`) as SessionEventID,
  } as T;
}

describe('aggregateSessionEntries', () => {
  it('emits a User entry from a prompt event', () => {
    const entries = aggregateSessionEntries([
      evt<Extract<SessionEvent, { type: 'prompt' }>>({
        type: 'prompt',
        timestamp: 100,
        text: 'hello',
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'user',
      text: 'hello',
      time: { created: 100 },
    });
  });

  it('emits a Synthetic entry from a synthetic event', () => {
    const entries = aggregateSessionEntries([
      evt<Extract<SessionEvent, { type: 'synthetic' }>>({
        type: 'synthetic',
        timestamp: 200,
        text: 'system reminder',
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'synthetic', text: 'system reminder' });
  });

  it('aggregates an Assistant entry from step + text deltas + step.ended', () => {
    const entries = aggregateSessionEntries([
      evt<Extract<SessionEvent, { type: 'step.started' }>>({
        type: 'step.started',
        timestamp: 1,
        model: { id: 'gpt-5', providerID: 'openai' },
      }),
      evt<Extract<SessionEvent, { type: 'text.started' }>>({ type: 'text.started', timestamp: 2 }),
      evt<Extract<SessionEvent, { type: 'text.delta' }>>({
        type: 'text.delta',
        timestamp: 3,
        delta: 'Hel',
      }),
      evt<Extract<SessionEvent, { type: 'text.delta' }>>({
        type: 'text.delta',
        timestamp: 4,
        delta: 'lo',
      }),
      evt<Extract<SessionEvent, { type: 'step.ended' }>>({
        type: 'step.ended',
        timestamp: 5,
        reason: 'end_turn',
        cost: 0,
        tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    ]);

    expect(entries).toHaveLength(1);
    const assistant = entries[0] as SessionEntryAssistant;
    expect(assistant.type).toBe('assistant');
    expect(assistant.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(assistant.tokens?.output).toBe(2);
    expect(assistant.time.completed).toBe(5);
  });

  it('models a tool call lifecycle through input deltas + tool.called + tool.success', () => {
    const entries = aggregateSessionEntries([
      evt<Extract<SessionEvent, { type: 'step.started' }>>({
        type: 'step.started',
        timestamp: 10,
        model: { id: 'claude', providerID: 'anthropic' },
      }),
      evt<Extract<SessionEvent, { type: 'tool.input.started' }>>({
        type: 'tool.input.started',
        timestamp: 11,
        callID: 'call-1',
        name: 'read',
      }),
      evt<Extract<SessionEvent, { type: 'tool.input.delta' }>>({
        type: 'tool.input.delta',
        timestamp: 12,
        callID: 'call-1',
        delta: '{"path":',
      }),
      evt<Extract<SessionEvent, { type: 'tool.input.delta' }>>({
        type: 'tool.input.delta',
        timestamp: 13,
        callID: 'call-1',
        delta: '"a.ts"}',
      }),
      evt<Extract<SessionEvent, { type: 'tool.called' }>>({
        type: 'tool.called',
        timestamp: 14,
        callID: 'call-1',
        tool: 'read',
        input: { path: 'a.ts' },
        provider: { executed: true },
      }),
      evt<Extract<SessionEvent, { type: 'tool.success' }>>({
        type: 'tool.success',
        timestamp: 15,
        callID: 'call-1',
        title: 'read',
        output: 'file contents',
        provider: { executed: true },
      }),
      evt<Extract<SessionEvent, { type: 'step.ended' }>>({
        type: 'step.ended',
        timestamp: 16,
        reason: 'tool_use',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    ]);

    expect(entries).toHaveLength(1);
    const assistant = entries[0] as SessionEntryAssistant;
    expect(assistant.content).toHaveLength(1);
    const tool = assistant.content[0]!;
    expect(tool.type).toBe('tool');
    if (tool.type !== 'tool') return;
    expect(tool.callID).toBe('call-1');
    expect(tool.state.status).toBe('completed');
    if (tool.state.status === 'completed') {
      expect(tool.state.input).toEqual({ path: 'a.ts' });
      expect(tool.state.output).toBe('file contents');
    }
    expect(tool.time.completed).toBe(15);
  });

  it('falls back to error state when tool.error is observed', () => {
    const entries = aggregateSessionEntries([
      evt<Extract<SessionEvent, { type: 'step.started' }>>({
        type: 'step.started',
        timestamp: 1,
        model: { id: 'm', providerID: 'p' },
      }),
      evt<Extract<SessionEvent, { type: 'tool.called' }>>({
        type: 'tool.called',
        timestamp: 2,
        callID: 'call-bad',
        tool: 'shell',
        input: { cmd: 'ls' },
        provider: { executed: true },
      }),
      evt<Extract<SessionEvent, { type: 'tool.error' }>>({
        type: 'tool.error',
        timestamp: 3,
        callID: 'call-bad',
        error: 'permission denied',
        provider: { executed: true },
      }),
      evt<Extract<SessionEvent, { type: 'step.ended' }>>({
        type: 'step.ended',
        timestamp: 4,
        reason: 'error',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    ]);

    const assistant = entries[0] as SessionEntryAssistant;
    const tool = assistant.content[0]!;
    if (tool.type !== 'tool') throw new Error('expected tool');
    expect(tool.state.status).toBe('error');
    if (tool.state.status === 'error') {
      expect(tool.state.error).toBe('permission denied');
      expect(tool.state.input).toEqual({ cmd: 'ls' });
    }
  });

  it('emits a Compaction entry from a compacted event', () => {
    const entries = aggregateSessionEntries([
      evt<Extract<SessionEvent, { type: 'compacted' }>>({
        type: 'compacted',
        timestamp: 999,
        auto: false,
        overflow: true,
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'compaction',
      auto: false,
      overflow: true,
      time: { created: 999 },
    });
  });

  it('attaches retried events to the open assistant aggregate', () => {
    const entries = aggregateSessionEntries([
      evt<Extract<SessionEvent, { type: 'step.started' }>>({
        type: 'step.started',
        timestamp: 1,
        model: { id: 'm', providerID: 'p' },
      }),
      evt<Extract<SessionEvent, { type: 'retried' }>>({
        type: 'retried',
        timestamp: 2,
        attempt: 1,
        error: { message: '5xx', isRetryable: true },
      }),
      evt<Extract<SessionEvent, { type: 'step.ended' }>>({
        type: 'step.ended',
        timestamp: 3,
        reason: 'end_turn',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    ]);
    const assistant = entries[0] as SessionEntryAssistant;
    expect(assistant.retries).toEqual([
      { attempt: 1, error: { message: '5xx', isRetryable: true }, time: { created: 2 } },
    ]);
  });

  it('produces multiple turns in chronological order', () => {
    const entries = aggregateSessionEntries([
      evt<Extract<SessionEvent, { type: 'prompt' }>>({
        type: 'prompt',
        timestamp: 1,
        text: 'q1',
      }),
      evt<Extract<SessionEvent, { type: 'step.started' }>>({
        type: 'step.started',
        timestamp: 2,
        model: { id: 'm', providerID: 'p' },
      }),
      evt<Extract<SessionEvent, { type: 'text.delta' }>>({
        type: 'text.delta',
        timestamp: 3,
        delta: 'a1',
      }),
      evt<Extract<SessionEvent, { type: 'step.ended' }>>({
        type: 'step.ended',
        timestamp: 4,
        reason: 'end_turn',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
      evt<Extract<SessionEvent, { type: 'prompt' }>>({
        type: 'prompt',
        timestamp: 5,
        text: 'q2',
      }),
    ]);
    expect(entries.map((e) => e.type)).toEqual(['user', 'assistant', 'user']);
  });
});
