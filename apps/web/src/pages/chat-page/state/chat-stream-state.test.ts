import { describe, expect, it } from 'vitest';

import { buildChatRightPanelStateFromRunEvents } from './chat-stream-state.js';

describe('buildChatRightPanelStateFromRunEvents', () => {
  it('从 done/error 事件重建 upstreamSummary 历史', () => {
    const state = buildChatRightPanelStateFromRunEvents({
      goal: '修复流式摘要',
      events: [
        {
          type: 'done',
          stopReason: 'end_turn',
          requestId: 'req-1',
          runId: 'run-1',
          occurredAt: 100,
          upstreamSummary: {
            stopReason: 'end_turn',
            textDeltaCount: 3,
            reasoningDeltaCount: 1,
            toolCallDeltaCount: 0,
            sawDone: true,
            sawError: false,
            stalled: false,
          },
        },
        {
          type: 'error',
          code: 'STREAM_ERROR',
          message: 'boom',
          requestId: 'req-2',
          runId: 'run-2',
          occurredAt: 200,
          upstreamSummary: {
            stopReason: 'error',
            textDeltaCount: 0,
            reasoningDeltaCount: 0,
            toolCallDeltaCount: 1,
            sawDone: false,
            sawError: true,
            stalled: true,
          },
        },
      ],
    });

    expect(state.upstreamSummaries).toHaveLength(2);
    expect(state.upstreamSummaries[0]?.summary.stopReason).toBe('error');
    expect(state.upstreamSummaries[1]?.summary.stopReason).toBe('end_turn');
    expect(state.upstreamSummaries[0]?.summary.stalled).toBe(true);
    expect(state.upstreamSummaries[0]?.summary.toolCallDeltaCount).toBe(1);
    expect(state.upstreamSummaries[0]?.requestId).toBe('req-2');
    expect(state.upstreamSummaries[1]?.requestId).toBe('req-1');
  });

  it('tool_result 会把 requestId 绑定到工具调用条目上', () => {
    const state = buildChatRightPanelStateFromRunEvents({
      goal: '按请求过滤工具调用',
      events: [
        {
          type: 'tool_call_delta',
          toolCallId: 'call-1',
          toolName: 'read_file',
          inputDelta: '{"path":"a.ts"}',
        },
        {
          type: 'tool_result',
          toolCallId: 'call-1',
          toolName: 'read_file',
          clientRequestId: 'req-tools-1',
          output: { ok: true },
          isError: false,
        },
      ],
    });

    expect(state.toolCalls[0]?.requestId).toBe('req-tools-1');
  });

  it('tool_call_delta 在工具尚未完成时也会携带 requestId', () => {
    const state = buildChatRightPanelStateFromRunEvents({
      goal: '工具调用即时聚焦',
      events: [
        {
          type: 'tool_call_delta',
          toolCallId: 'call-live-1',
          toolName: 'edit_file',
          requestId: 'req-live-1',
          inputDelta: '{"path":"a.ts"}',
        },
      ],
    });

    expect(state.toolCalls[0]?.requestId).toBe('req-live-1');
  });

  it('question/permission/tool 相关 agentEvents 会携带 requestId', () => {
    const state = buildChatRightPanelStateFromRunEvents({
      goal: 'viz 聚焦 request',
      events: [
        {
          type: 'permission_asked',
          requestId: 'req-viz-1',
          toolName: 'edit_file',
          scope: 'src/a.ts',
          reason: '写入文件',
          riskLevel: 'medium',
          previewAction: '写入文件',
        },
        {
          type: 'question_replied',
          requestId: 'req-viz-2',
          status: 'answered',
        },
        {
          type: 'tool_result',
          toolCallId: 'call-2',
          toolName: 'read_file',
          clientRequestId: 'req-viz-3',
          output: { ok: true },
          isError: false,
        },
      ],
    });

    expect(state.agentEvents.some((event) => event.requestId === 'req-viz-1')).toBe(true);
    expect(state.agentEvents.some((event) => event.requestId === 'req-viz-2')).toBe(true);
    expect(state.agentEvents.some((event) => event.requestId === 'req-viz-3')).toBe(true);
  });
});
