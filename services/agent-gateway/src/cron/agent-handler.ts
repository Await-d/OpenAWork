import { randomUUID } from 'node:crypto';
import { resolveAnyChannel } from '../channels/router.js';
import { upsertChannelSession } from '../channels/channel-session-store.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { runSessionInBackground } from '../routes/stream-runtime.js';
import type { HandleStreamResult } from '../routes/stream-types.js';
import { deleteSessionWithMalformedRecovery } from '../session/session-delete-recovery.js';
import { deliverCronResult, notifyCronJobUnavailable, readCronResultText } from './delivery.js';
import type { CronJobExecutionContext, CronJobRecord } from './types.js';

interface SessionOwnerRow {
  readonly id: string;
}

export function buildCronAgentPrompt(job: CronJobRecord): string {
  const channelInfo =
    job.plugin_id && job.plugin_chat_id
      ? `\n## Channel Reply Routing\nThis cron job was created from plugin channel \`${job.plugin_id}\`.\nChat ID: \`${job.plugin_chat_id}\`\nWhen you have results to report, use **PluginSendMessage** with plugin_id="${job.plugin_id}" and chat_id="${job.plugin_chat_id}" to send the results back through the channel.`
      : '';
  const deliveryInstructions =
    job.plugin_id && job.plugin_chat_id
      ? `When finished, call **PluginSendMessage** EXACTLY ONCE with plugin_id="${job.plugin_id}" and chat_id="${job.plugin_chat_id}" to send a friendly result summary back through the channel. After sending, STOP.`
      : 'When finished, provide a concise result summary in this session, then STOP.';

  return [
    `You are a scheduled task assistant running cron job (ID: ${job.id}).`,
    `Job: ${job.name}`,
    job.delivery_target ? `Target session: ${job.delivery_target}` : '',
    channelInfo,
    '',
    '## Your Task',
    job.prompt,
    '',
    '## Delivery Instructions',
    deliveryInstructions,
    '',
    'Match the language of the task prompt in your delivery message (Chinese task -> Chinese reply, English task -> English reply). Be concise and friendly.',
    '',
    'Begin working on this task now.',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

function assertOwnedSession(sessionId: string, userId: string): string {
  const row = sqliteGet<SessionOwnerRow>(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  if (!row) {
    throw new Error(`Cron target session "${sessionId}" does not exist for this user.`);
  }
  return row.id;
}

/**
 * 本次执行使用的会话：**每次触发都新建**（`source: 'cron'`）。复用会踩两个坑：
 *
 * 1. **单飞锁冲突**（本轮修复的核心 bug）。`handleStreamRequest` 有会话级单飞锁
 *    （`getAnyInFlightStreamRequestForSession`），命中即 `409` 立即返回。
 *    复用「用户正在浏览的会话」时，只要用户恰好打开着它、或上一次触发尚未收尾，
 *    本次触发就在 20ms 内被拒 —— 表现正是「刚触发就 completed、毫无产出」。
 * 2. **历史与现场串味**。任务产出会混进用户自己的对话流，而 `source: 'cron'`
 *    只是会话级元数据，无法按「这一次执行」区分。
 *
 * 独立会话天然规避锁冲突（每次一个全新 session id），也让执行历史里的
 * `session_id` 精确指向「这一次执行」的现场，用户可直接点进去看。
 */
/**
 * 每个任务保留的「执行会话」条数上限，超出后回收最旧的。
 *
 * 每次触发新建会话是修复单飞锁冲突的必要代价，但不回收就会无界累积：
 * `every 1 分钟` 的任务一天 1440 条、一年 50 万条，会话列表很快被
 * `cron:<任务名>` 淹没。保留最近若干次足够排查「上一次到底发生了什么」——
 * 更早的现场已无诊断价值，且执行状态与错误原因另有 `cron_job_executions`
 * （按任务保留 200 条）承载。
 */
const CRON_EXECUTION_SESSIONS_KEPT_PER_JOB = 20;

/**
 * 回收该任务过旧的执行会话。
 *
 * 必须走 `deleteSessionWithMalformedRecovery`（而不是裸 `DELETE FROM sessions`）：
 * `sessions` 被 53 张表以 `ON DELETE CASCADE` 引用，且部分表在 FK 关闭时不会级联，
 * 那个函数是项目既定的会话删除约定，同时会失效 session-owner 缓存。
 *
 * 只回收 `idle`：`running` 是正在跑的那次（绝不能删）、`paused` 是停在等审批的
 * 现场（保留下来才能让用户看见「卡在哪一步」）。排序用 `created_at DESC, rowid DESC`
 * —— `created_at` 是秒精度的 `datetime('now')`，同一秒内建的多条必须靠 rowid
 * 才能稳定排序。
 */
function pruneOldCronExecutionSessions(job: CronJobRecord): void {
  // 整个回收过程「尽力而为」：它是维护动作，**绝不能**让一次任务因清理失败而失败。
  // 注意查询本身也要保护——`json_extract` 依赖 SQLite JSON1 扩展，若某些构建缺少
  // 该扩展会直接抛错；那种情况下任务仍应正常执行，只是旧会话不再自动回收。
  try {
    const stale = sqliteAll<{ id: string }>(
      `SELECT id FROM sessions
       WHERE user_id = ?
         AND state_status = 'idle'
         AND json_extract(metadata_json, '$.source') = 'cron'
         AND json_extract(metadata_json, '$.cronJobId') = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT -1 OFFSET ?`,
      [job.user_id, job.id, CRON_EXECUTION_SESSIONS_KEPT_PER_JOB],
    );
    for (const row of stale) {
      try {
        deleteSessionWithMalformedRecovery({ sessionId: row.id, userId: job.user_id });
      } catch (error) {
        logGatewayWarn('[cron] 回收旧执行会话失败', {
          jobId: job.id,
          sessionId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logGatewayWarn('[cron] 查询可回收的执行会话失败（本轮跳过回收）', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function createCronExecutionSession(job: CronJobRecord): string {
  const sessionId = randomUUID();
  const metadata = {
    source: 'cron',
    cronJobId: job.id,
    ...(job.working_folder ? { workingDirectory: job.working_folder } : {}),
  };
  sqliteRun(
    'INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, job.user_id, `cron:${job.name}`, '[]', 'idle', JSON.stringify(metadata)],
  );
  // **先建后回收**：这样上限是「含本次」的硬上限。若先回收再建，保留 20 条时
  // 插入后实际是 21 条（N+1），每次触发都会多留一条，上限形同虚设。
  // 新会话是最新的一条（rowid 最大），必然落在保留窗口内，不会被自己的回收删掉。
  pruneOldCronExecutionSessions(job);
  return sessionId;
}

/**
 * 校验任务声明的**投递目标**会话仍然归属该用户。
 *
 * 与执行会话解耦之后，`session_id` / `delivery_target` 只表达「结果该投递到哪」，
 * 不再决定本次在哪个会话里跑。`delivery_mode: 'session'` 时目标被删必须明确失败
 * （落 `failed` + 原因），而不是跑完把产出丢进虚空。
 *
 * **只对 `session` 模式生效**：`desktop` 模式只用执行会话 id 做通知跳转
 * （`deliverCronResultToDesktop` 会先确认它还在，不在就不带 session），`none`
 * 根本不投递。对这两种模式也校验 `session_id` 会把「来源会话被删」变成永久失败：
 * 任务每次触发都在执行前抛错并推一条「无法执行」，而它其实完全能跑。
 */
function assertDeclaredTargetsStillOwned(job: CronJobRecord): void {
  if (job.delivery_mode !== 'session') return;
  const target = job.delivery_target ?? job.session_id;
  if (target) assertOwnedSession(target, job.user_id);
}

/**
 * 渠道任务执行会话的 key（也是 session title）。
 *
 * **刻意不以 `channel:` 开头**，两个原因：
 *  1. 若沿用 `buildChannelSessionKey(plugin, chat)`（即 `channel:<plugin>:chat:<chat>`），
 *     就会复用**用户在该渠道的对话会话** —— 用户正聊着天时任务触发，
 *     `handleStreamRequest` 的会话级单飞锁直接 409，任务白跑（本轮修复的核心症状）。
 *  2. 若简单加后缀（`…:cron`），title 仍以 `channel:` 开头，会被
 *     `channel-conversations` 的 `title LIKE 'channel:<plugin>:chat:%'` 命中，
 *     解析出 `chatId = "<原 chat>:cron"`，在渠道会话列表里多出一条脏条目。
 *
 * 用独立前缀则：不进渠道会话列表；`findReusableChannelSession` 仍按 title 精确
 * 匹配，故**同一任务**复用同一条 cron 渠道会话（不会每次触发都新建）。
 *
 * 为什么仍走 `upsertChannelSession`（而不是像普通任务那样自建 `source: 'cron'`
 * 会话）：渠道任务的工具可见性与权限收敛全靠 `metadata.source === 'channel'`
 * （`isChannelManagedSession`）。改成 `'cron'` 会让 `channelToolAllowlist`、
 * `channel.tools` 开关、渠道 permissions 全部失效——那是**放宽**权限，比争锁更糟。
 */
function buildCronChannelSessionKey(job: CronJobRecord): string {
  return `cron-channel:${job.plugin_id}:${job.plugin_chat_id}:${job.id}`;
}

/**
 * 给 cron 渠道执行会话打上「这是任务执行会话」的标记。
 *
 * 为什么需要：它的 metadata 里 `source` 必须是 `'channel'`（否则渠道工具可见性与
 * 权限收敛全部失效），于是它在库里与普通渠道会话**只差一个 title 前缀**。将来任何
 * 「清理长期不活跃会话/渠道会话」的策略都必须能把它们排除，否则任务执行用的会话
 * 会被当成闲置对话删掉（虽然可重建，但会丢掉排查现场）。
 *
 * 标记写在 metadata 而非新列：`buildChannelSessionMetadata` 会 `...currentMetadata`
 * 继承旧字段，所以复用同一条会话时标记不会丢。
 */
function markCronChannelSession(sessionId: string, job: CronJobRecord): void {
  try {
    sqliteRun(
      `UPDATE sessions
          SET metadata_json = json_set(metadata_json, '$.cronJobId', ?, '$.isCronExecution', 1)
        WHERE id = ? AND user_id = ?`,
      [job.id, sessionId, job.user_id],
    );
  } catch (error) {
    // 标记失败不影响执行（它只服务未来的清理策略与排查）。
    logGatewayWarn('[cron] 标记 cron 渠道会话失败', {
      jobId: job.id,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function prepareCronSession(job: CronJobRecord): string {
  if (job.plugin_id && job.plugin_chat_id) {
    const channel = resolveAnyChannel(job.plugin_id);
    if (!channel) {
      throw new Error(`Cron channel "${job.plugin_id}" is not configured.`);
    }
    if (channel.ownerUserId !== job.user_id) {
      throw new Error(`Cron channel "${job.plugin_id}" does not belong to this user.`);
    }
    const sessionId = upsertChannelSession({
      channel,
      chatId: job.plugin_chat_id,
      sessionKey: buildCronChannelSessionKey(job),
      userId: job.user_id,
    });
    markCronChannelSession(sessionId, job);
    return sessionId;
  }

  return createCronExecutionSession(job);
}

/**
 * 把「执行未真正跑起来 / 中途失败」的结果翻译成异常。
 *
 * `runSessionInBackground` 用**返回值**表达失败（不抛错），而 `fireJob` 只按
 * 「有没有抛错」判定执行记录的状态。此前调用方直接丢弃返回值，于是：
 *
 *   - 会话单飞锁冲突 → 立即返回 `409 SESSION_ALREADY_RUNNING`（实测 24ms 结束）；
 *   - replay 命中 / 模型路由解析失败 → 同样静默返回；
 *
 * 三种都被记成 `completed`，用户在界面上看到「成功」但没有任何产出——任务成了空壳。
 * 这里补齐判定：任何非正常终态都抛错，交给 `fireJob` 落 `failed` + 原因。
 */
export function assertCronRunSucceeded(result: HandleStreamResult): void {
  const status = result.statusCode;
  const stopReason = result.stopReason;

  // 正常终态：200 且以 end_turn / max_tokens 收尾（工具轮由 stopReason=tool_use 继续，
  // 不会在此收尾）。`tool_permission` 是 cron 无人会话的停滞态（需要用户批准但用户不在），
  // 也不能算成功——否则任务会永远停在「等批准」而历史显示成功。
  if (status === 200 && (stopReason === 'end_turn' || stopReason === 'max_tokens')) {
    return;
  }

  const detail = result.errorSummary ?? result.errorDetail ?? '未提供原因';

  // `tool_permission`：任务在「等用户批准」处停下，而 cron 会话用户不在场 ——
  // 这不是成功，是**静默停摆**（历史显示成功、实际永远卡住）。给出可操作建议：
  // 需要在任务里执行的写操作，应改到用户在场时批准，或改用免审批的委派（子代理）。
  if (stopReason === 'tool_permission') {
    throw new Error(
      '定时任务因等待用户批准而停滞（会话内用户不在场，无法批准）。' +
        '请简化任务中需要写入 / 执行命令的步骤，或改为委派给子代理（定时任务的委派已免审批）。',
    );
  }

  // 409：会话级单飞锁（`SESSION_ALREADY_RUNNING`）与模型绑定不可用都归此码，
  // 两者文案里都带得出原因。注意**不能**按 `stopReason === undefined` 判定——
  // `runSessionInBackground` 会把无 stopReason 的结果统一补成 `stopReason: 'error'`
  // （见 `routes/stream-runtime.ts` 的防御性补全），那种判定在此恒为假。
  //
  // 文案刻意**不**断言「投递目标会话被占用」：执行会话与投递目标已解耦
  // （见 `prepareCronSession`），409 只可能来自「本次执行所用的那个会话」——
  // 渠道任务用它自己的 cron 渠道会话，普通任务用一次性新会话。
  if (status === 409) {
    throw new Error(
      `定时任务执行被拒绝（409）：${detail}。` +
        '常见原因是同一条任务的上一次执行尚未结束（会复用同一执行会话），或该渠道会话正被占用；稍后重试即可。',
    );
  }
  throw new Error(
    `定时任务执行未成功（statusCode=${status}${stopReason ? `，stopReason=${stopReason}` : ''}）：${detail}`,
  );
}

export async function runCronAgentJob(
  job: CronJobRecord,
  context?: CronJobExecutionContext,
): Promise<void> {
  if (!job.prompt.trim()) {
    return;
  }

  // 先做目标可达性校验（会话被删 → 明确失败），再建本次执行会话。
  //
  // 这条路径上任务**还没开始执行**，没有任何产出可展示；若只把错误抛给调度器，
  // 用户只有在主动打开 `/schedules` 时才会发现（`delivery_mode: 'desktop'` 的任务
  // 尤其不该如此——用户本来就期望收到通知）。所以失败也要主动推一条通知。
  let targetError: string | null = null;
  try {
    assertDeclaredTargetsStillOwned(job);
  } catch (error) {
    targetError = error instanceof Error ? error.message : String(error);
  }
  if (targetError !== null) {
    notifyCronJobUnavailable(job, targetError);
    throw new Error(targetError);
  }

  const sessionId = prepareCronSession(job);
  // 立刻上报：即使随后执行失败，用户也能从执行历史点进现场看到失败经过。
  // 放在 `runSessionInBackground` 之前，保证「失败但无现场」不会发生。
  context?.reportSession(sessionId);
  const executionStartedAt = Date.now();
  const result = await runSessionInBackground({
    requestData: {
      message: buildCronAgentPrompt(job),
      displayMessage: job.prompt,
      clientRequestId: `cron-${job.id}-${randomUUID()}`,
      ...(job.agent_id ? { agentId: job.agent_id } : {}),
      ...(job.model ? { model: job.model } : {}),
    },
    sessionId,
    userId: job.user_id,
  });

  // 投递在**判定成败之前**做：失败也要让用户知道（「任务没跑成」本身就是要传达的
  // 结果），否则又回到「静默失败」的老问题。投递自身失败只记日志，不改执行结论。
  let succeeded = true;
  let errorMessage: string | undefined;
  try {
    assertCronRunSucceeded(result);
  } catch (error) {
    succeeded = false;
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  // `none` 模式不投递，不要白读一次执行会话消息（`listSessionMessagesV2` 会
  // join 最近 3 轮的 parts）；其余模式才需要摘要正文。
  const resultText =
    job.delivery_mode === 'none'
      ? ''
      : readCronResultText({ executionSessionId: sessionId, userId: job.user_id });

  const delivery = deliverCronResult(job, {
    executionSessionId: sessionId,
    executionStartedAt,
    resultText,
    succeeded,
    ...(errorMessage ? { errorMessage } : {}),
  });

  // 投递完成后再抛出：让调度器把这次执行记为 failed（执行历史与用户通知一致）。
  // 兜底文案不可省：`new Error(undefined)` 的 message 是空串，执行历史会显示
  // 「失败」却没有任何原因，等于把这个缺陷换成另一种静默失败。
  if (!succeeded) {
    // 执行失败本身可能已经通过投递告知用户。但若**连投递也失败**，用户就完全
    // 无从得知（`delivery_mode: 'none'` 除外——那是用户明确选择只看执行历史）。
    if (delivery.attempted && !delivery.delivered) {
      notifyCronJobUnavailable(
        job,
        `任务执行失败，且失败结果也没能送达：${delivery.error ?? '未知原因'}`,
      );
    }
    throw new Error(errorMessage ?? '定时任务执行失败（未记录原因）');
  }

  // 执行成功但结果没送到 → 对用户而言等于没完成，必须可见（记 failed + 主动通知），
  // 不能只在日志里留一行 warn。
  if (delivery.attempted && !delivery.delivered) {
    const reason = `任务执行成功，但结果投递失败：${delivery.error ?? '未知原因'}`;
    notifyCronJobUnavailable(job, reason);
    throw new Error(reason);
  }
}
