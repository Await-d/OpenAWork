// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type {
  ChatMessage,
  ChatToolPart,
} from '../../../../components/conversation-runtime/messages/support.js';
import { deduplicateOverlappingMessages } from './use-chat-render-data.js';

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return { content: '', role: 'assistant', ...overrides };
}

function toolPart(id: string, toolCallId: string): ChatToolPart {
  return { id, input: {}, toolCallId, toolName: 'read', type: 'tool' };
}

function ids(messages: ChatMessage[]): string[] {
  return messages.map((item) => item.id);
}

describe('deduplicateOverlappingMessages', () => {
  it('id 相同的 user 消息只保留首次出现的一条', () => {
    const first = message({ content: '第一次', id: 'u1', role: 'user' });
    const duplicate = message({ content: '第二次', id: 'u1', role: 'user' });

    expect(deduplicateOverlappingMessages([first, duplicate])).toEqual([first]);
  });

  it('toolCallId 相同视为同一条，并保留 parts 更完整的一份', () => {
    const local = message({ id: 'local', parts: [toolPart('p1', 'call-1')] });
    const snapshot = message({
      id: 'server',
      parts: [toolPart('p1', 'call-1'), toolPart('p2', 'call-2')],
    });

    const output = deduplicateOverlappingMessages([local, snapshot]);

    expect(ids(output)).toEqual(['server']);
  });

  it('clientRequestId 相同视为同一条，且不改变首次出现的位置', () => {
    const local = message({ clientRequestId: 'req-1', id: 'local' });
    const later = message({ content: '另一条', id: 'other' });
    const snapshot = message({
      clientRequestId: 'req-1',
      id: 'server',
      parts: [toolPart('p1', 'call-1')],
    });

    const output = deduplicateOverlappingMessages([local, later, snapshot]);

    expect(ids(output)).toEqual(['server', 'other']);
  });

  it('part id 相交视为同一条', () => {
    const local = message({ id: 'local', parts: [toolPart('shared', 'call-a')] });
    const snapshot = message({
      id: 'server',
      parts: [toolPart('shared', 'call-a'), toolPart('p-2', 'call-b')],
    });

    expect(ids(deduplicateOverlappingMessages([local, snapshot]))).toEqual(['server']);
  });

  it('没有任何交集时全部保留且顺序不变', () => {
    const a = message({ id: 'a', parts: [toolPart('p-a', 'call-a')] });
    const b = message({ id: 'b', parts: [toolPart('p-b', 'call-b')] });
    const user = message({ id: 'u', role: 'user' });

    expect(ids(deduplicateOverlappingMessages([user, a, b]))).toEqual(['u', 'a', 'b']);
  });

  it('替换后新消息的 part 键会重新登记，后续消息仍能命中', () => {
    const first = message({ id: 'a' });
    const second = message({
      clientRequestId: 'req-x',
      id: 'b',
      parts: [toolPart('p-1', 'call-1')],
    });
    const replacement = message({
      clientRequestId: 'req-x',
      id: 'c',
      parts: [toolPart('p-2', 'call-2'), toolPart('p-3', 'call-3')],
    });
    const later = message({ id: 'd', parts: [toolPart('p-4', 'call-3')] });

    const output = deduplicateOverlappingMessages([first, second, replacement, later]);

    // replacement 覆盖 second（parts 更完整），later 又靠 replacement 新登记的
    // `call-3` 命中同一位置；later 片段更少，不覆盖。
    expect(ids(output)).toEqual(['a', 'c']);
  });

  it('替换后旧消息的键必须失效，不能把后续无关消息吸进来', () => {
    const local = message({ id: 'm-1', parts: [toolPart('p-old', 'call-old')] });
    // 同一 id 的更完整版本：顶掉 local，且不复用它的 part / toolCallId。
    const snapshot = message({
      id: 'm-1',
      parts: [toolPart('p-new-1', 'call-new-1'), toolPart('p-new-2', 'call-new-2')],
    });
    // 只与**已被丢弃**的 local 键（part id / toolCallId）相交的无关消息。
    const later = message({ id: 'm-2', parts: [toolPart('p-old', 'call-old')] });

    const output = deduplicateOverlappingMessages([local, snapshot, later]);

    // 若旧键未撤销，later 会被错误并进 m-1，导致整条消息被吞掉。
    expect(ids(output)).toEqual(['m-1', 'm-2']);
  });

  it('已落定的快照优先于仍在 streaming 的本地消息', () => {
    const streaming = message({ id: 'local', status: 'streaming' });
    const completed = message({ id: 'server', status: 'completed' });

    const output = deduplicateOverlappingMessages([
      { ...streaming, clientRequestId: 'req-1' },
      { ...completed, clientRequestId: 'req-1' },
    ]);

    expect(ids(output)).toEqual(['server']);
  });
});
