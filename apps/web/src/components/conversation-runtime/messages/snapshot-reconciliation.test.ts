/**
 * 共置测试：`snapshot-reconciliation.ts`。
 *
 * 服务端快照与本地乐观消息的协调规则在这里收口：
 *
 * - 快照顺序是权威顺序，但本地独有（快照尚未同步）的完成消息要插回原位置；
 * - 本地错误/取消等终止状态不能被快照的通用 completed 覆盖；
 * - 快照内部两条同文消息是各自独立持久化的记录，只有强身份才能折叠。
 *
 * `support.test.ts` 侧重端到端回归场景，这里按分支固定这些判定边界。
 */
import { describe, expect, it } from 'vitest';
import {
  reconcileSnapshotChatMessages,
  toSharedMessageSnapshot,
} from './snapshot-reconciliation.js';
import type { ChatMessage, ChatMessagePart } from './message-model.js';
import type { Message } from '@openAwork/shared';
import {
  contentFromParts,
  createAssistantTraceContent,
  parseAssistantTraceContent,
  readAssistantTracePayload,
} from './trace-codec.js';

function assistantMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '回答',
    status: 'completed',
    ...overrides,
  };
}

describe('reconcileSnapshotChatMessages', () => {
  it('任一侧为空时直接返回另一侧引用', () => {
    const previous: ChatMessage[] = [assistantMessage({ id: 'local' })];
    const snapshot: ChatMessage[] = [assistantMessage({ id: 'server' })];

    expect(reconcileSnapshotChatMessages([], snapshot)).toBe(snapshot);
    expect(reconcileSnapshotChatMessages(previous, [])).toBe(previous);
    expect(reconcileSnapshotChatMessages([], [])).toEqual([]);
  });

  it('同 ID 时本地错误终止状态不被快照的 completed 覆盖', () => {
    const previous = assistantMessage({
      id: 'm1',
      content: '上游出错了',
      createdAt: 1_000,
      status: 'error',
      stopReason: 'error',
    });
    const snapshot = assistantMessage({
      id: 'm1',
      content: '上游出错了',
      createdAt: 1_001,
      status: 'completed',
    });

    const reconciled = reconcileSnapshotChatMessages([previous], [snapshot]);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.status).toBe('error');
    expect(reconciled[0]?.stopReason).toBe('error');
  });

  it('快照新增的消息按服务端顺序插入', () => {
    const previous: ChatMessage[] = [{ id: 'u-1', role: 'user', content: '问题' }];
    const snapshot: ChatMessage[] = [
      { id: 'u-1', role: 'user', content: '问题' },
      assistantMessage({ id: 'server-new', content: '全新回答', createdAt: 10 }),
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled.map((message) => message.id)).toEqual(['u-1', 'server-new']);
    expect(reconciled[1]?.content).toBe('全新回答');
  });

  it('未被快照覆盖的本地完成消息按时间插回序列', () => {
    const previous: ChatMessage[] = [
      assistantMessage({ id: 'local-round-1', content: '第一轮结果', createdAt: 100 }),
      assistantMessage({ id: 'local-round-2', content: '第二轮回答', createdAt: 200 }),
    ];
    const snapshot: ChatMessage[] = [
      assistantMessage({ id: 'server-round-2', content: '第二轮回答已完成', createdAt: 201 }),
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled.map((message) => message.id)).toEqual([
      'local-round-1',
      'server-round-2',
      'local-round-2',
    ]);
  });

  it('快照中两条同文同时间的独立快照消息都被保留', () => {
    const previous: ChatMessage[] = [{ id: 'u-1', role: 'user', content: '同一个问题' }];
    const snapshot: ChatMessage[] = [
      { id: 'u-1', role: 'user', content: '同一个问题' },
      assistantMessage({ id: 'a-1', content: '好的', createdAt: 1_000 }),
      assistantMessage({ id: 'a-2', content: '好的', createdAt: 1_000 }),
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled.map((message) => message.id)).toEqual(['u-1', 'a-1', 'a-2']);
  });

  it('快照内部共享强身份的同文消息会折叠为一条', () => {
    const previous: ChatMessage[] = [{ id: 'u-1', role: 'user', content: '同一个问题' }];
    const snapshot: ChatMessage[] = [
      { id: 'u-1', role: 'user', content: '同一个问题' },
      assistantMessage({ id: 'a-1', content: '好的', createdAt: 1_000, clientRequestId: 'req:1' }),
      assistantMessage({ id: 'a-2', content: '好的', createdAt: 1_000, clientRequestId: 'req:1' }),
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled.map((message) => message.id)).toEqual(['u-1', 'a-1']);
  });

  it('快照未包含的本地流式占位消息被丢弃', () => {
    const previous: ChatMessage[] = [
      assistantMessage({ id: 'local-completed', content: '最终回答', createdAt: 1_000 }),
      assistantMessage({
        id: 'local-streaming',
        content: '',
        createdAt: 1_001,
        status: 'streaming',
      }),
    ];
    const snapshot: ChatMessage[] = [
      assistantMessage({ id: 'server-final', content: '最终回答', createdAt: 1_000 }),
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled.map((message) => message.id)).toEqual(['server-final']);
  });

  it('跨不同 ID 但正文一致的助理消息合并为快照版本', () => {
    const previous: ChatMessage[] = [
      assistantMessage({
        id: 'local-same-text',
        content: createAssistantTraceContent({ text: '最终回答', toolCalls: [] }),
      }),
    ];
    const snapshot: ChatMessage[] = [
      assistantMessage({
        id: 'server-same-text',
        content: createAssistantTraceContent({ text: '最终回答', toolCalls: [] }),
      }),
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.id).toBe('server-same-text');
  });
});

describe('mergePreferringCompleteContent 的 parts / content 顺序一致性', () => {
  const MERGE_ID = 'm-merge-order';

  function interleavedParts(): ChatMessagePart[] {
    return [
      { id: `${MERGE_ID}:text`, type: 'text', text: 'A' },
      {
        id: 'tool-merge',
        type: 'tool',
        toolCallId: 'tool-merge',
        toolName: 'read',
        input: {},
        status: 'running',
      },
      { id: `${MERGE_ID}:text:1`, type: 'text', text: 'B' },
    ];
  }

  it('快照无 parts 但文本更长时，parts 保持交错且 content 与 parts 编码同一顺序', () => {
    const parts = interleavedParts();
    const previous = assistantMessage({
      id: MERGE_ID,
      content: contentFromParts(parts),
      parts,
      status: 'completed',
    });
    // 快照没有 parts，只带来一份更完整的扁平文本（A → 工具 → B → C）。
    const snapshot = assistantMessage({
      id: MERGE_ID,
      content: createAssistantTraceContent({
        text: 'A\n\nB\n\nC',
        toolCalls: [
          {
            toolCallId: 'tool-merge',
            toolName: 'read',
            input: {},
            status: 'completed',
            output: 'ok',
          },
        ],
      }),
      status: 'completed',
    });

    const [merged] = reconcileSnapshotChatMessages([previous], [snapshot]);

    // (a) parts 的交错顺序不变。
    expect(merged?.parts?.map((part) => part.type)).toEqual(['text', 'tool', 'text']);
    // (b) content 与 parts 编码同一顺序 / 内容（content 是 parts 的序列化）。
    expect(merged?.content).toBe(contentFromParts(merged?.parts ?? []));
    // 快照更完整的文本已被吸收进 parts。
    expect(readAssistantTracePayload(merged!)?.text).toBe('A\n\nB\n\nC');
    expect(parseAssistantTraceContent(merged?.content ?? '')?.text).toBe('A\n\nB\n\nC');
  });

  it('快照带 parts 而 previous 无 parts 时，采用快照 parts 顺序并保留本地工具注解', () => {
    const previous = assistantMessage({
      id: MERGE_ID,
      content: createAssistantTraceContent({
        text: '本地较短文本',
        toolCalls: [
          {
            toolCallId: 'tool-merge',
            toolName: 'read',
            input: {},
            status: 'paused',
            pendingPermissionRequestId: 'perm-1',
          },
        ],
      }),
      status: 'completed',
    });
    const snapshotParts: ChatMessagePart[] = [
      { id: `${MERGE_ID}:text`, type: 'text', text: '服务端更完整的回答' },
      {
        id: 'tool-merge',
        type: 'tool',
        toolCallId: 'tool-merge',
        toolName: 'read',
        input: {},
        status: 'running',
      },
      { id: `${MERGE_ID}:text:1`, type: 'text', text: '后半段' },
    ];
    const snapshot = assistantMessage({
      id: MERGE_ID,
      content: contentFromParts(snapshotParts),
      parts: snapshotParts,
      status: 'completed',
    });

    const [merged] = reconcileSnapshotChatMessages([previous], [snapshot]);

    expect(merged?.parts?.map((part) => part.type)).toEqual(['text', 'tool', 'text']);
    expect(merged?.parts?.find((part) => part.type === 'tool')).toMatchObject({
      pendingPermissionRequestId: 'perm-1',
      status: 'paused',
    });
    expect(merged?.content).toBe(contentFromParts(merged?.parts ?? []));
  });

  it('快照并不更完整时保持 previous 的 parts 与 content 原样返回', () => {
    const parts = interleavedParts();
    const previous = assistantMessage({
      id: MERGE_ID,
      content: contentFromParts(parts),
      parts,
      status: 'completed',
    });
    const snapshot = assistantMessage({
      id: MERGE_ID,
      content: createAssistantTraceContent({ text: 'A', toolCalls: [] }),
      status: 'completed',
    });

    const [merged] = reconcileSnapshotChatMessages([previous], [snapshot]);

    expect(merged?.id).toBe(previous.id);
    expect(merged?.content).toBe(previous.content);
    expect(merged?.parts).toBe(previous.parts);
  });
});

describe('toSharedMessageSnapshot', () => {
  it('assistant 消息把推理块与正文投影为共享文本', () => {
    const message: ChatMessage = {
      id: 'a-1',
      role: 'assistant',
      content: createAssistantTraceContent({
        text: '最终回答',
        toolCalls: [],
        reasoningBlocks: ['第一段'],
      }),
      createdAt: 1_000,
    };

    const [snapshot] = toSharedMessageSnapshot([message]);

    expect(snapshot).toEqual({
      id: 'a-1',
      role: 'assistant',
      createdAt: 1_000,
      content: [{ type: 'text', text: '_Thinking:_\n\n第一段\n\n最终回答' }],
    });
  });

  it('assistant 无 trace 时直接使用原始正文', () => {
    const message: ChatMessage = {
      id: 'a-2',
      role: 'assistant',
      content: '普通回答',
      createdAt: 2_000,
    };

    const [snapshot] = toSharedMessageSnapshot([message]);

    expect(snapshot?.content).toEqual([{ type: 'text', text: '普通回答' }]);
  });

  it('user 消息保留 rawContent 引用', () => {
    const rawContent: Message['content'] = [{ type: 'text', text: '原始文本' }];
    const message: ChatMessage = {
      id: 'u-1',
      role: 'user',
      content: '原始文本',
      rawContent,
      createdAt: 3_000,
    };

    const [snapshot] = toSharedMessageSnapshot([message]);

    expect(snapshot?.content).toBe(rawContent);
  });

  it('无 rawContent 的 user 消息退化为单段文本', () => {
    const message: ChatMessage = {
      id: 'u-2',
      role: 'user',
      content: '纯文本',
      createdAt: 4_000,
    };

    const [snapshot] = toSharedMessageSnapshot([message]);

    expect(snapshot?.content).toEqual([{ type: 'text', text: '纯文本' }]);
  });

  it('字符串 createdAt 规范化为毫秒时间戳', () => {
    const message: ChatMessage = {
      id: 'u-3',
      role: 'user',
      content: '文本',
      createdAt: '2026-01-02T03:04:05.000Z',
    };

    const [snapshot] = toSharedMessageSnapshot([message]);

    expect(snapshot?.createdAt).toBe(Date.parse('2026-01-02T03:04:05.000Z'));
  });

  it('空列表返回空数组', () => {
    expect(toSharedMessageSnapshot([])).toEqual([]);
  });
});
