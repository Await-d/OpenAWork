import { describe, expect, it } from 'vitest';
import type { LiveToolCallState } from './chat-page-utils.js';
import { applyStreamToolProgress, applyStreamToolResult } from './apply-stream-tool-event.js';

const GUI_SNAPSHOT = {
  type: 'input_image' as const,
  artifactId: 'artifact-gui-1',
  fileName: 'computer-use-final.png',
  mimeType: 'image/png',
};

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

  it('已完成的工具收到迟到 progress 时保持 completed，不写入新进度', () => {
    const liveToolCalls = new Map<string, LiveToolCallState>([
      [
        't1',
        {
          createdAt: 1,
          inputText: '{}',
          output: { exitCode: 0 },
          status: 'completed',
          toolCallId: 't1',
          toolName: 'bash',
        },
      ],
    ]);

    applyStreamToolProgress({
      event: {
        completedCount: 1,
        subTools: [{ index: 0, tool: 'bash', status: 'running', partialOutput: 'late' }],
        toolCallId: 't1',
        toolName: 'bash',
        totalCount: 1,
      },
      liveToolCalls,
    });

    const state = liveToolCalls.get('t1');
    expect(state?.status).toBe('completed');
    expect(state?.output).toEqual({ exitCode: 0 });
    expect(state?.batchProgress).toBeUndefined();
  });

  it('paused（待审批）工具收到批准后的 progress 会恢复 streaming', () => {
    const liveToolCalls = new Map<string, LiveToolCallState>([
      [
        't1',
        {
          createdAt: 1,
          inputText: '{}',
          status: 'paused',
          toolCallId: 't1',
          toolName: 'bash',
        },
      ],
    ]);

    applyStreamToolProgress({
      event: {
        completedCount: 0,
        subTools: [{ index: 0, tool: 'bash', status: 'running', partialOutput: 'running' }],
        toolCallId: 't1',
        toolName: 'bash',
        totalCount: 1,
      },
      liveToolCalls,
    });

    expect(liveToolCalls.get('t1')?.status).toBe('streaming');
    expect(liveToolCalls.get('t1')?.batchProgress?.subTools).toHaveLength(1);
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

  it('把 tool_result 的 attachments 同时写入 liveToolCalls 与 segments', () => {
    const liveToolCalls = new Map<string, LiveToolCallState>([
      [
        'gui-1',
        {
          createdAt: 1,
          inputText: '{"instruction":"打开系统设置"}',
          status: 'streaming' as const,
          toolCallId: 'gui-1',
          toolName: 'computer_use',
        },
      ],
    ]);

    const result = applyStreamToolResult({
      accumulatedSegments: [],
      event: {
        output: '{"success":true}',
        toolCallId: 'gui-1',
        toolName: 'computer_use',
        attachments: [GUI_SNAPSHOT],
      },
      hasPendingPermission: false,
      liveToolCalls,
    });

    expect(liveToolCalls.get('gui-1')?.attachments).toEqual([GUI_SNAPSHOT]);
    expect(result.accumulatedSegments[0]).toMatchObject({
      type: 'tool',
      toolCallId: 'gui-1',
      attachments: [GUI_SNAPSHOT],
    });
  });

  it('不带 attachments 时不写入字段，且保留上一次已写入的附件', () => {
    const liveToolCalls = new Map<string, LiveToolCallState>([
      [
        'gui-1',
        {
          createdAt: 1,
          inputText: '{}',
          status: 'streaming' as const,
          toolCallId: 'gui-1',
          toolName: 'computer_use',
        },
      ],
    ]);

    const first = applyStreamToolResult({
      accumulatedSegments: [],
      event: {
        output: '{"success":true}',
        toolCallId: 'gui-1',
        toolName: 'computer_use',
        attachments: [GUI_SNAPSHOT],
      },
      hasPendingPermission: false,
      liveToolCalls,
    });
    const second = applyStreamToolResult({
      accumulatedSegments: first.accumulatedSegments,
      event: {
        output: 'ok',
        toolCallId: 'gui-1',
        toolName: 'computer_use',
      },
      hasPendingPermission: false,
      liveToolCalls,
    });

    expect(liveToolCalls.get('gui-1')?.attachments).toEqual([GUI_SNAPSHOT]);
    expect(second.accumulatedSegments[0]).toMatchObject({
      type: 'tool',
      attachments: [GUI_SNAPSHOT],
    });
  });
});
