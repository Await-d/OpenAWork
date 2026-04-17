import { describe, expect, it } from 'vitest';
import { recoverActiveAssistantStream } from './stream-recovery.js';

describe('recoverActiveAssistantStream', () => {
  it('returns null when the session is no longer running', () => {
    expect(
      recoverActiveAssistantStream({
        runEvents: [
          {
            type: 'text_delta',
            delta: 'hello',
            runId: 'run-1',
            occurredAt: 1,
          },
        ],
        sessionStateStatus: 'idle',
        hasActiveStream: true,
        activeStreamStartedAt: 1,
      }),
    ).toBeNull();
  });

  it('rebuilds the latest active run text, thinking, and usage snapshot', () => {
    expect(
      recoverActiveAssistantStream({
        runEvents: [
          {
            type: 'text_delta',
            delta: 'old',
            runId: 'run-1',
            occurredAt: 1,
          },
          {
            type: 'done',
            stopReason: 'end_turn',
            runId: 'run-1',
            occurredAt: 2,
          },
          {
            type: 'thinking_delta',
            delta: '思考中',
            runId: 'run-2',
            occurredAt: 10,
          },
          {
            type: 'text_delta',
            delta: '新',
            runId: 'run-2',
            occurredAt: 11,
          },
          {
            type: 'text_delta',
            delta: '内容',
            runId: 'run-2',
            occurredAt: 12,
          },
          {
            type: 'usage',
            inputTokens: 9,
            outputTokens: 3,
            totalTokens: 12,
            round: 1,
            runId: 'run-2',
            occurredAt: 13,
          },
        ],
        sessionStateStatus: 'running',
        hasActiveStream: true,
        activeStreamStartedAt: 10,
      }),
    ).toEqual({
      startedAt: 10,
      text: '新内容',
      thinking: '思考中',
      usage: {
        inputTokens: 9,
        outputTokens: 3,
        totalTokens: 12,
        round: 1,
      },
    });
  });

  it('keeps tool-only runs recoverable while paused', () => {
    expect(
      recoverActiveAssistantStream({
        runEvents: [
          {
            type: 'tool_call_delta',
            toolCallId: 'tool-1',
            toolName: 'bash',
            inputDelta: '{"command":"pwd"}',
            runId: 'run-9',
            occurredAt: 20,
          },
        ],
        sessionStateStatus: 'paused',
        hasActiveStream: true,
        activeStreamStartedAt: 20,
      }),
    ).toEqual({
      startedAt: 20,
      text: '',
      thinking: '',
      usage: null,
    });
  });

  it('skips recovery when the latest run already finished', () => {
    expect(
      recoverActiveAssistantStream({
        runEvents: [
          {
            type: 'text_delta',
            delta: '完成',
            runId: 'run-3',
            occurredAt: 30,
          },
          {
            type: 'done',
            stopReason: 'end_turn',
            runId: 'run-3',
            occurredAt: 31,
          },
        ],
        sessionStateStatus: 'running',
        hasActiveStream: true,
        activeStreamStartedAt: 30,
      }),
    ).toBeNull();
  });

  it('returns null when the session is paused without an active runtime stream', () => {
    expect(
      recoverActiveAssistantStream({
        runEvents: [
          {
            type: 'text_delta',
            delta: '旧回复',
            runId: 'run-old',
            occurredAt: 1,
          },
        ],
        sessionStateStatus: 'paused',
        hasActiveStream: false,
        activeStreamStartedAt: null,
      }),
    ).toBeNull();
  });

  it('keeps running-session recovery available while the attach runtime is still being rediscovered', () => {
    expect(
      recoverActiveAssistantStream({
        runEvents: [
          {
            type: 'thinking_delta',
            delta: '继续恢复',
            runId: 'run-refresh',
            occurredAt: 40,
          },
          {
            type: 'text_delta',
            delta: '已恢复',
            runId: 'run-refresh',
            occurredAt: 41,
          },
        ],
        sessionStateStatus: 'running',
        hasActiveStream: false,
        activeStreamStartedAt: null,
      }),
    ).toEqual({
      startedAt: 40,
      text: '已恢复',
      thinking: '继续恢复',
      usage: null,
    });
  });

  it('ignores stale run events that happened before the current active stream started', () => {
    expect(
      recoverActiveAssistantStream({
        runEvents: [
          {
            type: 'text_delta',
            delta: '旧内容',
            runId: 'run-old',
            occurredAt: 5,
          },
          {
            type: 'tool_call_delta',
            toolCallId: 'tool-current',
            toolName: 'bash',
            inputDelta: '{"command":"ls"}',
            runId: 'run-current',
            occurredAt: 100,
          },
          {
            type: 'text_delta',
            delta: '当前内容',
            runId: 'run-current',
            occurredAt: 101,
          },
        ],
        sessionStateStatus: 'running',
        hasActiveStream: true,
        activeStreamStartedAt: 100,
      }),
    ).toEqual({
      startedAt: 100,
      text: '当前内容',
      thinking: '',
      usage: null,
    });
  });
});
