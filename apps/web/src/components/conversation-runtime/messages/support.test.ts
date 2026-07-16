/**
 * Coverage for the wire-faithful parts pipeline in `support.ts`.
 *
 * `partsFromOrderedAssistantContent` is what `normalizeChatMessages` uses
 * to project the gateway's structured `MessageContent[]` array into the
 * client's ordered `ChatMessagePart[]` model. A regression here would
 * silently re-flatten persisted history into the legacy
 * reasoning → text → tool ordering, so we pin every shape that ChatPage
 * relies on:
 *
 * - reasoning / text / tool_call segments are emitted in the same order
 *   they appear in the wire content array;
 * - timing fields on reasoning segments are forwarded;
 * - tool segments default to `status: 'completed'` and reuse the wire
 *   `toolCallId` as the part `id` (so reconcilePartsById can match
 *   later snapshot/refresh updates by that stable id);
 * - whitespace-only text segments are dropped (matching the on-wire
 *   sanitization done by the gateway).
 *
 * `applyToolResultToLocalAssistantMessages` is the live-stream path that
 * writes a `tool_result` event onto an already-rendered assistant
 * message. The trailing-segment ordering tests here ensure that updating
 * a tool's output never re-orders the surrounding parts.
 */
import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@openAwork/shared';
import {
  applyToolResultToLocalAssistantMessages,
  normalizeChatMessages,
  partsFromOrderedAssistantContent,
  reconcileSnapshotChatMessages,
  type ChatMessage,
  type ChatMessagePart,
  type ChatToolPart,
} from './support.js';

const MSG_ID = 'msg-1';

describe('normalizeChatMessages', () => {
  it('保留恢复消息里的 agentId，供 team 对话按来源层级渲染身份', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-agent-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        createdAt: 1,
        agentId: 'prometheus',
      },
    ]);

    expect(messages[0]?.agentId).toBe('prometheus');
  });

  it('preserves assistant provider usage from recovered messages', () => {
    const messages = normalizeChatMessages([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        createdAt: 1,
        providerUsage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 130,
          reasoningTokens: 5,
          cacheReadTokens: 5,
        },
      },
    ]);

    expect(messages[0]?.providerUsage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 130,
      reasoningTokens: 5,
      cacheReadTokens: 5,
    });
  });

  // Regression: persistStreamUserMessage wraps the user's typed text with
  // `synthetic: true` text parts (`<system-reminder>` capability block before,
  // `[thinking-hint]` after) so the prompt-cache prefix stays byte-stable
  // across turns. Those parts must NEVER surface in the displayed message
  // — without filtering, an upstream error (e.g. context_length_exceeded)
  // followed by a recovery reload makes the user feel their typed text was
  // lost / replaced because the recovery payload's user message renders
  // as the synthetic blocks wrapped around their original text.
  it('drops synthetic text parts from recovered user messages', () => {
    const messages = normalizeChatMessages([
      {
        id: 'user-1',
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<system-reminder>\nCAPS\n</system-reminder>',
            synthetic: true,
          },
          { type: 'text', text: 'search for React 19' },
          {
            type: 'text',
            text: '\n[请用中文进行思考。]',
            synthetic: true,
          },
        ],
        createdAt: 1,
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toBe('search for React 19');
  });

  it('drops synthetic-only user messages so empty system reminders never surface', () => {
    const messages = normalizeChatMessages([
      {
        id: 'user-1',
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<system-reminder>\nCAPS\n</system-reminder>',
            synthetic: true,
          },
        ],
        createdAt: 1,
      },
    ]);

    expect(messages).toHaveLength(0);
  });
});

describe('partsFromOrderedAssistantContent', () => {
  it('preserves wire-arrival ordering of reasoning / text / tool segments', () => {
    const wire = [
      { type: 'reasoning', text: 'analysing', startedAt: 1, endedAt: 2 },
      { type: 'text', text: 'first answer' },
      { type: 'tool_call', toolCallId: 'tool-A', toolName: 'fetch', input: {} },
      { type: 'text', text: 'follow-up' },
      { type: 'tool_call', toolCallId: 'tool-B', toolName: 'echo', input: { msg: 'hi' } },
    ];
    const parts = partsFromOrderedAssistantContent(MSG_ID, wire);
    expect(parts.map((part) => part.type)).toEqual(['reasoning', 'text', 'tool', 'text', 'tool']);
    expect(parts[0]).toMatchObject({
      type: 'reasoning',
      text: 'analysing',
      startedAt: 1,
      endedAt: 2,
    });
    const toolA = parts[2] as ChatToolPart;
    expect(toolA.toolCallId).toBe('tool-A');
    expect(toolA.id).toBe('tool-A');
    // Without a paired tool_result the tool is still in flight.
    expect(toolA.status).toBe('running');
    expect(toolA.output).toBeUndefined();
    const toolB = parts[4] as ChatToolPart;
    expect(toolB.toolCallId).toBe('tool-B');
    expect(toolB.input).toEqual({ msg: 'hi' });
    expect(toolB.status).toBe('running');
  });

  it('keeps multiple distinct text parts when interleaved with tools', () => {
    const wire = [
      { type: 'text', text: 'hi ' },
      { type: 'tool_call', toolCallId: 't1', toolName: 'a', input: {} },
      { type: 'text', text: 'mid' },
    ];
    const parts = partsFromOrderedAssistantContent(MSG_ID, wire);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.type)).toEqual(['text', 'tool', 'text']);
    // Stable ids: first text has the bare suffix, later text gets a counter.
    expect(parts[0]?.id).toBe(`${MSG_ID}:text`);
    expect(parts[2]?.id).toBe(`${MSG_ID}:text:1`);
  });

  it('drops whitespace-only text segments', () => {
    const wire = [
      { type: 'text', text: '   ' },
      { type: 'text', text: '\n\t' },
      { type: 'text', text: 'real' },
    ];
    const parts = partsFromOrderedAssistantContent(MSG_ID, wire);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'text', text: 'real' });
  });

  it('drops empty reasoning segments — including encryptedContent placeholders', () => {
    // The gateway persists empty reasoning blocks in two situations:
    //   1. a `thinking_end` event arriving without any matching `thinking_delta`
    //   2. a placeholder created in `buildAssistantContent` to carry the
    //      OpenAI Responses API `encryptedContent` / `summary` / `responseId`
    //      so a follow-up turn can hand the encrypted reasoning back to the
    //      model. Both must NOT render as a "Thinking:" header with no body.
    const wire = [
      { type: 'reasoning', text: '' },
      { type: 'reasoning', text: '   \n\t' },
      {
        type: 'reasoning',
        text: '',
        encryptedContent: 'opaque-base64-blob',
        summary: 'r-summary',
      },
      { type: 'reasoning', text: 'real thought', startedAt: 1, endedAt: 2 },
      { type: 'text', text: 'final answer' },
    ];
    const parts = partsFromOrderedAssistantContent(MSG_ID, wire);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ type: 'reasoning', text: 'real thought' });
    expect(parts[1]).toMatchObject({ type: 'text', text: 'final answer' });
  });

  it('skips unsupported entries silently', () => {
    const wire = [
      null,
      undefined,
      'string-junk',
      { type: 'mystery' },
      { type: 'reasoning', text: 'ok' },
    ];
    const parts = partsFromOrderedAssistantContent(MSG_ID, wire as unknown[]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'reasoning', text: 'ok' });
  });

  it('falls back to a synthetic id when toolCallId is missing on a tool_call', () => {
    const wire = [{ type: 'tool_call', toolCallId: '', toolName: 'unnamed', input: {} }];
    const parts = partsFromOrderedAssistantContent(MSG_ID, wire);
    expect(parts).toHaveLength(1);
    const tool = parts[0] as ChatToolPart;
    expect(tool.toolCallId).toBe('');
    expect(tool.id).toBe(`${MSG_ID}:tool:0`);
  });

  it('merges a tool_result onto the matching tool part by toolCallId', () => {
    // The V2 projection in the gateway emits tool_call and tool_result
    // back-to-back inside the assistant message's own content array, so
    // the only place that can attach `output` to the rendered ChatToolPart
    // is right here. If this regresses, GenerateImageToolCard (and every
    // other card that reads `part.output`) silently shows a header-only
    // "completed" state with no body — the bug the user reported.
    const wire = [
      {
        type: 'tool_call',
        toolCallId: 'tool-A',
        toolName: 'generate_image',
        input: { prompt: 'cat' },
      },
      {
        type: 'tool_result',
        toolCallId: 'tool-A',
        toolName: 'generate_image',
        output: '{"success":true,"artifactId":"art-1"}',
        isError: false,
      },
    ];
    const parts = partsFromOrderedAssistantContent(MSG_ID, wire);
    expect(parts).toHaveLength(1);
    const tool = parts[0] as ChatToolPart;
    expect(tool.toolCallId).toBe('tool-A');
    expect(tool.status).toBe('completed');
    expect(tool.isError).toBe(false);
    expect(tool.output).toBe('{"success":true,"artifactId":"art-1"}');
  });

  it('flags failed tool results with status="failed" and isError=true', () => {
    const wire = [
      { type: 'tool_call', toolCallId: 'tool-A', toolName: 'fetch', input: {} },
      {
        type: 'tool_result',
        toolCallId: 'tool-A',
        toolName: 'fetch',
        output: 'boom',
        isError: true,
      },
    ];
    const tool = partsFromOrderedAssistantContent(MSG_ID, wire)[0] as ChatToolPart;
    expect(tool.status).toBe('failed');
    expect(tool.isError).toBe(true);
    expect(tool.output).toBe('boom');
  });

  it('preserves order when tool_result appears between two tool_calls', () => {
    // Wire shape: tool_call(A) → tool_result(A) → text → tool_call(B).
    // The merged result on A must not move A's position, and B must
    // remain pending (status=running) because no result arrived yet.
    const wire = [
      { type: 'tool_call', toolCallId: 'A', toolName: 'a', input: {} },
      { type: 'tool_result', toolCallId: 'A', toolName: 'a', output: 'okA', isError: false },
      { type: 'text', text: 'between' },
      { type: 'tool_call', toolCallId: 'B', toolName: 'b', input: {} },
    ];
    const parts = partsFromOrderedAssistantContent(MSG_ID, wire);
    expect(parts.map((p) => p.type)).toEqual(['tool', 'text', 'tool']);
    const a = parts[0] as ChatToolPart;
    const b = parts[2] as ChatToolPart;
    expect(a.output).toBe('okA');
    expect(a.status).toBe('completed');
    expect(b.output).toBeUndefined();
    expect(b.status).toBe('running');
  });

  it('silently drops a tool_result whose toolCallId has no preceding tool_call', () => {
    const wire = [
      { type: 'text', text: 'hello' },
      { type: 'tool_result', toolCallId: 'orphan', output: 'x', isError: false },
    ];
    const parts = partsFromOrderedAssistantContent(MSG_ID, wire);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'text', text: 'hello' });
  });
});

describe('reconcileSnapshotChatMessages', () => {
  it('把权限审批后的软刷新视为同位 user 消息，不重复保留本地 optimistic 文本', () => {
    const previousMessages: ChatMessage[] = [
      {
        id: 'local-user-temp',
        role: 'user',
        content: '帮我执行 npm run build',
        rawContent: [{ type: 'text', text: '帮我执行 npm run build' }],
        createdAt: 1_000,
        status: 'completed',
      },
    ];

    const snapshotMessages: ChatMessage[] = [
      {
        id: 'server-user-1',
        role: 'user',
        content: '帮我执行 npm run build',
        rawContent: [{ type: 'text', text: '帮我执行 npm run build' }],
        createdAt: 61_000,
        status: 'completed',
      },
    ];

    const reconciled = reconcileSnapshotChatMessages(previousMessages, snapshotMessages);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.id).toBe('server-user-1');
    expect(reconciled[0]?.content).toBe('帮我执行 npm run build');
  });
});

describe('applyToolResultToLocalAssistantMessages', () => {
  function buildAssistantMessageWithParts(parts: ChatMessagePart[]): ChatMessage {
    return {
      id: MSG_ID,
      role: 'assistant',
      // The renderer reads parts directly, so a placeholder content string
      // is enough for the function under test; readAssistantTracePayload
      // consults `parts` first when present.
      content: '{}',
      parts,
      status: 'streaming',
    };
  }

  function makeToolResultEvent(
    overrides: Partial<{
      toolCallId: string;
      output: unknown;
      isError: boolean;
      toolName: string;
    }>,
  ): Extract<RunEvent, { type: 'tool_result' }> {
    return {
      type: 'tool_result',
      toolCallId: overrides.toolCallId ?? 'tool-1',
      toolName: overrides.toolName ?? 'echo',
      output: overrides.output ?? null,
      isError: overrides.isError ?? false,
    };
  }

  it('updates only the matching tool part, preserving order', () => {
    const initialParts: ChatMessagePart[] = [
      { id: `${MSG_ID}:reasoning:0`, type: 'reasoning', text: 'plan' },
      {
        id: 'tool-1',
        type: 'tool',
        toolCallId: 'tool-1',
        toolName: 'a',
        input: {},
        status: 'running',
      },
      { id: `${MSG_ID}:text`, type: 'text', text: 'mid' },
      {
        id: 'tool-2',
        type: 'tool',
        toolCallId: 'tool-2',
        toolName: 'b',
        input: {},
        status: 'running',
      },
    ];
    const messages = [buildAssistantMessageWithParts(initialParts)];
    const next = applyToolResultToLocalAssistantMessages(
      messages,
      makeToolResultEvent({ toolCallId: 'tool-2', output: { ok: true } }),
    );
    expect(next).toHaveLength(1);
    const updatedParts = next[0]?.parts ?? [];
    // Wire ordering preserved.
    expect(updatedParts.map((part) => part.type)).toEqual(['reasoning', 'tool', 'text', 'tool']);
    // Only tool-2 received the output; tool-1 is untouched.
    const tool1 = updatedParts.find(
      (part): part is ChatToolPart => part.type === 'tool' && part.toolCallId === 'tool-1',
    );
    const tool2 = updatedParts.find(
      (part): part is ChatToolPart => part.type === 'tool' && part.toolCallId === 'tool-2',
    );
    expect(tool1?.output).toBeUndefined();
    expect(tool1?.status).toBe('running');
    expect(tool2?.output).toEqual({ ok: true });
    expect(tool2?.status).toBe('completed');
  });

  it('marks failed tools with status="failed" and propagates isError', () => {
    const initialParts: ChatMessagePart[] = [
      {
        id: 'tool-1',
        type: 'tool',
        toolCallId: 'tool-1',
        toolName: 'a',
        input: {},
        status: 'running',
      },
    ];
    const messages = [buildAssistantMessageWithParts(initialParts)];
    const next = applyToolResultToLocalAssistantMessages(
      messages,
      makeToolResultEvent({ toolCallId: 'tool-1', output: 'boom', isError: true }),
    );
    const tool = next[0]?.parts?.[0] as ChatToolPart | undefined;
    expect(tool?.isError).toBe(true);
    expect(tool?.status).toBe('failed');
    expect(tool?.output).toBe('boom');
  });

  it('returns the original array when no message hosts the toolCallId', () => {
    const initialParts: ChatMessagePart[] = [
      {
        id: 'tool-1',
        type: 'tool',
        toolCallId: 'tool-1',
        toolName: 'a',
        input: {},
        status: 'running',
      },
    ];
    const messages = [buildAssistantMessageWithParts(initialParts)];
    const next = applyToolResultToLocalAssistantMessages(
      messages,
      makeToolResultEvent({ toolCallId: 'unknown' }),
    );
    expect(next).toBe(messages);
  });
});
