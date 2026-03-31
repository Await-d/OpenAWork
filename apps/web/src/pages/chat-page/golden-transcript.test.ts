import { describe, expect, it } from 'vitest';

import { normalizeChatMessages } from './support.js';

describe('golden transcript baseline', () => {
  it('keeps canonical tool transcript stable for durable replay', () => {
    const transcript = normalizeChatMessages([
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1,
        content: [
          { type: 'text', text: '我先搜索，再等待权限。' },
          {
            type: 'tool_call',
            toolCallId: 'call-search',
            toolName: 'codesearch',
            input: { query: 'fastify sse example' },
          },
          {
            type: 'tool_call',
            toolCallId: 'call-task',
            toolName: 'task',
            input: { prompt: 'inspect workspace' },
          },
        ],
      },
      {
        id: 'tool-search',
        role: 'tool',
        createdAt: 2,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-search',
            toolName: 'codesearch',
            output: 'snippet',
            isError: false,
          },
        ],
      },
      {
        id: 'tool-task',
        role: 'tool',
        createdAt: 3,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-task',
            toolName: 'task',
            output: 'waiting for approval',
            isError: false,
            pendingPermissionRequestId: 'perm-1',
          },
        ],
      },
    ]);

    expect(transcript).toMatchInlineSnapshot(`
      [
        {
          "content": "{\"type\":\"assistant_trace\",\"payload\":{\"text\":\"我先搜索，再等待权限。\",\"toolCalls\":[{\"toolCallId\":\"call-search\",\"toolName\":\"codesearch\",\"input\":{\"query\":\"fastify sse example\"},\"output\":\"snippet\",\"isError\":false,\"status\":\"completed\"},{\"toolCallId\":\"call-task\",\"toolName\":\"task\",\"input\":{\"prompt\":\"inspect workspace\"},\"output\":\"waiting for approval\",\"isError\":false,\"pendingPermissionRequestId\":\"perm-1\",\"status\":\"paused\"}]}}",
          "createdAt": 1,
          "durationMs": undefined,
          "firstTokenLatencyMs": undefined,
          "id": "assistant-1",
          "model": undefined,
          "modifiedFilesSummary": undefined,
          "providerId": undefined,
          "role": "assistant",
          "status": "completed",
          "stopReason": undefined,
          "tokenEstimate": 3,
          "toolCallCount": 2,
        },
      ]
    `);
  });
});
