import { describe, expect, it } from 'vitest';
import {
  partsFromOrderedAssistantContent,
  readAssistantTracePayload,
  reconcileSnapshotChatMessages,
  type ChatMessage,
} from '../messages/support.js';
import { appendStreamingTextDelta, upsertStreamingToolSegment } from './streaming-segments.js';

describe('实时消息与快照同步', () => {
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
});
