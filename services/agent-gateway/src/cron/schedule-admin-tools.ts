/**
 * `schedule_manage` —— 会话内模型在用户审批下管理定时任务（cron）。
 *
 * 设计边界（对齐 260924-AI自助管理扩展四域 域三 / 方案 B）：
 * - 复用 `cronScheduler`（与 HTTP `/cron/jobs` 同一实例）：任务定义持久化在
 *   `cron_jobs`，网关重启后由 `restoreCronJobsFromStore` 恢复；执行历史在
 *   `cron_job_executions`（重启后可查）。
 * - **cron 会话禁止管理定时任务**（防自我复制 / 无人扩权）；team / channel 同样拒绝。
 * - 变更类动作默认 ask；list / history 只读免审批；审批预览展示调度表达式、
 *   时区、prompt 片段与投递目标。
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import { sqliteGet } from '../infra/db.js';
import { listCronExecutionsForJob } from './cron-store.js';
import { SCHEDULE_MANAGE_TOOL_NAME } from './schedule-manage-tool-name.js';
import type { CronScheduler } from './scheduler.js';
import type { CronJobRecord } from './types.js';
import { validateSessionWorkspacePath } from '../workspace/workspace-safety.js';

export { SCHEDULE_MANAGE_TOOL_NAME } from './schedule-manage-tool-name.js';

type CronSchedulerInstance = CronScheduler;

/**
 * 动态获取调度器单例。
 *
 * 静态导入会把 `cron/router → agent-handler → routes/stream-runtime` 拉进
 * `tool-definitions` 的模块图（stream-runtime 又引用工具定义，形成环）；
 * 调度器只在真正执行动作时才需要，故改为按需动态导入。
 */
async function getCronScheduler(): Promise<CronSchedulerInstance> {
  const { cronScheduler } = await import('./router.js');
  return cronScheduler;
}

const SCHEDULE_KINDS = ['at', 'every', 'cron'] as const;
const DELIVERY_MODES = ['desktop', 'session', 'none'] as const;
const HISTORY_LIMIT = 50;
const PROMPT_PREVIEW_CHARS = 200;

// ---------------------------------------------------------------------------
// 输入 schema
// ---------------------------------------------------------------------------

const scheduleJobDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    schedule_kind: z.enum(SCHEDULE_KINDS).optional(),
    schedule_at: z.number().nullable().optional(),
    schedule_every: z.number().int().positive().nullable().optional(),
    schedule_expr: z.string().trim().min(1).max(200).nullable().optional(),
    schedule_tz: z.string().trim().min(1).max(100).optional(),
    prompt: z.string().trim().min(1).max(32768).optional(),
    agent_id: z.string().trim().min(1).max(200).nullable().optional(),
    model: z.string().trim().min(1).max(200).nullable().optional(),
    working_folder: z.string().trim().min(1).max(1000).nullable().optional(),
    session_id: z.string().trim().min(1).max(200).nullable().optional(),
    delivery_mode: z.enum(DELIVERY_MODES).optional(),
    delivery_target: z.string().trim().min(1).max(500).nullable().optional(),
    plugin_id: z.string().trim().min(1).max(100).nullable().optional(),
    plugin_chat_id: z.string().trim().min(1).max(200).nullable().optional(),
    enabled: z.boolean().optional(),
    delete_after_run: z.boolean().optional(),
    max_iterations: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type ScheduleJobDraft = z.infer<typeof scheduleJobDraftSchema>;

export const scheduleManageInputSchema = z
  .object({
    action: z.enum(['list', 'add', 'update', 'remove', 'enable', 'disable', 'history']),
    jobId: z.string().trim().min(1).max(200).optional(),
    job: scheduleJobDraftSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'add') {
      if (!value.job?.name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'add 必须提供 job.name。',
          path: ['job', 'name'],
        });
      }
      if (!value.job?.schedule_kind) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'add 必须提供 job.schedule_kind（at / every / cron）。',
          path: ['job', 'schedule_kind'],
        });
      }
      if (!value.job?.prompt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'add 必须提供 job.prompt。',
          path: ['job', 'prompt'],
        });
      }
      const kind = value.job?.schedule_kind;
      if (kind === 'at' && typeof value.job?.schedule_at !== 'number') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'at 调度必须提供 schedule_at（epoch 毫秒）。',
          path: ['job', 'schedule_at'],
        });
      }
      if (kind === 'every' && typeof value.job?.schedule_every !== 'number') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'every 调度必须提供 schedule_every（毫秒间隔）。',
          path: ['job', 'schedule_every'],
        });
      }
      if (kind === 'cron' && !value.job?.schedule_expr) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'cron 调度必须提供 schedule_expr（5 段表达式）。',
          path: ['job', 'schedule_expr'],
        });
      }
      return;
    }
    if (value.action === 'update' && !value.job) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'update 必须提供 job 字段。',
        path: ['job'],
      });
    }
    if (value.action !== 'list' && !value.jobId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.action} 必须提供 jobId。`,
        path: ['jobId'],
      });
    }
  });

export const scheduleManageToolDefinition: ToolDefinition<
  typeof scheduleManageInputSchema,
  z.ZodString
> = {
  name: SCHEDULE_MANAGE_TOOL_NAME,
  description:
    '管理当前用户的定时任务。action=list 列举；add 新建；update 修改；remove 删除；enable/disable 启停；history 查看执行历史。' +
    '变更类操作需要用户批准；任务定义与执行历史均持久化（网关重启后仍保留）。' +
    'cron 表达式使用 5 段格式（分 时 日 月 周）；时区默认 UTC，可用 schedule_tz 指定。',
  inputSchema: scheduleManageInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('schedule_manage must execute through the gateway-managed sandbox path');
  },
};

// ---------------------------------------------------------------------------
// 会话守卫（fail-closed）
// ---------------------------------------------------------------------------

export interface ScheduleManageSessionRow {
  metadata_json: string;
  role_layer: string | null;
  team_parent_session_id: string | null;
  handoff_state: string | null;
}

const TEAM_ROLE_LAYERS = new Set(['pm1', 'pm2', 'executor', 'reviewer', 'reception']);

/** 返回拒绝原因；`null` 表示允许进入正常权限门控。 */
export function resolveScheduleManageSessionDenial(
  row: ScheduleManageSessionRow | null,
): string | null {
  if (!row) {
    return '当前会话不存在或无法解析，已拒绝定时任务变更。';
  }
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.metadata_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    // 坏 metadata 不阻止守卫判定，按无 metadata 处理。
  }

  const source = typeof metadata['source'] === 'string' ? metadata['source'] : '';
  // cron 会话优先判定：定时任务自己创建定时任务 = 无人扩权 / 自我复制。
  if (source === 'cron') {
    return '定时任务会话不允许管理定时任务（禁止自我复制与无人扩权）。';
  }

  const roleLayer = typeof row.role_layer === 'string' ? row.role_layer.trim() : '';
  const hasTeamParent =
    typeof row.team_parent_session_id === 'string' && row.team_parent_session_id.trim().length > 0;
  const hasTeamMetadata =
    typeof metadata['teamWorkspaceId'] === 'string' ||
    (typeof metadata['teamRoleInstance'] === 'object' && metadata['teamRoleInstance'] !== null);
  if (TEAM_ROLE_LAYERS.has(roleLayer) || hasTeamParent || hasTeamMetadata) {
    return '团队会话不允许管理定时任务，请回到个人会话操作。';
  }

  if (source === 'channel') {
    return '消息渠道会话不允许管理定时任务，请在设置页或桌面端操作。';
  }

  return null;
}

function readScheduleManageSessionRow(sessionId: string): ScheduleManageSessionRow | null {
  return (
    sqliteGet<ScheduleManageSessionRow>(
      'SELECT metadata_json, role_layer, team_parent_session_id, handoff_state FROM sessions WHERE id = ? LIMIT 1',
      [sessionId],
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function toJobSummary(job: CronJobRecord): Record<string, unknown> {
  return {
    id: job.id,
    name: job.name,
    scheduleKind: job.schedule_kind,
    scheduleAt: job.schedule_at,
    scheduleEvery: job.schedule_every,
    scheduleExpr: job.schedule_expr,
    scheduleTz: job.schedule_tz,
    prompt:
      job.prompt.length > PROMPT_PREVIEW_CHARS
        ? `${job.prompt.slice(0, PROMPT_PREVIEW_CHARS)}…`
        : job.prompt,
    agentId: job.agent_id,
    model: job.model,
    deliveryMode: job.delivery_mode,
    deliveryTarget: job.delivery_target,
    enabled: job.enabled,
    deleteAfterRun: job.delete_after_run,
    lastFiredAt: job.last_fired_at,
    fireCount: job.fire_count,
  };
}

function requireJobId(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error('缺少 jobId。');
  }
  return value.trim();
}

function findOwnedJob(
  scheduler: CronSchedulerInstance,
  userId: string,
  jobId: string,
): CronJobRecord {
  const job = scheduler.getJob(jobId);
  if (!job || job.user_id !== userId) {
    throw new Error(`未找到定时任务 ${jobId}。`);
  }
  return job;
}

/** 工具层的 `every` 间隔下限：低于 1s 的定时 agent 运行没有实际意义且浪费资源。 */
const MIN_SCHEDULE_EVERY_MS = 1000;

/**
 * 校验 `working_folder`：不得越出当前会话工作区。
 *
 * 审批预览只展示任务名与 prompt，模型若把 working_folder 指向会话工作区之外，
 * 等于在用户看不到的地方扩大 cron 会话的可访问路径（cron 会话的 workingDirectory
 * 就是该值）。已绑定工作区的会话强制落在工作区内；未绑定会话沿用平台既有的
 * 「允许有效绝对路径」语义（与 bash workdir 等工具一致）。
 */
function assertWorkingFolderAllowed(sessionId: string, workingFolder: unknown): void {
  if (workingFolder === undefined || workingFolder === null) {
    return;
  }
  if (typeof workingFolder !== 'string' || workingFolder.trim().length === 0) {
    throw new Error('working_folder 必须是非空字符串或 null。');
  }
  const validation = validateSessionWorkspacePath({ path: workingFolder.trim(), sessionId });
  if (!validation.ok) {
    throw new Error(
      validation.reason === 'outside-session-workspace'
        ? 'working_folder 必须在当前会话工作区内；如需在其他目录执行，请先在对应目录的会话中创建任务。'
        : 'working_folder 指向不允许的路径。',
    );
  }
}

/** 校验「结果态」的调度配置，避免出现永不触发的任务（静默失效）。 */
function assertScheduleConsistent(input: {
  scheduleKind: CronJobRecord['schedule_kind'];
  scheduleAt: number | null;
  scheduleEvery: number | null;
  scheduleExpr: string | null;
}): void {
  if (input.scheduleKind === 'at') {
    if (typeof input.scheduleAt !== 'number') {
      throw new Error('at 调度必须提供 schedule_at（epoch 毫秒）。');
    }
    if (input.scheduleAt <= Date.now()) {
      throw new Error('schedule_at 必须是未来时间（epoch 毫秒）。');
    }
    return;
  }
  if (input.scheduleKind === 'every') {
    if (typeof input.scheduleEvery !== 'number' || input.scheduleEvery < MIN_SCHEDULE_EVERY_MS) {
      throw new Error(`every 调度必须提供不小于 ${MIN_SCHEDULE_EVERY_MS} 毫秒的 schedule_every。`);
    }
    return;
  }
  if (!input.scheduleExpr) {
    throw new Error('cron 调度必须提供 schedule_expr（5 段表达式）。');
  }
}

// ---------------------------------------------------------------------------
// 动作实现
// ---------------------------------------------------------------------------

async function listJobsForTool(userId: string): Promise<string> {
  const scheduler = await getCronScheduler();
  const jobs = scheduler
    .listJobs()
    .filter((job) => job.user_id === userId)
    .map(toJobSummary);
  return JSON.stringify({ ok: true, action: 'list', count: jobs.length, jobs }, null, 2);
}

async function addJobForTool(
  userId: string,
  sessionId: string,
  input: z.infer<typeof scheduleManageInputSchema>,
): Promise<string> {
  const draft = input.job;
  if (!draft?.name || !draft.schedule_kind || !draft.prompt) {
    throw new Error('add 必须提供 job.name / schedule_kind / prompt。');
  }
  assertScheduleConsistent({
    scheduleKind: draft.schedule_kind,
    scheduleAt: draft.schedule_at ?? null,
    scheduleEvery: draft.schedule_every ?? null,
    scheduleExpr: draft.schedule_expr ?? null,
  });
  assertWorkingFolderAllowed(sessionId, draft.working_folder);
  const now = Date.now();
  const job: CronJobRecord = {
    id: randomUUID(),
    user_id: userId,
    name: draft.name,
    schedule_kind: draft.schedule_kind,
    schedule_at: draft.schedule_at ?? null,
    schedule_every: draft.schedule_every ?? null,
    schedule_expr: draft.schedule_expr ?? null,
    schedule_tz: draft.schedule_tz ?? 'UTC',
    prompt: draft.prompt,
    agent_id: draft.agent_id ?? null,
    model: draft.model ?? null,
    working_folder: draft.working_folder ?? null,
    session_id: draft.session_id ?? null,
    delivery_mode: draft.delivery_mode ?? 'none',
    delivery_target: draft.delivery_target ?? null,
    plugin_id: draft.plugin_id ?? null,
    plugin_chat_id: draft.plugin_chat_id ?? null,
    enabled: draft.enabled ?? true,
    delete_after_run: draft.delete_after_run ?? false,
    max_iterations: draft.max_iterations ?? 10,
    last_fired_at: null,
    fire_count: 0,
    created_at: now,
    updated_at: now,
  };

  const scheduler = await getCronScheduler();
  scheduler.addJob(job);
  return JSON.stringify({ ok: true, action: 'add', job: toJobSummary(job) }, null, 2);
}

async function updateJobForTool(
  userId: string,
  sessionId: string,
  input: z.infer<typeof scheduleManageInputSchema>,
): Promise<string> {
  const scheduler = await getCronScheduler();
  const jobId = requireJobId(input.jobId);
  const existing = findOwnedJob(scheduler, userId, jobId);
  const draft: ScheduleJobDraft = input.job ?? {};
  if (Object.keys(draft).length === 0) {
    throw new Error('update 至少需要一个要修改的字段。');
  }

  // 结果态调度一致性：改 kind / 时间字段 / 重新启用时校验最终配置，
  // 避免把任务改成「永不触发」（如 kind=cron 但 schedule_expr 为空）。
  const scheduleTouched =
    draft.schedule_kind !== undefined ||
    draft.schedule_at !== undefined ||
    draft.schedule_every !== undefined ||
    draft.schedule_expr !== undefined ||
    draft.enabled === true;
  if (scheduleTouched) {
    assertScheduleConsistent({
      scheduleKind: draft.schedule_kind ?? existing.schedule_kind,
      scheduleAt: draft.schedule_at !== undefined ? draft.schedule_at : existing.schedule_at,
      scheduleEvery:
        draft.schedule_every !== undefined ? draft.schedule_every : existing.schedule_every,
      scheduleExpr:
        draft.schedule_expr !== undefined ? draft.schedule_expr : existing.schedule_expr,
    });
  }
  if (draft.working_folder !== undefined) {
    assertWorkingFolderAllowed(sessionId, draft.working_folder);
  }

  scheduler.updateJob(jobId, {
    ...(draft.name !== undefined ? { name: draft.name } : {}),
    ...(draft.schedule_kind !== undefined ? { schedule_kind: draft.schedule_kind } : {}),
    ...(draft.schedule_at !== undefined ? { schedule_at: draft.schedule_at } : {}),
    ...(draft.schedule_every !== undefined ? { schedule_every: draft.schedule_every } : {}),
    ...(draft.schedule_expr !== undefined ? { schedule_expr: draft.schedule_expr } : {}),
    ...(draft.schedule_tz !== undefined ? { schedule_tz: draft.schedule_tz } : {}),
    ...(draft.prompt !== undefined ? { prompt: draft.prompt } : {}),
    ...(draft.agent_id !== undefined ? { agent_id: draft.agent_id } : {}),
    ...(draft.model !== undefined ? { model: draft.model } : {}),
    ...(draft.working_folder !== undefined ? { working_folder: draft.working_folder } : {}),
    ...(draft.session_id !== undefined ? { session_id: draft.session_id } : {}),
    ...(draft.delivery_mode !== undefined ? { delivery_mode: draft.delivery_mode } : {}),
    ...(draft.delivery_target !== undefined ? { delivery_target: draft.delivery_target } : {}),
    ...(draft.plugin_id !== undefined ? { plugin_id: draft.plugin_id } : {}),
    ...(draft.plugin_chat_id !== undefined ? { plugin_chat_id: draft.plugin_chat_id } : {}),
    ...(draft.enabled !== undefined ? { enabled: draft.enabled } : {}),
    ...(draft.delete_after_run !== undefined ? { delete_after_run: draft.delete_after_run } : {}),
    ...(draft.max_iterations !== undefined ? { max_iterations: draft.max_iterations } : {}),
  });

  const updated = scheduler.getJob(jobId);
  return JSON.stringify(
    { ok: true, action: 'update', job: updated ? toJobSummary(updated) : null },
    null,
    2,
  );
}

async function removeJobForTool(
  userId: string,
  input: z.infer<typeof scheduleManageInputSchema>,
): Promise<string> {
  const scheduler = await getCronScheduler();
  const jobId = requireJobId(input.jobId);
  findOwnedJob(scheduler, userId, jobId);
  scheduler.removeJob(jobId);
  return JSON.stringify({ ok: true, action: 'remove', jobId, removed: true }, null, 2);
}

async function setJobEnabledForTool(
  userId: string,
  input: z.infer<typeof scheduleManageInputSchema>,
  enabled: boolean,
): Promise<string> {
  const scheduler = await getCronScheduler();
  const jobId = requireJobId(input.jobId);
  findOwnedJob(scheduler, userId, jobId);
  scheduler.updateJob(jobId, { enabled });
  const updated = scheduler.getJob(jobId);
  return JSON.stringify(
    {
      ok: true,
      action: enabled ? 'enable' : 'disable',
      job: updated ? toJobSummary(updated) : null,
    },
    null,
    2,
  );
}

async function historyForTool(
  userId: string,
  input: z.infer<typeof scheduleManageInputSchema>,
): Promise<string> {
  const scheduler = await getCronScheduler();
  const jobId = requireJobId(input.jobId);
  findOwnedJob(scheduler, userId, jobId);
  const history = listCronExecutionsForJob(jobId, HISTORY_LIMIT);
  return JSON.stringify(
    { ok: true, action: 'history', jobId, count: history.length, history },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface RunScheduleManageInput {
  userId: string;
  sessionId: string;
  input: z.infer<typeof scheduleManageInputSchema>;
}

export async function runScheduleManageTool(params: RunScheduleManageInput): Promise<string> {
  const denial = resolveScheduleManageSessionDenial(readScheduleManageSessionRow(params.sessionId));
  if (denial) {
    throw new Error(denial);
  }

  const { userId, input } = params;
  switch (input.action) {
    case 'list':
      return await listJobsForTool(userId);
    case 'add':
      return await addJobForTool(userId, params.sessionId, input);
    case 'update':
      return await updateJobForTool(userId, params.sessionId, input);
    case 'remove':
      return await removeJobForTool(userId, input);
    case 'enable':
      return await setJobEnabledForTool(userId, input, true);
    case 'disable':
      return await setJobEnabledForTool(userId, input, false);
    case 'history':
      return await historyForTool(userId, input);
    default: {
      const exhaustive: never = input.action;
      throw new Error(`不支持的 action: ${String(exhaustive)}`);
    }
  }
}
