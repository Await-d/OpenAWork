/**
 * message-model 是纯类型模块（没有任何运行时导出），因此本文件是一份
 * **编译期契约测试**：用 `Partial<ChatMessage>` 覆盖全部可选字段、用穷尽
 * switch 区分 `ChatMessagePart` 的四个变体、并以字面量数组钉住
 * `ReasoningEffort` / `AssistantEventKind` / `AssistantEventStatus` 的取值集合。
 *
 * 运行期断言只确认构造出的对象可被读取；真正的门禁是
 * `pnpm --filter @openAwork/web typecheck` 必须在类型面被破坏时失败。
 */
import { describe, expect, it } from 'vitest';
import type {
  AssistantEventKind,
  AssistantEventPayload,
  AssistantEventStatus,
  ChatEventPart,
  ChatInputImageItem,
  ChatMessage,
  ChatMessagePart,
  ChatReasoningPart,
  ChatTextPart,
  ChatToolPart,
  ChatUsageDetails,
  ReasoningEffort,
} from './message-model.js';

const REASONING_EFFORTS: ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

const EVENT_KINDS: AssistantEventKind[] = [
  'agent',
  'audit',
  'compaction',
  'mcp',
  'permission',
  'question',
  'skill',
  'task',
  'tool',
];

const EVENT_STATUSES: AssistantEventStatus[] = ['error', 'paused', 'running', 'success'];

function buildMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'answer',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function buildTextPart(text: string): ChatTextPart {
  return { id: `text-${text}`, type: 'text', text };
}

function buildReasoningPart(text: string): ChatReasoningPart {
  return { id: `reasoning-${text}`, type: 'reasoning', text, startedAt: 10, endedAt: 20 };
}

function buildToolPart(overrides: Partial<ChatToolPart> = {}): ChatToolPart {
  return {
    id: 'tool-1',
    type: 'tool',
    toolCallId: 'tool-1',
    toolName: 'read',
    input: {},
    ...overrides,
  };
}

function buildEventPart(kind: AssistantEventKind = 'audit'): ChatEventPart {
  return {
    id: `event-${kind}`,
    type: 'event',
    payload: { kind, message: 'message', status: 'success', title: 'title' },
  };
}

/** 穷尽 switch：新增 part 变体时 TS 会在 default 分支的 never 校验处报错。 */
function renderPart(part: ChatMessagePart): string {
  switch (part.type) {
    case 'text':
      return `text:${part.text}`;
    case 'reasoning':
      return `reasoning:${part.text}:${part.startedAt ?? -1}:${part.endedAt ?? -1}`;
    case 'tool':
      return `tool:${part.toolName}:${part.status ?? 'unknown'}`;
    case 'event':
      return `event:${part.payload.kind}:${part.payload.status}`;
    default: {
      const exhaustive: never = part;
      return exhaustive;
    }
  }
}

describe('message-model 类型面（编译期覆盖，无运行时导出）', () => {
  it('ChatMessage 的全部可选字段可被构造并读取', () => {
    const message = buildMessage({
      clientRequestId: 'req-1',
      parts: [
        buildReasoningPart('plan'),
        buildTextPart('answer'),
        buildToolPart({ status: 'completed', output: { ok: true } }),
        buildEventPart(),
      ],
      rawContent: [{ type: 'text', text: 'answer' }],
      model: 'gpt-5',
      providerId: 'openai',
      agentId: 'sisyphus-junior',
      durationMs: 1_200,
      firstTokenLatencyMs: 200,
      stopReason: 'end_turn',
      tokenEstimate: 12,
      providerUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      toolCallCount: 1,
      modifiedFilesSummary: {
        type: 'modified_files_summary',
        title: 'modified files',
        summary: 'summary',
        files: [],
      },
      status: 'completed',
      reasoningBlocksEndedFlags: [true],
      reasoningBlocksDurationsMs: [150],
    });

    expect(message.role).toBe('assistant');
    expect(message.parts?.map(renderPart)).toEqual([
      'reasoning:plan:10:20',
      'text:answer',
      'tool:read:completed',
      'event:audit:success',
    ]);
    expect(message.stopReason).toBe('end_turn');
    expect(message.modifiedFilesSummary?.type).toBe('modified_files_summary');
  });

  it('ChatMessagePart 的四个变体都能被穷尽区分', () => {
    const parts: ChatMessagePart[] = [
      buildTextPart('t'),
      buildReasoningPart('r'),
      buildToolPart({ kind: 'mcp', status: 'failed', isError: true }),
      buildEventPart('compaction'),
    ];

    expect(parts.map(renderPart)).toEqual([
      'text:t',
      'reasoning:r:10:20',
      'tool:read:failed',
      'event:compaction:success',
    ]);
  });

  it('ChatToolPart 状态联合覆盖 running / paused / completed / failed', () => {
    const statuses: Array<NonNullable<ChatToolPart['status']>> = [
      'running',
      'paused',
      'completed',
      'failed',
    ];

    for (const status of statuses) {
      expect(buildToolPart({ status }).status).toBe(status);
    }
    expect(
      buildToolPart({ pendingPermissionRequestId: 'perm-1', resumedAfterApproval: true }),
    ).toMatchObject({ pendingPermissionRequestId: 'perm-1', resumedAfterApproval: true });
  });

  it('ChatUsageDetails / ChatInputImageItem / AssistantEventPayload 字面量取值集合稳定', () => {
    const usage: ChatUsageDetails = {
      requestIndex: 0,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 2,
      cacheWriteTokens: 3,
      estimatedCostUsd: 0.012,
      durationMs: 900,
      firstTokenLatencyMs: 120,
      tokensPerSecond: 5.5,
    };
    const image: ChatInputImageItem = {
      artifactId: 'artifact-1',
      detail: 'original',
      fileId: 'file-1',
      fileName: 'photo.png',
      imageUrl: 'https://example.test/photo.png',
      mimeType: 'image/png',
    };
    const payload: AssistantEventPayload = {
      kind: EVENT_KINDS[0]!,
      message: 'message',
      requestId: 'req-1',
      status: EVENT_STATUSES[0]!,
      title: 'title',
    };

    expect(usage.totalTokens).toBe(15);
    expect(image.detail).toBe('original');
    expect(payload.kind).toBe('agent');
    expect(REASONING_EFFORTS).toHaveLength(7);
    expect(EVENT_KINDS).toContain('question');
    expect(EVENT_STATUSES).toEqual(['error', 'paused', 'running', 'success']);
  });
});
