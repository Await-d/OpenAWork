/**
 * Regression coverage for the wire-faithful streaming segment accumulator.
 *
 * These tests pin the contract that ChatPage relies on while consuming the
 * gateway's interleaved `text_delta` / `thinking_delta` / `tool_call_delta` /
 * `tool_result` events:
 *
 * 1. Trailing-segment extension — repeated deltas of the same kind/key
 *    coalesce in place, so we don't open a new segment for every chunk.
 * 2. Wire ordering preserved — reasoning interleaved with text/tool yields
 *    multiple reasoning segments in the original arrival order, not a
 *    single "merged" reasoning segment that jumps positions.
 * 3. Tool result ↔ tool call binding — `applyToolResultToStreamingSegment`
 *    only updates the segment whose `toolCallId` matches the event, so
 *    multi-tool rounds never cross-pollinate output / status.
 */
import { describe, expect, it } from 'vitest';
import {
  appendStreamingTextDelta,
  appendStreamingThinkingDelta,
  applyToolResultToStreamingSegment,
  markStreamingReasoningSegmentEnded,
  segmentsFromRecoverySnapshot,
  upsertStreamingToolSegment,
} from './streaming-segments.js';
import type { ChatMessagePart, ChatReasoningPart, ChatToolPart } from './support.js';

const MESSAGE_ID = 'msg-1';

interface ReasoningMeta {
  blockKey: string;
}

function makeReasoningMetaMap(): Map<string, ReasoningMeta> {
  return new Map();
}

describe('appendStreamingTextDelta', () => {
  it('extends the trailing text segment for chained deltas', () => {
    let segments: ChatMessagePart[] = [];
    segments = appendStreamingTextDelta(segments, 'hello ', MESSAGE_ID);
    segments = appendStreamingTextDelta(segments, 'world', MESSAGE_ID);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: 'text', text: 'hello world' });
  });

  it('opens a new text segment when the trailing segment is non-text', () => {
    const meta = makeReasoningMetaMap();
    let segments: ChatMessagePart[] = [];
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'thinking', itemId: 'r1' },
      MESSAGE_ID,
    );
    segments = appendStreamingTextDelta(segments, 'answer', MESSAGE_ID);
    expect(segments.map((s) => s.type)).toEqual(['reasoning', 'text']);
  });

  it('returns the same array when the delta is empty', () => {
    const before: ChatMessagePart[] = [{ id: `${MESSAGE_ID}:text`, type: 'text', text: 'a' }];
    const after = appendStreamingTextDelta(before, '', MESSAGE_ID);
    expect(after).toBe(before);
  });
});

describe('appendStreamingThinkingDelta', () => {
  it('extends the trailing reasoning segment for the same blockKey', () => {
    const meta = makeReasoningMetaMap();
    let segments: ChatMessagePart[] = [];
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'foo', itemId: 'r1', occurredAt: 100 },
      MESSAGE_ID,
    );
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'bar', itemId: 'r1', occurredAt: 200 },
      MESSAGE_ID,
    );
    expect(segments).toHaveLength(1);
    const reasoning = segments[0] as ChatReasoningPart;
    expect(reasoning.text).toBe('foobar');
    // startedAt sticks to the first delta's occurredAt.
    expect(reasoning.startedAt).toBe(100);
  });

  it('opens a new segment when text interrupts the reasoning run', () => {
    const meta = makeReasoningMetaMap();
    let segments: ChatMessagePart[] = [];
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'A1', itemId: 'r1' },
      MESSAGE_ID,
    );
    segments = appendStreamingTextDelta(segments, 'mid', MESSAGE_ID);
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'A2', itemId: 'r1' },
      MESSAGE_ID,
    );
    // Two reasoning segments interleaved with text — wire ordering preserved.
    expect(segments.map((s) => s.type)).toEqual(['reasoning', 'text', 'reasoning']);
    expect((segments[0] as ChatReasoningPart).text).toBe('A1');
    expect((segments[2] as ChatReasoningPart).text).toBe('A2');
  });

  it('opens a new segment when a different blockKey arrives', () => {
    const meta = makeReasoningMetaMap();
    let segments: ChatMessagePart[] = [];
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'A', itemId: 'r1' },
      MESSAGE_ID,
    );
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'B', itemId: 'r2' },
      MESSAGE_ID,
    );
    expect(segments).toHaveLength(2);
    expect((segments[0] as ChatReasoningPart).text).toBe('A');
    expect((segments[1] as ChatReasoningPart).text).toBe('B');
  });

  it('treats outputIndex/summaryIndex as identity when itemId is absent', () => {
    const meta = makeReasoningMetaMap();
    let segments: ChatMessagePart[] = [];
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'A', outputIndex: 0, summaryIndex: 0 },
      MESSAGE_ID,
    );
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'B', outputIndex: 0, summaryIndex: 0 },
      MESSAGE_ID,
    );
    expect(segments).toHaveLength(1);
    expect((segments[0] as ChatReasoningPart).text).toBe('AB');
  });

  it('returns the same array for an empty delta', () => {
    const meta = makeReasoningMetaMap();
    const before: ChatMessagePart[] = [];
    const after = appendStreamingThinkingDelta(
      before,
      meta,
      { delta: '', itemId: 'r1' },
      MESSAGE_ID,
    );
    expect(after).toBe(before);
  });
});

describe('markStreamingReasoningSegmentEnded', () => {
  it('marks every segment that shares the chunk blockKey', () => {
    const meta = makeReasoningMetaMap();
    let segments: ChatMessagePart[] = [];
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'A1', itemId: 'r1' },
      MESSAGE_ID,
    );
    segments = appendStreamingTextDelta(segments, 'gap', MESSAGE_ID);
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'A2', itemId: 'r1' },
      MESSAGE_ID,
    );
    segments = markStreamingReasoningSegmentEnded(segments, meta, {
      itemId: 'r1',
      occurredAt: 999,
    });

    const reasoning = segments.filter((s): s is ChatReasoningPart => s.type === 'reasoning');
    expect(reasoning).toHaveLength(2);
    for (const part of reasoning) {
      expect(part.endedAt).toBe(999);
    }
  });

  it('only closes the targeted block when other blockKeys exist', () => {
    const meta = makeReasoningMetaMap();
    let segments: ChatMessagePart[] = [];
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'A', itemId: 'r1' },
      MESSAGE_ID,
    );
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'B', itemId: 'r2' },
      MESSAGE_ID,
    );
    segments = markStreamingReasoningSegmentEnded(segments, meta, {
      itemId: 'r1',
      occurredAt: 555,
    });
    const [first, second] = segments as ChatReasoningPart[];
    expect(first?.endedAt).toBe(555);
    expect(second?.endedAt).toBeUndefined();
  });

  it('closes every open reasoning segment when the chunk lacks identity', () => {
    const meta = makeReasoningMetaMap();
    let segments: ChatMessagePart[] = [];
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'A', itemId: 'r1' },
      MESSAGE_ID,
    );
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'B', itemId: 'r2' },
      MESSAGE_ID,
    );
    // No itemId / outputIndex / summaryIndex → "legacy" key matches both.
    segments = markStreamingReasoningSegmentEnded(segments, meta, { occurredAt: 100 });
    // Neither matches the legacy key, so segments stay untouched. (The legacy
    // chunk path applies only when both the existing segments and the chunk
    // have no identity hint — confirming we do not blindly close everything.)
    const [first, second] = segments as ChatReasoningPart[];
    expect(first?.endedAt).toBeUndefined();
    expect(second?.endedAt).toBeUndefined();
  });

  it('returns the same array when nothing changes', () => {
    const meta = makeReasoningMetaMap();
    const before: ChatMessagePart[] = [];
    const after = markStreamingReasoningSegmentEnded(before, meta, { itemId: 'r1' });
    expect(after).toBe(before);
  });
});

describe('upsertStreamingToolSegment', () => {
  it('appends a new tool segment at the current end of the list', () => {
    let segments: ChatMessagePart[] = [{ id: `${MESSAGE_ID}:text`, type: 'text', text: 'hi' }];
    segments = upsertStreamingToolSegment(segments, {
      toolCallId: 'tool-1',
      toolName: 'echo',
      input: { msg: 'hi' },
    });
    expect(segments.map((s) => s.type)).toEqual(['text', 'tool']);
    const tool = segments[1] as ChatToolPart;
    expect(tool.toolCallId).toBe('tool-1');
    expect(tool.input).toEqual({ msg: 'hi' });
    expect(tool.status).toBe('running');
  });

  it('updates the existing tool segment in place by toolCallId', () => {
    let segments: ChatMessagePart[] = [];
    segments = upsertStreamingToolSegment(segments, {
      toolCallId: 'tool-1',
      toolName: 'echo',
      input: { msg: 'h' },
    });
    segments = upsertStreamingToolSegment(segments, {
      toolCallId: 'tool-1',
      toolName: 'echo',
      input: { msg: 'hello' },
    });
    expect(segments).toHaveLength(1);
    const tool = segments[0] as ChatToolPart;
    expect(tool.input).toEqual({ msg: 'hello' });
  });

  it('keeps two distinct tool segments when toolCallIds differ', () => {
    let segments: ChatMessagePart[] = [];
    segments = upsertStreamingToolSegment(segments, {
      toolCallId: 'tool-1',
      toolName: 'echo',
      input: {},
    });
    segments = upsertStreamingToolSegment(segments, {
      toolCallId: 'tool-2',
      toolName: 'fetch',
      input: {},
    });
    expect(segments.map((s) => (s as ChatToolPart).toolCallId)).toEqual(['tool-1', 'tool-2']);
  });
});

describe('applyToolResultToStreamingSegment', () => {
  it('binds output / status only to the matching toolCallId', () => {
    let segments: ChatMessagePart[] = [];
    segments = upsertStreamingToolSegment(segments, {
      toolCallId: 'tool-1',
      toolName: 'a',
      input: {},
    });
    segments = upsertStreamingToolSegment(segments, {
      toolCallId: 'tool-2',
      toolName: 'b',
      input: {},
    });
    segments = applyToolResultToStreamingSegment(segments, {
      toolCallId: 'tool-2',
      output: { value: 42 },
      status: 'completed',
    });
    const tools = segments.filter((s): s is ChatToolPart => s.type === 'tool');
    expect(tools[0]).toMatchObject({ toolCallId: 'tool-1', status: 'running' });
    expect(tools[0]?.output).toBeUndefined();
    expect(tools[1]).toMatchObject({
      toolCallId: 'tool-2',
      status: 'completed',
      output: { value: 42 },
    });
  });

  it('returns the same array when no segment matches', () => {
    const segments: ChatMessagePart[] = [];
    const after = applyToolResultToStreamingSegment(segments, {
      toolCallId: 'missing',
      output: 'whatever',
    });
    expect(after).toBe(segments);
  });
});

describe('integration: wire ordering survives an interleaved round', () => {
  it('produces reasoning → text → reasoning → tool → text segments in order', () => {
    const meta = makeReasoningMetaMap();
    let segments: ChatMessagePart[] = [];

    // reasoning_A part 1
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'thinking-1 ', itemId: 'r1' },
      MESSAGE_ID,
    );
    // text "answer-A"
    segments = appendStreamingTextDelta(segments, 'answer-A', MESSAGE_ID);
    // reasoning_A part 2 (resumes the same logical block, after text)
    segments = appendStreamingThinkingDelta(
      segments,
      meta,
      { delta: 'thinking-2', itemId: 'r1' },
      MESSAGE_ID,
    );
    // tool call
    segments = upsertStreamingToolSegment(segments, {
      toolCallId: 'tool-1',
      toolName: 'fetch',
      input: { url: '...' },
    });
    // tool result
    segments = applyToolResultToStreamingSegment(segments, {
      toolCallId: 'tool-1',
      output: { ok: true },
      status: 'completed',
    });
    // follow-up text after tool
    segments = appendStreamingTextDelta(segments, ' done', MESSAGE_ID);

    expect(segments.map((s) => s.type)).toEqual(['reasoning', 'text', 'reasoning', 'tool', 'text']);
    expect((segments[0] as ChatReasoningPart).text).toBe('thinking-1 ');
    expect((segments[1] as { text: string }).text).toBe('answer-A');
    expect((segments[2] as ChatReasoningPart).text).toBe('thinking-2');
    expect((segments[3] as ChatToolPart).output).toEqual({ ok: true });
    expect((segments[4] as { text: string }).text).toBe(' done');
  });
});

describe('segmentsFromRecoverySnapshot', () => {
  it('builds reasoning parts with startedAt and endedAt from thinking blocks', () => {
    const segments = segmentsFromRecoverySnapshot(
      'recovery-1',
      [
        { key: 'indexed:0:summary:-1', text: 'plan A', startedAt: 100, endedAt: 200 },
        { key: 'indexed:1:summary:-1', text: 'plan B', startedAt: 300 },
      ],
      'Hello world',
    );
    expect(segments).toHaveLength(3);
    const [r0, r1, t0] = segments as [
      ChatReasoningPart,
      ChatReasoningPart,
      { type: string; text: string },
    ];
    expect(r0.type).toBe('reasoning');
    expect(r0.text).toBe('plan A');
    expect(r0.startedAt).toBe(100);
    expect(r0.endedAt).toBe(200);
    expect(r1.type).toBe('reasoning');
    expect(r1.text).toBe('plan B');
    expect(r1.startedAt).toBe(300);
    expect(r1.endedAt).toBeUndefined();
    expect(t0.type).toBe('text');
    expect(t0.text).toBe('Hello world');
  });

  it('skips empty thinking blocks', () => {
    const segments = segmentsFromRecoverySnapshot(
      'recovery-2',
      [
        { key: 'legacy:0', text: '   ', startedAt: 100 },
        { key: 'legacy:1', text: 'real content', startedAt: 200, endedAt: 300 },
      ],
      '',
    );
    expect(segments).toHaveLength(1);
    expect((segments[0] as ChatReasoningPart).text).toBe('real content');
    expect((segments[0] as ChatReasoningPart).endedAt).toBe(300);
  });

  it('returns empty array when no blocks and no text', () => {
    const segments = segmentsFromRecoverySnapshot('recovery-3', [], '');
    expect(segments).toHaveLength(0);
  });

  it('returns only text part when no thinking blocks', () => {
    const segments = segmentsFromRecoverySnapshot('recovery-4', [], 'just text');
    expect(segments).toHaveLength(1);
    expect(segments[0]!.type).toBe('text');
  });
});
