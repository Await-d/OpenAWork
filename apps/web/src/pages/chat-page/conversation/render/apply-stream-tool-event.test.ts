import { describe, expect, it } from 'vitest';
import { applyStreamToolProgress, applyStreamToolResult } from './apply-stream-tool-event.js';

describe('applyStreamToolProgress', () => {
  it('会写入 batchProgress 到 liveToolCalls', () => {
    const liveToolCalls = new Map();
    applyStreamToolProgress({
      event: {
        completedCount: 1,
        subTools: [],
        toolCallId: 't1',
        toolName: 'tool-a',
        totalCount: 2,
      },
      liveToolCalls,
    });

    expect(liveToolCalls.get('t1')?.batchProgress?.totalCount).toBe(2);
  });
});

describe('applyStreamToolResult', () => {
  it('会更新 liveToolCalls 并返回新的 segments', () => {
    const liveToolCalls = new Map([
      [
        't1',
        {
          createdAt: 1,
          inputText: '{}',
          status: 'streaming' as const,
          toolCallId: 't1',
          toolName: 'tool-a',
        },
      ],
    ]);
    const result = applyStreamToolResult({
      accumulatedSegments: [],
      event: {
        output: { ok: true },
        toolCallId: 't1',
        toolName: 'tool-a',
      },
      hasPendingPermission: false,
      liveToolCalls,
    });

    expect(liveToolCalls.get('t1')?.status).toBe('completed');
    expect(Array.isArray(result.accumulatedSegments)).toBe(true);
  });
});
