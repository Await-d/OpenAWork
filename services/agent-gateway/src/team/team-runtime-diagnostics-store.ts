import { trackTeamRuntimeIncident } from './team-runtime-telemetry.js';
import { logTeamAudit } from './team-audit-store.js';
import { sqliteAll } from '../infra/db.js';

export type TeamRuntimeIncidentCategory =
  | 'architecture_review'
  | 'handoff_failure'
  | 'latency_violation'
  | 'team_events_connection'
  | 'team_events_listener';

export type TeamRuntimeIncidentSeverity = 'warning' | 'error';

export interface TeamRuntimeIncident {
  category: TeamRuntimeIncidentCategory;
  code: string;
  context: Record<string, boolean | number | string | null>;
  message: string;
  severity: TeamRuntimeIncidentSeverity;
  timestamp: number;
  userId: string | null;
}

const MAX_INCIDENTS = 100;
const INCIDENT_AUDIT_DEDUPE_MS = 60 * 1000;
const incidentsByUser = new Map<string, TeamRuntimeIncident[]>();
const lastIncidentAuditAtBySignature = new Map<string, number>();

interface PersistedRuntimeIncidentRow {
  created_at: string;
  detail: string | null;
}

// Opportunistic sweep bookkeeping for `lastIncidentAuditAtBySignature`. The
// dedupe map keys on (user × category × code × entityId); entityId derives
// from sessionId / handoffId, so over a long-lived process the distinct-key
// space is effectively unbounded. An entry only matters for the
// INCIDENT_AUDIT_DEDUPE_MS window after it was written — older entries can
// never suppress a future audit — so they are pure leak. We sweep expired
// entries every SIGNATURE_SWEEP_INTERVAL writes (amortising the O(n) scan)
// to keep the map bounded by the distinct signatures seen within one window.
const DEFAULT_SIGNATURE_SWEEP_INTERVAL = 256;
let signatureSweepInterval = DEFAULT_SIGNATURE_SWEEP_INTERVAL;
let signatureWritesSinceSweep = 0;

function sweepExpiredAuditSignatures(now: number): void {
  for (const [sig, at] of lastIncidentAuditAtBySignature) {
    if (now - at >= INCIDENT_AUDIT_DEDUPE_MS) {
      lastIncidentAuditAtBySignature.delete(sig);
    }
  }
}

function resolveIncidentBucketKey(userId: string | null): string {
  return userId ?? '__global__';
}

export function recordTeamRuntimeIncident(input: TeamRuntimeIncident): void {
  const key = resolveIncidentBucketKey(input.userId);
  const bucket = incidentsByUser.get(key) ?? [];
  bucket.push(input);
  if (bucket.length > MAX_INCIDENTS) {
    bucket.splice(0, bucket.length - MAX_INCIDENTS);
  }
  incidentsByUser.set(key, bucket);
  safeWriteTeamRuntimeIncidentAudit(input);
  safeTrackTeamRuntimeIncident(input);
}

export function listTeamRuntimeIncidents(input?: {
  limit?: number;
  userId?: string | null;
}): TeamRuntimeIncident[] {
  const key = resolveIncidentBucketKey(input?.userId ?? null);
  const bucket = incidentsByUser.get(key) ?? [];
  const limit = input?.limit ?? 20;
  if (limit <= 0) {
    return [];
  }
  if (!input?.userId) {
    return bucket.slice(-limit).reverse();
  }
  return mergeRuntimeIncidentSources({
    inMemory: bucket,
    limit,
    persisted: listPersistedTeamRuntimeIncidents({
      limit: Math.max(limit * 4, 100),
      userId: input.userId,
    }),
  });
}

export function getTeamRuntimeIncidentSummary(input?: {
  sinceMs?: number;
  userId?: string | null;
}): Record<TeamRuntimeIncidentCategory, number> {
  const sinceMs = input?.sinceMs;
  const key = resolveIncidentBucketKey(input?.userId ?? null);
  const bucket = incidentsByUser.get(key) ?? [];
  const incidents = input?.userId
    ? mergeRuntimeIncidentSources({
        inMemory: bucket,
        limit: 400,
        persisted: listPersistedTeamRuntimeIncidents({
          limit: 400,
          userId: input.userId,
        }),
      })
    : bucket;
  const filtered =
    typeof sinceMs === 'number'
      ? incidents.filter((incident) => incident.timestamp >= sinceMs)
      : incidents;
  return filtered.reduce<Record<TeamRuntimeIncidentCategory, number>>(
    (acc, incident) => {
      acc[incident.category] += 1;
      return acc;
    },
    {
      architecture_review: 0,
      handoff_failure: 0,
      latency_violation: 0,
      team_events_connection: 0,
      team_events_listener: 0,
    },
  );
}

function buildRuntimeIncidentDedupeKey(incident: TeamRuntimeIncident): string {
  return JSON.stringify({
    category: incident.category,
    code: incident.code,
    context: incident.context,
    message: incident.message,
    severity: incident.severity,
    timestamp: incident.timestamp,
    userId: incident.userId,
  });
}

function mergeRuntimeIncidentSources(input: {
  inMemory: TeamRuntimeIncident[];
  limit: number;
  persisted: TeamRuntimeIncident[];
}): TeamRuntimeIncident[] {
  const merged = [...input.inMemory, ...input.persisted];
  const seen = new Set<string>();
  const deduped: TeamRuntimeIncident[] = [];
  for (const incident of merged.sort((left, right) => right.timestamp - left.timestamp)) {
    const key = buildRuntimeIncidentDedupeKey(incident);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(incident);
    if (deduped.length >= input.limit) {
      break;
    }
  }
  return deduped;
}

export function getTeamRuntimeIncidentCodeSummary(input?: {
  limit?: number;
  sinceMs?: number;
  userId?: string | null;
}): Record<string, number> {
  const sinceMs = input?.sinceMs;
  const key = resolveIncidentBucketKey(input?.userId ?? null);
  const bucket = incidentsByUser.get(key) ?? [];
  const filtered =
    typeof sinceMs === 'number'
      ? bucket.filter((incident) => incident.timestamp >= sinceMs)
      : bucket;
  const limit = input?.limit;
  const sliced = typeof limit === 'number' && limit > 0 ? filtered.slice(-limit) : filtered;

  return sliced.reduce<Record<string, number>>((acc, incident) => {
    acc[incident.code] = (acc[incident.code] ?? 0) + 1;
    return acc;
  }, {});
}

export function __resetTeamRuntimeDiagnosticsForTesting(): void {
  incidentsByUser.clear();
  lastIncidentAuditAtBySignature.clear();
  signatureWritesSinceSweep = 0;
}

/** Test-only: override the audit-signature sweep interval (null restores default). */
export function __setIncidentAuditSweepIntervalForTesting(interval: number | null): void {
  signatureSweepInterval =
    typeof interval === 'number' && interval > 0
      ? Math.floor(interval)
      : DEFAULT_SIGNATURE_SWEEP_INTERVAL;
  signatureWritesSinceSweep = 0;
}

/** Test-only: current size of the audit-signature dedupe map. */
export function __incidentAuditSignatureCountForTesting(): number {
  return lastIncidentAuditAtBySignature.size;
}

function resolveIncidentAuditEntityId(input: TeamRuntimeIncident): string {
  const handoffId = input.context['handoffId'];
  if (typeof handoffId === 'string' && handoffId.length > 0) {
    return handoffId;
  }
  const sessionId = input.context['sessionId'];
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    return sessionId;
  }
  return input.code;
}

function resolveIncidentSessionId(input: TeamRuntimeIncident): string | null {
  for (const key of [
    'sessionId',
    'receptionSessionId',
    'fromSessionId',
    'toSessionId',
    'childSessionId',
  ] as const) {
    const value = input.context[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function parsePersistedRuntimeIncident(
  row: PersistedRuntimeIncidentRow,
  userId: string,
): TeamRuntimeIncident | null {
  if (!row.detail) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.detail) as Record<string, unknown>;
    const category = parsed['category'];
    const code = parsed['code'];
    const context = parsed['context'];
    const message = parsed['message'];
    const severity = parsed['severity'];
    const timestamp = parsed['timestamp'];
    if (
      category !== 'architecture_review' &&
      category !== 'handoff_failure' &&
      category !== 'latency_violation' &&
      category !== 'team_events_connection' &&
      category !== 'team_events_listener'
    ) {
      return null;
    }
    if (
      typeof code !== 'string' ||
      typeof message !== 'string' ||
      (severity !== 'warning' && severity !== 'error') ||
      typeof timestamp !== 'number' ||
      typeof context !== 'object' ||
      context === null ||
      Array.isArray(context)
    ) {
      return null;
    }
    return {
      category,
      code,
      context: context as Record<string, boolean | number | string | null>,
      message,
      severity,
      timestamp,
      userId,
    };
  } catch {
    return null;
  }
}

function listPersistedTeamRuntimeIncidents(input: {
  limit: number;
  userId: string;
}): TeamRuntimeIncident[] {
  const rows = sqliteAll<PersistedRuntimeIncidentRow>(
    `SELECT detail, created_at
       FROM team_audit_logs
      WHERE user_id = ? AND action = 'runtime_incident'
      ORDER BY id DESC
      LIMIT ?`,
    [input.userId, input.limit],
  );
  return rows
    .map((row) => parsePersistedRuntimeIncident(row, input.userId))
    .filter((incident): incident is TeamRuntimeIncident => incident !== null);
}

function buildIncidentAuditSignature(input: TeamRuntimeIncident): string | null {
  if (!input.userId) {
    return null;
  }
  // 去重签名只取稳定维度（user + category + code + 实体），刻意剔除 context / message：
  // 像 latency_violation 这类高频事件，其 durationMs 每次都不同，若纳入签名会让 60s
  // 去重永不命中，进而在系统已经变慢时对 team_audit_logs 形成写风暴。实体维度沿用
  // 审计行的 entityId 派生（handoffId / sessionId / code），保证 handoff 失败仍按实体分别留痕。
  return JSON.stringify({
    userId: input.userId,
    category: input.category,
    code: input.code,
    entityId: resolveIncidentAuditEntityId(input),
  });
}

function writeTeamRuntimeIncidentAudit(input: TeamRuntimeIncident): void {
  if (!input.userId) {
    return;
  }

  const signature = buildIncidentAuditSignature(input);
  if (!signature) {
    return;
  }

  const now = Date.now();
  const lastAt = lastIncidentAuditAtBySignature.get(signature) ?? 0;
  if (now - lastAt < INCIDENT_AUDIT_DEDUPE_MS) {
    return;
  }

  const entityId = resolveIncidentAuditEntityId(input);
  const summary = `runtime incident: ${input.code}`;

  logTeamAudit({
    action: 'runtime_incident',
    detail: JSON.stringify({
      category: input.category,
      code: input.code,
      context: input.context,
      message: input.message,
      severity: input.severity,
      timestamp: input.timestamp,
    }),
    entityId,
    entityType: 'runtime_incident',
    sessionId: resolveIncidentSessionId(input),
    summary,
    userId: input.userId,
  });
  lastIncidentAuditAtBySignature.set(signature, now);
  signatureWritesSinceSweep += 1;
  if (signatureWritesSinceSweep >= signatureSweepInterval) {
    signatureWritesSinceSweep = 0;
    sweepExpiredAuditSignatures(now);
  }
}

function safeWriteTeamRuntimeIncidentAudit(input: TeamRuntimeIncident): void {
  try {
    writeTeamRuntimeIncidentAudit(input);
  } catch (error) {
    console.warn(
      `[team-runtime-diagnostics] 写 runtime incident audit 失败：${formatErrorMessage(error)}`,
    );
  }
}

function safeTrackTeamRuntimeIncident(input: TeamRuntimeIncident): void {
  try {
    trackTeamRuntimeIncident(input);
  } catch (error) {
    console.warn(
      `[team-runtime-diagnostics] 上报 runtime incident telemetry 失败：${formatErrorMessage(error)}`,
    );
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
