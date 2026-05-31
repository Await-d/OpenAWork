import type { TeamRuntimeAlert } from './team-failure-policy.js';
import { trackTeamRuntimeAlertTransition } from './team-runtime-telemetry.js';
import { clearTeamRuntimeAlertControl } from './team-runtime-alert-control-store.js';

export interface TeamRuntimeAlertState extends TeamRuntimeAlert {
  firstDetectedAt: number;
  lastDetectedAt: number;
  occurrenceCount: number;
  resolvedAt: number | null;
  status: 'ongoing' | 'open' | 'reopened' | 'resolved';
}

const activeAlertsByUser = new Map<string, Map<TeamRuntimeAlert['code'], TeamRuntimeAlertState>>();
const recentResolvedAlertsByUser = new Map<string, TeamRuntimeAlertState[]>();
const MAX_RESOLVED_ALERTS = 50;

function cloneState(state: TeamRuntimeAlertState): TeamRuntimeAlertState {
  return { ...state };
}

function resolveAlertBucketKey(userId: string): string {
  return userId;
}

function getActiveBucket(userId: string): Map<TeamRuntimeAlert['code'], TeamRuntimeAlertState> {
  const key = resolveAlertBucketKey(userId);
  const bucket = activeAlertsByUser.get(key);
  if (bucket) {
    return bucket;
  }
  const next = new Map<TeamRuntimeAlert['code'], TeamRuntimeAlertState>();
  activeAlertsByUser.set(key, next);
  return next;
}

function getResolvedBucket(userId: string): TeamRuntimeAlertState[] {
  const key = resolveAlertBucketKey(userId);
  const bucket = recentResolvedAlertsByUser.get(key);
  if (bucket) {
    return bucket;
  }
  const next: TeamRuntimeAlertState[] = [];
  recentResolvedAlertsByUser.set(key, next);
  return next;
}

function takeRecentlyResolvedAlert(userId: string, code: TeamRuntimeAlert['code']): TeamRuntimeAlertState | null {
  const bucket = getResolvedBucket(userId);
  const index = bucket.findIndex((item) => item.code === code);
  if (index < 0) {
    return null;
  }
  const [resolved] = bucket.splice(index, 1);
  return resolved ?? null;
}

export function reconcileTeamRuntimeAlerts(input: {
  alerts: TeamRuntimeAlert[];
  capturedAtMs: number;
  userId: string;
}): {
  activeAlerts: TeamRuntimeAlertState[];
  recentResolvedAlerts: TeamRuntimeAlertState[];
} {
  const activeAlerts = getActiveBucket(input.userId);
  const recentResolvedAlerts = getResolvedBucket(input.userId);
  const seen = new Set<TeamRuntimeAlert['code']>();

  for (const alert of input.alerts) {
    seen.add(alert.code);
    const existing = activeAlerts.get(alert.code);
    if (!existing) {
      const previouslyResolved = takeRecentlyResolvedAlert(input.userId, alert.code);
      const next: TeamRuntimeAlertState = {
        ...alert,
        firstDetectedAt: input.capturedAtMs,
        lastDetectedAt: input.capturedAtMs,
        occurrenceCount: 1,
        resolvedAt: null,
        status: previouslyResolved ? 'reopened' : 'open',
      };
      activeAlerts.set(alert.code, next);
      trackTeamRuntimeAlertTransition({
        alertCode: alert.code,
        severity: alert.severity,
        transition: previouslyResolved ? 'reopened' : 'opened',
      });
      continue;
    }

    existing.message = alert.message;
    existing.severity = alert.severity;
    existing.suggestedAction = alert.suggestedAction;
    existing.lastDetectedAt = input.capturedAtMs;
    existing.occurrenceCount += 1;
    existing.status = 'ongoing';
  }

  for (const [code, state] of activeAlerts.entries()) {
    if (seen.has(code)) {
      continue;
    }
    activeAlerts.delete(code);
    const resolved: TeamRuntimeAlertState = {
      ...state,
      resolvedAt: input.capturedAtMs,
      status: 'resolved',
    };
    clearTeamRuntimeAlertControl({
      alertCode: code,
      userId: input.userId,
    });
    recentResolvedAlerts.unshift(resolved);
    if (recentResolvedAlerts.length > MAX_RESOLVED_ALERTS) {
      recentResolvedAlerts.splice(MAX_RESOLVED_ALERTS);
    }
    trackTeamRuntimeAlertTransition({
      alertCode: code,
      severity: state.severity,
      transition: 'resolved',
    });
  }

  return {
    activeAlerts: listActiveTeamRuntimeAlerts(input.userId),
    recentResolvedAlerts: listResolvedTeamRuntimeAlerts(input.userId, 10),
  };
}

export function listActiveTeamRuntimeAlerts(userId: string): TeamRuntimeAlertState[] {
  return Array.from(getActiveBucket(userId).values())
    .sort((left, right) => {
      const severityRank = (value: TeamRuntimeAlertState['severity']) =>
        value === 'critical' ? 0 : value === 'warning' ? 1 : 2;
      const bySeverity = severityRank(left.severity) - severityRank(right.severity);
      if (bySeverity !== 0) {
        return bySeverity;
      }
      return right.lastDetectedAt - left.lastDetectedAt;
    })
    .map(cloneState);
}

export function listResolvedTeamRuntimeAlerts(userId: string, limit = 10): TeamRuntimeAlertState[] {
  return getResolvedBucket(userId).slice(0, limit).map(cloneState);
}

export function __resetTeamRuntimeAlertStoreForTesting(): void {
  activeAlertsByUser.clear();
  recentResolvedAlertsByUser.clear();
}
