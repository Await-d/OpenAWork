/**
 * 共置测试：`message-equivalence.ts`。
 *
 * 这组判定函数决定"两条消息是不是同一条逻辑消息"，是快照协调与流式合并的
 * 判定基础。核心不变量：
 *
 * - 双方都带 `clientRequestId` 且不一致 → 一定是不同轮次，模糊等价不得合并；
 * - 正文一致的配对允许最多 15s 的落库时间漂移；
 * - 助理 trace 的正文本前缀匹配放宽到 4 倍容差（长工具调用可能跨分钟）。
 *
 * 注意：`SNAPSHOT_RECONCILE_TIME_TOLERANCE_MS` 与
 * `areInputImagesEquivalent` 都是模块私有符号，这里用字面量 15_000 固定
 * 公开行为，并通过 `areLikelySameNearbyUserMessage` 间接覆盖图片比较。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  areLikelySameNearbyUserMessage,
  areLogicalMessageDuplicates,
  areMessagesSeparatedByUserTurn,
  areSameAssistantMessageContent,
  areSnapshotMessagesEquivalent,
  areStronglyIdenticalMessages,
  createSnapshotMessageComparator,
  hasOverlappingPartIds,
  hasUserMessageBetween,
} from './message-equivalence.js';
import { createAssistantEventCardContent } from './card-codec.js';
import type { ChatMessage, ChatMessagePart } from './message-model.js';
import type { Message } from '@openAwork/shared';
import { createAssistantTraceContent } from './trace-codec.js';
import { normalizeChatMessages } from './normalize-chat-messages.js';

const SNAPSHOT_TIME_TOLERANCE_MS = 15_000;

describe('快照比较缓存与轮次身份', () => {
  it.each([15_001, 16_000, 3_600_000])('真实数组用户消息无强身份时受时间窗约束：%s', (delay) => {
    const messages = normalizeChatMessages([
      { id: 'local', role: 'user', createdAt: 1_000, content: [{ type: 'text', text: '问题' }] },
      {
        id: 'server',
        role: 'user',
        createdAt: 1_000 + delay,
        content: [{ type: 'text', text: '问题' }],
      },
    ]);
    expect(areLikelySameNearbyUserMessage(messages[0]!, messages[1]!)).toBe(false);
  });

  it.each(['same-id', 'same-request', 'missing-time', 'within-window'])(
    '真实数组保留合理身份配对：%s',
    (kind) => {
      const messages = normalizeChatMessages([
        {
          id: 'local',
          role: 'user',
          createdAt: kind === 'missing-time' ? undefined : 1_000,
          clientRequestId: kind === 'same-request' ? 'req:assistant:1' : undefined,
          content: [{ type: 'text', text: '问题' }],
        },
        {
          id: kind === 'same-id' ? 'local' : 'server',
          role: 'user',
          createdAt:
            kind === 'missing-time' ? undefined : kind === 'within-window' ? 16_000 : 3_601_000,
          clientRequestId: kind === 'same-request' ? 'req:assistant:1' : undefined,
          content: [{ type: 'text', text: '问题' }],
        },
      ]);
      expect(areLikelySameNearbyUserMessage(messages[0]!, messages[1]!)).toBe(true);
      expect(areSnapshotMessagesEquivalent(messages[0]!, messages[1]!)).toBe(true);
    },
  );
  it('一次比较器内每条 trace 仅解析一次，新比较器读取最新正文', () => {
    const left = assistantMessage({
      content: createAssistantTraceContent({ text: '第一条回答', toolCalls: [] }),
    });
    const right = assistantMessage({
      id: 'other',
      content: createAssistantTraceContent({ text: '第二条回答', toolCalls: [] }),
    });
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const compare = createSnapshotMessageComparator();
      expect(compare(left, right)).toBe(false);
      const calls = parse.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      expect(compare(left, right)).toBe(false);
      expect(parse.mock.calls).toHaveLength(calls);
      right.content = createAssistantTraceContent({ text: '第一条回答扩展', toolCalls: [] });
      expect(createSnapshotMessageComparator()(left, right)).toBe(true);
      expect(parse.mock.calls.length).toBeGreaterThan(calls);
    } finally {
      parse.mockRestore();
    }
  });

  it('不同请求轮次即便共享 part 或 toolCallId 也不折叠', () => {
    const parts: ChatMessagePart[] = [
      { id: 'shared', type: 'tool', toolCallId: 'call', toolName: 'read', input: {} },
    ];
    const left = assistantMessage({ id: 'a', clientRequestId: 'req:assistant:1', parts });
    const right = assistantMessage({ id: 'b', clientRequestId: 'req', parts });
    expect(areStronglyIdenticalMessages(left, right)).toBe(false);
    expect(areLogicalMessageDuplicates(left, right)).toBe(false);
  });
});

function assistantMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: 'msg-1', role: 'assistant', content: '相同正文', ...overrides };
}

function userMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: 'user-1', role: 'user', content: '同一个问题', ...overrides };
}

describe('areSnapshotMessagesEquivalent', () => {
  it('角色不同直接判定不等价', () => {
    expect(
      areSnapshotMessagesEquivalent(
        assistantMessage({}),
        userMessage({ id: 'msg-1', content: '相同正文' }),
      ),
    ).toBe(false);
  });

  it('正文一致且时间一致时等价', () => {
    expect(
      areSnapshotMessagesEquivalent(
        assistantMessage({ createdAt: 1_000 }),
        assistantMessage({ id: 'msg-2', createdAt: 1_000 }),
      ),
    ).toBe(true);
  });

  it('正文一致时容差边界为 15s', () => {
    const left = assistantMessage({ createdAt: 0 });
    const withinTolerance = assistantMessage({
      id: 'msg-2',
      createdAt: SNAPSHOT_TIME_TOLERANCE_MS,
    });
    const beyondTolerance = assistantMessage({
      id: 'msg-3',
      createdAt: SNAPSHOT_TIME_TOLERANCE_MS + 1,
    });

    expect(areSnapshotMessagesEquivalent(left, withinTolerance)).toBe(true);
    expect(areSnapshotMessagesEquivalent(left, beyondTolerance)).toBe(false);
  });

  it('缺少可比时间时正文一致即等价', () => {
    expect(
      areSnapshotMessagesEquivalent(assistantMessage({}), assistantMessage({ id: 'msg-2' })),
    ).toBe(true);
    expect(
      areSnapshotMessagesEquivalent(
        assistantMessage({ createdAt: '不是时间' }),
        assistantMessage({ id: 'msg-2' }),
      ),
    ).toBe(true);
  });

  it('双方请求 ID 不同时即使正文与时间一致也不等价', () => {
    expect(
      areSnapshotMessagesEquivalent(
        assistantMessage({ clientRequestId: 'req-1:assistant:1', createdAt: 1_000 }),
        assistantMessage({ id: 'msg-2', clientRequestId: 'req-1:assistant:2', createdAt: 1_000 }),
      ),
    ).toBe(false);
  });

  it('单边缺少请求 ID 时仍按正文与时间配对', () => {
    expect(
      areSnapshotMessagesEquivalent(
        assistantMessage({ createdAt: 1_000 }),
        assistantMessage({ id: 'msg-2', clientRequestId: 'req-1:assistant:2', createdAt: 1_000 }),
      ),
    ).toBe(true);
  });

  it('助理 trace 工具状态不同但文本一致时等价', () => {
    const left = assistantMessage({
      content: createAssistantTraceContent({
        text: '最终答复',
        toolCalls: [{ toolCallId: 't1', toolName: 'a', input: {}, status: 'running' }],
      }),
    });
    const right = assistantMessage({
      id: 'msg-2',
      content: createAssistantTraceContent({
        text: '最终答复',
        toolCalls: [
          { toolCallId: 't1', toolName: 'a', input: {}, status: 'completed', output: 'ok' },
        ],
      }),
    });

    expect(left.content).not.toBe(right.content);
    expect(areSnapshotMessagesEquivalent(left, right)).toBe(true);
  });

  it('助理 trace 文本仅空白/换行差异时等价', () => {
    const left = assistantMessage({
      content: JSON.stringify({
        type: 'assistant_trace',
        payload: { text: '  最终答复  ', toolCalls: [] },
      }),
    });
    const right = assistantMessage({
      id: 'msg-2',
      content: createAssistantTraceContent({ text: '最终答复', toolCalls: [] }),
    });

    expect(left.content).not.toBe(right.content);
    expect(areSnapshotMessagesEquivalent(left, right)).toBe(true);
  });

  it('文本前缀匹配在 4 倍容差内视为同一轮', () => {
    const left = assistantMessage({
      content: createAssistantTraceContent({ text: '这是最终回答', toolCalls: [] }),
      createdAt: 0,
    });
    const within = assistantMessage({
      id: 'msg-2',
      content: createAssistantTraceContent({
        text: '这是最终回答，补充说明',
        toolCalls: [],
      }),
      createdAt: SNAPSHOT_TIME_TOLERANCE_MS * 4,
    });
    const beyond = assistantMessage({
      id: 'msg-3',
      content: createAssistantTraceContent({
        text: '这是最终回答，补充说明',
        toolCalls: [],
      }),
      createdAt: SNAPSHOT_TIME_TOLERANCE_MS * 4 + 1,
    });

    expect(areSnapshotMessagesEquivalent(left, within)).toBe(true);
    expect(areSnapshotMessagesEquivalent(left, beyond)).toBe(false);
  });

  it('前缀占比不足一半时不等价', () => {
    const left = assistantMessage({
      content: createAssistantTraceContent({ text: 'ab', toolCalls: [] }),
    });
    const right = assistantMessage({
      id: 'msg-2',
      content: createAssistantTraceContent({ text: 'abcdefghij', toolCalls: [] }),
    });

    expect(areSnapshotMessagesEquivalent(left, right)).toBe(false);
  });

  it('两侧文本为空时按工具调用 ID 集合比对', () => {
    const left = assistantMessage({
      content: createAssistantTraceContent({
        text: '',
        toolCalls: [{ toolCallId: 't1', toolName: 'a', input: {} }],
      }),
    });
    const sameTools = assistantMessage({
      id: 'msg-2',
      content: createAssistantTraceContent({
        text: '',
        toolCalls: [{ toolCallId: 't1', toolName: 'a', input: {}, output: 'ok' }],
      }),
    });
    const differentTools = assistantMessage({
      id: 'msg-3',
      content: createAssistantTraceContent({
        text: '',
        toolCalls: [{ toolCallId: 't2', toolName: 'a', input: {} }],
      }),
    });

    expect(areSnapshotMessagesEquivalent(left, sameTools)).toBe(true);
    expect(areSnapshotMessagesEquivalent(left, differentTools)).toBe(false);
  });

  it('两侧文本与工具调用均为空时按推理块比对', () => {
    const left = assistantMessage({
      content: createAssistantTraceContent({
        text: '',
        toolCalls: [],
        reasoningBlocks: ['先分析'],
      }),
    });
    const sameReasoning = assistantMessage({
      id: 'msg-2',
      content: createAssistantTraceContent({
        text: '',
        toolCalls: [],
        reasoningBlocks: ['先分析'],
        reasoningBlocksTimings: [{ startedAt: 100 }],
      }),
    });
    const differentReasoning = assistantMessage({
      id: 'msg-3',
      content: createAssistantTraceContent({
        text: '',
        toolCalls: [],
        reasoningBlocks: ['另一种推理'],
      }),
    });

    expect(areSnapshotMessagesEquivalent(left, sameReasoning)).toBe(true);
    expect(areSnapshotMessagesEquivalent(left, differentReasoning)).toBe(false);
  });
});

describe('areStronglyIdenticalMessages', () => {
  it('消息 ID 相同即强一致（优先于角色判断）', () => {
    expect(
      areStronglyIdenticalMessages(
        { id: 'same', role: 'user', content: 'a' },
        { id: 'same', role: 'assistant', content: 'b' },
      ),
    ).toBe(true);
  });

  it('ID 不同且角色不同时为 false', () => {
    expect(
      areStronglyIdenticalMessages(
        { id: 'a', role: 'user', content: 'x' },
        { id: 'b', role: 'assistant', content: 'x' },
      ),
    ).toBe(false);
  });

  it('clientRequestId 相同即强一致', () => {
    expect(
      areStronglyIdenticalMessages(
        { id: 'a', role: 'assistant', content: 'x', clientRequestId: 'req-1' },
        { id: 'b', role: 'assistant', content: 'y', clientRequestId: 'req-1' },
      ),
    ).toBe(true);
  });

  it('只有单边携带 clientRequestId 时为 false', () => {
    expect(
      areStronglyIdenticalMessages(
        { id: 'a', role: 'assistant', content: 'x' },
        { id: 'b', role: 'assistant', content: 'x', clientRequestId: 'req-1' },
      ),
    ).toBe(false);
  });

  it('共享分片 ID 即强一致', () => {
    const left: ChatMessagePart[] = [{ id: 'part-1', type: 'text', text: 'A' }];
    const right: ChatMessagePart[] = [{ id: 'part-1', type: 'text', text: 'B' }];

    expect(
      areStronglyIdenticalMessages(
        { id: 'a', role: 'assistant', content: '', parts: left },
        { id: 'b', role: 'assistant', content: '', parts: right },
      ),
    ).toBe(true);
  });

  it('分片 ID 不同但 toolCallId 重叠即强一致', () => {
    const left: ChatMessagePart[] = [
      { id: 'local:tool', type: 'tool', toolCallId: 'tc-1', toolName: 'a', input: {} },
    ];
    const right: ChatMessagePart[] = [
      { id: 'server:tool', type: 'tool', toolCallId: 'tc-1', toolName: 'a', input: {} },
    ];

    expect(
      areStronglyIdenticalMessages(
        { id: 'a', role: 'assistant', content: '', parts: left },
        { id: 'b', role: 'assistant', content: '', parts: right },
      ),
    ).toBe(true);
  });

  it('无共同分片的用户消息为 false', () => {
    expect(
      areStronglyIdenticalMessages(
        { id: 'a', role: 'user', content: '同一个问题' },
        { id: 'b', role: 'user', content: '同一个问题' },
      ),
    ).toBe(false);
  });
});

describe('areLogicalMessageDuplicates', () => {
  it('强一致消息是逻辑重复', () => {
    expect(
      areLogicalMessageDuplicates(
        { id: 'same', role: 'assistant', content: 'a' },
        { id: 'same', role: 'assistant', content: 'b' },
      ),
    ).toBe(true);
  });

  it('角色不同不是逻辑重复', () => {
    expect(
      areLogicalMessageDuplicates(
        { id: 'a', role: 'user', content: 'x' },
        { id: 'b', role: 'assistant', content: 'x' },
      ),
    ).toBe(false);
  });

  it('双方请求 ID 不同时即使同文同时也判定为不同轮次', () => {
    expect(
      areLogicalMessageDuplicates(
        assistantMessage({ clientRequestId: 'req-1:assistant:1', createdAt: 1_000 }),
        assistantMessage({ id: 'msg-2', clientRequestId: 'req-1:assistant:2', createdAt: 1_001 }),
      ),
    ).toBe(false);
  });

  it('单边缺少请求 ID 时仍可与快照孪生配对', () => {
    expect(
      areLogicalMessageDuplicates(
        assistantMessage({ createdAt: 1_000 }),
        assistantMessage({ id: 'msg-2', clientRequestId: 'req-1:assistant:2', createdAt: 1_000 }),
      ),
    ).toBe(true);
  });
});

describe('areSameAssistantMessageContent', () => {
  it('非 assistant 消息返回 false', () => {
    expect(
      areSameAssistantMessageContent(
        { id: 'a', role: 'user', content: 'x' },
        { id: 'b', role: 'user', content: 'x' },
      ),
    ).toBe(false);
  });

  it('任一侧是事件卡片时返回 false', () => {
    const eventCard = createAssistantEventCardContent({
      kind: 'tool',
      title: '工具执行',
      message: '完成',
      status: 'success',
    });

    expect(
      areSameAssistantMessageContent(
        { id: 'a', role: 'assistant', content: eventCard },
        { id: 'b', role: 'assistant', content: '普通文本' },
      ),
    ).toBe(false);
    expect(
      areSameAssistantMessageContent(
        { id: 'a', role: 'assistant', content: eventCard },
        { id: 'b', role: 'assistant', content: eventCard },
      ),
    ).toBe(false);
  });

  it('忽略空白与换行差异后正文一致', () => {
    expect(
      areSameAssistantMessageContent(
        { id: 'a', role: 'assistant', content: 'hello   world\n' },
        { id: 'b', role: 'assistant', content: 'hello world' },
      ),
    ).toBe(true);
  });

  it('请求 ID 不同时返回 false', () => {
    expect(
      areSameAssistantMessageContent(
        { id: 'a', role: 'assistant', content: '相同的回答', clientRequestId: 'req:1' },
        { id: 'b', role: 'assistant', content: '相同的回答', clientRequestId: 'req:2' },
      ),
    ).toBe(false);
  });

  it('正文为空时返回 false', () => {
    expect(
      areSameAssistantMessageContent(
        { id: 'a', role: 'assistant', content: '   ' },
        { id: 'b', role: 'assistant', content: '' },
      ),
    ).toBe(false);
  });
});

describe('areLikelySameNearbyUserMessage', () => {
  const image = {
    type: 'input_image' as const,
    artifactId: 'artifact-1',
    fileId: 'file-1',
    detail: 'auto' as const,
    mimeType: 'image/png',
  };

  it.each([undefined, 'blob:other-preview'])('同 artifact 忽略预览 URL 差异：%s', (imageUrl) => {
    const left = userMessage({
      rawContent: [{ ...image, imageUrl: 'blob:local-preview' }],
    });
    const right = userMessage({ id: 'server', rawContent: [{ ...image, imageUrl }] });
    expect(areLikelySameNearbyUserMessage(left, right)).toBe(true);
    expect(areLikelySameNearbyUserMessage(right, left)).toBe(true);
  });

  it('仅 fileId 标识图片时也忽略预览 URL 差异', () => {
    expect(
      areLikelySameNearbyUserMessage(
        userMessage({
          rawContent: [{ type: 'input_image', fileId: 'file-1', imageUrl: 'blob:a' }],
        }),
        userMessage({ id: 'server', rawContent: [{ type: 'input_image', fileId: 'file-1' }] }),
      ),
    ).toBe(true);
  });

  it.each([
    { ...image, artifactId: 'artifact-2' },
    { ...image, fileId: 'file-2' },
    { ...image, detail: 'high' as const },
    { ...image, mimeType: 'image/jpeg' },
    { ...image, fileName: 'other.png' },
  ])('图片身份或内容元数据不同不得被同文时间兜底覆盖：%j', (differentImage) => {
    const left = userMessage({ createdAt: 1_000, rawContent: [image] });
    const right = userMessage({ id: 'server', createdAt: 2_000, rawContent: [differentImage] });
    expect(areLikelySameNearbyUserMessage(left, right)).toBe(false);
    expect(areSnapshotMessagesEquivalent(left, right)).toBe(false);
    expect(areLogicalMessageDuplicates(left, right)).toBe(false);
  });

  it('图片数量不同不得被同文时间兜底覆盖', () => {
    const left = userMessage({ rawContent: [image] });
    const right = userMessage({ id: 'server', rawContent: [image, image] });
    expect(areLikelySameNearbyUserMessage(left, right)).toBe(false);
    expect(areSnapshotMessagesEquivalent(left, right)).toBe(false);
  });

  it('缺少稳定 ID 时仍比较图片 URL', () => {
    const left = userMessage({ rawContent: [{ type: 'input_image', imageUrl: 'blob:a' }] });
    const right = userMessage({
      id: 'server',
      rawContent: [{ type: 'input_image', imageUrl: 'blob:b' }],
    });
    expect(areLikelySameNearbyUserMessage(left, right)).toBe(false);
    expect(areSnapshotMessagesEquivalent(left, right)).toBe(false);
  });

  it('相同图片但用户请求 ID 冲突时不等价', () => {
    const left = userMessage({ clientRequestId: 'request-a', rawContent: [image] });
    const right = userMessage({ id: 'server', clientRequestId: 'request-b', rawContent: [image] });
    expect(areLikelySameNearbyUserMessage(left, right)).toBe(false);
    expect(areSnapshotMessagesEquivalent(left, right)).toBe(false);
    expect(areLogicalMessageDuplicates(left, right)).toBe(false);
  });

  it('rawContent 显示文本不同不得被同文时间兜底覆盖', () => {
    const left = userMessage({ rawContent: [{ type: 'text', text: '第一问' }, image] });
    const right = userMessage({
      id: 'server',
      rawContent: [{ type: 'text', text: '第二问' }, image],
    });
    expect(areLikelySameNearbyUserMessage(left, right)).toBe(false);
    expect(areSnapshotMessagesEquivalent(left, right)).toBe(false);
  });

  it('非用户消息返回 false', () => {
    expect(
      areLikelySameNearbyUserMessage(
        { id: 'a', role: 'assistant', content: 'x' },
        { id: 'b', role: 'user', content: 'x' },
      ),
    ).toBe(false);
  });

  it('正文不同返回 false', () => {
    expect(
      areLikelySameNearbyUserMessage(
        userMessage({}),
        userMessage({ id: 'user-2', content: '另一个' }),
      ),
    ).toBe(false);
  });

  it('正文相同且无 rawContent 时判定为同一条', () => {
    expect(areLikelySameNearbyUserMessage(userMessage({}), userMessage({ id: 'user-2' }))).toBe(
      true,
    );
  });

  it('synthetic 文本被过滤导致显示文本不同则返回 false', () => {
    expect(
      areLikelySameNearbyUserMessage(
        userMessage({
          id: 'user-a',
          content: '看图',
          rawContent: [{ type: 'text', text: '看图', synthetic: true }],
        }),
        userMessage({ id: 'user-b' }),
      ),
    ).toBe(false);
  });

  it('图片附件一致时判定为同一条', () => {
    const rawContent: Message['content'] = [
      { type: 'text', text: '看图' },
      { type: 'input_image', fileId: 'file-1', mimeType: 'image/png' },
    ];

    expect(
      areLikelySameNearbyUserMessage(
        userMessage({ id: 'user-a', content: '看图', rawContent: [...rawContent] }),
        userMessage({ id: 'user-b', content: '看图', rawContent: [...rawContent] }),
      ),
    ).toBe(true);
  });

  it('图片附件不同（fileId 不同）时判定为不同', () => {
    expect(
      areLikelySameNearbyUserMessage(
        userMessage({
          id: 'user-a',
          content: '看图',
          rawContent: [{ type: 'input_image', fileId: 'file-1', mimeType: 'image/png' }],
        }),
        userMessage({
          id: 'user-b',
          content: '看图',
          rawContent: [{ type: 'input_image', fileId: 'file-2', mimeType: 'image/png' }],
        }),
      ),
    ).toBe(false);
  });
});

describe('hasOverlappingPartIds', () => {
  it('任一侧缺失或为空时返回 false', () => {
    expect(hasOverlappingPartIds(undefined, undefined)).toBe(false);
    expect(hasOverlappingPartIds([], [{ id: 'a', type: 'text', text: 'x' }])).toBe(false);
    expect(hasOverlappingPartIds([{ id: 'a', type: 'text', text: 'x' }], [])).toBe(false);
  });

  it('存在共同分片 ID 时返回 true，否则 false', () => {
    const left: ChatMessagePart[] = [{ id: 'shared', type: 'text', text: 'A' }];
    const right: ChatMessagePart[] = [
      { id: 'shared', type: 'text', text: 'B' },
      { id: 'only-right', type: 'text', text: 'C' },
    ];
    const unrelated: ChatMessagePart[] = [{ id: 'other', type: 'text', text: 'D' }];

    expect(hasOverlappingPartIds(left, right)).toBe(true);
    expect(hasOverlappingPartIds(left, unrelated)).toBe(false);
  });
});

describe('hasUserMessageBetween', () => {
  const messages: ChatMessage[] = [
    { id: 'm-0', role: 'assistant', content: 'a' },
    { id: 'm-1', role: 'assistant', content: 'b' },
    { id: 'm-2', role: 'user', content: '问题' },
    { id: 'm-3', role: 'assistant', content: 'c' },
  ];

  it('候选位置在快照位置之后时返回 false', () => {
    expect(hasUserMessageBetween(messages, 3, 1)).toBe(false);
    expect(hasUserMessageBetween(messages, 1, 1)).toBe(false);
  });

  it('中间存在用户消息时返回 true', () => {
    expect(hasUserMessageBetween(messages, 0, 3)).toBe(true);
  });

  it('中间只有助理消息时返回 false', () => {
    expect(hasUserMessageBetween(messages, 0, 1)).toBe(false);
  });

  it('快照位置本身是用户消息时计入区间', () => {
    expect(hasUserMessageBetween(messages, 0, 2)).toBe(true);
  });
});

describe('areMessagesSeparatedByUserTurn', () => {
  it('任一侧时间不可比或时间相同时返回 false', () => {
    expect(
      areMessagesSeparatedByUserTurn(
        { id: 'a', role: 'assistant', content: 'x', createdAt: '不是时间' },
        { id: 'b', role: 'assistant', content: 'y', createdAt: 1_000 },
        [],
      ),
    ).toBe(false);

    expect(
      areMessagesSeparatedByUserTurn(
        { id: 'a', role: 'assistant', content: 'x', createdAt: 1_000 },
        { id: 'b', role: 'assistant', content: 'y', createdAt: 1_000 },
        [{ id: 'u', role: 'user', content: '中间问题', createdAt: 1_000 }],
      ),
    ).toBe(false);
  });

  it('两次时间之间存在用户回合时返回 true', () => {
    const middle: ChatMessage = { id: 'u', role: 'user', content: '中间问题', createdAt: 1_500 };

    expect(
      areMessagesSeparatedByUserTurn(
        { id: 'a', role: 'assistant', content: 'x', createdAt: 1_000 },
        { id: 'b', role: 'assistant', content: 'y', createdAt: 2_000 },
        [middle],
      ),
    ).toBe(true);
  });

  it('用户消息恰好落在边界时间上不算分隔', () => {
    expect(
      areMessagesSeparatedByUserTurn(
        { id: 'a', role: 'assistant', content: 'x', createdAt: 1_000 },
        { id: 'b', role: 'assistant', content: 'y', createdAt: 2_000 },
        [{ id: 'u', role: 'user', content: '边界问题', createdAt: 1_000 }],
      ),
    ).toBe(false);
  });
});
