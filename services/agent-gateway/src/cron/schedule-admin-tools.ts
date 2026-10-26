/**
 * `schedule_manage` —— 会话内模型在用户审批下管理定时任务（cron）。
 *
 * 设计边界（对齐 260924-AI自助管理扩展四域 域三 / 方案 B；渠道放通见下）：
 * - 复用 `cronScheduler`（与 HTTP `/cron/jobs` 同一实例）：任务定义持久化在
 *   `cron_jobs`，网关重启后由 `restoreCronJobsFromStore` 恢复；执行历史在
 *   `cron_job_executions`（重启后可查）。
 * - **cron 会话禁止管理定时任务**（防自我复制 / 无人扩权）；**team 会话同样拒绝**。
 * - **渠道会话放通，但作用域收敛**（`resolveScheduleManageChannelScope`）：只能管理
 *   本渠道本会话创建的任务，新建时渠道投递字段钉回当前会话。放通后必须同时堵住
 *   两条旁路：① 渠道任务在渠道会话内执行时的自我复制（按 `cron-` 请求键识别）；
 *   ② 渠道级工具白名单（`channelToolAllowlist`）不得被绕过。
 * - 变更类动作默认 ask；list / history 只读免审批；审批预览展示调度表达式、
 *   时区、prompt 片段与投递目标。
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import { sqliteGet } from '../infra/db.js';
import { listCronExecutionsForJob } from './cron-store.js';
import { attachExecutionPreviews } from './delivery.js';
import { assertValidSchedule, type ScheduleValidationInput } from './schedule-validation.js';
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
  })
  .strict();

export type ScheduleJobDraft = z.infer<typeof scheduleJobDraftSchema>;

export const scheduleManageInputSchema = z
  .object({
    action: z.enum(['list', 'add', 'update', 'remove', 'enable', 'disable', 'run', 'history']),
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
    '管理当前用户的定时任务。action=list 列举；add 新建；update 修改；remove 删除；enable/disable 启停；run 立即执行一次；history 查看执行历史。' +
    '变更类操作需要用户批准；任务定义与执行历史均持久化（网关重启后仍保留）。' +
    'cron 表达式使用 5 段格式（分 时 日 月 周）；时区默认 UTC，可用 schedule_tz 指定。' +
    '在消息渠道会话中，只能管理本会话创建的定时任务，且结果自动投递回本会话。',
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

/**
 * 渠道会话的定时任务作用域：`{ pluginId, chatId }`。
 *
 * 渠道会话（消息频道）此前被**整体拒绝**管理定时任务，于是「消息频道里既建不了
 * 也删不掉任务」，而 schema / `runCronAgentJob` 又完整支持 `plugin_id` +
 * `plugin_chat_id` 投递——那条分支成了不可达代码。现在放通，但把可见范围收敛到
 * **当前渠道会话自己创建的任务**（同一个 plugin + 同一个 chat）：
 *   - 群聊 A 删不掉群聊 B 的任务，也看不到别的会话的任务；
 *   - 新建任务时强制把 `plugin_id` / `plugin_chat_id` 钉成当前渠道，投递才能回到
 *     这个会话（此前渠道侧建的任务因缺这两个字段只会落进一个孤儿 cron 会话）。
 *
 * 渠道元数据由服务端写入（`buildChannelSessionMetadata`），客户端无法伪造。
 */
export interface ScheduleManageChannelScope {
  readonly pluginId: string;
  readonly chatId: string;
}

export function resolveScheduleManageChannelScope(
  metadata: Record<string, unknown>,
): ScheduleManageChannelScope | null {
  if (metadata['source'] !== 'channel') {
    return null;
  }
  const chatId =
    typeof metadata['channelChatId'] === 'string' ? metadata['channelChatId'].trim() : '';
  const channel = metadata['channel'];
  const pluginId =
    channel && typeof channel === 'object' && !Array.isArray(channel)
      ? typeof (channel as Record<string, unknown>)['id'] === 'string'
        ? ((channel as Record<string, unknown>)['id'] as string).trim()
        : ''
      : '';
  if (pluginId.length === 0 || chatId.length === 0) {
    return null;
  }
  return { pluginId, chatId };
}

/** 任务是否属于该渠道会话的作用域。 */
export function isJobInChannelScope(
  job: CronJobRecord,
  scope: ScheduleManageChannelScope,
): boolean {
  return job.plugin_id === scope.pluginId && job.plugin_chat_id === scope.chatId;
}

/**
 * 本回合是否由定时任务派发。
 *
 * 前缀 `cron-` 由 `cron/agent-handler.ts` 的
 * `` `cron-${job.id}-${randomUUID()}` `` 生成，并已在网关内部请求键注册表登记
 * （`handoff/store/handoff-store.ts`）；此处只做前缀判定，注册表仍是唯一真相源
 * （若前缀变更，`verify-team-turn-rollback-internal-keys` 守卫会先失败）。
 */
function isCronDispatchedTurn(clientRequestId: string | null | undefined): boolean {
  return typeof clientRequestId === 'string' && clientRequestId.startsWith('cron-');
}

function parseSessionMetadata(row: ScheduleManageSessionRow): Record<string, unknown> {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.metadata_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    // 坏 metadata 不阻止守卫判定，按无 metadata 处理。
  }
  return metadata;
}

/** 返回拒绝原因；`null` 表示允许进入正常权限门控。 */
export function resolveScheduleManageSessionDenial(
  row: ScheduleManageSessionRow | null,
  options?: { readonly clientRequestId?: string | null },
): string | null {
  if (!row) {
    return '当前会话不存在或无法解析，已拒绝定时任务变更。';
  }
  const metadata = parseSessionMetadata(row);

  const source = typeof metadata['source'] === 'string' ? metadata['source'] : '';
  // cron 会话优先判定：定时任务自己创建定时任务 = 无人扩权 / 自我复制。
  if (source === 'cron') {
    return '定时任务会话不允许管理定时任务（禁止自我复制与无人扩权）。';
  }

  // 渠道会话放通后新增的旁路：渠道里创建的定时任务在**渠道会话内**执行
  // （`prepareCronSession` 复用渠道会话），此时 `source` 仍是 `'channel'`。
  // 只按 source 判定会放过「定时任务 → 继续建定时任务」这条无人值守的自我复制
  // 路径（原设计对 `source === 'cron'` 明确封堵的正是这一类）。
  // cron 派发的回合键前缀 `cron-` 已在网关内部请求键注册表登记
  // （`handoff-store.ts` 的 `GATEWAY_INTERNAL_REQUEST_KEY_SHAPES`），据此识别。
  if (isCronDispatchedTurn(options?.clientRequestId)) {
    return '定时任务触发的运行不允许管理定时任务（禁止自我复制与无人扩权）。';
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

  // 渠道会话：允许，但必须能解析出作用域；解析不出（元数据缺失）时 fail-closed，
  // 否则作用域为空会把「限制在当前会话」退化成「可以操作全部任务」。
  if (source === 'channel' && !resolveScheduleManageChannelScope(metadata)) {
    return '消息渠道会话缺少渠道标识，已拒绝定时任务操作。';
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
  channelScope: ScheduleManageChannelScope | null = null,
): CronJobRecord {
  const job = scheduler.getJob(jobId);
  if (!job || job.user_id !== userId) {
    throw new Error(`未找到定时任务 ${jobId}。`);
  }
  // 渠道会话只能触碰「本渠道本会话」创建的任务（越界一律按未找到处理，
  // 不泄露其他会话的任务是否存在）。
  if (channelScope && !isJobInChannelScope(job, channelScope)) {
    throw new Error(`未找到定时任务 ${jobId}。`);
  }
  return job;
}

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

/**
 * 校验「结果态」的调度配置，避免出现永不触发的任务（静默失效）。
 *
 * 与 HTTP 路由共用 `schedule-validation`：此前工具侧只校验表达式，时区拼错
 * （`Asia/Shangai`）仍会静默回落 UTC，任务偏移数小时且无提示。
 */
function assertScheduleConsistent(input: ScheduleValidationInput): void {
  assertValidSchedule(input);
}

// ---------------------------------------------------------------------------
// 动作实现
// ---------------------------------------------------------------------------

async function listJobsForTool(
  userId: string,
  channelScope: ScheduleManageChannelScope | null,
): Promise<string> {
  const scheduler = await getCronScheduler();
  const jobs = scheduler
    .listJobs()
    .filter((job) => job.user_id === userId)
    .filter((job) => channelScope === null || isJobInChannelScope(job, channelScope))
    .map((job) => ({ ...toJobSummary(job), nextFireAt: scheduler.getNextFireAt(job.id) }));
  return JSON.stringify({ ok: true, action: 'list', count: jobs.length, jobs }, null, 2);
}

async function addJobForTool(
  userId: string,
  sessionId: string,
  input: z.infer<typeof scheduleManageInputSchema>,
  channelScope: ScheduleManageChannelScope | null,
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
    scheduleTimeZone: draft.schedule_tz ?? 'UTC',
    deliveryMode: channelScope ? 'none' : (draft.delivery_mode ?? 'none'),
    deliveryTarget: channelScope ? null : (draft.delivery_target ?? null),
    sessionId: draft.session_id ?? null,
  });
  if (channelScope) {
    // 渠道会话建的任务必须钉在当前渠道 + 当前会话上，否则结果回不到这里
    // （会退化成一个用户看不见的孤儿 cron 会话）。
    if (
      draft.plugin_id !== undefined &&
      draft.plugin_id !== null &&
      draft.plugin_id !== channelScope.pluginId
    ) {
      throw new Error('渠道会话只能为当前渠道创建定时任务。');
    }
  }
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
    // 渠道会话：投递由 `plugin_id` + `plugin_chat_id` 承载
    // （`prepareCronSession` 命中该分支即复用渠道会话并回发）。
    // `delivery_mode: 'session'` + `delivery_target` 走的是「把 target 当**会话 id**
    // 查 sessions 表」的另一条路径，填 chatId 会在执行期直接抛错，故渠道任务固定
    // `none` + 空 target，避免把一个能建的任务变成到点必失败。
    delivery_mode: channelScope ? 'none' : (draft.delivery_mode ?? 'none'),
    delivery_target: channelScope ? null : (draft.delivery_target ?? null),
    plugin_id: channelScope ? channelScope.pluginId : (draft.plugin_id ?? null),
    plugin_chat_id: channelScope ? channelScope.chatId : (draft.plugin_chat_id ?? null),
    enabled: draft.enabled ?? true,
    delete_after_run: draft.delete_after_run ?? false,
    // 历史列保留，但不再作为可配置项暴露（执行链路没有对应实现）。
    max_iterations: 10,
    last_fired_at: null,
    fire_count: 0,
    created_at: now,
    updated_at: now,
  };

  const scheduler = await getCronScheduler();
  scheduler.addJob(job);
  return JSON.stringify(
    {
      ok: true,
      action: 'add',
      job: { ...toJobSummary(job), nextFireAt: scheduler.getNextFireAt(job.id) },
    },
    null,
    2,
  );
}

async function updateJobForTool(
  userId: string,
  sessionId: string,
  input: z.infer<typeof scheduleManageInputSchema>,
  channelScope: ScheduleManageChannelScope | null,
): Promise<string> {
  const scheduler = await getCronScheduler();
  const jobId = requireJobId(input.jobId);
  const existing = findOwnedJob(scheduler, userId, jobId, channelScope);
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
    draft.schedule_tz !== undefined ||
    draft.delivery_mode !== undefined ||
    draft.delivery_target !== undefined ||
    draft.session_id !== undefined ||
    draft.enabled === true;
  if (scheduleTouched) {
    assertScheduleConsistent({
      scheduleKind: draft.schedule_kind ?? existing.schedule_kind,
      scheduleAt: draft.schedule_at !== undefined ? draft.schedule_at : existing.schedule_at,
      scheduleEvery:
        draft.schedule_every !== undefined ? draft.schedule_every : existing.schedule_every,
      scheduleExpr:
        draft.schedule_expr !== undefined ? draft.schedule_expr : existing.schedule_expr,
      scheduleTimeZone: draft.schedule_tz !== undefined ? draft.schedule_tz : existing.schedule_tz,
      deliveryMode: draft.delivery_mode ?? existing.delivery_mode,
      deliveryTarget:
        draft.delivery_target !== undefined ? draft.delivery_target : existing.delivery_target,
      sessionId: draft.session_id !== undefined ? draft.session_id : existing.session_id,
      // 只改名 / 停用不因「at 已过期」被挡；改 kind、时间或重新启用则必须严格校验。
      allowExpiredAt:
        draft.schedule_kind === undefined &&
        draft.schedule_at === undefined &&
        draft.enabled !== true,
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
  });

  const updated = scheduler.getJob(jobId);
  return JSON.stringify(
    {
      ok: true,
      action: 'update',
      job: updated
        ? { ...toJobSummary(updated), nextFireAt: scheduler.getNextFireAt(jobId) }
        : null,
    },
    null,
    2,
  );
}

async function removeJobForTool(
  userId: string,
  input: z.infer<typeof scheduleManageInputSchema>,
  channelScope: ScheduleManageChannelScope | null,
): Promise<string> {
  const scheduler = await getCronScheduler();
  const jobId = requireJobId(input.jobId);
  findOwnedJob(scheduler, userId, jobId, channelScope);
  scheduler.removeJob(jobId);
  return JSON.stringify({ ok: true, action: 'remove', jobId, removed: true }, null, 2);
}

async function setJobEnabledForTool(
  userId: string,
  input: z.infer<typeof scheduleManageInputSchema>,
  enabled: boolean,
  channelScope: ScheduleManageChannelScope | null,
): Promise<string> {
  const scheduler = await getCronScheduler();
  const jobId = requireJobId(input.jobId);
  const job = findOwnedJob(scheduler, userId, jobId, channelScope);

  // 启用前按「结果态」校验：过期的一次性任务 / 坏表达式启用后也不会触发。
  // 直接报错比返回 `ok: true`（而 `nextFireAt` 为 null）诚实。
  if (enabled) {
    assertScheduleConsistent({
      scheduleKind: job.schedule_kind,
      scheduleAt: job.schedule_at,
      scheduleEvery: job.schedule_every,
      scheduleExpr: job.schedule_expr,
      scheduleTimeZone: job.schedule_tz,
      deliveryMode: job.delivery_mode,
      deliveryTarget: job.delivery_target,
      sessionId: job.session_id,
      allowExpiredAt: false,
    });
  }

  scheduler.updateJob(jobId, { enabled });
  const updated = scheduler.getJob(jobId);
  return JSON.stringify(
    {
      ok: true,
      action: enabled ? 'enable' : 'disable',
      job: updated
        ? { ...toJobSummary(updated), nextFireAt: scheduler.getNextFireAt(jobId) }
        : null,
    },
    null,
    2,
  );
}

/** `run`：手动立即触发一次（与到点触发同路径）。 */
async function runJobForTool(
  userId: string,
  input: z.infer<typeof scheduleManageInputSchema>,
  channelScope: ScheduleManageChannelScope | null,
): Promise<string> {
  const scheduler = await getCronScheduler();
  const jobId = requireJobId(input.jobId);
  findOwnedJob(scheduler, userId, jobId, channelScope);
  // 只起跑，不 await handler（可能跑很久）；执行结果经 `history` 动作查看。
  // 但「没跑起来」必须报错：任务在途 / 并发已满时旧实现仍返回 started:true，
  // 模型会据此告诉用户「已触发」而实际什么都没发生。
  const started = scheduler.startJobNow(jobId);
  if (!started.started) {
    throw new Error(
      started.reason === 'in-flight'
        ? '该任务上一次执行尚未结束，请稍后再试。'
        : started.reason === 'busy'
          ? '网关当前并发执行已满，请稍后再试。'
          : '目标定时任务当前无法执行。',
    );
  }
  return JSON.stringify(
    { ok: true, action: 'run', jobId, started: true, executionId: started.executionId },
    null,
    2,
  );
}

async function historyForTool(
  userId: string,
  input: z.infer<typeof scheduleManageInputSchema>,
  channelScope: ScheduleManageChannelScope | null,
): Promise<string> {
  const scheduler = await getCronScheduler();
  const jobId = requireJobId(input.jobId);
  findOwnedJob(scheduler, userId, jobId, channelScope);
  // 与 HTTP 端点同口径：带上产出摘要与执行会话 id，让模型也能把「这次跑了什么」
  // 转述给用户（`delivery_mode: 'none'` 时这是唯一的内容来源）。
  const history = attachExecutionPreviews({
    userId,
    executions: listCronExecutionsForJob(jobId, HISTORY_LIMIT),
  });
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
  /** 本回合的请求键；用于识别「定时任务触发的无人值守运行」（见守卫说明）。 */
  clientRequestId?: string | null;
}

export async function runScheduleManageTool(params: RunScheduleManageInput): Promise<string> {
  const row = readScheduleManageSessionRow(params.sessionId);
  const denial = resolveScheduleManageSessionDenial(row, {
    clientRequestId: params.clientRequestId ?? null,
  });
  if (denial) {
    throw new Error(denial);
  }
  const channelScope = row ? resolveScheduleManageChannelScope(parseSessionMetadata(row)) : null;

  const { userId, input } = params;
  switch (input.action) {
    case 'list':
      return await listJobsForTool(userId, channelScope);
    case 'add':
      return await addJobForTool(userId, params.sessionId, input, channelScope);
    case 'update':
      return await updateJobForTool(userId, params.sessionId, input, channelScope);
    case 'remove':
      return await removeJobForTool(userId, input, channelScope);
    case 'enable':
      return await setJobEnabledForTool(userId, input, true, channelScope);
    case 'disable':
      return await setJobEnabledForTool(userId, input, false, channelScope);
    case 'run':
      return await runJobForTool(userId, input, channelScope);
    case 'history':
      return await historyForTool(userId, input, channelScope);
    default: {
      const exhaustive: never = input.action;
      throw new Error(`不支持的 action: ${String(exhaustive)}`);
    }
  }
}
