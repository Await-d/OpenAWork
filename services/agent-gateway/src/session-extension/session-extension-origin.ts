/**
 * 可信来源解析（含**祖先链**）。
 *
 * 安全模型的一条硬约束：任何「这个会话是什么来源、谁能操作它」的判断，都必须
 * 能从**持久化状态**推出来，不能只信当前会话的 metadata。
 *
 * 反例（本模块专门修的洞）：`task` 派生的子代理会话由
 * `tools/sandbox/handlers/delegation.ts` 构造，其 metadata 只有
 * `parentSessionId` / `createdByTool: 'task'`，**没有** `source: 'channel'`。
 * 于是：
 *   - 可见性判断（`session-tool-visibility.ts` 只看 `metadata.source`）认为它是
 *     个人会话 → 管理工具可见；
 *   - 执行守卫（`resolveSkillManageSessionDenial`）同样只看当前会话 → 放行。
 * 结果就是「渠道会话禁用的自助管理工具，可以通过派个子代理绕过去」。
 *
 * 修法：沿 `metadata.parentSessionId` 与 `team_parent_session_id` 向上走，只要链
 * 上出现 channel / cron / team，当前会话就继承该来源的收敛语义。
 */

import { sqliteGet } from '../infra/db.js';

/** 会话来源分类。`web` 覆盖普通个人会话（含桌面端 / 移动端）。 */
export type SessionExtensionOriginSource = 'channel' | 'cron' | 'team' | 'web' | 'unknown';

export interface SessionExtensionOrigin {
  readonly sessionId: string;
  readonly ownerUserId: string;
  readonly source: SessionExtensionOriginSource;
  /** 渠道实例 ID（仅 `source === 'channel'` 时可信）。 */
  readonly channelId: string | null;
  /** 渠道会话键（群 / 私聊 ID）。 */
  readonly chatId: string | null;
  /** 本轮发言者（平台侧 ID）；群共享会话下必须靠它区分请求者。 */
  readonly actorId: string | null;
  /** 命中来源的会话 ID（可能不是传入的 sessionId）。 */
  readonly originSessionId: string;
  /** 从当前会话到来源会话的祖先链（含两端），用于排障与审计。 */
  readonly ancestorChain: readonly string[];
  /**
   * 该来源是否**显式开启**了会话级扩展管理。
   *
   * 渠道默认关闭：必须由 owner 在渠道配置里显式打开，否则即便校验全部通过也
   * 不放行。个人会话天然为 `true`（沿用既有设置页 / 个人会话语义）。
   */
  readonly managementEnabled: boolean;
}

interface OriginRow {
  id: string;
  user_id: string;
  metadata_json: string;
  role_layer: string | null;
  team_parent_session_id: string | null;
}

/** 祖先链最大深度：正常派生不会再深，超过即视为异常并停止（防环）。 */
const MAX_ANCESTOR_DEPTH = 8;

const TEAM_ROLE_LAYERS = new Set(['pm1', 'pm2', 'executor', 'reviewer', 'reception']);

function readRow(sessionId: string): OriginRow | undefined {
  return sqliteGet<OriginRow>(
    `SELECT id, user_id, metadata_json, role_layer, team_parent_session_id
       FROM sessions WHERE id = ? LIMIT 1`,
    [sessionId],
  );
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 坏 metadata 不阻止来源判定：按「无 metadata」处理，交由 role_layer 兜底。
  }
  return {};
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** 读一层嵌套的可信字符串：`metadata[parent][child]`，父级不是对象时返回 null。 */
function readNestedString(
  record: Record<string, unknown>,
  parentKey: string,
  childKey: string,
): string | null {
  const parent = record[parentKey];
  if (typeof parent !== 'object' || parent === null || Array.isArray(parent)) return null;
  return readString(parent as Record<string, unknown>, childKey);
}

function isTeamRow(row: OriginRow, metadata: Record<string, unknown>): boolean {
  const roleLayer = typeof row.role_layer === 'string' ? row.role_layer.trim() : '';
  if (TEAM_ROLE_LAYERS.has(roleLayer)) return true;
  const teamParent = row.team_parent_session_id?.trim();
  if (teamParent && teamParent.length > 0) return true;
  if (typeof metadata['teamWorkspaceId'] === 'string') return true;
  const roleInstance = metadata['teamRoleInstance'];
  return typeof roleInstance === 'object' && roleInstance !== null;
}

function nextAncestor(row: OriginRow, metadata: Record<string, unknown>): string | null {
  const teamParent = row.team_parent_session_id?.trim();
  if (teamParent && teamParent.length > 0) return teamParent;
  return readString(metadata, 'parentSessionId');
}

/**
 * 解析会话的**可信来源**。
 *
 * 自底向上遍历祖先链，第一个命中 `channel` / `cron` / `team` 的会话即决定来源；
 * 全链都是个人会话时结果为 `web`。渠道身份（channelId / chatId / actorId）只从
 * 命中来源的那一层读取，避免子会话伪造渠道字段。
 */
export function resolveSessionExtensionOrigin(sessionId: string): SessionExtensionOrigin | null {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = sessionId;
  let ownerUserId: string | null = null;
  let fallbackChannelId: string | null = null;
  let fallbackChatId: string | null = null;
  let fallbackActorId: string | null = null;

  while (currentId && chain.length < MAX_ANCESTOR_DEPTH && !visited.has(currentId)) {
    visited.add(currentId);
    const row = readRow(currentId);
    if (!row) break;
    chain.push(currentId);
    ownerUserId ??= row.user_id;

    const metadata = parseMetadata(row.metadata_json);
    // 渠道身份由 `buildChannelSessionMetadata` 写在 `channel.id` 下（`channelChatId`
    // 才是顶层的）。此前只读顶层 `channelId`，导致 `origin.channelId` 恒为 null、
    // 操作记录的 `channel_id` 一直是空的——渠道身份只剩 chatId 一半。
    const channelId =
      readString(metadata, 'channelId') ?? readNestedString(metadata, 'channel', 'id');
    const chatId = readString(metadata, 'channelChatId') ?? readString(metadata, 'chatId');
    // 发言者身份同理：`buildChannelSessionMetadata` 把它写在 `channelActor.userId`
    // 下，顶层并没有 `channelActorId` / `actorId` 这两个键（此前只读顶层，导致
    // 操作记录的 `requester_actor_id` 恒为 null，规格要求的「原 requester」没落地）。
    // 没有网关用户身份时退回平台侧 id，至少能回答「是哪个群成员发起的」。
    const actorId =
      readString(metadata, 'channelActorId') ??
      readString(metadata, 'actorId') ??
      readNestedString(metadata, 'channelActor', 'userId') ??
      readNestedString(metadata, 'channelActor', 'platformUserId');

    if (metadata['source'] === 'channel') {
      return {
        sessionId,
        ownerUserId: ownerUserId ?? row.user_id,
        source: 'channel',
        channelId,
        chatId,
        actorId,
        originSessionId: currentId,
        ancestorChain: chain,
        // 渠道默认关闭；只有渠道配置显式打开才放行会话级扩展管理。
        managementEnabled: metadata['channelExtensionManagementEnabled'] === true,
      };
    }

    if (metadata['source'] === 'cron') {
      return {
        sessionId,
        ownerUserId: ownerUserId ?? row.user_id,
        source: 'cron',
        channelId: null,
        chatId: null,
        actorId: null,
        originSessionId: currentId,
        ancestorChain: chain,
        managementEnabled: false,
      };
    }

    if (isTeamRow(row, metadata)) {
      return {
        sessionId,
        ownerUserId: ownerUserId ?? row.user_id,
        source: 'team',
        channelId: null,
        chatId: null,
        actorId: null,
        originSessionId: currentId,
        ancestorChain: chain,
        managementEnabled: false,
      };
    }

    // 个人会话层：记住最近一层的渠道线索，供派生子会话未复制 metadata 时兜底。
    fallbackChannelId ??= channelId;
    fallbackChatId ??= chatId;
    fallbackActorId ??= actorId;
    currentId = nextAncestor(row, metadata);
  }

  if (!ownerUserId) {
    return null;
  }

  // 纯个人会话时链长为 1；链更长说明当前会话是某个个人会话的**派生**（task 子代理）。
  // `originSessionId` 必须取链尾，否则 `isDescendantSessionOrigin` 无从判断——这正是
  // 「子代理只读」规则生效的前提。
  const lastVisited = chain[chain.length - 1] ?? sessionId;
  return {
    sessionId,
    ownerUserId,
    source: 'web',
    channelId: fallbackChannelId,
    chatId: fallbackChatId,
    actorId: fallbackActorId,
    originSessionId: lastVisited,
    ancestorChain: chain,
    managementEnabled: true,
  };
}

/**
 * 当前会话是否**派生自**来源会话（即它是 `task` 子代理会话）。
 *
 * 用途：派生子会话只允许读取扩展状态，**不允许创建提案**。理由：
 *   - 子代理在后台运行且无人交互，「继续装一个」的语义会被父对话误读为已生效；
 *   - 子代理的上下文常含用户粘贴的文本，容易被当成新的安装指令；
 *   - 真正需要安装时，父会话（或用户在渠道里）自己提案即可，能力不缺。
 * 注意：这不影响读路径（list / 详情），排障与自我描述仍可用。
 */
export function isDescendantSessionOrigin(origin: SessionExtensionOrigin): boolean {
  return origin.sessionId !== origin.originSessionId;
}

/**
 * 管理类扩展变更的来源拒绝原因；`null` 表示允许进入正常门控。
 *
 * 与 `skill-admin-tools` / `mcp-admin-tools` 的既有守卫文案保持一致，但判定改成
 * **祖先链**版本——这是修复「派子代理绕过渠道限制」的关键。
 */
export function resolveSessionExtensionOriginDenial(
  origin: SessionExtensionOrigin | null,
): string | null {
  if (!origin) {
    return '当前会话不存在或无法解析，已拒绝扩展变更。';
  }
  switch (origin.source) {
    case 'team':
      return '团队会话不允许修改扩展配置，请回到个人会话操作。';
    case 'cron':
      return '定时任务会话无人审批，不允许修改扩展配置。';
    case 'channel':
      return '消息渠道会话不允许在此直接修改扩展配置，请通过确认流程操作。';
    case 'web':
      return null;
    default:
      return '当前会话来源不可识别，已拒绝扩展变更。';
  }
}

/**
 * 既有自助管理工具（`skill_manage` / `mcp_manage_servers` / `memory_manage` …）的
 * 祖先链守卫。
 *
 * 为什么单独一个函数而不是复用 `resolveSessionExtensionOriginDenial`：既有工具的
 * 拒绝文案已被回归测试锁定（例如「团队会话不允许修改技能安装，请回到个人会话操作。」），
 * 这里按主语拼装，保证文案逐字不变，**只把判定依据从「当前会话 metadata」换成
 * 「祖先链」**。这样修掉「派个子代理就绕过渠道限制」的洞，同时不破坏既有断言。
 */
export function resolveManageToolAncestorDenial(
  origin: SessionExtensionOrigin | null,
  labels: { subject: string; missingObject: string },
): string | null {
  if (!origin) {
    return `当前会话不存在或无法解析，已拒绝${labels.missingObject}。`;
  }
  switch (origin.source) {
    case 'team':
      return `团队会话不允许修改${labels.subject}，请回到个人会话操作。`;
    case 'cron':
      return `定时任务会话无人审批，不允许修改${labels.subject}。`;
    case 'channel':
      return `消息渠道会话不允许修改${labels.subject}，请在设置页或桌面端操作。`;
    case 'web':
      return null;
    default:
      return `当前会话来源不可识别，已拒绝${labels.missingObject}。`;
  }
}
