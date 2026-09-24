/**
 * 定时任务持久化存储（`cron_jobs` / `cron_job_executions`）。
 *
 * 背景：`CronScheduler` 原本是纯内存实现，网关重启即丢任务与历史。本模块提供：
 *   - 任务定义 upsert / delete / 启动全量装载；
 *   - 执行历史 upsert（fireJob 开始与结束各写一次）与按任务保留上限的裁剪；
 *   - 重启时把残留的 `running` 执行标记为 `failed`（中断）。
 *
 * 调度器通过 `CronSchedulerPersistence` 钩子调用本模块（保持调度器可单测、无 DB 依赖）。
 */

import { sqliteAll, sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';
import type { CronExecutionRecord, CronJobRecord, DeliveryMode, ScheduleKind } from './types.js';

/** 每个任务保留的执行历史条数上限（按 started_at 倒序裁剪）。 */
export const CRON_EXECUTION_RETENTION_PER_JOB = 200;

interface CronJobRow {
  id: string;
  user_id: string;
  name: string;
  schedule_kind: string;
  schedule_at: number | null;
  schedule_every: number | null;
  schedule_expr: string | null;
  schedule_tz: string;
  prompt: string;
  agent_id: string | null;
  model: string | null;
  working_folder: string | null;
  session_id: string | null;
  delivery_mode: string;
  delivery_target: string | null;
  plugin_id: string | null;
  plugin_chat_id: string | null;
  enabled: number;
  delete_after_run: number;
  max_iterations: number;
  last_fired_at: number | null;
  fire_count: number;
  created_at: number;
  updated_at: number;
}

interface CronExecutionRow {
  id: string;
  job_id: string;
  user_id: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  error: string | null;
  session_id: string | null;
}

function rowToCronJob(row: CronJobRow): CronJobRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    schedule_kind: row.schedule_kind as ScheduleKind,
    schedule_at: row.schedule_at,
    schedule_every: row.schedule_every,
    schedule_expr: row.schedule_expr,
    schedule_tz: row.schedule_tz,
    prompt: row.prompt,
    agent_id: row.agent_id,
    model: row.model,
    working_folder: row.working_folder,
    session_id: row.session_id,
    delivery_mode: row.delivery_mode as DeliveryMode,
    delivery_target: row.delivery_target,
    plugin_id: row.plugin_id,
    plugin_chat_id: row.plugin_chat_id,
    enabled: row.enabled === 1,
    delete_after_run: row.delete_after_run === 1,
    max_iterations: row.max_iterations,
    last_fired_at: row.last_fired_at,
    fire_count: row.fire_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToCronExecution(row: CronExecutionRow): CronExecutionRecord {
  return {
    id: row.id,
    job_id: row.job_id,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status: row.status as CronExecutionRecord['status'],
    ...(row.error !== null ? { error: row.error } : {}),
    ...(row.session_id !== null ? { session_id: row.session_id } : {}),
  };
}

/** 任务定义 upsert（与内存态保持同步；`id` 为主键）。 */
export function upsertCronJob(job: CronJobRecord): void {
  sqliteRun(
    `INSERT INTO cron_jobs (
       id, user_id, name, schedule_kind, schedule_at, schedule_every, schedule_expr, schedule_tz,
       prompt, agent_id, model, working_folder, session_id, delivery_mode, delivery_target,
       plugin_id, plugin_chat_id, enabled, delete_after_run, max_iterations,
       last_fired_at, fire_count, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       name = excluded.name,
       schedule_kind = excluded.schedule_kind,
       schedule_at = excluded.schedule_at,
       schedule_every = excluded.schedule_every,
       schedule_expr = excluded.schedule_expr,
       schedule_tz = excluded.schedule_tz,
       prompt = excluded.prompt,
       agent_id = excluded.agent_id,
       model = excluded.model,
       working_folder = excluded.working_folder,
       session_id = excluded.session_id,
       delivery_mode = excluded.delivery_mode,
       delivery_target = excluded.delivery_target,
       plugin_id = excluded.plugin_id,
       plugin_chat_id = excluded.plugin_chat_id,
       enabled = excluded.enabled,
       delete_after_run = excluded.delete_after_run,
       max_iterations = excluded.max_iterations,
       last_fired_at = excluded.last_fired_at,
       fire_count = excluded.fire_count,
       updated_at = excluded.updated_at`,
    [
      job.id,
      job.user_id,
      job.name,
      job.schedule_kind,
      job.schedule_at,
      job.schedule_every,
      job.schedule_expr,
      job.schedule_tz,
      job.prompt,
      job.agent_id,
      job.model,
      job.working_folder,
      job.session_id,
      job.delivery_mode,
      job.delivery_target,
      job.plugin_id,
      job.plugin_chat_id,
      job.enabled ? 1 : 0,
      job.delete_after_run ? 1 : 0,
      job.max_iterations,
      job.last_fired_at,
      job.fire_count,
      job.created_at,
      job.updated_at,
    ],
  );
}

/**
 * 删除任务定义，并在同一事务内清理其执行历史。
 *
 * `cron_job_executions` 没有指向 `cron_jobs` 的外键（避免删除任务时误伤审计需要），
 * 若只删任务行，历史会成为永久孤儿（路由对已删任务 404，孤儿行再也无法被查询或
 * 裁剪）——因此显式级联删除。
 */
export function deleteCronJob(id: string): void {
  sqliteTransaction(() => {
    sqliteRun('DELETE FROM cron_job_executions WHERE job_id = ?', [id]);
    sqliteRun('DELETE FROM cron_jobs WHERE id = ?', [id]);
  });
}

/** 启动装载：全部任务（含 disabled，调度器只对 enabled 建定时器）。 */
export function listCronJobsForRestore(): CronJobRecord[] {
  return sqliteAll<CronJobRow>('SELECT * FROM cron_jobs ORDER BY created_at ASC', []).map(
    rowToCronJob,
  );
}

export function getCronJobById(id: string): CronJobRecord | undefined {
  const row = sqliteGet<CronJobRow>('SELECT * FROM cron_jobs WHERE id = ? LIMIT 1', [id]);
  return row ? rowToCronJob(row) : undefined;
}

/** 执行历史 upsert + 按任务裁剪保留窗口。 */
export function recordCronExecution(userId: string, exec: CronExecutionRecord): void {
  sqliteRun(
    `INSERT INTO cron_job_executions (id, job_id, user_id, started_at, finished_at, status, error, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       finished_at = excluded.finished_at,
       status = excluded.status,
       error = excluded.error,
       session_id = excluded.session_id`,
    [
      exec.id,
      exec.job_id,
      userId,
      exec.started_at,
      exec.finished_at,
      exec.status,
      exec.error ?? null,
      exec.session_id ?? null,
    ],
  );

  sqliteRun(
    `DELETE FROM cron_job_executions
      WHERE job_id = ?
        AND id NOT IN (
          SELECT id FROM cron_job_executions
           WHERE job_id = ?
           ORDER BY started_at DESC, id DESC
           LIMIT ?
        )`,
    [exec.job_id, exec.job_id, CRON_EXECUTION_RETENTION_PER_JOB],
  );
}

export function listCronExecutionsForJob(jobId: string, limit = 100): CronExecutionRecord[] {
  return sqliteAll<CronExecutionRow>(
    `SELECT * FROM cron_job_executions WHERE job_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`,
    [jobId, limit],
  ).map(rowToCronExecution);
}

/**
 * 重启补偿：把上次进程残留的 `running` 执行标记为 `failed`（网关重启中断），
 * 避免历史里永远挂着不可能结束的运行态。
 */
export function markInterruptedCronExecutions(): number {
  const rows = sqliteAll<{ id: string }>(
    `SELECT id FROM cron_job_executions WHERE status = 'running'`,
    [],
  );
  if (rows.length === 0) {
    return 0;
  }
  sqliteRun(
    `UPDATE cron_job_executions
        SET status = 'failed',
            finished_at = ?,
            error = COALESCE(error, '网关重启中断。')
      WHERE status = 'running'`,
    [Date.now()],
  );
  return rows.length;
}

export interface CronRestoreScheduler {
  restoreJobs(jobs: readonly CronJobRecord[]): void;
}

/** 启动装载入口：先标记中断执行，再把任务定义装回调度器。 */
export function restoreCronJobsFromStore(scheduler: CronRestoreScheduler): {
  restored: number;
  interrupted: number;
} {
  const interrupted = markInterruptedCronExecutions();
  const jobs = listCronJobsForRestore();
  scheduler.restoreJobs(jobs);
  return { restored: jobs.length, interrupted };
}
