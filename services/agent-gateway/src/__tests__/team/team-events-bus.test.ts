/**
 * 260515-team-phase-b · T-07 单元测试
 *
 * 覆盖事件总线的发布订阅 + userId 过滤 + 异常隔离。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  publishTeamEvent,
  subscribeToTeamEvents,
  __clearTeamEventsBusForTesting,
  type TeamEventEnvelope,
} from '../../handoff/bus/team-events-bus.js';

beforeEach(() => {
  __clearTeamEventsBusForTesting();
});

afterEach(() => {
  __clearTeamEventsBusForTesting();
});

function makeEvent(overrides: Partial<TeamEventEnvelope> = {}): TeamEventEnvelope {
  return {
    type: 'handoff.created',
    timestamp: 0,
    payload: {},
    userId: 'u1',
    ...overrides,
  };
}

describe('publish/subscribe', () => {
  it('订阅者收到所有发布的事件', () => {
    const received: TeamEventEnvelope[] = [];
    const unsub = subscribeToTeamEvents((e) => received.push(e));
    publishTeamEvent(makeEvent({ taskId: 'a' }));
    publishTeamEvent(makeEvent({ taskId: 'b' }));
    expect(received).toHaveLength(2);
    expect(received.map((e) => e.taskId)).toEqual(['a', 'b']);
    unsub();
  });

  it('unsubscribe 后不再收到事件', () => {
    const received: TeamEventEnvelope[] = [];
    const unsub = subscribeToTeamEvents((e) => received.push(e));
    publishTeamEvent(makeEvent({ taskId: 'before' }));
    unsub();
    publishTeamEvent(makeEvent({ taskId: 'after' }));
    expect(received.map((e) => e.taskId)).toEqual(['before']);
  });

  it('一个监听器抛错不影响其他监听器', () => {
    const ok: TeamEventEnvelope[] = [];
    subscribeToTeamEvents(() => {
      throw new Error('boom');
    });
    subscribeToTeamEvents((e) => ok.push(e));
    publishTeamEvent(makeEvent());
    expect(ok).toHaveLength(1);
  });
});
