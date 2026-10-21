import { describe, expect, it } from 'vitest';

import {
  applyChatRightPanelChunk,
  buildChatRightPanelStateFromRunEvents,
  createInitialChatRightPanelState,
  getToolCallCards,
  startChatRightPanelRun,
} from './chat-stream-state.js';

const GUI_SNAPSHOT = {
  type: 'input_image' as const,
  artifactId: 'artifact-gui-1',
  fileName: 'computer-use-final.png',
  mimeType: 'image/png',
};

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

  it('tool_result 的 attachments 会写入工具条目并透传到 ToolCallCardModel', () => {
    const state = buildChatRightPanelStateFromRunEvents({
      goal: '展示 computer_use 最终截图',
      events: [
        {
          type: 'tool_call_delta',
          toolCallId: 'call-gui-1',
          toolName: 'computer_use',
          inputDelta: '{"instruction":"打开系统设置"}',
        },
        {
          type: 'tool_result',
          toolCallId: 'call-gui-1',
          toolName: 'computer_use',
          output: '{"success":true}',
          isError: false,
          attachments: [GUI_SNAPSHOT],
        },
      ],
    });

    expect(state.toolCalls[0]?.attachments).toEqual([GUI_SNAPSHOT]);
    expect(getToolCallCards(state)[0]?.attachments).toEqual([GUI_SNAPSHOT]);
  });

  it('tool_result 不带 attachments 时字段保持 undefined（其它工具不受影响）', () => {
    const state = buildChatRightPanelStateFromRunEvents({
      goal: '普通工具结果',
      events: [
        {
          type: 'tool_result',
          toolCallId: 'call-read-1',
          toolName: 'read',
          output: 'ok',
          isError: false,
        },
      ],
    });

    expect(state.toolCalls[0]?.toolName).toBe('read');
    expect(state.toolCalls[0]?.attachments).toBeUndefined();
    expect(getToolCallCards(state)[0]?.attachments).toBeUndefined();
  });

  it('tool_progress 不覆盖同一 toolCallId 已写入的 attachments', () => {
    const state = buildChatRightPanelStateFromRunEvents({
      goal: '批量工具进度',
      events: [
        {
          type: 'tool_result',
          toolCallId: 'call-gui-2',
          toolName: 'computer_use',
          output: '{"success":true}',
          isError: false,
          attachments: [GUI_SNAPSHOT],
        },
        {
          type: 'tool_progress',
          toolCallId: 'call-gui-2',
          toolName: 'computer_use',
          subTools: [],
          completedCount: 1,
          totalCount: 2,
        },
      ],
    });

    expect(state.toolCalls[0]?.attachments).toEqual([GUI_SNAPSHOT]);
  });

  it('tool_result 后迟到的 tool_progress 不把已完成工具改回 running', () => {
    const state = buildChatRightPanelStateFromRunEvents({
      goal: '迟到的进度事件',
      events: [
        {
          type: 'tool_result',
          toolCallId: 'call-late-1',
          toolName: 'bash',
          output: { exitCode: 0 },
          isError: false,
        },
        {
          type: 'tool_progress',
          toolCallId: 'call-late-1',
          toolName: 'bash',
          subTools: [{ index: 0, tool: 'bash', status: 'running', partialOutput: 'late output' }],
          completedCount: 0,
          totalCount: 1,
        },
      ],
    });

    expect(state.toolCalls[0]?.status).toBe('completed');
    expect(state.toolCalls[0]?.batchProgress).toBeUndefined();
  });

  it('paused 工具收到批准后的 progress 会恢复 running，并清掉审批占位', () => {
    const state = buildChatRightPanelStateFromRunEvents({
      goal: '审批恢复后的实时输出',
      events: [
        {
          type: 'tool_call_delta',
          toolCallId: 'call-paused-1',
          toolName: 'bash',
          inputDelta: '{"command":"bun test"}',
        },
        {
          type: 'tool_result',
          toolCallId: 'call-paused-1',
          toolName: 'bash',
          output: '等待审批',
          isError: false,
          pendingPermissionRequestId: 'perm-1',
        },
        {
          type: 'tool_progress',
          toolCallId: 'call-paused-1',
          toolName: 'bash',
          subTools: [{ index: 0, tool: 'bash', status: 'running', partialOutput: 'RESUMED' }],
          completedCount: 0,
          totalCount: 1,
        },
      ],
    });

    const toolCall = state.toolCalls[0];
    expect(toolCall?.status).toBe('running');
    expect(toolCall?.pendingPermissionRequestId).toBeUndefined();
    expect(toolCall?.batchProgress?.subTools[0]?.partialOutput).toBe('RESUMED');
    expect(state.planTasks[0]?.status).toBe('in_progress');
    expect(state.dagNodes.find((node) => node.id === 'call-paused-1')?.status).toBe('running');
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

  it('同一个 compaction runId 的 started/completed 只保留一个右侧压缩项', () => {
    const state = buildChatRightPanelStateFromRunEvents({
      goal: '压缩上下文',
      events: [
        {
          type: 'compaction',
          summary: '正在压缩会话上下文。',
          trigger: 'manual',
          phase: 'started',
          cause: 'manual',
          strategy: 'runtime_replace',
          runId: 'command:session-1:slash-compact:run-1',
          eventId: 'session-1:slash-compact:run-1:compaction:started',
          occurredAt: 100,
        },
        {
          type: 'compaction',
          summary: '已压缩较早消息。',
          trigger: 'manual',
          phase: 'completed',
          cause: 'manual',
          strategy: 'runtime_replace',
          compactedMessages: 12,
          representedMessages: 12,
          runId: 'command:session-1:slash-compact:run-1',
          eventId: 'session-1:slash-compact:run-1:compaction:completed',
          occurredAt: 200,
        },
      ],
    });

    expect(state.compactions).toHaveLength(1);
    expect(state.compactions[0]).toMatchObject({
      id: 'compaction:command:session-1:slash-compact:run-1',
      phase: 'completed',
      compactedMessages: 12,
      representedMessages: 12,
    });
  });
});

describe('applyChatRightPanelChunk — 流内非终态错误', () => {
  it('TOOL_ERROR 不结算面板：状态原地返回，不产生失败事件', () => {
    const running = startChatRightPanelRun(createInitialChatRightPanelState(), '继续跑');
    const next = applyChatRightPanelChunk(running, {
      type: 'error',
      code: 'TOOL_ERROR',
      message: 'Tool webfetch 的入参不是合法 JSON，已放弃本次调用',
    });

    expect(next).toBe(running);
  });

  it('终态 error 仍把面板结算为失败', () => {
    const running = startChatRightPanelRun(createInitialChatRightPanelState(), '继续跑');
    const next = applyChatRightPanelChunk(running, {
      type: 'error',
      code: 'MODEL_ERROR',
      message: '上游 500',
    });

    expect(next).not.toBe(running);
    expect(next.agentEvents.at(-1)?.label).toBe('流式响应失败');
    expect(next.dagNodes[0]?.status).toBe('failed');
  });

  it('TOOL_ERROR 携带上游摘要时只记录摘要，不结算为失败', () => {
    const running = startChatRightPanelRun(createInitialChatRightPanelState(), '继续跑');
    const next = applyChatRightPanelChunk(running, {
      type: 'error',
      code: 'TOOL_ERROR',
      message: 'Tool webfetch 的入参不是合法 JSON，已放弃本次调用',
      upstreamSummary: {
        stopReason: 'error',
        textDeltaCount: 1,
        reasoningDeltaCount: 0,
        toolCallDeltaCount: 1,
        sawDone: false,
        sawError: true,
        stalled: false,
      },
    });

    expect(next).not.toBe(running);
    expect(next.upstreamSummaries).toHaveLength(1);
    expect(next.agentEvents.some((event) => event.type === 'agent_error')).toBe(false);
  });

  it('历史重建（刷新路径）遇到 TOOL_ERROR 不污染面板终态', () => {
    const state = buildChatRightPanelStateFromRunEvents({
      goal: '畸形工具入参后继续',
      events: [
        {
          type: 'tool_call_delta',
          toolCallId: 'call-webfetch-1',
          toolName: 'webfetch',
          inputDelta: '{"url"',
        },
        {
          type: 'error',
          code: 'TOOL_ERROR',
          message: 'Tool webfetch 的入参不是合法 JSON，已放弃本次调用',
        },
        { type: 'done', stopReason: 'end_turn' },
      ],
    });

    expect(state.agentEvents.some((event) => event.type === 'agent_error')).toBe(false);
    expect(state.agentEvents.at(-1)?.label).toBe('流式响应完成');
    expect(state.dagNodes[0]?.status).toBe('completed');
  });
});
