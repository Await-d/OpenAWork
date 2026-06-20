import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../infra/db.js';
import {
  __resetTeamRuntimeAlertStoreForTesting,
  listActiveTeamRuntimeAlerts,
  listResolvedTeamRuntimeAlerts,
  reconcileTeamRuntimeAlerts,
} from '../../team/team-runtime-alert-store.js';
import {
  __resetTeamRuntimeTelemetryForTesting,
  __setTeamRuntimeTelemetrySinkForTesting,
} from '../../team/team-runtime-telemetry.js';

describe('team-runtime-alert-store', () => {
  beforeAll(async () => {
    await migrate();
  });

  afterEach(() => {
    __resetTeamRuntimeAlertStoreForTesting();
    __resetTeamRuntimeTelemetryForTesting();
  });

  it('首次出现时变为 open，持续存在时变为 ongoing，消失后进入 resolved', () => {
    const transitions: Array<{ alert_code?: string; transition?: string }> = [];
    __setTeamRuntimeTelemetrySinkForTesting({
      isEnabled: () => true,
      shutdown: async () => {},
      track: (_name, properties) => {
        transitions.push(properties);
      },
    });

    reconcileTeamRuntimeAlerts({
      alerts: [
        {
          code: 'handoff-failure',
          message: 'handoff failed',
          severity: 'critical',
          suggestedAction: 'check',
        },
      ],
      capturedAtMs: 100,
      userId: 'u-alert',
    });
    expect(listActiveTeamRuntimeAlerts('u-alert')[0]).toMatchObject({
      code: 'handoff-failure',
      occurrenceCount: 1,
      status: 'open',
    });

    reconcileTeamRuntimeAlerts({
      alerts: [
        {
          code: 'handoff-failure',
          message: 'handoff failed',
          severity: 'critical',
          suggestedAction: 'check',
        },
      ],
      capturedAtMs: 200,
      userId: 'u-alert',
    });
    expect(listActiveTeamRuntimeAlerts('u-alert')[0]).toMatchObject({
      code: 'handoff-failure',
      occurrenceCount: 2,
      status: 'ongoing',
    });

    reconcileTeamRuntimeAlerts({
      alerts: [],
      capturedAtMs: 300,
      userId: 'u-alert',
    });
    expect(listActiveTeamRuntimeAlerts('u-alert')).toHaveLength(0);
    expect(listResolvedTeamRuntimeAlerts('u-alert', 5)[0]).toMatchObject({
      code: 'handoff-failure',
      resolvedAt: 300,
      status: 'resolved',
    });
    expect(transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alert_code: 'handoff-failure',
          transition: 'opened',
        }),
        expect.objectContaining({
          alert_code: 'handoff-failure',
          transition: 'resolved',
        }),
      ]),
    );
  });

  it('resolved 后再次出现会标记为 reopened', () => {
    reconcileTeamRuntimeAlerts({
      alerts: [
        {
          code: 'latency-violation',
          message: 'latency high',
          severity: 'warning',
          suggestedAction: 'check latency',
        },
      ],
      capturedAtMs: 100,
      userId: 'u-alert',
    });

    reconcileTeamRuntimeAlerts({
      alerts: [],
      capturedAtMs: 200,
      userId: 'u-alert',
    });

    reconcileTeamRuntimeAlerts({
      alerts: [
        {
          code: 'latency-violation',
          message: 'latency high again',
          severity: 'warning',
          suggestedAction: 'check latency',
        },
      ],
      capturedAtMs: 300,
      userId: 'u-alert',
    });

    expect(listActiveTeamRuntimeAlerts('u-alert')[0]).toMatchObject({
      code: 'latency-violation',
      status: 'reopened',
    });
  });
});
