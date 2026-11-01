/**
 * 周期整理任务持久化与租约（261101-记忆确认写入与周期整理）。
 *
 * 设计要点：
 * - 任务以 `memory_jobs` 表为唯一真相源，同 `(kind, scope_key, period_key)` 只建一行，
 *   依赖唯一索引 + `INSERT OR IGNORE` 实现「同周期重复入队是 no-op」。
 * - 领取走**事务内条件更新**：`UPDATE ... WHERE id = ? AND status IN ('queued','retry_wait')`
 *   的 `changes` 才是「是否真正拿到租约」的唯一依据，绝不允许返回未持有租约的 lease。
 * - 续约 / 完成 / 失败 / 释放全部按 `id + lease_token` 双重条件，迟到 worker 不得覆盖新状态。
 * - 进程崩溃遗留的 `running` 由 `recoverExpiredMemoryJobLeases` 拉回 `retry_wait`。
 */
import { randomUUID } from 'node:crypto';
import type { MemoryJobKind, MemoryMaintenanceSummary, MemoryScope } from '@openAwork/agent-core';
import { memoryScopeKey } from '@openAwork/agent-core';
import {
  sqliteAll,
  sqliteGet,
  sqliteRun,
  sqliteRunWithChanges,
  sqliteTransaction,
} from '../../infra/db.js';
import { logGatewayWarn } from '../../infra/gateway-logger.js';

/** 租约默认有效期：5 分钟。 */
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
/** 任务最大尝试次数，达上限即置 failed。 */
const MAX_JOB_ATTEMPTS = 5;
/** 任务退避上限：1 小时。 */
const MAX_JOB_BACKOFF_MS = 60 * 60 * 1000;
/** 退避基数：1 分钟（`base * 2^(attempts-1)`）。 */
const JOB_BACKOFF_BASE_MS = 60 * 1000;
/** 报告默认读取条数上限。 */
const DEFAULT_REPORT_LIMIT = 50;

const VALID_SCOPE_TYPES = new Set(['user', 'workspace', 'team', 'channel_chat']);

export interface MemoryJobLease {
  jobId: string;
  userId: string;
  kind: MemoryJobKind;
  scope: MemoryScope;
  owner: string;
  token: string;
}

export interface MemoryMaintenanceStateRow {
  changeWatermark: number;
  lastPatrolAt: string | null;
  lastSemanticAt: string | null;
  lastReviewAt: string | null;
}

export interface EnqueueMemoryJobInput {
  userId: string;
  kind: MemoryJobKind;
  scope: MemoryScope;
  periodKey: string;
  dueAt: string;
  now?: Date;
}

export interface ClaimDueMemoryJobInput {
  owner: string;
  now: Date;
  kinds?: readonly MemoryJobKind[];
  leaseMs?: number;
}

export interface CreateMemoryMaintenanceReportInput {
  userId: string;
  jobId: string;
  scope: MemoryScope;
  summary: MemoryMaintenanceSummary;
  watermark: number;
  now?: Date;
}

export interface UnnotifiedMemoryMaintenanceReport {
  id: string;
  scope: MemoryScope;
  summary: MemoryMaintenanceSummary;
  createdAt: string;
}

interface MemoryJobRow {
  id: string;
  user_id: string;
  kind: MemoryJobKind;
  scope_key: string;
  status: string;
  due_at: string;
  period_key: string;
  attempts: number;
  lease_token: string | null;
}

interface MemoryJobCandidateRow {
  id: string;
  user_id: string;
  kind: MemoryJobKind;
  scope_key: string;
  attempts: number;
}

interface MemoryMaintenanceStateDbRow {
  change_watermark: number;
  last_patrol_at: string | null;
  last_semantic_at: string | null;
  last_review_at: string | null;
}

interface MemoryMaintenanceReportRow {
  id: string;
  scope_type: string;
  scope_id: string;
  summary_json: string;
  created_at: string;
}

/**
 * 进程级租约持有者 id。
 *
 * 每次进程启动唯一，保证重启后不会以同一 owner 续约上一个进程遗留的租约。
 */
export function createMemoryJobOwnerId(): string {
  return randomUUID();
}

function toIso(date: Date): string {
  return date.toISOString();
}

function isoOrNow(date: Date | undefined): string {
  return toIso(date ?? new Date());
}

/** 指数退避，上限 `MAX_JOB_BACKOFF_MS`。`attempts` 为已完成尝试次数。 */
function computeJobBackoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const raw = JOB_BACKOFF_BASE_MS * 2 ** Math.min(exponent, 20);
  return Math.min(raw, MAX_JOB_BACKOFF_MS);
}

/**
 * 反解 `scope_key` 为 `MemoryScope`。
 *
 * 解析失败返回 null，调用方必须跳过该行（脏数据不得让整个领取流程抛错）。
 */
function parseMemoryScopeKey(scopeKey: string): MemoryScope | null {
  const separator = scopeKey.indexOf(':');
  if (separator <= 0) {
    return null;
  }
  const type = scopeKey.slice(0, separator);
  const id = scopeKey.slice(separator + 1);
  if (!VALID_SCOPE_TYPES.has(type) || id.length === 0) {
    return null;
  }
  return { type: type as MemoryScope['type'], id };
}

/** 入队整理任务；同 `(kind, scope_key, period_key)` 重复调用是 no-op。 */
export function enqueueMemoryJob(input: EnqueueMemoryJobInput): void {
  const nowIso = isoOrNow(input.now);
  const scopeKey = memoryScopeKey(input.scope);
  sqliteRun(
    `INSERT OR IGNORE INTO memory_jobs
       (id, user_id, kind, scope_key, status, due_at, period_key, attempts,
        lease_owner, lease_token, lease_expires_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?)`,
    [
      randomUUID(),
      input.userId,
      input.kind,
      scopeKey,
      input.dueAt,
      input.periodKey,
      nowIso,
      nowIso,
    ],
  );
}

/**
 * 领取一个到期任务。
 *
 * 事务内先选最早到期候选，再以条件 UPDATE 抢占；`changes === 0` 说明被别的
 * worker 抢走（或不满足状态前置），此时返回 null 而不是伪造 lease。
 */
export function claimDueMemoryJob(input: ClaimDueMemoryJobInput): MemoryJobLease | null {
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  const nowIso = toIso(input.now);
  const leaseExpiresAt = toIso(new Date(input.now.getTime() + leaseMs));
  const kinds = input.kinds ?? [];

  return sqliteTransaction(() => {
    const kindFilter = kinds.length > 0 ? ` AND kind IN (${kinds.map(() => '?').join(', ')})` : '';
    const candidates = sqliteAll<MemoryJobCandidateRow>(
      `SELECT id, user_id, kind, scope_key, attempts
         FROM memory_jobs
        WHERE status IN ('queued', 'retry_wait')
          AND due_at <= ?${kindFilter}
        ORDER BY due_at ASC, created_at ASC
        LIMIT 10`,
      [nowIso, ...kinds],
    );
    if (candidates.length === 0) {
      return null;
    }

    for (const candidate of candidates) {
      const scope = parseMemoryScopeKey(candidate.scope_key);
      if (scope === null) {
        logGatewayWarn('[memory-jobs] 跳过无法解析 scope_key 的任务', {
          jobId: candidate.id,
          scopeKey: candidate.scope_key,
        });
        continue;
      }

      const token = randomUUID();
      const changes = sqliteRunWithChanges(
        `UPDATE memory_jobs
            SET status = 'running',
                lease_owner = ?,
                lease_token = ?,
                lease_expires_at = ?,
                attempts = attempts + 1,
                updated_at = ?
          WHERE id = ? AND status IN ('queued', 'retry_wait')`,
        [input.owner, token, leaseExpiresAt, nowIso, candidate.id],
      );
      if (changes === 0) {
        // 已被其他 worker 抢走：继续尝试下一个候选，而不是返回无租约的假 lease。
        continue;
      }

      return {
        jobId: candidate.id,
        userId: candidate.user_id,
        kind: candidate.kind,
        scope,
        owner: input.owner,
        token,
      };
    }

    return null;
  });
}

/** 续租；只有仍持原 token 的 worker 能续。 */
export function renewMemoryJobLease(
  lease: MemoryJobLease,
  now: Date,
  leaseMs: number = DEFAULT_LEASE_MS,
): boolean {
  const leaseExpiresAt = toIso(new Date(now.getTime() + leaseMs));
  const changes = sqliteRunWithChanges(
    `UPDATE memory_jobs
        SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND lease_token = ? AND status = 'running'`,
    [leaseExpiresAt, toIso(now), lease.jobId, lease.token],
  );
  return changes > 0;
}

/** 完成任务并清租约；按 `id + lease_token` 双重条件。 */
export function completeMemoryJob(lease: MemoryJobLease, now?: Date): boolean {
  const nowIso = isoOrNow(now);
  const changes = sqliteRunWithChanges(
    `UPDATE memory_jobs
        SET status = 'succeeded',
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = NULL,
            updated_at = ?
      WHERE id = ? AND lease_token = ?`,
    [nowIso, lease.jobId, lease.token],
  );
  return changes > 0;
}

/**
 * 标记任务失败。
 *
 * `attempts >= MAX_JOB_ATTEMPTS` 置 `failed`；否则回 `retry_wait` 并把 `due_at`
 * 按指数退避前移。
 */
export function failMemoryJob(lease: MemoryJobLease, error: string, now: Date): boolean {
  const row = sqliteGet<MemoryJobRow>(
    'SELECT id, user_id, kind, scope_key, status, due_at, period_key, attempts, lease_token FROM memory_jobs WHERE id = ? AND lease_token = ?',
    [lease.jobId, lease.token],
  );
  if (row === undefined) {
    return false;
  }

  const nowIso = toIso(now);
  if (row.attempts >= MAX_JOB_ATTEMPTS) {
    const changes = sqliteRunWithChanges(
      `UPDATE memory_jobs
          SET status = 'failed',
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error = ?,
              updated_at = ?
        WHERE id = ? AND lease_token = ?`,
      [error, nowIso, lease.jobId, lease.token],
    );
    return changes > 0;
  }

  const dueAt = toIso(new Date(now.getTime() + computeJobBackoffMs(row.attempts)));
  const changes = sqliteRunWithChanges(
    `UPDATE memory_jobs
        SET status = 'retry_wait',
            due_at = ?,
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = ?,
            updated_at = ?
      WHERE id = ? AND lease_token = ?`,
    [dueAt, error, nowIso, lease.jobId, lease.token],
  );
  return changes > 0;
}

/** 主动交还任务（不消耗退避），回到 `retry_wait` 且立即可再领。 */
export function releaseMemoryJob(lease: MemoryJobLease, error: string, now: Date): boolean {
  const nowIso = toIso(now);
  const changes = sqliteRunWithChanges(
    `UPDATE memory_jobs
        SET status = 'retry_wait',
            due_at = ?,
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = ?,
            updated_at = ?
      WHERE id = ? AND lease_token = ?`,
    [nowIso, error, nowIso, lease.jobId, lease.token],
  );
  return changes > 0;
}

/** 回收租约过期的 running 任务，返回回收条数。 */
export function recoverExpiredMemoryJobLeases(now: Date): number {
  const nowIso = toIso(now);
  return sqliteRunWithChanges(
    `UPDATE memory_jobs
        SET status = 'retry_wait',
            due_at = ?,
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = 'lease_expired',
            updated_at = ?
      WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
    [nowIso, nowIso, nowIso],
  );
}

/** 读取每用户维护水位；无行时返回全零默认值。 */
export function readMemoryMaintenanceState(userId: string): MemoryMaintenanceStateRow {
  const row = sqliteGet<MemoryMaintenanceStateDbRow>(
    `SELECT change_watermark, last_patrol_at, last_semantic_at, last_review_at
       FROM memory_maintenance_state
      WHERE user_id = ?`,
    [userId],
  );
  if (row === undefined) {
    return {
      changeWatermark: 0,
      lastPatrolAt: null,
      lastSemanticAt: null,
      lastReviewAt: null,
    };
  }
  return {
    changeWatermark: row.change_watermark,
    lastPatrolAt: row.last_patrol_at,
    lastSemanticAt: row.last_semantic_at,
    lastReviewAt: row.last_review_at,
  };
}

/** UPSERT 每用户维护水位；只覆盖 patch 中显式给出的字段。 */
export function writeMemoryMaintenanceState(
  userId: string,
  patch: Partial<MemoryMaintenanceStateRow>,
  now: Date,
): void {
  const nowIso = toIso(now);
  const current = readMemoryMaintenanceState(userId);
  const merged: MemoryMaintenanceStateRow = {
    changeWatermark: patch.changeWatermark ?? current.changeWatermark,
    lastPatrolAt: patch.lastPatrolAt ?? current.lastPatrolAt,
    lastSemanticAt: patch.lastSemanticAt ?? current.lastSemanticAt,
    lastReviewAt: patch.lastReviewAt ?? current.lastReviewAt,
  };
  sqliteRun(
    `INSERT INTO memory_maintenance_state
       (user_id, change_watermark, last_patrol_at, last_semantic_at, last_review_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       change_watermark = excluded.change_watermark,
       last_patrol_at = excluded.last_patrol_at,
       last_semantic_at = excluded.last_semantic_at,
       last_review_at = excluded.last_review_at,
       updated_at = excluded.updated_at`,
    [
      userId,
      merged.changeWatermark,
      merged.lastPatrolAt,
      merged.lastSemanticAt,
      merged.lastReviewAt,
      nowIso,
    ],
  );
}

/** 统计未结束（queued / running / retry_wait）且到期的任务数。 */
export function countPendingMemoryJobs(now: Date): number {
  const row = sqliteGet<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM memory_jobs
      WHERE status IN ('queued', 'running', 'retry_wait')
        AND due_at <= ?`,
    [toIso(now)],
  );
  return row?.n ?? 0;
}

/** 落库一条整理报告，返回报告 id。 */
export function createMemoryMaintenanceReport(input: CreateMemoryMaintenanceReportInput): string {
  const id = randomUUID();
  sqliteRun(
    `INSERT INTO memory_maintenance_reports
       (id, user_id, job_id, scope_type, scope_id, summary_json, watermark, created_at, notified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      id,
      input.userId,
      input.jobId,
      input.scope.type,
      input.scope.id,
      JSON.stringify(input.summary),
      input.watermark,
      isoOrNow(input.now),
    ],
  );
  return id;
}

/** 列出尚未通知的整理报告（按创建时间升序）。 */
export function listUnnotifiedMemoryMaintenanceReports(
  userId: string,
  limit: number = DEFAULT_REPORT_LIMIT,
): UnnotifiedMemoryMaintenanceReport[] {
  const rows = sqliteAll<MemoryMaintenanceReportRow>(
    `SELECT id, scope_type, scope_id, summary_json, created_at
       FROM memory_maintenance_reports
      WHERE user_id = ? AND notified_at IS NULL
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    [userId, limit],
  );

  const reports: UnnotifiedMemoryMaintenanceReport[] = [];
  for (const row of rows) {
    let summary: MemoryMaintenanceSummary;
    try {
      summary = JSON.parse(row.summary_json) as MemoryMaintenanceSummary;
    } catch (error) {
      // 脏报告不能让通知流程整体失败：跳过并记录。
      logGatewayWarn('[memory-reports] 跳过无法解析的 summary_json', {
        reportId: row.id,
        error: String(error),
      });
      continue;
    }
    reports.push({
      id: row.id,
      scope: { type: row.scope_type as MemoryScope['type'], id: row.scope_id },
      summary,
      createdAt: row.created_at,
    });
  }
  return reports;
}

/** 标记报告已通知（幂等：已通知的行保持不变）。 */
export function markMemoryMaintenanceReportsNotified(
  reportIds: readonly string[],
  now?: Date,
): void {
  if (reportIds.length === 0) {
    return;
  }
  const nowIso = isoOrNow(now);
  sqliteTransaction(() => {
    for (const reportId of reportIds) {
      sqliteRun(
        `UPDATE memory_maintenance_reports
            SET notified_at = ?
          WHERE id = ? AND notified_at IS NULL`,
        [nowIso, reportId],
      );
    }
  });
}
