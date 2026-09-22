/**
 * 共置测试：`normalize-chat-messages.ts`。
 *
 * `normalizeChatMessages` 是历史恢复（recovery reload）的唯一入口，负责把
 * 网关持久化的 `Message[]` 投影成 UI 的 `ChatMessage[]`。这里的测试固定：
 *
 * - 规范化输出的字段集与状态推断（stopReason → status）；
 * - 字符串内容的三条分支（纯文本 / legacy tool_call JSON / assistant_trace）；
 * - 数组内容的分片投影（wire 顺序、tool_result 合并、图片与 synthetic 过滤）；
 * - 无法识别的记录被静默跳过，不产出半成品消息。
 */
import { describe, expect, it } from 'vitest';
import { normalizeChatMessages } from './normalize-chat-messages.js';
import type { ChatMessage, ChatToolPart } from './message-model.js';
import { createAssistantTraceContent, parseAssistantTraceContent } from './trace-codec.js';

const LEGACY_TOOL_CALL = JSON.stringify({
  type: 'tool_call',
  payload: {
    toolCallId: 'tc-1',
    toolName: 'Bash',
    kind: 'tool',
    input: { command: 'ls' },
    status: 'completed',
  },
});

/** `computer_use` 最终截图的 tool result 附件形态（网关只下发 artifactId）。 */
const GUI_SNAPSHOT = {
  type: 'input_image' as const,
  artifactId: 'artifact-gui-1',
  fileName: 'computer-use-final.png',
  mimeType: 'image/png',
};

function firstMessage(rawMessages: unknown): ChatMessage | undefined {
  return normalizeChatMessages(rawMessages)[0];
}

function requireFirstMessage(rawMessages: unknown): ChatMessage {
  const message = firstMessage(rawMessages);
  if (!message) {
    throw new Error('期望 normalizeChatMessages 产出至少一条消息');
  }
  return message;
}

describe('normalizeChatMessages · 输入与字段集', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['字符串', 'not-an-array'],
    ['对象', { role: 'user', content: 'x' }],
    ['数字', 42],
  ])('非数组输入（%s）返回空数组', (_name, input) => {
    expect(normalizeChatMessages(input)).toEqual([]);
  });

  it('普通文本消息输出规范化字段集', () => {
    const message = requireFirstMessage([
      {
        id: 'u-1',
        role: 'user',
        content: '你好',
        createdAt: 1_700_000_000_000,
        model: 'gpt-5',
        providerId: 'openai',
        agentId: 'agent-1',
        durationMs: 10,
        firstTokenLatencyMs: 5,
        stopReason: 'end_turn',
        tokenEstimate: 7,
      },
    ]);

    expect(Object.keys(message).sort()).toEqual([
      'agentId',
      'clientRequestId',
      'content',
      'createdAt',
      'durationMs',
      'firstTokenLatencyMs',
      'id',
      'model',
      'providerId',
      'providerUsage',
      'role',
      'status',
      'stopReason',
      'tokenEstimate',
    ]);
    expect(message).toMatchObject({
      id: 'u-1',
      role: 'user',
      content: '你好',
      createdAt: 1_700_000_000_000,
      model: 'gpt-5',
      providerId: 'openai',
      agentId: 'agent-1',
      durationMs: 10,
      firstTokenLatencyMs: 5,
      stopReason: 'end_turn',
      tokenEstimate: 7,
      status: 'completed',
    });
  });

  it('缺失 id 时生成随机 id，缺失时间时使用当前时间', () => {
    const before = Date.now();
    const message = requireFirstMessage([{ role: 'user', content: '没有 ID' }]);

    expect(typeof message.id).toBe('string');
    expect(message.id.length).toBeGreaterThan(0);
    expect(message.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('非有限数值与非法 providerUsage 被忽略', () => {
    const message = requireFirstMessage([
      {
        id: 'u-1',
        role: 'user',
        content: 'x',
        durationMs: Number.NaN,
        firstTokenLatencyMs: Number.POSITIVE_INFINITY,
        tokenEstimate: Number.NaN,
        providerUsage: { inputTokens: 'many' },
      },
    ]);

    expect(message.durationMs).toBeUndefined();
    expect(message.firstTokenLatencyMs).toBeUndefined();
    expect(message.tokenEstimate).toBeUndefined();
    expect(message.providerUsage).toBeUndefined();
  });

  it('合法 providerUsage 被规范化保留', () => {
    const message = requireFirstMessage([
      {
        id: 'u-1',
        role: 'user',
        content: 'x',
        providerUsage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          reasoningTokens: 3,
          cacheReadTokens: -5,
        },
      },
    ]);

    expect(message.providerUsage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      reasoningTokens: 3,
      cacheReadTokens: 0,
    });
  });

  it.each([
    ['stopReason=error', { stopReason: 'error' }, 'error'],
    ['stopReason=cancelled', { stopReason: 'cancelled' }, 'cancelled'],
    ['显式 status 优先', { status: 'streaming', stopReason: 'error' }, 'streaming'],
    ['legacy status=final', { status: 'final' }, 'completed'],
  ])('状态推断：%s', (_name, overrides, expectedStatus) => {
    const message = requireFirstMessage([
      { id: 'a-1', role: 'assistant', content: '内容', ...overrides },
    ]);

    expect(message.status).toBe(expectedStatus);
  });

  it('跳过非法记录、未知角色与字符串内容的 tool 消息', () => {
    const messages = normalizeChatMessages([
      null,
      undefined,
      'junk',
      42,
      { role: 'system', content: '系统消息' },
      { role: 'tool', content: '字符串工具内容' },
      {
        id: 's-1',
        role: 'synthetic',
        content: '子代理已完成 · 审计会话唤醒原语',
        description: '审计会话唤醒原语',
        metadata: { source: 'subagent', childID: 'child-1', agent: 'explore', state: 'completed' },
      },
      { id: 'u-1', role: 'user', content: '保留我' },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe('u-1');
  });

  it('synthetic（网关注入的子代理通知）不得进入 transcript', () => {
    const messages = normalizeChatMessages([
      {
        id: 's-2',
        role: 'synthetic',
        content: '子代理已失败 · 修复登录',
        description: '修复登录',
        metadata: { source: 'subagent', childID: 'child-2', agent: 'general', state: 'error' },
        createdAt: 1,
      },
    ]);

    expect(messages).toHaveLength(0);
  });
});

describe('normalizeChatMessages · 字符串内容分支', () => {
  it('legacy tool_call JSON 独立成消息', () => {
    const message = requireFirstMessage([
      { id: 'a-1', role: 'assistant', content: LEGACY_TOOL_CALL, createdAt: 1 },
    ]);

    const trace = parseAssistantTraceContent(message.content);
    expect(trace?.text).toBe('');
    expect(trace?.toolCalls[0]).toMatchObject({
      toolCallId: 'tc-1',
      toolName: 'Bash',
      status: 'completed',
    });
    expect(message).toMatchObject({ role: 'assistant', toolCallCount: 1, tokenEstimate: 0 });
  });

  it('相邻的 legacy tool_call 追加到上一条助手消息', () => {
    const messages = normalizeChatMessages([
      { id: 'a-1', role: 'assistant', content: '先说明。', createdAt: 1 },
      { id: 'a-2', role: 'assistant', content: LEGACY_TOOL_CALL, createdAt: 2 },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe('a-1');
    const trace = parseAssistantTraceContent(messages[0]?.content ?? '');
    expect(trace?.text).toBe('先说明。');
    expect(trace?.toolCalls).toHaveLength(1);
    expect(messages[0]?.toolCallCount).toBe(1);
  });

  it('assistant_trace JSON 生成 parts 并保留原始内容', () => {
    const content = createAssistantTraceContent({
      text: '回答',
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'Read', input: { file: 'a.ts' } }],
    });
    const message = requireFirstMessage([{ id: 'a-1', role: 'assistant', content, createdAt: 1 }]);

    expect(message.content).toBe(content);
    expect(message.toolCallCount).toBe(1);
    expect(message.parts?.map((part) => part.type)).toEqual(['text', 'tool']);
  });

  it('普通 assistant 文本不生成 parts', () => {
    const message = requireFirstMessage([
      { id: 'a-1', role: 'assistant', content: '普通回答', createdAt: 1 },
    ]);

    expect(message.parts).toBeUndefined();
    expect(message.content).toBe('普通回答');
  });
});

describe('normalizeChatMessages · 数组内容分支', () => {
  it('assistant 数组按 wire 顺序生成 parts 并合并 tool_result', () => {
    const message = requireFirstMessage([
      {
        id: 'a-1',
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '先分析', startedAt: 1, endedAt: 2 },
          { type: 'text', text: '执行中' },
          { type: 'tool_call', toolCallId: 'tc-1', toolName: 'Bash', input: { command: 'ls' } },
          {
            type: 'tool_result',
            toolCallId: 'tc-1',
            toolName: 'Bash',
            output: 'ok',
            isError: false,
          },
          { type: 'text', text: '完成' },
        ],
        createdAt: 1,
      },
    ]);

    expect(message.parts?.map((part) => part.type)).toEqual(['reasoning', 'text', 'tool', 'text']);
    expect(message.parts?.[2]).toMatchObject({ status: 'completed', output: 'ok' });
    expect(message.toolCallCount).toBe(1);
    expect(message.tokenEstimate).toBeGreaterThan(0);
    expect(parseAssistantTraceContent(message.content)?.text).toBe('执行中\n完成');
  });

  it('assistant 数组中的 tool_result 带待审批请求时工具为 paused', () => {
    const message = requireFirstMessage([
      {
        id: 'a-1',
        role: 'assistant',
        content: [
          { type: 'tool_call', toolCallId: 'tc-1', toolName: 'Bash', input: {} },
          {
            type: 'tool_result',
            toolCallId: 'tc-1',
            toolName: 'Bash',
            output: 'waiting for approval',
            isError: false,
            pendingPermissionRequestId: 'req-1',
          },
        ],
        createdAt: 1,
      },
    ]);

    const tool = message.parts?.[0] as ChatToolPart | undefined;
    expect(tool).toMatchObject({ status: 'paused', pendingPermissionRequestId: 'req-1' });
  });

  it('assistant 数组缺少可渲染分片时跳过整条消息', () => {
    expect(
      normalizeChatMessages([
        { id: 'a-1', role: 'assistant', content: [{ type: 'mystery' }], createdAt: 1 },
      ]),
    ).toEqual([]);
  });

  it('user 数组内容过滤 synthetic 文本、提取图片并保留 rawContent', () => {
    const rawContent = [
      { type: 'text', text: '<system-reminder>caps</system-reminder>', synthetic: true },
      { type: 'text', text: '看图' },
      { type: 'input_image', fileId: 'file-1', mimeType: 'image/png' },
    ];
    const message = requireFirstMessage([{ id: 'u-1', role: 'user', content: rawContent }]);

    expect(message).toMatchObject({ role: 'user', content: '看图', status: 'completed' });
    expect(message.rawContent).toBe(rawContent);
  });

  it('user 数组仅含图片时保留空文本消息', () => {
    const message = requireFirstMessage([
      { id: 'u-1', role: 'user', content: [{ type: 'input_image', fileId: 'file-1' }] },
    ]);

    expect(message.content).toBe('');
    expect(message.status).toBe('completed');
  });

  it('user 数组既无文本又无图片时跳过', () => {
    expect(
      normalizeChatMessages([{ id: 'u-1', role: 'user', content: [{ type: 'text', text: ' ' }] }]),
    ).toEqual([]);
    expect(normalizeChatMessages([{ id: 'u-1', role: 'user', content: [] }])).toEqual([]);
  });

  it('tool_result 合并进前面的 assistant 消息并同步 parts', () => {
    const messages = normalizeChatMessages([
      {
        id: 'a-1',
        role: 'assistant',
        content: [
          { type: 'text', text: '执行工具' },
          { type: 'tool_call', toolCallId: 'tc-1', toolName: 'Bash', input: { command: 'ls' } },
        ],
        createdAt: 1,
      },
      {
        id: 't-1',
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'tc-1',
            toolName: 'Bash',
            output: 'ok',
            isError: false,
          },
        ],
        createdAt: 2,
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(parseAssistantTraceContent(messages[0]?.content ?? '')?.toolCalls[0]).toMatchObject({
      status: 'completed',
      output: 'ok',
    });
    expect(messages[0]?.parts?.[1]).toMatchObject({ status: 'completed', output: 'ok' });
  });

  it('跨消息合并 tool_result 时把 attachments 同步到 parts', () => {
    const messages = normalizeChatMessages([
      {
        id: 'a-gui',
        role: 'assistant',
        content: [
          { type: 'text', text: '开始 GUI 操作' },
          {
            type: 'tool_call',
            toolCallId: 'tc-gui',
            toolName: 'computer_use',
            input: { instruction: '打开系统设置' },
          },
        ],
        createdAt: 1,
      },
      {
        id: 't-gui',
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'tc-gui',
            toolName: 'computer_use',
            output: '{"success":true}',
            isError: false,
            attachments: [GUI_SNAPSHOT],
          },
        ],
        createdAt: 2,
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts?.[1]).toMatchObject({ attachments: [GUI_SNAPSHOT] });
  });

  it('孤立 tool_result 的回退消息保留 attachments', () => {
    const message = requireFirstMessage([
      {
        id: 't-gui-orphan',
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'tc-gui-orphan',
            toolName: 'computer_use',
            output: '{"success":true}',
            isError: false,
            attachments: [GUI_SNAPSHOT],
          },
        ],
        createdAt: 5,
      },
    ]);

    const tool = message.parts?.find((part): part is ChatToolPart => part.type === 'tool');
    expect(tool?.attachments).toEqual([GUI_SNAPSHOT]);
  });

  it('孤立的 tool_result 生成回退消息', () => {
    const message = requireFirstMessage([
      {
        id: 't-1',
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'tc-orphan',
            toolName: 'Bash',
            output: 'x',
            isError: false,
          },
        ],
        createdAt: 5,
      },
    ]);

    expect(message).toMatchObject({
      id: 't-1:tool-fallback',
      role: 'assistant',
      toolCallCount: 1,
      status: 'completed',
      createdAt: 5,
    });
    const trace = parseAssistantTraceContent(message.content);
    expect(trace?.toolCalls[0]).toMatchObject({
      toolCallId: 'tc-orphan',
      toolName: 'Bash',
      input: {},
      status: 'completed',
    });
  });

  it('孤立的错误 tool_result 回退消息状态为 error', () => {
    const message = requireFirstMessage([
      {
        id: 't-2',
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'tc-orphan',
            toolName: 'Bash',
            output: 'boom',
            isError: true,
          },
        ],
      },
    ]);

    expect(message.status).toBe('error');
    expect(parseAssistantTraceContent(message.content)?.toolCalls[0]).toMatchObject({
      status: 'failed',
      isError: true,
      output: 'boom',
    });
  });
});
