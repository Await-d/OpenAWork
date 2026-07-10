import { randomUUID } from 'node:crypto';
import { listResourceCatalog } from '@openAwork/resources/node';
import type { ResourceTextDescriptor } from '@openAwork/resources/node';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { resolveChannelLlmToolsEnabled } from './channel-tool-gate.js';
import type { ChannelInstance } from './types.js';

interface ReusableSessionRow {
  readonly id: string;
  readonly metadata_json: string;
}

export function buildChannelSessionKey(pluginId: string, chatId: string): string {
  return `channel:${pluginId}:chat:${chatId}`;
}

export function buildChannelSessionMetadata(
  channel: ChannelInstance,
  chatId: string,
  userId: string,
  currentMetadata: Record<string, unknown> = {},
  currentMessageId?: string,
): Record<string, unknown> {
  const persona = resolveChannelPersona(channel, userId);
  const channelLlmToolsEnabled = resolveChannelLlmToolsEnabled({
    explicit: channel.channelLlmToolsEnabled,
    tools: channel.tools,
    fallback: currentMetadata['channelLlmToolsEnabled'] === true,
  });
  const nextMetadata: Record<string, unknown> = {
    ...currentMetadata,
    source: 'channel',
    channelChatId: chatId,
    ...(currentMessageId ? { channelMessageId: currentMessageId } : {}),
    webSearchEnabled: channel.tools?.['web_search'] === true,
    taskToolEnabled:
      channel.tools?.['task'] === true && (channel.permissions?.allowSubAgents ?? true),
    questionToolEnabled: false,
    channelLlmToolsEnabled,
    channel: {
      id: channel.id,
      type: channel.type,
      name: channel.name,
      providerId: channel.providerId ?? null,
      model: channel.model ?? null,
      permissions: channel.permissions ?? null,
      persona: persona
        ? {
            resourceId: persona.resourceId,
            title: persona.title,
          }
        : null,
      channelLlmToolsEnabled,
      tools: channel.tools ?? {},
    },
  };

  if (persona) {
    nextMetadata['channelPersona'] = persona;
  } else {
    delete nextMetadata['channelPersona'];
  }

  if (channel.providerId) {
    nextMetadata['providerId'] = channel.providerId;
  } else {
    delete nextMetadata['providerId'];
  }

  if (channel.model) {
    nextMetadata['modelId'] = channel.model;
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
  readonly chatId: string;
  readonly channel: ChannelInstance;
  readonly currentMessageId?: string;
  readonly sessionKey: string;
  readonly userId: string;
}): string {
  const existingSession = findReusableChannelSession(input.userId, input.sessionKey);
  const nextMetadata = buildChannelSessionMetadata(
    input.channel,
    input.chatId,
    input.userId,
    parseSessionMetadataJson(existingSession?.metadata_json ?? '{}'),
    input.currentMessageId,
  );

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
