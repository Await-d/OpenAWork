/**
 * 260515-team-phase-b · T-07 单元测试
 *
 * 覆盖事件总线的发布订阅 + userId 过滤 + 异常隔离。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  publishTeamEvent,
  subscribeToTeamEvents,
  __clearTeamEventsBusForTesting,
  getTeamEventsBusStats,
  type TeamEventEnvelope,
} from '../../handoff/bus/team-events-bus.js';
import {
  __resetTeamRuntimeDiagnosticsForTesting,
  listTeamRuntimeIncidents,
} from '../../team/team-runtime-diagnostics-store.js';
import {
  __resetTeamRuntimeTelemetryForTesting,
  __setTeamRuntimeTelemetrySinkForTesting,
} from '../../team/team-runtime-telemetry.js';
import * as teamAuditStore from '../../team/team-audit-store.js';

beforeEach(() => {
  __clearTeamEventsBusForTesting();
  __resetTeamRuntimeDiagnosticsForTesting();
  __resetTeamRuntimeTelemetryForTesting();
});

afterEach(() => {
  __clearTeamEventsBusForTesting();
  __resetTeamRuntimeDiagnosticsForTesting();
  __resetTeamRuntimeTelemetryForTesting();
  vi.restoreAllMocks();
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

  it('统计会记录 publishedCount / listenerCount / listenerErrorCount，并在 reset 后清零', () => {
    const unsub = subscribeToTeamEvents(() => {
      throw new Error('boom');
    });
    publishTeamEvent(makeEvent({ type: 'session.substate.changed' }));

    expect(getTeamEventsBusStats()).toMatchObject({
      listenerCount: 1,
      listenerErrorCount: 1,
      publishedCount: 1,
      publishedByType: {
        'session.substate.changed': 1,
      },
    });
    expect(listTeamRuntimeIncidents({ limit: 10, userId: 'u1' })[0]).toMatchObject({
      category: 'team_events_listener',
      code: 'team-events-listener-threw',
    });

    unsub();
    __clearTeamEventsBusForTesting();
    __resetTeamRuntimeDiagnosticsForTesting();
    expect(getTeamEventsBusStats()).toMatchObject({
      listenerCount: 0,
      listenerErrorCount: 0,
      publishedCount: 0,
      publishedByType: {},
    });
    expect(listTeamRuntimeIncidents({ limit: 10, userId: 'u1' })).toHaveLength(0);
  });

  it('runtime incident 写 audit 失败时不会反噬事件总线主流程', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(teamAuditStore, 'logTeamAudit').mockImplementation(() => {
      throw new Error('database is locked');
    });

    const ok: TeamEventEnvelope[] = [];
    subscribeToTeamEvents(() => {
      throw new Error('boom');
    });
    subscribeToTeamEvents((event) => ok.push(event));

    expect(() => publishTeamEvent(makeEvent())).not.toThrow();
    expect(ok).toHaveLength(1);
    expect(listTeamRuntimeIncidents({ limit: 10, userId: 'u1' })[0]).toMatchObject({
      category: 'team_events_listener',
      code: 'team-events-listener-threw',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('写 runtime incident audit 失败'),
    );
  });

  it('runtime incident telemetry 失败时不会反噬事件总线主流程', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    __setTeamRuntimeTelemetrySinkForTesting({
      isEnabled: () => true,
      shutdown: async () => {},
      track: () => {
        throw new Error('telemetry offline');
      },
    });

    const ok: TeamEventEnvelope[] = [];
    subscribeToTeamEvents(() => {
      throw new Error('boom');
    });
    subscribeToTeamEvents((event) => ok.push(event));

    expect(() => publishTeamEvent(makeEvent())).not.toThrow();
    expect(ok).toHaveLength(1);
    expect(listTeamRuntimeIncidents({ limit: 10, userId: 'u1' })[0]).toMatchObject({
      category: 'team_events_listener',
      code: 'team-events-listener-threw',
    });
    expect(warnSpy.mock.calls.some(([message]) =>
      typeof message === 'string' && message.includes('track team_runtime_incident 失败'),
    )).toBe(true);
  });
});
