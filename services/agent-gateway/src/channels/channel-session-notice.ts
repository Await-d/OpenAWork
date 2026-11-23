/**
 * 会话内的审批事件 → 渠道回推（261101）。
 *
 * 背景：渠道会话里发生权限申请时，审批只能发生在 Web / 桌面端（群里的「同意」
 * 不构成授权），而渠道侧此前**完全静默**——本轮以 `stopReason=tool_permission`
 * 正常结束（HTTP 200），用户只看到一句「未生成文本」；审批通过后的续跑同样没有
 * 任何输出回到渠道，等于把盲区从「审批前」挪到「审批后」。
 *
 * 本模块只做一件事：按 `sessionId` 找回它对应的渠道会话，把一段文本推过去。
 * 三条硬约束：
 *   1. **best-effort**：推送失败绝不冒泡到审批路由——审批此时已经落库生效，
 *      让响应变成 500 会诱导用户重复提交；
 *   2. **只认渠道会话**：非渠道会话（Web 里直接创建的）解析不到目标即返回，
 *      不猜测、不群发；
 *   3. 语言取会话 metadata 里的那一份（渠道回复语言），保证回推与正常回复一致。
 */

import { sqliteGet } from '../infra/db.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import {
  listPendingPermissionSummaries,
  resolveEarliestPendingExpiry,
} from '../permission/permission-pending-store.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import {
  buildLocalizedErrorMessage,
  buildPermissionExpiredMessage,
  buildPermissionPendingMessage,
  buildPermissionResolvedMessage,
  buildPermissionResumedNoTextMessage,
} from './channel-localization.js';
import { channelLogInfo, channelLogWarn } from './channel-log.js';
import { CHANNELS_SETTINGS_KEY, materializeStoredChannels } from './channel-config.js';
import { extractChannelReplyText } from './channel-reply-text.js';
import {
  normalizeChannelReplyLanguage,
  type ChannelReplyLanguage,
} from './channel-reply-language.js';
import { channelManager } from './manager.js';

/** `channel-session-store.buildChannelSessionKey` 的格式：`channel:<pluginId>:chat:<chatId>`。 */
const CHANNEL_SESSION_KEY_PREFIX = 'channel:';
const CHANNEL_SESSION_KEY_CHAT_MARKER = ':chat:';

interface ChannelSessionRow {
  title: string | null;
  metadata_json: string | null;
  user_id: string;
}

export interface ChannelSessionNoticeTarget {
  readonly pluginId: string;
  readonly chatId: string;
  readonly replyLanguage: ChannelReplyLanguage;
  /** 读取会话消息（回推续跑结果）时必需，因此随目标一起解析出来。 */
  readonly ownerUserId: string;
}

function parseChannelSessionKey(key: string): { pluginId: string; chatId: string } | null {
  if (!key.startsWith(CHANNEL_SESSION_KEY_PREFIX)) {
    return null;
  }
  const rest = key.slice(CHANNEL_SESSION_KEY_PREFIX.length);
  const markerIndex = rest.indexOf(CHANNEL_SESSION_KEY_CHAT_MARKER);
  if (markerIndex <= 0) {
    return null;
  }
  const pluginId = rest.slice(0, markerIndex);
  const chatId = rest.slice(markerIndex + CHANNEL_SESSION_KEY_CHAT_MARKER.length);
  if (pluginId.length === 0 || chatId.length === 0) {
    return null;
  }
  return { pluginId, chatId };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readMetadataChannelId(metadata: Record<string, unknown>): string | null {
  const channel = metadata['channel'];
  if (typeof channel !== 'object' || channel === null || Array.isArray(channel)) {
    return null;
  }
  return readNonEmptyString((channel as Record<string, unknown>)['id']);
}

/**
 * 会话 → 渠道推送目标。
 *
 * metadata 优先（`channel.id` + `channelChatId`，每轮由 `upsertChannelSession`
 * 刷新），会话标题解析仅作兜底：老会话、或 metadata 被外部工具改写过的行仍要
 * 能找回渠道，否则「用户以为会收到通知」的承诺会静默失效。
 *
 * 判据的覆盖面（已核实，改这里前先看一眼）：`channelChatId` 全仓只有
 * `upsertChannelSession` 写入，因此
 *   - task 子代理会话（`delegation.ts` 全新构造 metadata）与普通 cron 会话
 *     （`createCronExecutionSession`）都不含该字段 → 判为非渠道，**不会误报**；
 *     代价是渠道派生的子代理拿不到回推（属已知边界，与
 *     `session-extension-origin.ts` 要沿祖先链找渠道同源）；
 *   - 渠道绑定的 cron 执行会话**会**命中（它刻意走 `upsertChannelSession` 且
 *     `source:'channel'`）——这是期望行为：任务卡在等审批、或批准后的结果，
 *     本来就该回到那个群/会话。
 * 标题兜底理论上可被「手工把会话标题改成 `channel:<id>:chat:<id>`」触发，但那只
 * 能把消息发到用户自己配置且正在运行的渠道，危害有界，故保留兜底以免老会话静默。
 */
export function resolveChannelSessionNoticeTarget(
  sessionId: string,
): ChannelSessionNoticeTarget | null {
  const row = sqliteGet<ChannelSessionRow>(
    'SELECT title, metadata_json, user_id FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) {
    return null;
  }
  const metadata = parseSessionMetadataJson(row.metadata_json ?? '{}');
  const fallback = parseChannelSessionKey(row.title ?? '');
  const pluginId = readMetadataChannelId(metadata) ?? fallback?.pluginId ?? null;
  const chatId = readNonEmptyString(metadata['channelChatId']) ?? fallback?.chatId ?? null;
  if (!pluginId || !chatId) {
    return null;
  }
  return {
    pluginId,
    chatId,
    replyLanguage: normalizeChannelReplyLanguage(metadata['replyLanguage']),
    ownerUserId: row.user_id,
  };
}

/**
 * 该渠道是否愿意接收**主动**推送。
 *
 * 与 `auto-reply` 的入场判定同口径（`!enabled || features.autoReply === false`
 * 即不处理）：用户关掉渠道、或关掉「自动回复」之后仍收到机器人主动发的审批
 * 提示，是把开关当摆设。读取渠道配置**不绕 router**——那会把路由模块的顶层
 * 副作用（注册工厂 / 建管线）拖进审批链路，也容易成环。
 *
 * 配置缺失或解析失败时**不拦截**：此时会话确实来自该渠道、服务也确实在跑，
 * 宁可按用户原本的期望发出提示，也不要因为读不到配置而静默。
 */
function isChannelPushAllowed(target: ChannelSessionNoticeTarget): boolean {
  const row = sqliteGet<{ value: string }>(
    'SELECT value FROM user_settings WHERE user_id = ? AND key = ? LIMIT 1',
    [target.ownerUserId, CHANNELS_SETTINGS_KEY],
  );
  if (!row?.value) {
    return true;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(row.value) as unknown;
  } catch {
    return true;
  }

  const channel = materializeStoredChannels(raw, target.ownerUserId).find(
    (entry) => entry.id === target.pluginId,
  );
  if (!channel) {
    return true;
  }
  return channel.enabled && channel.features?.autoReply !== false;
}

/**
 * 把一段文本推到渠道会话。
 *
 * 调用方**不需要**（也不应该）用 try/catch 包住：本函数吞掉全部失败并只记日志，
 * 返回 `false` 表示「没送到」。渠道服务未运行、渠道开关关闭、平台 API 报错都在
 * 此收敛 —— 包括**读渠道配置时的 SQLite 异常**，它是这条链路上唯一会同步抛出的
 * 地方，绝不能让它冒泡成 rejected promise（调用点全是 fire-and-forget，会成为
 * unhandled rejection）。
 */
export async function sendChannelSessionNotice(input: {
  readonly target: ChannelSessionNoticeTarget;
  readonly sessionId: string;
  /** 日志用的事件来源，例如 `permission.decision`。 */
  readonly source: string;
  readonly text: string;
}): Promise<boolean> {
  const logContext = {
    pluginId: input.target.pluginId,
    chatId: input.target.chatId,
    sessionId: input.sessionId,
    source: input.source,
  };
  try {
    const service = channelManager.getService(input.target.pluginId);
    if (!service || !service.isRunning()) {
      channelLogWarn('channel session notice skipped: service unavailable', logContext);
      return false;
    }
    if (!isChannelPushAllowed(input.target)) {
      channelLogInfo(
        'channel session notice skipped: channel disabled or auto-reply off',
        logContext,
      );
      return false;
    }

    await service.sendMessage(input.target.chatId, input.text);
    channelLogInfo('channel session notice sent', {
      ...logContext,
      textLength: input.text.length,
    });
    return true;
  } catch (error) {
    channelLogWarn('channel session notice failed', {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** 祖先链回溯的跳数上限：防畸形 metadata 造出的超长链把一次回推拖成 N 次查询。 */
const MAX_ANCESTOR_HOPS = 8;

interface SessionAncestryRow {
  metadata_json: string | null;
  team_parent_session_id: string | null;
}

/**
 * 父会话 id。
 *
 * 取法与 `session-extension-origin.nextAncestor` 一致：`team_parent_session_id`
 * 列（团队 layering）优先，其次 metadata 里的 `parentSessionId`（task 子代理）。
 * 两者语义不同，但「谁派生的我」只有一个答案。
 */
function readParentSessionId(sessionId: string): string | null {
  const row = sqliteGet<SessionAncestryRow>(
    'SELECT metadata_json, team_parent_session_id FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) {
    return null;
  }
  const teamParent = readNonEmptyString(row.team_parent_session_id);
  if (teamParent) {
    return teamParent;
  }
  return readNonEmptyString(parseSessionMetadataJson(row.metadata_json ?? '{}')['parentSessionId']);
}

/**
 * 沿祖先链找渠道归属 —— **渠道派生的子代理会话**专用。
 *
 * 子代理会话的 metadata 是全新构造的（`delegation.ts`），不带 `channelChatId`，
 * 所以「用户在 Web 上批准了子代理的权限请求」这件事在渠道里原本毫无痕迹。往上
 * 走才能找到那个群/会话；跳数有上限，并带 visited 防环。
 *
 * 注意与 `resolveChannelSessionNoticeTarget` 的分工：**只有「用户动作的反馈」
 * 该用这个版本**（审批决定 / 超时失效）。子代理**续跑产出的文本**仍走直接版本 ——
 * 子代理的产出会经父会话回合带回渠道，沿祖先链再发一遍就是重复投递，而且把
 * 「给父代理看的报告」直接倒进群里也不合适。
 */
export function resolveChannelSessionNoticeTargetIncludingAncestors(
  sessionId: string,
): ChannelSessionNoticeTarget | null {
  const direct = resolveChannelSessionNoticeTarget(sessionId);
  if (direct) {
    return direct;
  }

  const visited = new Set<string>([sessionId]);
  let current = sessionId;
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop += 1) {
    const parentId = readParentSessionId(current);
    if (!parentId || visited.has(parentId)) {
      return null;
    }
    visited.add(parentId);
    const target = resolveChannelSessionNoticeTarget(parentId);
    if (target) {
      return target;
    }
    current = parentId;
  }
  return null;
}

interface ChannelSessionNoticeInput {
  readonly sessionId: string;
  readonly source: string;
  readonly buildText: (target: ChannelSessionNoticeTarget) => string;
}

/**
 * 解析目标后即发一条回推；非渠道会话、渠道不可达、任何查询异常都安静返回。
 *
 * 与 `sendChannelSessionNotice` 一样是「不允许向调用方抛错」的边界：目标解析
 * 要读 `sessions` 表，这一步同样可能失败。
 */
async function notifyResolvedTarget(
  input: ChannelSessionNoticeInput,
  resolve: (sessionId: string) => ChannelSessionNoticeTarget | null,
): Promise<boolean> {
  try {
    const target = resolve(input.sessionId);
    if (!target) {
      return false;
    }
    return await sendChannelSessionNotice({
      target,
      sessionId: input.sessionId,
      source: input.source,
      text: input.buildText(target),
    });
  } catch (error) {
    channelLogWarn('channel session notice aborted', {
      sessionId: input.sessionId,
      source: input.source,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** 只认本会话的渠道身份；用于「这是本会话自己的产出」类回推。 */
export async function notifyChannelSession(input: ChannelSessionNoticeInput): Promise<boolean> {
  return notifyResolvedTarget(input, resolveChannelSessionNoticeTarget);
}

/** 允许沿祖先链回溯；用于「用户动作的反馈」类回推（审批决定、超时失效）。 */
async function notifyChannelSessionWithAncestors(
  input: ChannelSessionNoticeInput,
): Promise<boolean> {
  return notifyResolvedTarget(input, resolveChannelSessionNoticeTargetIncludingAncestors);
}

/**
 * 审批决定落库后的回推。
 *
 * `resumed` 必须是「真的拿到了续跑载荷」——拒绝（`reject`）只会终止本轮，
 * 说成「正在继续执行」会让用户以为还有后续输出在等。
 */
export function notifyChannelPermissionDecision(input: {
  readonly sessionId: string;
  readonly toolName: string;
  readonly decision: 'once' | 'session' | 'permanent' | 'reject';
  readonly resumed: boolean;
}): void {
  // 允许祖先链：在 Web 上批准的可能是渠道派生的子代理会话的权限请求，
  // 它的 metadata 里没有渠道身份，但渠道用户同样需要知道自己刚批了什么。
  void notifyChannelSessionWithAncestors({
    sessionId: input.sessionId,
    source: 'permission.decision',
    buildText: (target) =>
      buildPermissionResolvedMessage(target.replyLanguage, {
        toolName: input.toolName,
        decision: input.decision,
        resumed: input.resumed,
      }),
  });
}

/**
 * 批准后的续跑结束时的回推。
 *
 * 续跑发生在没有打开的 SSE / WS 的路径上（`resumeApprovedPermissionRequest`），
 * 渠道侧拿不到任何输出。三种结局都要有交代：
 *   - 又停下来等下一次授权 → 再发一条等审批提示；
 *   - 正常跑完 → 发本轮最终 assistant 文本；
 *   - 跑完但没产出文本 → 明确说明，而不是留给用户猜。
 */
export async function notifyChannelAfterApprovedResume(input: {
  readonly sessionId: string;
  readonly clientRequestId: string;
}): Promise<void> {
  // 本函数挂在 `resumeApprovedPermissionRequest(...).then()` 上，它的 rejection 会
  // 落进调用方的 `.catch` —— 那里把错误当「续跑失败」回推给用户。回推自身读库失败
  // 若冒上去，用户会收到一条「执行失败：database is not open」的假警报，而续跑其实
  // 好好跑完了。所以这里必须自己吞掉异常。
  try {
    const target = resolveChannelSessionNoticeTarget(input.sessionId);
    if (!target) {
      return;
    }

    const pending = listPendingPermissionSummaries(input.sessionId);
    if (pending.length > 0) {
      await sendChannelSessionNotice({
        target,
        sessionId: input.sessionId,
        source: 'permission.resume',
        text: buildPermissionPendingMessage(target.replyLanguage, {
          toolNames: pending.map((entry) => entry.toolName),
          expiresAt: resolveEarliestPendingExpiry(pending),
        }),
      });
      return;
    }

    const replyText = readLatestAssistantText({
      sessionId: input.sessionId,
      userId: target.ownerUserId,
      clientRequestId: input.clientRequestId,
    });
    await sendChannelSessionNotice({
      target,
      sessionId: input.sessionId,
      source: 'permission.resume',
      text: replyText ?? buildPermissionResumedNoTextMessage(target.replyLanguage),
    });
  } catch (error) {
    channelLogWarn('channel resume notice aborted', {
      sessionId: input.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 待审批请求**超时失效**时的回推。
 *
 * 超时与「拒绝」不同：用户什么都没做，本轮就作废了。不说一声，渠道里那句
 * 「等待授权」会一直像是还有人在等它批准。允许祖先链，理由同审批决定。
 *
 * 触发时机是惰性的（有人读取待审批列表时才扫描过期行），因此这是**尽力而为**：
 * 没人打开任何端时不会有这条消息，但也不会误报。
 */
export function notifyChannelPermissionExpired(input: {
  readonly sessionId: string;
  readonly toolNames: readonly string[];
}): void {
  void notifyChannelSessionWithAncestors({
    sessionId: input.sessionId,
    source: 'permission.expired',
    buildText: (target) =>
      buildPermissionExpiredMessage(target.replyLanguage, { toolNames: input.toolNames }),
  });
}

/**
 * 批准后续跑**失败**时的回推。
 *
 * 没有这一条，续跑炸掉时渠道里就是批准后的永久沉默——比「等审批」更难排查，
 * 因为用户会认为授权已经完成、事情正在做。
 */
export function notifyChannelPermissionResumeFailure(input: {
  readonly sessionId: string;
  readonly detail: string;
}): void {
  void notifyChannelSession({
    sessionId: input.sessionId,
    source: 'permission.resume_failed',
    buildText: (target) => buildLocalizedErrorMessage(target.replyLanguage, input.detail),
  });
}

/** 取本轮（同一 `clientRequestId`）最后一条 assistant 文本；取不到返回 `null`。 */
function readLatestAssistantText(input: {
  readonly sessionId: string;
  readonly userId: string;
  readonly clientRequestId: string;
}): string | null {
  const latest = listSessionMessagesV2({
    sessionId: input.sessionId,
    userId: input.userId,
  })
    .filter(
      (entry) => entry.role === 'assistant' && entry.clientRequestId === input.clientRequestId,
    )
    .at(-1);
  // 只取正文：回推给 IM 的内容不得包含 reasoning / 工具入参与输出。
  const text = extractChannelReplyText(latest);
  return text.length > 0 ? text : null;
}
