import { randomUUID } from 'node:crypto';
import { listResourceCatalog } from '@openAwork/resources/node';
import type { ResourceTextDescriptor } from '@openAwork/resources/node';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { resolveChannelLlmToolsEnabled } from './channel-tool-gate.js';
import { normalizeChannelPromptInjections } from './channel-prompt-injections.js';
import { normalizeChannelReplyLanguage } from './channel-reply-language.js';
import type { ChannelInstance } from './types.js';

interface ReusableSessionRow {
  readonly id: string;
  readonly metadata_json: string;
}

export interface ChannelSessionActorContext {
  readonly aclConfigured: boolean;
  readonly matched: boolean;
  readonly permissions: {
    readonly allowReadHome: boolean;
    readonly readablePathPrefixes: readonly string[];
    readonly allowWriteOutside: boolean;
    readonly allowShell: boolean;
    readonly allowSubAgents: boolean;
  };
  readonly platformUserId: string;
  readonly senderName: string;
  readonly toolAllowlist: readonly string[] | null;
  readonly userId?: string;
  readonly workspaceId?: string;
}

interface BuildChannelSessionMetadataInput {
  readonly actor?: ChannelSessionActorContext;
  readonly channel: ChannelInstance;
  readonly chatId: string;
  readonly currentMessageId?: string;
  readonly currentMetadata?: Record<string, unknown>;
  readonly userId: string;
}

export function buildChannelSessionKey(pluginId: string, chatId: string): string {
  return `channel:${pluginId}:chat:${chatId}`;
}

function readStoredChannelToolAllowlist(
  metadata: Record<string, unknown>,
): readonly string[] | null | undefined {
  const value = metadata['channelToolAllowlist'];
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function isAllowlistEnabledForTool(
  toolAllowlist: readonly string[] | null | undefined,
  toolKey: string,
): boolean {
  if (!toolAllowlist) {
    return true;
  }

  return (
    toolAllowlist.includes('*') || toolAllowlist.includes('all') || toolAllowlist.includes(toolKey)
  );
}

export function buildChannelSessionMetadata(
  input: BuildChannelSessionMetadataInput,
): Record<string, unknown> {
  const currentMetadata = input.currentMetadata ?? {};
  const persona = resolveChannelPersona(input.channel, input.userId);
  const channelLlmToolsEnabled = resolveChannelLlmToolsEnabled({
    explicit: input.channel.channelLlmToolsEnabled,
    tools: input.channel.tools,
    fallback: currentMetadata['channelLlmToolsEnabled'] === true,
  });
  const promptInjections = normalizeChannelPromptInjections(input.channel.promptInjections);
  const toolAllowlist = input.actor
    ? input.actor.toolAllowlist
    : readStoredChannelToolAllowlist(currentMetadata);
  const nextMetadata: Record<string, unknown> = {
    ...currentMetadata,
    source: 'channel',
    channelChatId: input.chatId,
    ...(input.currentMessageId ? { channelMessageId: input.currentMessageId } : {}),
    webSearchEnabled:
      input.channel.tools?.['web_search'] === true &&
      isAllowlistEnabledForTool(toolAllowlist, 'web_search'),
    taskToolEnabled:
      input.channel.tools?.['task'] === true &&
      isAllowlistEnabledForTool(toolAllowlist, 'task') &&
      (input.channel.permissions?.allowSubAgents ?? true),
    questionToolEnabled: false,
    replyLanguage: normalizeChannelReplyLanguage(input.channel.replyLanguage),
    channelLlmToolsEnabled,
    channel: {
      id: input.channel.id,
      type: input.channel.type,
      name: input.channel.name,
      replyLanguage: normalizeChannelReplyLanguage(input.channel.replyLanguage),
      providerId: input.channel.providerId ?? null,
      model: input.channel.model ?? null,
      permissions: input.channel.permissions ?? null,
      persona: persona
        ? {
            resourceId: persona.resourceId,
            title: persona.title,
          }
        : null,
      promptInjections,
      channelLlmToolsEnabled,
      tools: input.channel.tools ?? {},
    },
  };

  if (persona) {
    nextMetadata['channelPersona'] = persona;
  } else {
    delete nextMetadata['channelPersona'];
  }

  if (toolAllowlist !== undefined) {
    nextMetadata['channelToolAllowlist'] = toolAllowlist;
  } else {
    delete nextMetadata['channelToolAllowlist'];
  }

  if (input.actor) {
    nextMetadata['channelActor'] = {
      aclConfigured: input.actor.aclConfigured,
      matched: input.actor.matched,
      permissions: input.actor.permissions,
      platformUserId: input.actor.platformUserId,
      senderName: input.actor.senderName,
      ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
      ...(input.actor.userId ? { userId: input.actor.userId } : {}),
    };
  } else if (!currentMetadata['channelActor']) {
    delete nextMetadata['channelActor'];
  }

  if (input.channel.providerId) {
    nextMetadata['providerId'] = input.channel.providerId;
  } else {
    delete nextMetadata['providerId'];
  }

  if (input.channel.model) {
    nextMetadata['modelId'] = input.channel.model;
  } else {
    delete nextMetadata['modelId'];
  }

  return nextMetadata;
}

function resolveChannelPersona(
  channel: ChannelInstance,
  userId: string,
): { readonly resourceId: string; readonly title: string; readonly content: string } | null {
  const resourceId = channel.persona?.resourceId;
  if (!resourceId) {
    return null;
  }

  const persona = listResourceCatalog().souls.find(
    (soul: ResourceTextDescriptor) =>
      soul.id === resourceId &&
      soul.visibility === 'feature' &&
      soul.feature === 'channels' &&
      soul.usageKind === 'channel-persona',
  );
  if (!persona) {
    const userPersona = sqliteGet<{
      readonly id: string;
      readonly title: string;
      readonly content: string;
    }>(
      `SELECT id, title, content
       FROM user_resources
       WHERE id = ? AND user_id = ? AND area = 'souls'
       LIMIT 1`,
      [resourceId, userId],
    );
    return userPersona
      ? {
          resourceId: userPersona.id,
          title: userPersona.title,
          content: userPersona.content,
        }
      : null;
  }

  return {
    resourceId: persona.id,
    title: persona.title,
    content: persona.content,
  };
}

/**
 * 复用候选**优先**排除「上一轮失败」的会话。
 *
 * 失败路径会把 `state_status` 写回 `'idle'`（该列只描述「有没有在跑」的排队
 * 语义），所以 DB 层曾经无法区分「空闲」与「炸过」。`last_error` 补上这个区分后，
 * 优先挑健康的会话，避免下一条消息被塞进上下文带错误残骸的会话。
 *
 * 三级降级（顺序不可换）：
 *   1. 健康的 idle 会话 —— 正常路径。
 *   2. 健康的任意会话 —— 该会话正在跑，串行队列里排下一轮。
 *   3. **最近一条会话（即使失败）** —— 兜底。
 *
 * 第 3 级是刻意的：若把它也排除掉，频道持续故障（如 token 失效）时每条入站
 * 消息都会新建一条会话，几十条消息刷出几十个孤儿会话，用户侧历史彻底断裂 ——
 * 那比「复用一条带失败标记的会话」更糟。兜底复用保留 `last_error` 不清除，
 * 排障时仍看得到「这一轮又炸了」；真正跑通的那一轮由 `markChannelSessionHealthy`
 * 清标记，它随即重新成为首选。
 *
 * 谓词用 `= ''` 而非 `IS NULL`：该列默认 NULL，但历史行可能是空串，两者在
 * 「无错误」语义上等价，`COALESCE` 让两种情况都落到同一分支。
 */
const HEALTHY_SESSION_PREDICATE = "COALESCE(s.last_error, '') = ''";

function findReusableChannelSession(userId: string, sessionKey: string): ReusableSessionRow | null {
  const idleSession = sqliteGet<ReusableSessionRow>(
    `SELECT s.id, s.metadata_json
     FROM sessions s
     WHERE s.user_id = ? AND s.title = ? AND s.state_status = 'idle'
       AND ${HEALTHY_SESSION_PREDICATE}
     ORDER BY s.updated_at DESC
     LIMIT 1`,
    [userId, sessionKey],
  );
  if (idleSession) {
    return idleSession;
  }

  const healthySession = sqliteGet<ReusableSessionRow>(
    `SELECT s.id, s.metadata_json
     FROM sessions s
     WHERE s.user_id = ? AND s.title = ? AND ${HEALTHY_SESSION_PREDICATE}
     ORDER BY s.updated_at DESC
     LIMIT 1`,
    [userId, sessionKey],
  );
  if (healthySession) {
    return healthySession;
  }

  // 兜底：全都不健康时复用最近一条，宁可带着失败痕迹继续，也不要每条消息都
  // 新建会话把用户的历史冲垮。
  return (
    sqliteGet<ReusableSessionRow>(
      `SELECT s.id, s.metadata_json
       FROM sessions s
       WHERE s.user_id = ? AND s.title = ?
       ORDER BY s.updated_at DESC
       LIMIT 1`,
      [userId, sessionKey],
    ) ?? null
  );
}

export function upsertChannelSession(input: {
  readonly actor?: ChannelSessionActorContext;
  readonly chatId: string;
  readonly channel: ChannelInstance;
  readonly currentMessageId?: string;
  readonly sessionKey: string;
  readonly userId: string;
}): string {
  const existingSession = findReusableChannelSession(input.userId, input.sessionKey);
  const nextMetadata = buildChannelSessionMetadata({
    actor: input.actor,
    channel: input.channel,
    chatId: input.chatId,
    currentMessageId: input.currentMessageId,
    currentMetadata: parseSessionMetadataJson(existingSession?.metadata_json ?? '{}'),
    userId: input.userId,
  });

  if (existingSession) {
    // 刻意**不**在这里清 `last_error`：复用可能只是兜底路径（见
    // `findReusableChannelSession` 第 3 级降级），本轮还没跑、还不知道能不能好，
    // 提前抹掉会让「这一轮又炸了」在排查时消失。真正确认恢复的时刻是本轮跑通，
    // 由 `markChannelSessionHealthy` 清标记。
    sqliteRun(
      "UPDATE sessions SET title = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [input.sessionKey, JSON.stringify(nextMetadata), existingSession.id, input.userId],
    );
    return existingSession.id;
  }

  const sessionId = randomUUID();
  sqliteRun(
    'INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, input.userId, input.sessionKey, '[]', 'idle', JSON.stringify(nextMetadata)],
  );
  return sessionId;
}
