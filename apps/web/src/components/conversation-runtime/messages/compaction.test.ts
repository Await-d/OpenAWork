/**
 * 共置测试：`compaction.ts`。
 *
 * 压缩（compaction）在客户端有三个来源，且它们在上下文过滤里的语义不同：
 *
 * - `marker`：网关持久化的模型面压缩摘要，是上下文里的权威锚点；
 * - `card`：GenerativeUI 压缩卡片（`type: 'compaction'`）或
 *   `compaction_marker` JSON；
 * - `assistant_event`：运行事件流里同步过来的展示卡片，只用于展示、
 *   不参与上下文计数。
 *
 * 这些测试固定每个来源的解析、去重优先级和 `filterChatMessagesForContext`
 * 的截断规则。
 */
import { describe, expect, it } from 'vitest';
import {
  deduplicateCompactionMessages,
  estimateContextMessageTokens,
  extractNestedCompactionCardContent,
  filterChatMessagesForContext,
  isCompactionMessage,
  readCompactionTranscriptState,
} from './compaction.js';
import { createAssistantEventCardContent, createCompactionCardContent } from './card-codec.js';
import type { ChatMessage } from './message-model.js';
import { createAssistantTraceContent } from './trace-codec.js';

const MARKER_CONTENT = JSON.stringify({
  source: 'openAwork',
  type: 'compaction_marker',
  payload: { summary: '已压缩较早轮次。', tailStartMessageId: 'msg-tail' },
});

function assistantMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: 'msg-1', role: 'assistant', content: '', status: 'completed', ...overrides };
}

describe('readCompactionTranscriptState', () => {
  it('非 assistant 消息返回 null', () => {
    expect(readCompactionTranscriptState({ role: 'user', content: MARKER_CONTENT })).toBeNull();
  });

  it('识别持久化 marker 并保留 tailStartMessageId', () => {
    expect(readCompactionTranscriptState({ role: 'assistant', content: MARKER_CONTENT })).toEqual({
      phase: 'completed',
      source: 'marker',
      summary: '已压缩较早轮次。',
      tailStartMessageId: 'msg-tail',
    });
  });

  it('openawork_internal marker 同样识别，但缺少 summary 时返回 null', () => {
    const internal = JSON.stringify({
      source: 'openawork_internal',
      type: 'compaction_marker',
      payload: { summary: '内部标记摘要' },
    });
    expect(readCompactionTranscriptState({ role: 'assistant', content: internal })).toMatchObject({
      phase: 'completed',
      source: 'marker',
      summary: '内部标记摘要',
    });

    const missingSummary = JSON.stringify({
      source: 'openAwork',
      type: 'compaction_marker',
      payload: {},
    });
    expect(
      readCompactionTranscriptState({ role: 'assistant', content: missingSummary }),
    ).toBeNull();
  });

  it.each([
    ['started', 'started'],
    ['failed', 'failed'],
    ['completed', 'completed'],
    ['unknown-phase', 'completed'],
  ])('compaction 卡片的 phase=%s 映射为 %s', (rawPhase, expectedPhase) => {
    const content = createCompactionCardContent({
      title: 'compact',
      summary: '压缩摘要',
      trigger: 'manual',
      phase: rawPhase as 'started' | 'failed' | 'completed',
    });

    expect(readCompactionTranscriptState({ role: 'assistant', content })).toEqual({
      phase: expectedPhase,
      source: 'card',
      summary: '压缩摘要',
    });
  });

  it.each([
    ['running', 'started'],
    ['error', 'failed'],
    ['success', 'completed'],
    ['paused', 'completed'],
  ])('assistant_event 压缩卡片 status=%s 映射为 %s', (status, expectedPhase) => {
    const content = createAssistantEventCardContent({
      kind: 'compaction',
      title: 'compact',
      message: '已预防性压缩 2 条较早消息。',
      status: status as 'running' | 'error' | 'success' | 'paused',
    });

    expect(readCompactionTranscriptState({ role: 'assistant', content })).toEqual({
      phase: expectedPhase,
      source: 'assistant_event',
      summary: '已预防性压缩 2 条较早消息。',
    });
  });

  it('从 assistant_trace 的内嵌文本解析压缩卡片', () => {
    const content = createAssistantTraceContent({
      text: createCompactionCardContent({
        title: 'compact',
        summary: '内嵌压缩摘要',
        trigger: 'automatic',
      }),
      toolCalls: [],
    });

    expect(readCompactionTranscriptState({ role: 'assistant', content })).toEqual({
      phase: 'completed',
      source: 'card',
      summary: '内嵌压缩摘要',
    });
  });

  it.each([
    ['普通文本', '这是一条普通回复。'],
    ['非法 JSON', '{ 不是 JSON'],
    ['普通 assistant_trace', createAssistantTraceContent({ text: '普通回复', toolCalls: [] })],
  ])('%s 返回 null', (_name, content) => {
    expect(readCompactionTranscriptState({ role: 'assistant', content })).toBeNull();
  });
});

describe('isCompactionMessage', () => {
  it('marker / 卡片 / assistant_event 都判定为压缩消息', () => {
    expect(isCompactionMessage({ role: 'assistant', content: MARKER_CONTENT })).toBe(true);
    expect(
      isCompactionMessage({
        role: 'assistant',
        content: createCompactionCardContent({
          title: 'compact',
          summary: '摘要',
          trigger: 'manual',
        }),
      }),
    ).toBe(true);
    expect(
      isCompactionMessage({
        role: 'assistant',
        content: createAssistantEventCardContent({
          kind: 'compaction',
          title: 'compact',
          message: '摘要',
          status: 'success',
        }),
      }),
    ).toBe(true);
  });

  it('普通文本与用户消息不算压缩消息', () => {
    expect(isCompactionMessage({ role: 'assistant', content: '普通回复' })).toBe(false);
    expect(isCompactionMessage({ role: 'user', content: MARKER_CONTENT })).toBe(false);
  });
});

describe('deduplicateCompactionMessages', () => {
  const startedCard = (clientRequestId: string): ChatMessage =>
    assistantMessage({
      id: 'server-started',
      clientRequestId,
      content: createCompactionCardContent({
        title: 'compact',
        summary: '正在压缩会话上下文。',
        trigger: 'manual',
        phase: 'started',
      }),
    });
  const completedCard = (clientRequestId: string): ChatMessage =>
    assistantMessage({
      id: 'server-completed',
      clientRequestId,
      content: createCompactionCardContent({
        title: 'compact',
        summary: '已压缩较早消息。',
        trigger: 'manual',
        phase: 'completed',
      }),
    });

  it('少于两条消息时原样返回输入数组', () => {
    const single: ChatMessage[] = [assistantMessage({ content: MARKER_CONTENT })];
    expect(deduplicateCompactionMessages(single)).toBe(single);
    const empty: ChatMessage[] = [];
    expect(deduplicateCompactionMessages(empty)).toBe(empty);
  });

  it('同一事件身份取 phase 更完整的消息', () => {
    const identity = 'assistant_event:compaction:run-1';
    const deduplicated = deduplicateCompactionMessages([
      startedCard(identity),
      completedCard(identity),
    ]);

    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0]?.id).toBe('server-completed');
  });

  it('后到的低阶段消息不会回退已有的完整消息', () => {
    const identity = 'assistant_event:compaction:run-1';
    const deduplicated = deduplicateCompactionMessages([
      completedCard(identity),
      startedCard(identity),
    ]);

    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0]?.id).toBe('server-completed');
  });

  it('marker 不参与事件身份去重', () => {
    const messages: ChatMessage[] = [
      assistantMessage({
        id: 'marker-1',
        clientRequestId: 'assistant_event:compaction:x',
        content: MARKER_CONTENT,
      }),
      assistantMessage({
        id: 'marker-2',
        clientRequestId: 'assistant_event:compaction:x',
        content: MARKER_CONTENT,
      }),
    ];

    expect(deduplicateCompactionMessages(messages)).toHaveLength(2);
  });

  it('没有事件身份的普通压缩卡片不会被合并', () => {
    const card = createCompactionCardContent({
      title: 'compact',
      summary: '摘要',
      trigger: 'manual',
      phase: 'started',
    });
    const messages: ChatMessage[] = [
      assistantMessage({ id: 'card-a', content: card }),
      assistantMessage({ id: 'card-b', content: card }),
    ];

    expect(deduplicateCompactionMessages(messages).map((message) => message.id)).toEqual([
      'card-a',
      'card-b',
    ]);
  });
});

describe('filterChatMessagesForContext', () => {
  it('空数组原样返回', () => {
    const empty: ChatMessage[] = [];
    expect(filterChatMessagesForContext(empty)).toBe(empty);
  });

  it('marker 带 tailStartMessageId 时把它到 marker 之间的消息一起保留', () => {
    const markerWithTail = JSON.stringify({
      source: 'openAwork',
      type: 'compaction_marker',
      payload: { summary: '已压缩较早轮次。', tailStartMessageId: 'old-user' },
    });
    const messages: ChatMessage[] = [
      { id: 'old-user', role: 'user', content: '旧历史' },
      assistantMessage({ id: 'marker-1', content: markerWithTail }),
      assistantMessage({
        id: 'display-card',
        content: createCompactionCardContent({
          title: 'compact',
          summary: '展示用压缩卡片',
          trigger: 'automatic',
          phase: 'completed',
        }),
      }),
      { id: 'new-user', role: 'user', content: '新问题' },
    ];

    const effective = filterChatMessagesForContext(messages);

    expect(effective.map((message) => message.id)).toEqual(['marker-1', 'old-user', 'new-user']);
  });

  it('没有 marker 时从最后一条 completed 压缩卡片开始截断', () => {
    const messages: ChatMessage[] = [
      { id: 'old-user', role: 'user', content: '旧历史' },
      assistantMessage({
        id: 'card-started',
        content: createCompactionCardContent({
          title: 'compact',
          summary: '正在压缩',
          trigger: 'manual',
          phase: 'started',
        }),
      }),
      assistantMessage({
        id: 'card-completed',
        content: createCompactionCardContent({
          title: 'compact',
          summary: '已完成压缩',
          trigger: 'manual',
          phase: 'completed',
        }),
      }),
    ];

    expect(filterChatMessagesForContext(messages).map((message) => message.id)).toEqual([
      'card-completed',
    ]);
  });

  it('只有非 completed 的压缩卡片时不截断', () => {
    const messages: ChatMessage[] = [
      { id: 'old-user', role: 'user', content: '旧历史' },
      assistantMessage({
        id: 'card-started',
        content: createCompactionCardContent({
          title: 'compact',
          summary: '正在压缩',
          trigger: 'manual',
          phase: 'started',
        }),
      }),
    ];

    expect(filterChatMessagesForContext(messages)).toHaveLength(2);
  });

  it('没有任何压缩消息时返回全部消息', () => {
    const messages: ChatMessage[] = [
      { id: 'u-1', role: 'user', content: '问题' },
      assistantMessage({ id: 'a-1', content: '回答' }),
    ];

    expect(filterChatMessagesForContext(messages)).toHaveLength(2);
  });
});

describe('estimateContextMessageTokens', () => {
  it('completed marker 按固定前缀加摘要估算', () => {
    const summary = '已压缩较早轮次。';
    const message = assistantMessage({ content: MARKER_CONTENT });

    expect(estimateContextMessageTokens(message)).toBe(
      Math.max(1, Math.round(`What did we do so far?\n\n${summary}`.length / 4)),
    );
  });

  it('未完成的压缩卡片估算为 0', () => {
    const message = assistantMessage({
      content: createCompactionCardContent({
        title: 'compact',
        summary: '正在压缩',
        trigger: 'manual',
        phase: 'started',
      }),
    });

    expect(estimateContextMessageTokens(message)).toBe(0);
  });

  it.each([
    ['status 卡片', JSON.stringify({ type: 'status', payload: { title: 'x', message: 'y' } })],
    ['tool_call 卡片', JSON.stringify({ type: 'tool_call', payload: {} })],
    ['form 卡片', JSON.stringify({ type: 'form', payload: {} })],
    ['code_diff 卡片', JSON.stringify({ type: 'code_diff', payload: {} })],
  ])('%s 估算为 0', (_name, content) => {
    const message: ChatMessage = { id: 'a-1', role: 'assistant', content };
    expect(estimateContextMessageTokens(message)).toBe(0);
  });

  it('assistant_event 卡片估算为 0', () => {
    const message = assistantMessage({
      content: createAssistantEventCardContent({
        kind: 'task',
        title: '任务',
        message: '详情',
        status: 'running',
      }),
    });

    expect(estimateContextMessageTokens(message)).toBe(0);
  });

  it('优先使用显式 tokenEstimate，否则按正文长度估算', () => {
    expect(
      estimateContextMessageTokens({ id: 'u-1', role: 'user', content: 'abc', tokenEstimate: 42 }),
    ).toBe(42);
    expect(estimateContextMessageTokens({ id: 'u-2', role: 'user', content: 'abcdefgh' })).toBe(2);
    expect(estimateContextMessageTokens({ id: 'u-3', role: 'user', content: '' })).toBe(0);
  });
});

describe('extractNestedCompactionCardContent', () => {
  it('直接卡片按规范化结果返回', () => {
    const content = createCompactionCardContent({
      title: 'compact',
      summary: '直接卡片摘要',
      trigger: 'manual',
      phase: 'completed',
    });

    const extracted = extractNestedCompactionCardContent(content);
    expect(extracted).not.toBeNull();
    expect(JSON.parse(extracted as string)).toEqual({
      type: 'compaction',
      payload: {
        title: 'compact',
        summary: '直接卡片摘要',
        trigger: 'manual',
        phase: 'completed',
      },
    });
  });

  it('assistant_event 压缩卡片转换为 automatic 卡片', () => {
    const content = createAssistantEventCardContent({
      kind: 'compaction',
      title: 'compact',
      message: '已预防性压缩 2 条较早消息。',
      status: 'success',
    });

    const extracted = extractNestedCompactionCardContent(content);
    expect(JSON.parse(extracted as string)).toEqual({
      type: 'compaction',
      payload: {
        title: 'compact',
        summary: '已预防性压缩 2 条较早消息。',
        trigger: 'automatic',
        phase: 'completed',
      },
    });
  });

  it.each([
    ['running', 'started'],
    ['error', 'failed'],
  ])('assistant_event status=%s 映射为 phase=%s', (status, expectedPhase) => {
    const content = createAssistantEventCardContent({
      kind: 'compaction',
      title: 'compact',
      message: '压缩进行中。',
      status: status as 'running' | 'error',
    });

    expect(JSON.parse(extractNestedCompactionCardContent(content) as string)).toMatchObject({
      payload: { phase: expectedPhase, trigger: 'automatic' },
    });
  });

  it('assistant_event 标题为空时回退为 compact', () => {
    const content = createAssistantEventCardContent({
      kind: 'compaction',
      title: '',
      message: '无标题压缩。',
      status: 'success',
    });

    expect(JSON.parse(extractNestedCompactionCardContent(content) as string)).toMatchObject({
      payload: { title: 'compact' },
    });
  });

  it('内嵌于 assistant_trace 文本中的压缩卡片可被提取', () => {
    const content = createAssistantTraceContent({
      text: createCompactionCardContent({
        title: 'compact',
        summary: '内嵌摘要',
        trigger: 'automatic',
      }),
      toolCalls: [],
    });

    expect(JSON.parse(extractNestedCompactionCardContent(content) as string)).toEqual({
      type: 'compaction',
      payload: { title: 'compact', summary: '内嵌摘要', trigger: 'automatic' },
    });
  });

  it.each([
    ['普通文本', '这是普通回复内容。'],
    ['非法 JSON', '{ 不是 JSON'],
    [
      '内嵌普通文本的 assistant_trace',
      createAssistantTraceContent({ text: '普通回复', toolCalls: [] }),
    ],
    ['status 卡片', JSON.stringify({ type: 'status', payload: { title: 'x', message: 'y' } })],
  ])('%s 返回 null', (_name, content) => {
    expect(extractNestedCompactionCardContent(content)).toBeNull();
  });
});
