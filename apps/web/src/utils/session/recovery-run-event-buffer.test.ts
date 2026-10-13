import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@openAwork/shared';

import {
  planRunEventRequest,
  settleRunEventBuffer,
  type RunEventPrefixBuffer,
} from './recovery-run-event-buffer.js';

const SESSION_ID = 'session-1';
const REQUEST_ID = 'req-1';

function textDelta(delta: string): RunEvent {
  return { type: 'text_delta', delta, eventId: `evt-${delta}`, occurredAt: 1 } as RunEvent;
}

function bufferWith(overrides: Partial<RunEventPrefixBuffer> = {}): RunEventPrefixBuffer {
  return {
    clientRequestId: REQUEST_ID,
    cursor: 3,
    events: [textDelta('b0'), textDelta('b1')],
    sessionId: SESSION_ID,
    ...overrides,
  };
}

describe('planRunEventRequest', () => {
  it('有同会话前缀时下发游标', () => {
    expect(planRunEventRequest({ buffer: bufferWith(), sessionId: SESSION_ID })).toBe(3);
  });

  it('没有前缀时回 undefined（全量请求）', () => {
    expect(planRunEventRequest({ buffer: null, sessionId: SESSION_ID })).toBeUndefined();
  });

  it('换了会话时回 undefined，不复用别的会话的游标', () => {
    expect(planRunEventRequest({ buffer: bufferWith(), sessionId: 'session-2' })).toBeUndefined();
  });

  it('前缀为空时回 undefined：缺少前缀的增量等于残缺序列', () => {
    expect(
      planRunEventRequest({ buffer: bufferWith({ events: [], cursor: 0 }), sessionId: SESSION_ID }),
    ).toBeUndefined();
  });
});

describe('settleRunEventBuffer — 全量请求', () => {
  it('活跃流存在时把响应变成新前缀，游标取服务端高水位', () => {
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: REQUEST_ID, lastSeq: 12 },
      buffer: null,
      requestedAfterSeq: undefined,
      runEventCursor: null,
      runEvents: [textDelta('a'), textDelta('b')],
      sessionId: SESSION_ID,
    });

    expect(settlement.needsFullReload).toBe(false);
    expect(settlement.buffer).toMatchObject({ clientRequestId: REQUEST_ID, cursor: 12 });
    expect(settlement.events.map((event) => (event as { delta: string }).delta)).toEqual([
      'a',
      'b',
    ]);
  });

  it('更旧的一次全量响应晚到时不让前缀回退（保留更靠前的缓冲）', () => {
    // 并发下全量读可能晚于更新的增量交付落地：它的 lastSeq（=5）低于缓冲游标（=6），
    // 覆盖前缀会让下一拍重复交付同一段增量。
    const buffer = bufferWith({ cursor: 6 });
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: REQUEST_ID, lastSeq: 5 },
      buffer,
      requestedAfterSeq: undefined,
      runEventCursor: null,
      runEvents: [textDelta('stale')],
      sessionId: SESSION_ID,
    });

    expect(settlement.needsFullReload).toBe(false);
    expect(settlement.buffer).toBe(buffer);
    expect(settlement.events).toBe(buffer.events);
  });

  it('更旧的全量响应属于别的 scope 时仍然照常替换前缀', () => {
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: 'req-2', lastSeq: 5 },
      buffer: bufferWith({ cursor: 6 }),
      requestedAfterSeq: undefined,
      runEventCursor: null,
      runEvents: [textDelta('fresh')],
      sessionId: SESSION_ID,
    });

    expect(settlement.buffer).toMatchObject({ clientRequestId: 'req-2', cursor: 5 });
    expect(settlement.events).toHaveLength(1);
  });

  it('没有活跃流时清空前缀（下一轮 run 是新 scope）', () => {
    const settlement = settleRunEventBuffer({
      activeStream: null,
      buffer: bufferWith(),
      requestedAfterSeq: undefined,
      runEventCursor: null,
      runEvents: [],
      sessionId: SESSION_ID,
    });

    expect(settlement.buffer).toBeNull();
    expect(settlement.events).toEqual([]);
  });
});

describe('settleRunEventBuffer — 增量请求', () => {
  it('把增量拼在前缀之后，并推进游标', () => {
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: REQUEST_ID, lastSeq: 5 },
      buffer: bufferWith(),
      requestedAfterSeq: 3,
      runEventCursor: 5,
      runEvents: [textDelta('c'), textDelta('d')],
      sessionId: SESSION_ID,
    });

    expect(settlement.needsFullReload).toBe(false);
    expect(settlement.buffer?.cursor).toBe(5);
    expect(settlement.events.map((event) => (event as { delta: string }).delta)).toEqual([
      'b0',
      'b1',
      'c',
      'd',
    ]);
  });

  it('本次没有新事件时保持原游标，并复用旧数组引用', () => {
    const buffer = bufferWith();
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: REQUEST_ID, lastSeq: 3 },
      buffer,
      requestedAfterSeq: 3,
      runEventCursor: null,
      runEvents: [],
      sessionId: SESSION_ID,
    });

    expect(settlement.needsFullReload).toBe(false);
    expect(settlement.buffer?.cursor).toBe(3);
    expect(settlement.events).toBe(buffer.events);
  });

  it('换了 run（clientRequestId 变化）时要求全量重载，不拼接旧前缀', () => {
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: 'req-2', lastSeq: 1 },
      buffer: bufferWith(),
      requestedAfterSeq: 3,
      runEventCursor: 1,
      runEvents: [textDelta('x')],
      sessionId: SESSION_ID,
    });

    expect(settlement.needsFullReload).toBe(true);
    expect(settlement.buffer).toBeNull();
  });

  it('换了会话时要求全量重载', () => {
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: REQUEST_ID, lastSeq: 9 },
      buffer: bufferWith(),
      requestedAfterSeq: 3,
      runEventCursor: 9,
      runEvents: [textDelta('x')],
      sessionId: 'session-2',
    });

    expect(settlement.needsFullReload).toBe(true);
  });

  it('高水位回退（scope 被清掉重建）时要求全量重载', () => {
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: REQUEST_ID, lastSeq: 2 },
      buffer: bufferWith(),
      requestedAfterSeq: 3,
      runEventCursor: null,
      runEvents: [],
      sessionId: SESSION_ID,
    });

    expect(settlement.needsFullReload).toBe(true);
  });

  it('服务端游标小于本地游标时不回退本地游标', () => {
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: REQUEST_ID, lastSeq: 9 },
      buffer: bufferWith(),
      requestedAfterSeq: 3,
      runEventCursor: 4,
      runEvents: [textDelta('c')],
      sessionId: SESSION_ID,
    });

    expect(settlement.buffer?.cursor).toBe(4);
    expect(settlement.needsFullReload).toBe(false);
  });

  it('缓冲在等待期间被别的交付推进过（游标与请求游标不一致）时要求全量重载', () => {
    // 并发两拍：本次请求带着 cursor=3 发出，另一拍先把缓冲推进到了 6，
    // 于是这条响应覆盖的区间与缓冲既可能重叠也可能有缝 —— 不拼接。
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: REQUEST_ID, lastSeq: 8 },
      buffer: bufferWith({ cursor: 6 }),
      requestedAfterSeq: 3,
      runEventCursor: 8,
      runEvents: [textDelta('e'), textDelta('f')],
      sessionId: SESSION_ID,
    });

    expect(settlement.needsFullReload).toBe(true);
    expect(settlement.buffer).toBeNull();
  });

  it('空数组却带非空游标（响应与声明窗口不符）时要求全量重载', () => {
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: REQUEST_ID, lastSeq: 5 },
      buffer: bufferWith(),
      requestedAfterSeq: 3,
      runEventCursor: 5,
      runEvents: [],
      sessionId: SESSION_ID,
    });

    expect(settlement.needsFullReload).toBe(true);
  });

  it('非空数组但服务端游标不大于请求游标（窗口不符）时要求全量重载', () => {
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: REQUEST_ID, lastSeq: 5 },
      buffer: bufferWith(),
      requestedAfterSeq: 3,
      runEventCursor: 3,
      runEvents: [textDelta('c')],
      sessionId: SESSION_ID,
    });

    expect(settlement.needsFullReload).toBe(true);
  });

  it('携带游标但没有本地前缀时要求全量重载（不允许无前缀的增量交付）', () => {
    const settlement = settleRunEventBuffer({
      activeStream: { clientRequestId: REQUEST_ID, lastSeq: 5 },
      buffer: null,
      requestedAfterSeq: 3,
      runEventCursor: 5,
      runEvents: [textDelta('c')],
      sessionId: SESSION_ID,
    });

    expect(settlement.needsFullReload).toBe(true);
  });
});
