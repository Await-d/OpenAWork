import { sqliteAll, sqliteRun } from '../infra/db.js';

/**
 * TaskJob —— 子代理与后台工作的统一生命周期注册表。
 *
 * 对标上游 `packages/core/src/job.ts` 的 `Job.Service`：
 *   - 单一注册表承载「运行中 / 已完成 / 失败 / 取消」四态；
 *   - 显式 `background` 语义（与前台 block 分叉）；
 *   - 可恢复工作的通知身份是 `notificationId`（不是 clientRequestId 前缀）；
 *   - 终态结果进入 25 条消费历史，可恢复后台工作额外持久化到 `task_jobs` 表。
 *
 * 本模块只负责状态与持久化，**不负责**消息注入与唤醒（由交付层调用）。
 */

/** 消费历史上限，对齐上游 `COMPLETED_LIMIT`。 */
const MAX_CONSUMED_HISTORY = 25;

export type TaskJobStatus = 'running' | 'completed' | 'error' | 'cancelled';

/** 终态：完成 / 失败 / 取消。 */
export type TaskJobTerminalStatus = Exclude<TaskJobStatus, 'running'>;

/** 可恢复工作的恢复载体，对齐上游 `Recovery` 的 subagent 分支。 */
export interface TaskJobRecovery {
  kind: 'subagent';
  parentSessionId: string;
  childSessionId: string;
  agent: string;
  description: string;
}

export interface TaskJobInfo {
  id: string;
  type: 'subagent';
  title: string;
  status: TaskJobStatus;
  startedAt: number;
  completedAt?: number;
  output?: string;
  error?: string;
  /** 可恢复后台工作的通知身份；即合成消息 ID。 */
  notificationId?: string;
  recovery?: TaskJobRecovery;
}

export interface TaskJobStartInput {
  id: string;
  title?: string;
  recovery?: TaskJobRecovery;
  notificationId?: string;
}

export interface TaskJobSettleInput {
  status: TaskJobTerminalStatus;
  output?: string;
  error?: string;
  notificationId?: string;
}

interface ActiveTaskJob {
  info: TaskJobInfo;
  waiters: Set<(info: TaskJobInfo) => void>;
  backgrounded: boolean;
  consumed: boolean;
}

interface PersistedTaskJobRow {
  id: string;
  notification_id: string;
  recovery_json: string;
  status: string;
  output: string | null;
  error: string | null;
}

/** 供重启恢复扫描使用的完整持久化记录（含通知身份与终态结果）。 */
export interface PersistedBackgroundJob {
  notificationId: string;
  recovery: TaskJobRecovery;
  status: TaskJobStatus;
  output?: string;
  error?: string;
}

const activeJobs = new Map<string, ActiveTaskJob>();

function snapshot(job: ActiveTaskJob): TaskJobInfo {
  return { ...job.info };
}

function isTerminal(status: TaskJobStatus): status is TaskJobTerminalStatus {
  return status !== 'running';
}

function resolveWaiters(job: ActiveTaskJob): void {
  const waiters = [...job.waiters];
  job.waiters.clear();
  for (const waiter of waiters) {
    waiter(snapshot(job));
  }
}

/**
 * 仅移除「已消费且无 notificationId」的最旧条目，直到不超过消费历史上限。
 * 带 notificationId 的条目必须等 `completeBackground` 显式清理。
 */
function trimConsumedHistory(): void {
  const consumed = [...activeJobs.entries()].filter(
    ([, job]) => job.consumed && job.info.notificationId === undefined,
  );
  const overflow = consumed.length - MAX_CONSUMED_HISTORY;
  if (overflow <= 0) {
    return;
  }
  for (const [id] of consumed.slice(0, overflow)) {
    activeJobs.delete(id);
  }
}

function persistJob(job: ActiveTaskJob): void {
  const { recovery, notificationId } = job.info;
  if (!recovery || !notificationId) {
    return;
  }
  sqliteRun(
    `INSERT INTO task_jobs
       (id, notification_id, recovery_json, status, output, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       notification_id = excluded.notification_id,
       recovery_json = excluded.recovery_json,
       status = excluded.status,
       output = excluded.output,
       error = excluded.error,
       updated_at = datetime('now')`,
    [
      job.info.id,
      notificationId,
      JSON.stringify(recovery),
      job.info.status,
      job.info.output ?? null,
      job.info.error ?? null,
    ],
  );
}

/** 启动或加入一个任务。同名运行中任务直接复用，不重启执行体。 */
export function start(input: TaskJobStartInput): TaskJobInfo {
  const existing = activeJobs.get(input.id);
  if (existing && existing.info.status === 'running') {
    return snapshot(existing);
  }

  const job: ActiveTaskJob = {
    info: {
      id: input.id,
      type: 'subagent',
      title: input.title ?? input.id,
      status: 'running',
      startedAt: Date.now(),
      ...(input.notificationId ? { notificationId: input.notificationId } : {}),
      ...(input.recovery ? { recovery: input.recovery } : {}),
    },
    waiters: new Set(),
    backgrounded: false,
    consumed: false,
  };
  activeJobs.set(input.id, job);
  return snapshot(job);
}

export function startBackground(input: TaskJobStartInput): TaskJobInfo {
  const info = start(input);
  background(input.id);
  return get(input.id) ?? info;
}

export function get(id: string): TaskJobInfo | undefined {
  const job = activeJobs.get(id);
  return job ? snapshot(job) : undefined;
}

export function listActive(): TaskJobInfo[] {
  return [...activeJobs.values()].map(snapshot);
}

/**
 * 结算：置为终态并写入 output/error。
 * 幂等——已终态的任务再次 settle 不会覆盖既有结果。
 * 返回 `undefined` 表示该 id 不在注册表中。
 */
export function settle(id: string, input: TaskJobSettleInput): TaskJobInfo | undefined {
  const job = activeJobs.get(id);
  if (!job) {
    return undefined;
  }
  if (isTerminal(job.info.status)) {
    return snapshot(job);
  }

  job.info = {
    ...job.info,
    status: input.status,
    completedAt: Date.now(),
    ...(input.notificationId ? { notificationId: input.notificationId } : {}),
    ...(input.output !== undefined ? { output: input.output } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
  };
  persistJob(job);
  resolveWaiters(job);
  return snapshot(job);
}

/** 取消运行中的任务。已终态时为幂等空操作。 */
export function cancel(id: string): TaskJobInfo | undefined {
  const job = activeJobs.get(id);
  if (!job) {
    return undefined;
  }
  if (isTerminal(job.info.status)) {
    return snapshot(job);
  }

  job.info = {
    ...job.info,
    status: 'cancelled',
    completedAt: Date.now(),
  };
  persistJob(job);
  resolveWaiters(job);
  return snapshot(job);
}

/**
 * 把前台阻塞工作转为后台：保留恢复载体并分配通知身份。
 * 可恢复工作即使已终态也允许 background（对齐上游「先完成再转后台」）。
 */
export function background(id: string): TaskJobInfo | undefined {
  const job = activeJobs.get(id);
  if (!job) {
    return undefined;
  }
  const recovery = job.info.recovery;
  if (!recovery && isTerminal(job.info.status)) {
    return undefined;
  }
  if (job.backgrounded) {
    return snapshot(job);
  }

  job.backgrounded = true;
  job.info = {
    ...job.info,
    ...(recovery ? { notificationId: job.info.notificationId ?? createNotificationId() } : {}),
  };
  persistJob(job);
  return snapshot(job);
}

/** 标记结果已被消费，使其可进入消费历史。 */
export function consume(id: string): void {
  const job = activeJobs.get(id);
  if (!job || !isTerminal(job.info.status) || job.consumed) {
    return;
  }
  job.consumed = true;
  trimConsumedHistory();
}

/** 通知已投递，幂等清理持久化记录与内存条目。 */
export function completeBackground(notificationId: string): void {
  sqliteRun('DELETE FROM task_jobs WHERE notification_id = ?', [notificationId]);
  for (const [id, job] of activeJobs) {
    if (job.info.notificationId === notificationId && isTerminal(job.info.status)) {
      activeJobs.delete(id);
    }
  }
}

export function completeConsumedBackgroundJobs(input: {
  sessionId: string;
  userId: string;
}): number {
  const pending = sqliteAll<{ notification_id: string }>(
    `SELECT task_jobs.notification_id FROM task_jobs
     JOIN message_v2 AS notice ON notice.id = task_jobs.notification_id
     JOIN message_v2 AS consumed ON consumed.session_id = notice.session_id
       AND consumed.user_id = notice.user_id
       AND (consumed.time_created > notice.time_created
         OR (consumed.time_created = notice.time_created AND consumed.id > notice.id))
     WHERE notice.session_id = ? AND notice.user_id = ?
       AND task_jobs.status != 'running'
       AND json_extract(consumed.data, '$.role') IN ('user', 'assistant')
     GROUP BY task_jobs.notification_id`,
    [input.sessionId, input.userId],
  );
  for (const row of pending) {
    completeBackground(row.notification_id);
  }
  return pending.length;
}

/** 未投递的可恢复后台工作，供启动恢复扫描使用。 */
export function pendingBackground(): TaskJobRecovery[] {
  const rows = sqliteAll<PersistedTaskJobRow>('SELECT * FROM task_jobs ORDER BY updated_at ASC');
  const recoveries: TaskJobRecovery[] = [];
  for (const row of rows) {
    const recovery = parseRecovery(row.recovery_json);
    if (recovery) {
      recoveries.push(recovery);
    }
  }
  return recoveries;
}

/** 等待任务进入终态；已终态时立即返回。 */
export function waitForSettle(id: string): Promise<TaskJobInfo | undefined> {
  const job = activeJobs.get(id);
  if (!job) {
    return Promise.resolve(undefined);
  }
  if (isTerminal(job.info.status)) {
    return Promise.resolve(snapshot(job));
  }
  return new Promise<TaskJobInfo>((resolve) => {
    job.waiters.add(resolve);
  });
}

function normalizePersistedStatus(value: string): TaskJobStatus {
  return value === 'running' || value === 'completed' || value === 'error' || value === 'cancelled'
    ? value
    : 'error';
}

/**
 * 列出全部持久化记录（含通知身份、终态结果），供重启恢复扫描使用。
 *
 * 与 `pendingBackground()` 的区别：后者只返回恢复载体（父子会话 / agent / 描述），
 * 不足以重建一条通知——恢复需要 `notificationId`、`status` 与 `output`/`error`。
 */
export function listPersistedBackgroundJobs(): PersistedBackgroundJob[] {
  const rows = sqliteAll<PersistedTaskJobRow>('SELECT * FROM task_jobs ORDER BY updated_at ASC');
  const jobs: PersistedBackgroundJob[] = [];
  for (const row of rows) {
    const recovery = parseRecovery(row.recovery_json);
    if (!recovery) {
      continue;
    }
    jobs.push({
      notificationId: row.notification_id,
      recovery,
      status: normalizePersistedStatus(row.status),
      ...(row.output ? { output: row.output } : {}),
      ...(row.error ? { error: row.error } : {}),
    });
  }
  return jobs;
}

export function updatePersistedBackgroundJob(input: {
  notificationId: string;
  status: TaskJobTerminalStatus;
  output?: string;
  error?: string;
}): void {
  sqliteRun(
    `UPDATE task_jobs SET status = ?, output = ?, error = ?, updated_at = datetime('now')
     WHERE notification_id = ? AND status = 'running'`,
    [input.status, input.output ?? null, input.error ?? null, input.notificationId],
  );
}

function parseRecovery(value: string): TaskJobRecovery | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<TaskJobRecovery>;
    if (
      parsed.kind !== 'subagent' ||
      typeof parsed.parentSessionId !== 'string' ||
      typeof parsed.childSessionId !== 'string' ||
      typeof parsed.agent !== 'string' ||
      typeof parsed.description !== 'string'
    ) {
      return undefined;
    }
    return {
      kind: 'subagent',
      parentSessionId: parsed.parentSessionId,
      childSessionId: parsed.childSessionId,
      agent: parsed.agent,
      description: parsed.description,
    };
  } catch {
    // 脏数据不阻断恢复扫描：跳过该条继续处理其余记录。
    return undefined;
  }
}

function createNotificationId(): string {
  return `task-job:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

/** 仅测试使用：清空内存注册表（不动持久化）。 */
export function resetTaskJobsForTests(): void {
  activeJobs.clear();
}
