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

/**
 * 引用回收。
 *
 * 回归背景：归一化每次都造新消息对象，因此「切回刚离开的会话」时，即使快照内容与
 * 视图缓存逐字段一致，合流结果也会整表换新引用，击穿消息列表里所有
 * `ChatGroupBlock` 的 `React.memo`。回收后 `setMessages` 能直接短路。
 */
describe('reconcileSnapshotChatMessages 的引用回收', () => {
  function userMessage(id: string, content: string, createdAt: number): ChatMessage {
    return { id, role: 'user', content, createdAt };
  }

  it('快照与 previous 逐字段一致时返回同一个数组引用', () => {
    const previous = [userMessage('u1', '第一条', 1_000), userMessage('u2', '第二条', 2_000)];
    // 模拟重新归一化：对象全新但内容一致
    const snapshot = [userMessage('u1', '第一条', 1_000), userMessage('u2', '第二条', 2_000)];

    expect(reconcileSnapshotChatMessages(previous, snapshot)).toBe(previous);
  });

  it('快照新增消息时，未变消息仍复用 previous 的对象引用', () => {
    const kept = userMessage('u1', '第一条', 1_000);
    const previous = [kept];
    const snapshot = [userMessage('u1', '第一条', 1_000), userMessage('u2', '第二条', 2_000)];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled).not.toBe(previous);
    expect(reconciled[0]).toBe(kept);
    expect(reconciled[1]).toBe(snapshot[1]);
  });

  it('previous 多出本地消息时不能返回 previous 引用', () => {
    const previous = [userMessage('u1', '第一条', 1_000), userMessage('u2', '本地补充', 2_000)];
    const snapshot = [userMessage('u1', '第一条', 1_000)];

    // 本地独有消息会被保留（合流契约），因此结果内容等价但数组是新引用。
    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled).toHaveLength(2);
    expect(reconciled[0]).toBe(previous[0]);
    expect(reconciled[1]).toBe(previous[1]);
  });

  it('同 id 但状态变化时视为真实更新（不沿用旧引用，避免渲染陈旧状态）', () => {
    const previous: ChatMessage[] = [
      { id: 'm1', role: 'assistant', content: '回答', status: 'streaming', createdAt: 1_000 },
    ];
    const snapshot: ChatMessage[] = [
      { id: 'm1', role: 'assistant', content: '回答', status: 'completed', createdAt: 1_000 },
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled).not.toBe(previous);
    expect(reconciled[0]).not.toBe(previous[0]);
    expect(reconciled[0]?.status).toBe('completed');
  });

  it('快照带来更完整的 assistant 正文时视为真实更新', () => {
    const previous: ChatMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: createAssistantTraceContent({ text: '回答', toolCalls: [] }),
        createdAt: 1_000,
      },
    ];
    const snapshot: ChatMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: createAssistantTraceContent({ text: '回答，且快照更完整', toolCalls: [] }),
        createdAt: 1_000,
      },
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled[0]).not.toBe(previous[0]);
    expect(reconciled[0]?.content).not.toBe(previous[0]?.content);
  });

  it('同 id 但 parts 变化时视为真实更新（content 相同也不复用）', () => {
    const previous: ChatMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: '序列化文本',
        createdAt: 1_000,
        parts: [{ id: 'p1', type: 'text', text: '序列化文本' }] as ChatMessagePart[],
      },
    ];
    const snapshot: ChatMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: '序列化文本',
        createdAt: 1_000,
        parts: [
          { id: 'p1', type: 'text', text: '序列化文本' },
          { id: 'p2', type: 'text', text: '追加' },
        ] as ChatMessagePart[],
      },
    ];

    expect(reconcileSnapshotChatMessages(previous, snapshot)).not.toBe(previous);
  });

  // ─── 不进入 content 但参与渲染的字段（漏判会造成陈旧展示）──────────────────

  /**
   * 构造一条自洽的 assistant 消息：`content` 必须等于 `contentFromParts(parts)`
   * —— 这是真实消息的形态（`content` 是 parts 的序列化结果），也是引用回收判定
   * 所依赖的不变量。构造不自洽会让判定误判为「内容已变」，测试就失去意义。
   */
  function tracedMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
    const parts: ChatMessagePart[] = [{ id: 'p1', type: 'text', text: '回答' }];
    return {
      id: 'm1',
      role: 'assistant',
      createdAt: 1_000,
      ...overrides,
      parts: overrides.parts ?? parts,
      content: overrides.content ?? contentFromParts(overrides.parts ?? parts),
    } as ChatMessage;
  }

  // ─── 统一基底：两条终态分支都是「服务端优先」 ─────────────────────────────

  it('两条终态分支都保留服务端回填的元数据（流式收尾）', () => {
    const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };
    const previous = [tracedMessage({ status: 'streaming' })];
    const snapshot = [
      tracedMessage({ status: 'completed', providerUsage: usage } as Partial<ChatMessage>),
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled[0]?.providerUsage).toEqual(usage);
  });

  it('两条终态分支都保留服务端回填的元数据（两侧均终态）', () => {
    const usage = { inputTokens: 7, outputTokens: 8, totalTokens: 15 };
    const previous = [tracedMessage({ status: 'completed' })];
    const snapshot = [
      tracedMessage({ status: 'completed', providerUsage: usage } as Partial<ChatMessage>),
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    // 此前该分支以本地为基底，服务端元数据在这里被丢弃。
    expect(reconciled[0]?.providerUsage).toEqual(usage);
  });

  it('服务端元数据优先于本地较旧的同名字段', () => {
    const previous = [
      tracedMessage({ status: 'completed', model: '本地旧模型' } as Partial<ChatMessage>),
    ];
    const snapshot = [
      tracedMessage({ status: 'completed', model: '服务端新模型' } as Partial<ChatMessage>),
    ];

    expect(reconcileSnapshotChatMessages(previous, snapshot)[0]?.model).toBe('服务端新模型');
  });

  it('推理块计时以快照为准（本地可能只记录了前 N 个块）', () => {
    const previous = [
      tracedMessage({
        status: 'streaming',
        reasoningBlocksEndedFlags: [true],
        reasoningBlocksDurationsMs: [1_200],
      } as Partial<ChatMessage>),
    ];
    const snapshot = [
      tracedMessage({
        status: 'completed',
        reasoningBlocksEndedFlags: [true, true],
        reasoningBlocksDurationsMs: [1_200, 800],
        providerUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      } as Partial<ChatMessage>),
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled[0]?.reasoningBlocksEndedFlags).toEqual([true, true]);
    expect(reconciled[0]?.reasoningBlocksDurationsMs).toEqual([1_200, 800]);
    expect(reconciled[0]?.providerUsage).toBeDefined();
  });

  it('快照缺失推理块计时字段时沿用本地兜底', () => {
    const previous = [
      tracedMessage({
        status: 'streaming',
        reasoningBlocksEndedFlags: [true],
        reasoningBlocksDurationsMs: [1_200],
      } as Partial<ChatMessage>),
    ];
    const snapshot = [
      tracedMessage({
        status: 'completed',
        reasoningBlocksEndedFlags: undefined,
        reasoningBlocksDurationsMs: undefined,
      } as Partial<ChatMessage>),
    ];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect(reconciled[0]?.reasoningBlocksEndedFlags).toEqual([true]);
    expect(reconciled[0]?.reasoningBlocksDurationsMs).toEqual([1_200]);
  });

  it('快照未提供计时字段时不会把本地的 undefined 写进去', () => {
    const previous = [tracedMessage({ status: 'streaming', reasoningBlocksEndedFlags: undefined })];
    const snapshot = [tracedMessage({ status: 'completed' })];

    const reconciled = reconcileSnapshotChatMessages(previous, snapshot);

    expect('reasoningBlocksEndedFlags' in reconciled[0]!).toBe(false);
  });

  // ─── 引用回收：非 content 字段也必须参与判定 ──────────────────────────────

  it('快照回填 providerUsage 时换新引用，避免用量展示停在本地空值', () => {
    const previous = [tracedMessage({ status: 'streaming' })];
    const snapshot = [
      tracedMessage({
        status: 'completed',
        providerUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      } as Partial<ChatMessage>),
    ];

    expect(reconcileSnapshotChatMessages(previous, snapshot)).not.toBe(previous);
  });

  it('tokenEstimate / model / durationMs 变化时换新引用', () => {
    for (const patch of [
      { tokenEstimate: 42 },
      { model: 'gpt-5' },
      { durationMs: 1_234 },
      { toolCallCount: 3 },
      { agentId: 'agent-a' },
    ] as Partial<ChatMessage>[]) {
      const previous = [tracedMessage({ status: 'streaming' })];
      const snapshot = [tracedMessage({ status: 'completed', ...patch } as Partial<ChatMessage>)];
      expect(reconcileSnapshotChatMessages(previous, snapshot)).not.toBe(previous);
    }
  });

  it('所有渲染字段一致时仍复用 previous 引用（优化不能失效）', () => {
    const shared = {
      model: 'gpt-5',
      tokenEstimate: 42,
      providerUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    } as Partial<ChatMessage>;

    const previous = [tracedMessage({ ...shared, status: 'streaming' })];
    const snapshot = [tracedMessage({ ...shared, status: 'completed' })];
    expect(reconcileSnapshotChatMessages(previous, snapshot)).not.toBe(previous);

    // 两侧终态且逐字段一致 ⇒ 整表复用
    const bothCompleted = [tracedMessage({ ...shared, status: 'completed' })];
    expect(
      reconcileSnapshotChatMessages(bothCompleted, [
        tracedMessage({ ...shared, status: 'completed' }),
      ]),
    ).toBe(bothCompleted);
  });

  it('event 分片 payload 变化时换新引用（唯一不进 content 的分片变体）', () => {
    const previous: ChatMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: '回答',
        createdAt: 1_000,
        parts: [
          {
            id: 'e1',
            type: 'event',
            payload: { kind: 'audit', message: 'm', status: 'running', title: 't' },
          },
        ] as ChatMessagePart[],
      },
    ];
    const snapshot: ChatMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: '回答',
        createdAt: 1_000,
        parts: [
          {
            id: 'e1',
            type: 'event',
            payload: { kind: 'audit', message: 'm', status: 'success', title: 't' },
          },
        ] as ChatMessagePart[],
      },
    ];

    expect(reconcileSnapshotChatMessages(previous, snapshot)).not.toBe(previous);
  });
});
