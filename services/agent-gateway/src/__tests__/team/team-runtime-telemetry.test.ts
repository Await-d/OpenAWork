import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __healthDedupeSizeForTesting,
  __resetTeamRuntimeTelemetryForTesting,
  __setHealthSweepIntervalForTesting,
  __setTeamRuntimeTelemetrySinkForTesting,
  trackTeamRuntimeAlertTransition,
  trackTeamRuntimeHealth,
  trackTeamRuntimeIncident,
} from '../../team/team-runtime-telemetry.js';

describe('team-runtime-telemetry', () => {
  afterEach(() => {
    __resetTeamRuntimeTelemetryForTesting();
  });

  it('incident 会转换为结构化 telemetry event', () => {
    const tracked: Array<{
      name: string;
      properties: Record<string, boolean | number | string>;
    }> = [];
    __setTeamRuntimeTelemetrySinkForTesting({
      isEnabled: () => true,
      shutdown: async () => {},
      track: (name, properties) => {
        tracked.push({ name, properties });
      },
    });

    trackTeamRuntimeIncident({
      category: 'handoff_failure',
      code: 'handoff-runner-failed',
      context: {
        handoffId: 'h-1',
        retryCount: 2,
      },
      message: 'runner exploded',
      severity: 'error',
      timestamp: 123,
      userId: 'u-telemetry',
    });

    expect(tracked).toEqual([
      {
        name: 'team_runtime_incident',
        properties: expect.objectContaining({
          category: 'handoff_failure',
          code: 'handoff-runner-failed',
          severity: 'error',
          timestamp_ms: 123,
          context_handoffId: 'h-1',
          context_retryCount: 2,
        }),
      },
    ]);
  });

  it('health snapshot 在签名未变且窗口内时去重', () => {
    const tracked: Array<{
      name: string;
      properties: Record<string, boolean | number | string>;
    }> = [];
    __setTeamRuntimeTelemetrySinkForTesting({
      isEnabled: () => true,
      shutdown: async () => {},
      track: (name, properties) => {
        tracked.push({ name, properties });
      },
    });

    const input = {
      activeRuntimeThreadCount: 1,
      health: { reasons: ['handoff_failure=1'], status: 'critical' as const },
      incidentSummary: {
        architecture_review: 0,
        handoff_failure: 1,
        latency_violation: 0,
        team_events_connection: 0,
        team_events_listener: 0,
      },
      pendingInteractionCount: 0,
      staleRuntimeThreadCount: 0,
      userId: 'u-telemetry',
    };

    trackTeamRuntimeHealth(input);
    trackTeamRuntimeHealth(input);

    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toMatchObject({
      name: 'team_runtime_health',
      properties: expect.objectContaining({
        health_status: 'critical',
        handoff_failure_count: 1,
      }),
    });
  });

  it('alert transition 支持 reopened', () => {
    const tracked: Array<{
      name: string;
      properties: Record<string, boolean | number | string>;
    }> = [];
    __setTeamRuntimeTelemetrySinkForTesting({
      isEnabled: () => true,
      shutdown: async () => {},
      track: (name, properties) => {
        tracked.push({ name, properties });
      },
    });

    trackTeamRuntimeAlertTransition({
      alertCode: 'latency-violation',
      severity: 'warning',
      transition: 'reopened',
    });

    expect(tracked).toContainEqual({
      name: 'team_runtime_alert_transition',
      properties: {
        alert_code: 'latency-violation',
        severity: 'warning',
        transition: 'reopened',
      },
    });
  });

  it('health telemetry 失败时不会污染去重状态，并允许后续重试成功', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let shouldFail = true;
    const tracked: Array<{
      name: string;
      properties: Record<string, boolean | number | string>;
    }> = [];
    __setTeamRuntimeTelemetrySinkForTesting({
      isEnabled: () => true,
      shutdown: async () => {},
      track: (name, properties) => {
        if (shouldFail) {
          throw new Error('telemetry offline');
        }
        tracked.push({ name, properties });
      },
    });

    const input = {
      activeRuntimeThreadCount: 1,
      health: { reasons: ['handoff_failure=1'], status: 'critical' as const },
      incidentSummary: {
        architecture_review: 0,
        handoff_failure: 1,
        latency_violation: 0,
        team_events_connection: 0,
        team_events_listener: 0,
      },
      pendingInteractionCount: 0,
      staleRuntimeThreadCount: 0,
      userId: 'u-telemetry-retry',
    };

    expect(() => trackTeamRuntimeHealth(input)).not.toThrow();
    shouldFail = false;
    expect(() => trackTeamRuntimeHealth(input)).not.toThrow();

    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.name).toBe('team_runtime_health');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('track team_runtime_health 失败'));
  });

  it('alert transition telemetry 失败时不会抛出', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    __setTeamRuntimeTelemetrySinkForTesting({
      isEnabled: () => true,
      shutdown: async () => {},
      track: () => {
        throw new Error('telemetry offline');
      },
    });

    expect(() =>
      trackTeamRuntimeAlertTransition({
        alertCode: 'latency-violation',
        severity: 'warning',
        transition: 'resolved',
      }),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('track team_runtime_alert_transition 失败'),
    );
  });

  it('健康去重 map 在写入达到 sweep 间隔时清除过期用户条目', () => {
    __setTeamRuntimeTelemetrySinkForTesting({
      isEnabled: () => true,
      shutdown: async () => {},
      track: () => undefined,
    });
    // 每 4 次成功写入触发一次 sweep。
    __setHealthSweepIntervalForTesting(4);

    const nowSpy = vi.spyOn(Date, 'now');
    const base = 1_700_000_000_000;

    // 3 个不同用户、各自不同的签名（health_status 不同）在 base 时刻写入，
    // 都会成功 track 并落 dedupe 条目（3 次写入，未达 sweep 间隔 4）。
    const statuses = ['critical', 'degraded', 'healthy'] as const;
    statuses.forEach((status, index) => {
      nowSpy.mockReturnValue(base);
      trackTeamRuntimeHealth({
        activeRuntimeThreadCount: index,
        health: { reasons: [`r-${status}`], status },
        incidentSummary: {
          architecture_review: 0,
          handoff_failure: 0,
          latency_violation: 0,
          team_events_connection: 0,
          team_events_listener: 0,
        },
        pendingInteractionCount: 0,
        staleRuntimeThreadCount: 0,
        userId: `u-stale-${index}`,
      });
    });
    expect(__healthDedupeSizeForTesting()).toBe(3);

    // 推进到窗口（5 分钟）之后，第 4 次写入（新用户）触发 sweep：
    // 3 个旧条目此刻都已过期，被清除，只剩刚写入的这一条。
    nowSpy.mockReturnValue(base + 5 * 60 * 1000 + 1);
    trackTeamRuntimeHealth({
      activeRuntimeThreadCount: 9,
      health: { reasons: ['r-fresh'], status: 'critical' as const },
      incidentSummary: {
        architecture_review: 0,
        handoff_failure: 0,
        latency_violation: 0,
        team_events_connection: 0,
        team_events_listener: 0,
      },
      pendingInteractionCount: 0,
      staleRuntimeThreadCount: 0,
      userId: 'u-fresh',
    });
    expect(__healthDedupeSizeForTesting()).toBe(1);

    nowSpy.mockRestore();
  });

  it('sweep 不会误删仍在窗口内的去重条目', () => {
    __setTeamRuntimeTelemetrySinkForTesting({
      isEnabled: () => true,
      shutdown: async () => {},
      track: () => undefined,
    });
    __setHealthSweepIntervalForTesting(2);

    const nowSpy = vi.spyOn(Date, 'now');
    const base = 1_700_000_000_000;
    nowSpy.mockReturnValue(base);

    // 2 个不同用户在同一窗口内写入：第 2 次写入触发 sweep，但都未过期，
    // 因此 sweep 不应删除任何条目。
    [0, 1].forEach((index) => {
      trackTeamRuntimeHealth({
        activeRuntimeThreadCount: index,
        health: { reasons: [`r-${index}`], status: 'critical' as const },
        incidentSummary: {
          architecture_review: 0,
          handoff_failure: 0,
          latency_violation: 0,
          team_events_connection: 0,
          team_events_listener: 0,
        },
        pendingInteractionCount: 0,
        staleRuntimeThreadCount: 0,
        userId: `u-live-${index}`,
      });
    });

    expect(__healthDedupeSizeForTesting()).toBe(2);
    nowSpy.mockRestore();
  });
});
