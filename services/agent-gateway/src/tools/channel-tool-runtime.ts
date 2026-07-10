import { defaultIgnoreManager } from '@openAwork/agent-core';
import { promises as fsp } from 'node:fs';
import { basename } from 'node:path';
import { channelFetch } from '../channels/channel-http.js';
import { channelManager } from '../channels/manager.js';
import type { ChannelMessage } from '../channels/types.js';
import { sqliteGet } from '../infra/db.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import {
  assertSessionWorkspacePath,
  ensureIgnoreRulesLoadedForPath,
} from '../workspace/workspace-safety.js';

interface ChannelSessionRow {
  readonly metadata_json: string;
  readonly title: string;
}

export interface ChannelContext {
  readonly chatId: string;
  readonly currentMessageId?: string;
  readonly pluginId: string;
  readonly pluginType?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCurrentChannelContext(sessionId: string): ChannelContext | null {
  const row = sqliteGet<ChannelSessionRow>(
    'SELECT metadata_json, title FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  const metadata = parseSessionMetadataJson(row?.metadata_json ?? '{}');
  const channel = isRecord(metadata['channel']) ? metadata['channel'] : null;
  const pluginId = typeof channel?.['id'] === 'string' ? channel['id'] : '';
  const pluginType = typeof channel?.['type'] === 'string' ? channel['type'] : undefined;
  const metadataChatId =
    typeof metadata['channelChatId'] === 'string' ? metadata['channelChatId'] : '';
  const currentMessageId =
    typeof metadata['channelMessageId'] === 'string' ? metadata['channelMessageId'] : '';
  const titlePrefix = pluginId ? `channel:${pluginId}:chat:` : '';
  const titleChatId =
    row?.title && titlePrefix && row.title.startsWith(titlePrefix)
      ? row.title.slice(titlePrefix.length)
      : '';
  const chatId = metadataChatId || titleChatId;
  if (metadata['source'] !== 'channel' || !pluginId || !chatId) {
    return null;
  }
  return {
    pluginId,
    chatId,
    ...(pluginType ? { pluginType } : {}),
    ...(currentMessageId ? { currentMessageId } : {}),
  };
}

export function assertChannelContext(
  sessionId: string,
  requested: { readonly chat_id?: string; readonly plugin_id?: string },
): ChannelContext {
  const current = readCurrentChannelContext(sessionId);
  if (!current) {
    throw new Error('Channel tools can only run inside a channel-managed session.');
  }
  if (requested.plugin_id && requested.plugin_id !== current.pluginId) {
    throw new Error('Requested plugin_id does not match the current channel session.');
  }
  if (requested.chat_id && requested.chat_id !== current.chatId) {
    throw new Error('Requested chat_id does not match the current channel session.');
  }
  return current;
}

export async function readChannelMedia(input: {
  readonly filePath: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
}): Promise<{ readonly buffer: Buffer; readonly fileName: string; readonly sourceUrl?: string }> {
  if (input.filePath.startsWith('http://') || input.filePath.startsWith('https://')) {
    const response = await channelFetch(input.filePath, {
      signal: input.signal,
      timeoutMs: 30_000,
    });
    if (!response.ok) {
      throw new Error(`Media download failed: HTTP ${response.status}`);
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      fileName: basename(new URL(input.filePath).pathname) || 'download.bin',
      sourceUrl: input.filePath,
    };
  }

  const safePath = assertSessionWorkspacePath({ path: input.filePath, sessionId: input.sessionId });
  await ensureIgnoreRulesLoadedForPath(safePath);
  if (defaultIgnoreManager.shouldIgnore(safePath)) {
    throw new Error(`Access denied: file "${safePath}" is protected by agentignore rules`);
  }
  return { buffer: await fsp.readFile(safePath), fileName: basename(safePath) };
}

export function serializeChannelMessages(
  messages: readonly ChannelMessage[],
  context?: ChannelContext,
): string {
  return JSON.stringify(
    messages.map((message) => ({
      id: message.id,
      ...(context ? { replyMessageId: buildChannelReplyReference(context, message.id) } : {}),
      senderId: message.senderId,
      senderName: message.senderName,
      chatId: message.chatId,
      content: message.content,
      timestamp: message.timestamp,
    })),
  );
}

export function buildChannelReplyReference(context: ChannelContext, messageId: string): string {
  switch (context.pluginType) {
    case 'telegram':
    case 'discord':
    case 'slack':
    case 'wecom':
    case 'whatsapp':
      if (messageId.includes(':')) {
        const currentChatPrefix = `${context.chatId}:`;
        if (!messageId.startsWith(currentChatPrefix)) {
          throw new Error('Reply message_id must belong to the current channel chat.');
        }
        return messageId;
      }
      return `${context.chatId}:${messageId}`;
    case 'qq':
      if (messageId.includes('|')) {
        const currentChatPrefix = `${context.chatId}|`;
        if (!messageId.startsWith(currentChatPrefix)) {
          throw new Error('Reply message_id must belong to the current channel chat.');
        }
        return messageId;
      }
      return `${context.chatId}|${messageId}`;
    case 'dingtalk':
    case 'feishu':
    case 'weixin':
    case undefined:
      return messageId;
    default:
      return messageId;
  }
}

export function requireChannelService(pluginId: string) {
  const service = channelManager.getService(pluginId);
  if (!service?.isRunning()) {
    throw new Error(`Channel service "${pluginId}" is not running.`);
  }
  return service;
}
