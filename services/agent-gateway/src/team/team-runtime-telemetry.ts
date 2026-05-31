import { TelemetryManager, type TelemetryEventName } from '@openAwork/telemetry';
import type { TeamRuntimeHealth } from './team-failure-policy.js';
import type { TeamRuntimeIncident } from './team-runtime-diagnostics-store.js';

interface TelemetrySink {
  isEnabled(): boolean;
  shutdown(): Promise<void>;
  track(name: TelemetryEventName, properties: Record<string, string | number | boolean>): void;
}

const HEALTH_TRACK_DEDUPE_MS = 5 * 60 * 1000;

let sink: TelemetrySink = new TelemetryManager();
const lastHealthSignatureByUser = new Map<string, string>();
const lastHealthTrackedAtByUser = new Map<string, number>();

// Opportunistic sweep bookkeeping for the health-track dedupe maps. Both are
// keyed by `userId`, so over a long-lived process with churning users the
// distinct-key space grows unbounded. An entry only matters for the
// HEALTH_TRACK_DEDUPE_MS window after it was written — once older than that it
// can never suppress a future track — so stale entries are pure leak. We sweep
// expired entries every HEALTH_SWEEP_INTERVAL writes (amortising the O(n)
// scan), keeping the maps bounded by the distinct users seen within one window.
// Mirrors the audit-signature sweep in team-runtime-diagnostics-store (§0.67).
const DEFAULT_HEALTH_SWEEP_INTERVAL = 256;
let healthSweepInterval = DEFAULT_HEALTH_SWEEP_INTERVAL;
let healthWritesSinceSweep = 0;

function sweepExpiredHealthDedupe(now: number): void {
  for (const [key, at] of lastHealthTrackedAtByUser) {
    if (now - at >= HEALTH_TRACK_DEDUPE_MS) {
      lastHealthTrackedAtByUser.delete(key);
      lastHealthSignatureByUser.delete(key);
    }
  }
}

function normalizeContextProperties(
  context: TeamRuntimeIncident['context'],
): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[`context_${key}`] = value;
    } else if (value === null) {
      output[`context_${key}`] = 'null';
    }
  }
  return output;
}

export function trackTeamRuntimeIncident(incident: TeamRuntimeIncident): void {
  if (!sink.isEnabled()) {
    return;
  }
  safeTrack('team_runtime_incident', {
    category: incident.category,
    code: incident.code,
    severity: incident.severity,
    message_length: incident.message.length,
    timestamp_ms: incident.timestamp,
    ...normalizeContextProperties(incident.context),
  });
}

export function trackTeamRuntimeHealth(input: {
  activeRuntimeThreadCount: number;
  health: TeamRuntimeHealth;
  incidentSummary: Record<string, number>;
  pendingInteractionCount: number;
  staleRuntimeThreadCount: number;
  userId: string;
}): void {
  if (!sink.isEnabled()) {
    return;
  }

  const now = Date.now();
  const dedupeKey = input.userId;
  const signature = JSON.stringify({
    health: input.health.status,
    reasons: input.health.reasons,
    incidentSummary: input.incidentSummary,
    pendingInteractionCount: input.pendingInteractionCount,
    staleRuntimeThreadCount: input.staleRuntimeThreadCount,
    activeRuntimeThreadCount: input.activeRuntimeThreadCount,
  });
  if (
    lastHealthSignatureByUser.get(dedupeKey) === signature &&
    now - (lastHealthTrackedAtByUser.get(dedupeKey) ?? 0) < HEALTH_TRACK_DEDUPE_MS
  ) {
    return;
  }

  const tracked = safeTrack('team_runtime_health', {
    health_status: input.health.status,
    active_runtime_thread_count: input.activeRuntimeThreadCount,
    pending_interaction_count: input.pendingInteractionCount,
    reason_count: input.health.reasons.length,
    stale_runtime_thread_count: input.staleRuntimeThreadCount,
    architecture_review_count: input.incidentSummary['architecture_review'] ?? 0,
    handoff_failure_count: input.incidentSummary['handoff_failure'] ?? 0,
    latency_violation_count: input.incidentSummary['latency_violation'] ?? 0,
    team_events_connection_count: input.incidentSummary['team_events_connection'] ?? 0,
    team_events_listener_count: input.incidentSummary['team_events_listener'] ?? 0,
  });
  if (tracked) {
    lastHealthSignatureByUser.set(dedupeKey, signature);
    lastHealthTrackedAtByUser.set(dedupeKey, now);
    healthWritesSinceSweep += 1;
    if (healthWritesSinceSweep >= healthSweepInterval) {
      healthWritesSinceSweep = 0;
      sweepExpiredHealthDedupe(now);
    }
  }
}

export function trackTeamRuntimeAlertTransition(input: {
  alertCode: string;
  severity: 'critical' | 'info' | 'warning';
  transition: 'opened' | 'reopened' | 'resolved';
}): void {
  if (!sink.isEnabled()) {
    return;
  }
  safeTrack('team_runtime_alert_transition', {
    alert_code: input.alertCode,
    severity: input.severity,
    transition: input.transition,
  });
}

export function isTeamRuntimeTelemetryEnabled(): boolean {
  return sink.isEnabled();
}

export async function shutdownTeamRuntimeTelemetry(): Promise<void> {
  await sink.shutdown();
}

export function __setTeamRuntimeTelemetrySinkForTesting(next: TelemetrySink): void {
  sink = next;
}

export function __resetTeamRuntimeTelemetryForTesting(): void {
  sink = new TelemetryManager({ enabled: false });
  lastHealthSignatureByUser.clear();
  lastHealthTrackedAtByUser.clear();
  healthWritesSinceSweep = 0;
  healthSweepInterval = DEFAULT_HEALTH_SWEEP_INTERVAL;
}

/** Test-only: override the health-dedupe sweep interval (null restores default). */
export function __setHealthSweepIntervalForTesting(interval: number | null): void {
  healthSweepInterval =
    typeof interval === 'number' && interval > 0
      ? Math.floor(interval)
      : DEFAULT_HEALTH_SWEEP_INTERVAL;
  healthWritesSinceSweep = 0;
}

/** Test-only: current size of the health-dedupe maps (both stay in lockstep). */
export function __healthDedupeSizeForTesting(): number {
  return lastHealthTrackedAtByUser.size;
}

function safeTrack(
  name: TelemetryEventName,
  properties: Record<string, string | number | boolean>,
): boolean {
  try {
    sink.track(name, properties);
    return true;
  } catch (error) {
    console.warn(
      `[team-runtime-telemetry] track ${name} 失败：${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
