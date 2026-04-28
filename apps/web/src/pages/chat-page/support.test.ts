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
  partsFromOrderedAssistantContent,
  type ChatMessage,
  type ChatMessagePart,
  type ChatToolPart,
} from './support.js';

const MSG_ID = 'msg-1';

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
    expect(parts.map((part) => part.type)).toEqual([
      'reasoning',
      'text',
      'tool',
      'text',
      'tool',
    ]);
    expect(parts[0]).toMatchObject({
      type: 'reasoning',
      text: 'analysing',
      startedAt: 1,
      endedAt: 2,
    });
    const toolA = parts[2] as ChatToolPart;
    expect(toolA.toolCallId).toBe('tool-A');
    expect(toolA.id).toBe('tool-A');
    expect(toolA.status).toBe('completed');
    const toolB = parts[4] as ChatToolPart;
    expect(toolB.toolCallId).toBe('tool-B');
    expect(toolB.input).toEqual({ msg: 'hi' });
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
    const wire = [
      { type: 'tool_call', toolCallId: '', toolName: 'unnamed', input: {} },
    ];
    const parts = partsFromOrderedAssistantContent(MSG_ID, wire);
    expect(parts).toHaveLength(1);
    const tool = parts[0] as ChatToolPart;
    expect(tool.toolCallId).toBe('');
    expect(tool.id).toBe(`${MSG_ID}:tool:0`);
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

  function makeToolResultEvent(overrides: Partial<{
    toolCallId: string;
    output: unknown;
    isError: boolean;
    toolName: string;
  }>): Extract<RunEvent, { type: 'tool_result' }> {
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
    expect(updatedParts.map((part) => part.type)).toEqual([
      'reasoning',
      'tool',
      'text',
      'tool',
    ]);
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
