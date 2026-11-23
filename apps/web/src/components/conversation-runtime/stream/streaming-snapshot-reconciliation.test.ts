import { describe, expect, it } from 'vitest';
import {
  contentFromParts,
  normalizeChatMessages,
  parseAssistantTraceContent,
  partsFromOrderedAssistantContent,
  readAssistantTracePayload,
  reconcileSnapshotChatMessages,
  type ChatMessage,
} from '../messages/support.js';
import { appendStreamingTextDelta, upsertStreamingToolSegment } from './streaming-segments.js';

describe('实时消息与快照同步', () => {
  it('跨消息 ID 的已完成快照按持久化顺序只保留一次工具前正文', () => {
    const localId = 'assistant-local';
    const persistedId = 'assistant-persisted';
    const text = '我查一下官网，确认它现在是做什么的。';
    const tool = { toolCallId: 'fetch-1', toolName: 'webfetch', input: {} };
    const attachments = [{ type: 'input_image' as const, artifactId: 'preview-1' }];
    const parts = upsertStreamingToolSegment(appendStreamingTextDelta([], text, localId), {
      ...tool,
      status: 'running',
      attachments,
    });
    const event = {
      id: 'local-event',
      type: 'event' as const,
      payload: {
        kind: 'tool' as const,
        status: 'success' as const,
        title: '工具事件',
        message: '',
      },
    };
    const local: ChatMessage = {
      id: localId,
      role: 'assistant',
      status: 'completed',
      content: contentFromParts(parts),
      parts: [...parts, event],
    };
    const snapshot = normalizeChatMessages([
      {
        id: persistedId,
        role: 'assistant',
        status: 'final',
        content: [
          { type: 'text', text },
          { type: 'tool_call', ...tool },
          { type: 'tool_result', ...tool, output: '网页内容', isError: false },
        ],
      },
    ]);

    const messages = reconcileSnapshotChatMessages([local], snapshot);

    expect(messages).toHaveLength(1);
    const [message] = messages;
    expect(message?.id).toBe(persistedId);
    expect.soft(message?.parts).toEqual([
      { type: 'text', id: `${persistedId}:text`, text },
      expect.objectContaining({
        type: 'tool',
        ...tool,
        status: 'completed',
        output: '网页内容',
        attachments,
      }),
      event,
    ]);
    expect(parseAssistantTraceContent(message?.content ?? '')).toMatchObject({
      text,
      toolCalls: [{ ...tool, status: 'completed', output: '网页内容' }],
    });
  });

  it('同一消息同步快照后首段文本只保留一次', () => {
    const id = 'assistant-1';
    const content = '这是实时回答';
    const local: ChatMessage = {
      id,
      role: 'assistant',
      content,
      status: 'completed',
      parts: appendStreamingTextDelta([], content, id),
    };
    const snapshot: ChatMessage = {
      ...local,
      parts: partsFromOrderedAssistantContent(id, [{ type: 'text', text: content }]),
    };

    const messages = reconcileSnapshotChatMessages([local], [snapshot]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toEqual(snapshot.parts);
    const message = messages[0];
    expect(message && readAssistantTracePayload(message)?.text).toBe(content);
  });

  it('工具分隔的相同文字保留两段且重复同步不额外追加', () => {
    const id = 'assistant-2';
    const text = '正在处理';
    const tool = { toolCallId: 'tool-1', toolName: 'read_file', input: {} };
    const parts = appendStreamingTextDelta(
      upsertStreamingToolSegment(appendStreamingTextDelta([], text, id), tool),
      text,
      id,
    );
    const local: ChatMessage = {
      id,
      role: 'assistant',
      content: text + text,
      status: 'completed',
      parts,
    };
    const snapshot: ChatMessage = {
      ...local,
      parts: partsFromOrderedAssistantContent(id, [
        { type: 'text', text },
        { type: 'tool_call', ...tool },
        { type: 'text', text },
      ]),
    };

    const messages = reconcileSnapshotChatMessages(
      reconcileSnapshotChatMessages([local], [snapshot]),
      [snapshot],
    );

    expect(messages[0]?.parts).toEqual(snapshot.parts);
    const message = messages[0];
    expect(message && readAssistantTracePayload(message)?.text).toBe(`${text}\n\n${text}`);
  });

  it('完整快照补齐较早文本时按快照顺序重排已有工具和文本 part', () => {
    const id = 'assistant-late-prefix';
    const tool = { toolCallId: 'tool-late-prefix', toolName: 'read_file', input: {} };
    // Attach 可能从事件窗口中段开始：客户端先看见工具，再看见工具后的文本。
    // 此时后置文本会暂时取得首个 text part ID。
    const localParts = appendStreamingTextDelta(
      upsertStreamingToolSegment([], tool),
      '工具之后',
      id,
    );
    const local: ChatMessage = {
      id,
      role: 'assistant',
      content: '工具之后',
      status: 'streaming',
      parts: localParts,
    };
    const snapshot: ChatMessage = {
      id,
      role: 'assistant',
      content: '工具之前工具之后',
      status: 'streaming',
      parts: partsFromOrderedAssistantContent(id, [
        { type: 'text', text: '工具之前' },
        { type: 'tool_call', ...tool },
        { type: 'text', text: '工具之后' },
      ]),
    };

    const [reconciled] = reconcileSnapshotChatMessages([local], [snapshot]);

    expect(reconciled?.parts?.map((part) => part.type)).toEqual(['text', 'tool', 'text']);
    expect(
      reconciled?.parts?.map((part) => {
        if (part.type === 'text') return part.text;
        if (part.type === 'tool') return part.toolName;
        return part.type;
      }),
    ).toEqual(['工具之前', 'read_file', '工具之后']);
  });

  it('完成快照没有新增 part 时保留实时事件顺序并吸收工具终态', () => {
    const id = 'assistant-completed-order';
    const localParts = partsFromOrderedAssistantContent(id, [
      { type: 'text', text: '工具之前' },
      { type: 'tool_call', toolCallId: 'completed-tool', toolName: 'bash', input: {} },
      { type: 'text', text: '工具之后' },
    ]);
    const snapshotParts = partsFromOrderedAssistantContent(id, [
      { type: 'text', text: '工具之前' },
      { type: 'text', text: '工具之后' },
      { type: 'tool_call', toolCallId: 'completed-tool', toolName: 'bash', input: {} },
      {
        type: 'tool_result',
        toolCallId: 'completed-tool',
        toolName: 'bash',
        output: 'ok',
        isError: false,
      },
    ]);
    const local: ChatMessage = {
      id,
      role: 'assistant',
      content: '工具之前工具之后',
      status: 'streaming',
      parts: localParts,
    };
    const snapshot: ChatMessage = {
      ...local,
      status: 'completed',
      parts: snapshotParts,
    };

    const [reconciled] = reconcileSnapshotChatMessages([local], [snapshot]);

    expect(reconciled?.parts?.map((part) => part.type)).toEqual(['text', 'tool', 'text']);
    expect(reconciled?.parts?.find((part) => part.type === 'tool')).toMatchObject({
      output: 'ok',
      status: 'completed',
    });
  });
});
