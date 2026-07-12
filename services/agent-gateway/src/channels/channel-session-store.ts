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

function findReusableChannelSession(userId: string, sessionKey: string): ReusableSessionRow | null {
  const idleSession = sqliteGet<ReusableSessionRow>(
    `SELECT id, metadata_json
     FROM sessions
     WHERE user_id = ? AND title = ? AND state_status = 'idle'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, sessionKey],
  );
  if (idleSession) {
    return idleSession;
  }

  return (
    sqliteGet<ReusableSessionRow>(
      `SELECT id, metadata_json
       FROM sessions
       WHERE user_id = ? AND title = ?
       ORDER BY updated_at DESC
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
