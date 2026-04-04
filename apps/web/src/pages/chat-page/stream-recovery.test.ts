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
      }),
    ).toBeNull();
  });
});
