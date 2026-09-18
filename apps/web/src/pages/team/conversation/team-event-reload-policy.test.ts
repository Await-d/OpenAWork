import { describe, expect, it } from 'vitest';
import type { HandoffEvent } from '../../../stores/team/team-events.js';
import {
  isTeamEventForSession,
  nextTeamEventWatermark,
  shouldReloadForTeamEvents,
} from './team-event-reload-policy.js';

const RECEPTION_SESSION = 'reception-1';
const PM1_SESSION = 'pm1-1';

function handoffFailed(overrides: Partial<HandoffEvent> = {}): HandoffEvent {
  return {
    type: 'handoff.failed',
    taskId: 'handoff-1',
    // 网关侧 publishHandoffEvent 用 toSessionId ?? fromSessionId 作为顶层 sessionId
    sessionId: PM1_SESSION,
    layer: 'reception',
    timestamp: 1_000,
    payload: {
      fromSessionId: RECEPTION_SESSION,
      toSessionId: PM1_SESSION,
      state: 'failed',
      reason: 'planning-generation-failed: 项目调查无进展：.；需要用户介入',
    },
    ...overrides,
  };
}

describe('isTeamEventForSession', () => {
  it('handoff.failed 顶层 sessionId 是子会话，但接待层仍应命中', () => {
    expect(isTeamEventForSession(handoffFailed(), RECEPTION_SESSION)).toBe(true);
  });

  it('子会话自身也命中同一事件', () => {
    expect(isTeamEventForSession(handoffFailed(), PM1_SESSION)).toBe(true);
  });

  it('与两端都无关的会话不命中', () => {
    expect(isTeamEventForSession(handoffFailed(), 'other-session')).toBe(false);
  });

  it('无 payload 两端 id 的事件只按顶层 sessionId 判定', () => {
    const event = handoffFailed({
      sessionId: RECEPTION_SESSION,
      payload: { state: 'failed' },
    });
    expect(isTeamEventForSession(event, RECEPTION_SESSION)).toBe(true);
    expect(isTeamEventForSession(event, PM1_SESSION)).toBe(false);
  });
});

describe('shouldReloadForTeamEvents', () => {
  it('末条与当前会话无关时，仍能因前面的命中事件触发刷新', () => {
    const events: HandoffEvent[] = [
      handoffFailed({ timestamp: 1_000 }),
      {
        type: 'team.usage.updated',
        sessionId: 'unrelated-session',
        timestamp: 1_100,
        payload: {},
      },
    ];

    expect(
      shouldReloadForTeamEvents({
        events,
        sessionId: RECEPTION_SESSION,
        lastSeenTimestamp: 900,
      }),
    ).toBe(true);
  });

  it('不触发刷新的类型即使属于本会话也不命中', () => {
    const events: HandoffEvent[] = [
      { type: 'team.usage.updated', sessionId: RECEPTION_SESSION, timestamp: 1_000, payload: {} },
    ];

    expect(
      shouldReloadForTeamEvents({ events, sessionId: RECEPTION_SESSION, lastSeenTimestamp: 0 }),
    ).toBe(false);
  });

  it('时间戳不超过处理水位的事件被忽略', () => {
    expect(
      shouldReloadForTeamEvents({
        events: [handoffFailed({ timestamp: 1_000 })],
        sessionId: RECEPTION_SESSION,
        lastSeenTimestamp: 1_000,
      }),
    ).toBe(false);
  });

  it('空事件列表不命中', () => {
    expect(
      shouldReloadForTeamEvents({ events: [], sessionId: RECEPTION_SESSION, lastSeenTimestamp: 0 }),
    ).toBe(false);
  });
});

describe('nextTeamEventWatermark', () => {
  it('取批内最大时间戳而非末条时间戳', () => {
    const events: HandoffEvent[] = [
      handoffFailed({ timestamp: 1_500 }),
      handoffFailed({ timestamp: 1_200 }),
    ];

    expect(nextTeamEventWatermark(events, 0)).toBe(1_500);
  });

  it('不倒退已有水位', () => {
    expect(nextTeamEventWatermark([handoffFailed({ timestamp: 500 })], 900)).toBe(900);
  });
});

describe('session.messages.rolled_back', () => {
  function rollbackEvent(affectedSessionIds: string[], applied?: boolean): HandoffEvent {
    return {
      type: 'session.messages.rolled_back',
      sessionId: RECEPTION_SESSION,
      timestamp: 2_000,
      payload: {
        sessionId: RECEPTION_SESSION,
        cutoffMessageId: 'msg-cutoff',
        cutoffTimeMs: 1_000,
        tombstoneAtMs: 2_000,
        affectedSessionIds,
        ...(applied === undefined ? {} : { applied }),
      },
    };
  }

  it('回退事件进入 reload 集合', () => {
    expect(
      shouldReloadForTeamEvents({
        events: [rollbackEvent([RECEPTION_SESSION])],
        sessionId: RECEPTION_SESSION,
        lastSeenTimestamp: 0,
      }),
    ).toBe(true);
  });

  it('子树内会话也因 affectedSessionIds 命中而刷新', () => {
    expect(
      isTeamEventForSession(rollbackEvent([RECEPTION_SESSION, PM1_SESSION]), PM1_SESSION),
    ).toBe(true);
    expect(
      shouldReloadForTeamEvents({
        events: [rollbackEvent([RECEPTION_SESSION, PM1_SESSION])],
        sessionId: PM1_SESSION,
        lastSeenTimestamp: 0,
      }),
    ).toBe(true);
  });

  it('与回执无关的会话不命中', () => {
    expect(isTeamEventForSession(rollbackEvent([RECEPTION_SESSION]), 'other-session')).toBe(false);
  });

  it('applied === false 的空操作回执不构成刷新理由', () => {
    expect(
      shouldReloadForTeamEvents({
        events: [rollbackEvent([RECEPTION_SESSION], false)],
        sessionId: RECEPTION_SESSION,
        lastSeenTimestamp: 0,
      }),
    ).toBe(false);
  });
});
