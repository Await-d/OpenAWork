/**
 * 定时任务结果投递。
 *
 * 执行与投递是**两件事**（见 `agent-handler.ts` 的 `createCronExecutionSession`）：
 * 执行永远落在独立 cron 会话里（规避会话单飞锁），产出则按 `delivery_mode` 送到
 * 用户能看见的地方：
 *
 *   - `session`：往 `delivery_target`（未指定则 `session_id`）会话追加一条
 *     `role: 'synthetic'` 通知，复用子代理完成通知的渲染通道（客户端按
 *     `metadata.source === 'cron'` 分流），点击可跳到本次执行现场；
 *   - `desktop`：写一条用户级通知（`notifications` 表）。它自动经
 *     `/notification-events` WS 推给该用户所有在线客户端（Web 侧栏铃铛 +
 *     页面隐藏时的系统通知），无需另建传输层；
 *   - `none`：只落执行历史，不投递。
 *
 * 两条通道都**幂等**：投递身份用 `delivery:<jobId>:<execStartedAt>`，重复投递同一
 * 次执行是空操作（与子代理通知同一套「通知身份同时作消息 id」的做法）。
 */

import type { SubagentNoticeState } from '@openAwork/shared';
import { sqliteGet } from '../infra/db.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { injectSyntheticSessionMessage } from '../message/synthetic-message-injection.js';
import { createNotification } from '../session/notification-store.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import { extractLatestChildSessionSummary } from '../task/task-result-extraction.js';
import type { CronExecutionRecord, CronJobRecord } from './types.js';

/** 投递正文上限：通知行是紧凑摘要，超长内容引导用户点进执行现场看全文。 */
const MAX_DELIVERY_BODY_CHARS = 2_000;

/**
 * 标签属性转义。
 *
 * 客户端靠 `/^<(subagent|cron)\b[^>]*>/` 剥离外层包裹（见 shared 的
 * `stripSubagentNoticeWrapper`）。任务名是用户自由输入，若含 `>` 会提前闭合
 * 起始标签、让剥离正则失配，原始标签就会漏到正文里。
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function buildCronNoticeText(input: {
  jobName: string;
  body: string;
  executionSessionId: string;
}): string {
  const truncated =
    input.body.length > MAX_DELIVERY_BODY_CHARS
      ? `${input.body.slice(0, MAX_DELIVERY_BODY_CHARS)}\n…（内容过长已截断，点击标题查看完整执行现场）`
      : input.body;
  // 与子代理通知同形：带标签包裹，客户端解析时剥离；模型侧直接读正文。
  return `<cron sessionID="${escapeAttribute(input.executionSessionId)}" job="${escapeAttribute(input.jobName)}">\n${truncated}\n</cron>`;
}

interface SessionOwnerRow {
  readonly id: string;
}

/** 目标会话仍存在且归属该用户时返回其 id，否则 null（调用方据此降级）。 */
function resolveOwnedSession(sessionId: string | null, userId: string): string | null {
  if (!sessionId) return null;
  const row = sqliteGet<SessionOwnerRow>(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  return row?.id ?? null;
}

export interface CronDeliveryContext {
  /** 本次执行的会话 id（投递正文里的「现场」入口）。 */
  readonly executionSessionId: string;
  /** 执行开始时间，参与投递身份构造以实现幂等。 */
  readonly executionStartedAt: number;
  /** 模型在本轮产出的最终文本；为空时用状态兜底文案。 */
  readonly resultText: string;
  /** 本次执行是否成功（决定通知状态与文案）。 */
  readonly succeeded: boolean;
  /** 失败原因（`succeeded: false` 时用于投递正文）。 */
  readonly errorMessage?: string;
}

/**
 * 从执行会话取回本轮产出文本。
 *
 * 复用 `getChildSessionSummary`（与子代理完成通知同一口径：只在**已完成**的
 * assistant 消息里找最后一条有文本的），避免两处各写一套「什么算产出」。
 */
export function readCronResultText(input: { executionSessionId: string; userId: string }): string {
  try {
    return extractLatestChildSessionSummary(
      listSessionMessagesV2({
        sessionId: input.executionSessionId,
        userId: input.userId,
        statuses: ['final'],
        // 只看最近 3 个 turn：不传 `turnLimit` 时底层是 `limit: -1`（**全量**读
        // 消息并 join 全部 parts）。渠道任务的执行会话是复用的，历史随执行次数
        // 无限增长——全量读会让「取一条摘要」的代价随时间线性恶化。
        // 最终总结必然落在最近几轮内（`extractLatestChildSessionSummary` 本身也
        // 只在最近 20 条里找），故 3 轮足够。
        turnLimit: 3,
      }),
    );
  } catch (error) {
    logGatewayWarn('[cron-delivery] 读取执行产出失败', {
      sessionId: input.executionSessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/** 执行历史条目 + 产出摘要（供 `/cron/jobs/:id/history` 与工具的 history 动作）。 */
export interface CronJobHistoryEntry extends CronExecutionRecord {
  /**
   * 该次执行的产出摘要（前 `EXECUTION_PREVIEW_CHARS` 字）。
   *
   * 为什么放在这里：`delivery_mode: 'none'` 的任务产出会写进独立执行会话，
   * 但界面上没有任何指针指向它——用户看到「completed」却拿不到内容。
   * 带上摘要后，即使不投递、不跳转，也能在历史里直接读到结果开头。
   */
  outputPreview?: string;
}

const EXECUTION_PREVIEW_CHARS = 400;

/**
 * 给执行历史补齐产出摘要。
 *
 * 只处理**最近 `previewLimit` 条可预览记录**（带 `session_id` 且不是 `skipped`）：
 * 历史最多返回 100 条，逐条读会话消息会变成 N+1 查询。跳过记录会占满窗口，
 * 故按「实际读取次数」而不是数组下标计数。超过窗口的旧记录没有摘要也无妨
 * （点进会话仍可看全文）。
 */
export function attachExecutionPreviews(input: {
  readonly userId: string;
  readonly executions: readonly CronExecutionRecord[];
  readonly previewLimit?: number;
}): CronJobHistoryEntry[] {
  const previewLimit = input.previewLimit ?? 5;
  let previewed = 0;
  return input.executions.map((exec) => {
    if (!exec.session_id || exec.status === 'skipped' || previewed >= previewLimit) {
      return { ...exec };
    }
    previewed += 1;
    const text = readCronResultText({
      executionSessionId: exec.session_id,
      userId: input.userId,
    }).trim();
    if (text.length === 0) {
      return { ...exec };
    }
    const preview =
      text.length > EXECUTION_PREVIEW_CHARS ? `${text.slice(0, EXECUTION_PREVIEW_CHARS)}…` : text;
    return { ...exec, outputPreview: preview };
  });
}

function buildDeliveryBody(context: CronDeliveryContext): string {
  if (context.succeeded) {
    return context.resultText.trim().length > 0
      ? context.resultText.trim()
      : '任务已完成，但没有产生文本输出（可点开执行现场查看工具调用详情）。';
  }
  return `任务执行失败：${context.errorMessage ?? '未记录原因'}`;
}

/**
 * 投递结果。
 *
 * `delivered: false` **必须**向调用方（`runCronAgentJob`）如实上报，不能只记日志：
 * 「任务跑成功、结果却没送到」对用户来说等于没完成，而只写日志的话这个事实
 * 永远不会出现在任何界面上——正是本次要消灭的静默失败。
 */
export interface CronDeliveryOutcome {
  /** 是否真的尝试过投递（`delivery_mode: 'none'` 时为 false）。 */
  readonly attempted: boolean;
  readonly delivered: boolean;
  readonly error?: string;
}

const SKIPPED: CronDeliveryOutcome = { attempted: false, delivered: false };

/**
 * 投递 `delivery_mode: 'session'`：往目标会话追加一条合成通知。
 *
 * 用 `injectSyntheticSessionMessage` 而非裸追加 assistant 消息，原因有三：
 *   1. 它按通知身份幂等（重放 / 重试不会产生重复行）；
 *   2. `role: 'synthetic'` 对模型可见（用户下一次发言时模型知道任务结果），
 *      但客户端不会把它渲染成用户输入；
 *   3. 复用既有的 notice 渲染通道（`SubagentNoticeRow`），三端零新增组件。
 *
 * 目标会话不存在（被删）时**不抛错**，但返回 `delivered: false` + 原因，
 * 由调用方决定如何呈现（当前实现会把它记成失败，见 `runCronAgentJob`）。
 */
export function deliverCronResultToSession(
  job: CronJobRecord,
  context: CronDeliveryContext,
): CronDeliveryOutcome {
  const targetSessionId = resolveOwnedSession(
    job.delivery_mode === 'session' && job.delivery_target ? job.delivery_target : job.session_id,
    job.user_id,
  );
  if (!targetSessionId) {
    logGatewayWarn('[cron-delivery] 投递目标会话不存在或已删除，跳过会话投递', {
      jobId: job.id,
      userId: job.user_id,
    });
    return {
      attempted: true,
      delivered: false,
      error: '投递目标会话不存在或已被删除',
    };
  }

  // 结果落在「目标会话」还是「执行现场」：投递到目标会话（用户的对话流）。
  const body = buildDeliveryBody(context);
  injectSyntheticSessionMessage({
    sessionId: targetSessionId,
    userId: job.user_id,
    notificationId: `delivery:${job.id}:${context.executionStartedAt}`,
    text: buildCronNoticeText({
      jobName: job.name,
      body,
      executionSessionId: context.executionSessionId,
    }),
    // 标题行渲染为 `<agent> <状态> · <description>`：agent 已放任务名，description
    // 再放一次任务名会变成「每日新闻 已完成 · 每日新闻」。
    description: '定时任务',
    metadata: {
      // 已扩展为联合类型；客户端按 'cron' 分流文案与跳转语义。
      source: 'cron',
      // **刻意不传 `childID`**：客户端把 `childID` 接到
      // `openChildSessionInspector`（`useChildSessionSelection`），那是「选中子代理
      // 并打开右侧『代理』面板」的子代理专用口。cron 执行会话不是子代理，塞进去只
      // 会打开一个空面板。结果正文与失败原因都已在本通知内展示，排查可走
      // `/schedules` 的执行历史，故不需要跳转。
      agent: job.name,
      state: (context.succeeded ? 'done' : 'failed') satisfies SubagentNoticeState,
    },
  });
  return { attempted: true, delivered: true };
}

/**
 * 投递 `delivery_mode: 'desktop'`：写一条用户级通知。
 *
 * `createNotification` 落库后会自动 `publishNotificationChanged`，经
 * `/notification-events` WS 推给该用户**所有在线客户端**，Web 侧栏铃铛与
 * 页面隐藏时的系统通知都走这条链路——因此不需要为桌面端新建传输层。
 */
export function deliverCronResultToDesktop(
  job: CronJobRecord,
  context: CronDeliveryContext,
): CronDeliveryOutcome {
  // `notifications.session_id` 有指向 `sessions` 的外键，且 FK 是开启的
  // （`infra/db.ts` 的 `PRAGMA foreign_keys=ON`）。执行会话可能已被回收
  // （`createCronExecutionSession` 只按任务保留最近若干条），此时带上它会让
  // INSERT 直接抛错——**整条通知投递静默失败**。故先确认它还在；不在就不带
  // session（丢失跳转能力，但「任务跑完了 / 没跑成」这个通知本身必须送达）。
  const linkedSessionId = resolveOwnedSession(context.executionSessionId, job.user_id);
  createNotification({
    id: `cron-delivery:${job.id}:${context.executionStartedAt}`,
    userId: job.user_id,
    eventType: 'cron_job_finished',
    // 失败时同样保持 informational：红点只留给需要用户操作的待办
    // （`resolveNotificationKind` 只把 permission/question 算 actionable）。
    kind: 'informational',
    title: context.succeeded ? `定时任务「${job.name}」已完成` : `定时任务「${job.name}」执行失败`,
    body: buildDeliveryBody(context),
    ...(linkedSessionId ? { sessionId: linkedSessionId } : {}),
    // 同一次执行重复投递是空操作（重试 / 重放不会把红点点亮两遍）。
    dedupeKey: `cron-delivery:${job.id}:${context.executionStartedAt}`,
  });
  return { attempted: true, delivered: true };
}

/**
 * 按任务声明的 `delivery_mode` 投递执行结果。`none` 时什么都不做。
 *
 * 本函数**不抛错**，但把失败如实放进返回值：调用方（`runCronAgentJob`）需要据此
 * 让「执行成功、投递失败」变成一条**可见的**失败记录，而不是只在日志里留痕。
 */
export function deliverCronResult(
  job: CronJobRecord,
  context: CronDeliveryContext,
): CronDeliveryOutcome {
  if (job.delivery_mode === 'none') return SKIPPED;
  try {
    return job.delivery_mode === 'desktop'
      ? deliverCronResultToDesktop(job, context)
      : deliverCronResultToSession(job, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logGatewayWarn('[cron-delivery] 投递失败', {
      jobId: job.id,
      deliveryMode: job.delivery_mode,
      error: message,
    });
    return { attempted: true, delivered: false, error: message };
  }
}

/**
 * 目标不可达（投递目标会话被删 / 渠道配置缺失）时的用户通知。
 *
 * 这条路径上任务**还没开始执行**，所以没有任何「执行现场」可看；如果只把错误抛给
 * 调度器，用户只有在主动打开 `/schedules` 时才会发现——对 `delivery_mode: 'desktop'`
 * 的任务尤其不合理（用户本来就期望收到通知）。
 *
 * 用稳定的 `dedupeKey`：同一条任务反复触发失败时只保留**一条未读**通知（内容更新
 * 并置顶），否则一个每 10 分钟触发的坏任务会瞬间刷满通知中心。
 */
export function notifyCronJobUnavailable(job: CronJobRecord, reason: string): void {
  try {
    createNotification({
      // **不能复用固定 id**：`createNotification` 的 dedupe 只匹配 `status='unread'`，
      // 用户读过那条通知后再失败时不再命中 dedupe，INSERT 会撞主键并被
      // `isUniqueConstraintViolation` 静默吞掉——任务从此「永远静默」。
      // 用随机 id + 固定 dedupeKey：未读时更新同一条，已读后能重新点亮。
      id: crypto.randomUUID(),
      userId: job.user_id,
      eventType: 'cron_job_unavailable',
      kind: 'informational',
      title: `定时任务「${job.name}」无法执行`,
      body: `${reason}（任务配置需要修正；执行历史里也会记录本次失败。）`,
      dedupeKey: `cron-unavailable:${job.id}`,
    });
  } catch (error) {
    logGatewayWarn('[cron-delivery] 无法执行的通知也发不出去', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
