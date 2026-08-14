import { describe, expect, test } from 'vitest';
import type { ChatMessage } from './support.js';
import {
  detectCrossMessageToolGroups,
  shouldHideMessageInToolGroup,
  getToolCallsForMessage,
} from './group-cross-message-tools.js';

function createToolCallMessage(
  id: string,
  toolName: string,
  kind?: 'tool' | 'mcp' | 'skill',
): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: JSON.stringify({
      type: 'assistant_trace',
      payload: {
        text: '',
        toolCalls: [
          {
            toolCallId: `${id}-tool`,
            toolName,
            kind,
            input: {},
            output: null,
            status: 'completed',
          },
        ],
      },
    }),
    createdAt: Date.now(),
    toolCallCount: 1,
  };
}

function createMixedMessage(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: JSON.stringify({
      type: 'assistant_trace',
      payload: {
        text: 'Some text content',
        toolCalls: [
          {
            toolCallId: `${id}-tool`,
            toolName: 'bash',
            input: {},
            output: null,
            status: 'completed',
          },
        ],
      },
    }),
    createdAt: Date.now(),
    toolCallCount: 1,
  };
}

describe('detectCrossMessageToolGroups', () => {
  test('不合并单条消息', () => {
    const messages: ChatMessage[] = [createToolCallMessage('msg1', 'bash')];
    const result = detectCrossMessageToolGroups(messages);
    expect(result.size).toBe(0);
  });

  test('合并连续的相同工具类型消息', () => {
    const messages: ChatMessage[] = [
      createToolCallMessage('msg1', 'bash'),
      createToolCallMessage('msg2', 'bash'),
      createToolCallMessage('msg3', 'bash'),
    ];
    const result = detectCrossMessageToolGroups(messages);
    expect(result.size).toBe(1);
    expect(result.get(0)).toEqual([0, 1, 2]);
  });

  test('不合并不同工具类型', () => {
    const messages: ChatMessage[] = [
      createToolCallMessage('msg1', 'bash'),
      createToolCallMessage('msg2', 'read'),
      createToolCallMessage('msg3', 'bash'),
    ];
    const result = detectCrossMessageToolGroups(messages);
    expect(result.size).toBe(0);
  });

  test('合并连续的 MCP 工具（即使工具名不同）', () => {
    const messages: ChatMessage[] = [
      createToolCallMessage('msg1', 'mcp_tool_a', 'mcp'),
      createToolCallMessage('msg2', 'mcp_tool_b', 'mcp'),
      createToolCallMessage('msg3', 'mcp_tool_c', 'mcp'),
    ];
    const result = detectCrossMessageToolGroups(messages);
    expect(result.size).toBe(1);
    expect(result.get(0)).toEqual([0, 1, 2]);
  });

  test('不合并包含文本的消息', () => {
    const messages: ChatMessage[] = [
      createToolCallMessage('msg1', 'bash'),
      createMixedMessage('msg2'),
      createToolCallMessage('msg3', 'bash'),
    ];
    const result = detectCrossMessageToolGroups(messages);
    expect(result.size).toBe(0);
  });

  test('不合并非连续的消息', () => {
    const messages: ChatMessage[] = [
      createToolCallMessage('msg1', 'bash'),
      {
        id: 'user-msg',
        role: 'user',
        content: 'User message',
        createdAt: Date.now(),
      },
      createToolCallMessage('msg2', 'bash'),
    ];
    const result = detectCrossMessageToolGroups(messages);
    expect(result.size).toBe(0);
  });

  test('识别多个独立的合并组', () => {
    const messages: ChatMessage[] = [
      createToolCallMessage('msg1', 'bash'),
      createToolCallMessage('msg2', 'bash'),
      {
        id: 'user-msg',
        role: 'user',
        content: 'User message',
        createdAt: Date.now(),
      },
      createToolCallMessage('msg3', 'read'),
      createToolCallMessage('msg4', 'read'),
      createToolCallMessage('msg5', 'read'),
    ];
    const result = detectCrossMessageToolGroups(messages);
    expect(result.size).toBe(2);
    expect(result.get(0)).toEqual([0, 1]);
    expect(result.get(3)).toEqual([3, 4, 5]);
  });
});

describe('shouldHideMessageInToolGroup', () => {
  test('首条消息不隐藏', () => {
    const toolGroups = new Map([[0, [0, 1, 2]]]);
    expect(shouldHideMessageInToolGroup(0, toolGroups)).toBe(false);
  });

  test('非首条消息隐藏', () => {
    const toolGroups = new Map([[0, [0, 1, 2]]]);
    expect(shouldHideMessageInToolGroup(1, toolGroups)).toBe(true);
    expect(shouldHideMessageInToolGroup(2, toolGroups)).toBe(true);
  });

  test('不在合并组中的消息不隐藏', () => {
    const toolGroups = new Map([[0, [0, 1, 2]]]);
    expect(shouldHideMessageInToolGroup(3, toolGroups)).toBe(false);
  });
});

describe('getToolCallsForMessage', () => {
  test('返回合并组的所有工具调用', () => {
    const messages: ChatMessage[] = [
      createToolCallMessage('msg1', 'bash'),
      createToolCallMessage('msg2', 'bash'),
      createToolCallMessage('msg3', 'bash'),
    ];
    const toolGroups = new Map([[0, [0, 1, 2]]]);
    const result = getToolCallsForMessage(0, messages, toolGroups);
    expect(result.length).toBe(3);
    expect(result.map((tc) => tc.toolCallId)).toEqual(['msg1-tool', 'msg2-tool', 'msg3-tool']);
  });

  test('非合并组消息返回自己的工具调用', () => {
    const messages: ChatMessage[] = [
      createToolCallMessage('msg1', 'bash'),
      createToolCallMessage('msg2', 'read'),
    ];
    const toolGroups = new Map();
    const result = getToolCallsForMessage(1, messages, toolGroups);
    expect(result.length).toBe(1);
    expect(result[0]?.toolCallId).toBe('msg2-tool');
  });
});
