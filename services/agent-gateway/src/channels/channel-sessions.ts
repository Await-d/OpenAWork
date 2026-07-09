import type { Message } from '@openAwork/shared';
import {
  COMPACTION_SETTINGS_KEY,
  readCompactionSettings,
} from '../compaction/compaction-policy.js';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import {
  getCompactionProviderConfig,
  getProviderConfigForSelection,
} from '../provider/provider-config.js';
import { resolveCompactionRoute, type ModelRouteConfig } from '../provider/model-router.js';
import { executeSessionCompaction } from '../session/session-compaction.js';
import { buildChannelSessionKey, upsertChannelSession } from './channel-session-store.js';
import type { ChannelInstance } from './types.js';

interface SessionMetadataRow {
  readonly metadata_json: string;
}

interface ChannelSessionCommandContext {
  readonly channel: ChannelInstance;
  readonly chatId: string;
}

export interface ChannelSessionCommandResult {
  readonly content: string;
}

function parseStoredJson<T>(value: string | undefined): T | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

async function resolveCompactCommandRoute(userId: string): Promise<ModelRouteConfig | null> {
  const providerRow = sqliteGet<{ readonly value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<{ readonly value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );

  const providers = parseStoredJson(providerRow?.value);
  const activeSelection = parseStoredJson(selectionRow?.value);
  const compactionConfig = await getCompactionProviderConfig(providers, activeSelection);
  if (compactionConfig) {
    return resolveCompactionRoute(compactionConfig.provider, compactionConfig.modelId);
  }

  const chatConfig = await getProviderConfigForSelection(providers, activeSelection);
  return chatConfig ? resolveCompactionRoute(chatConfig.provider, chatConfig.modelId) : null;
}

function readSessionMetadata(sessionId: string, userId: string): string {
  return (
    sqliteGet<SessionMetadataRow>(
      'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
      [sessionId, userId],
    )?.metadata_json ?? '{}'
  );
}

function readChannelMessages(input: ChannelSessionCommandContext): Message[] {
  if (!input.channel.ownerUserId) {
    return [];
  }

  const sessionId = upsertChannelSession({
    chatId: input.chatId,
    channel: input.channel,
    sessionKey: buildChannelSessionKey(input.channel.id, input.chatId),
    userId: input.channel.ownerUserId,
  });
  return listSessionMessagesV2({ sessionId, userId: input.channel.ownerUserId });
}

export function resetChannelConversation(
  input: ChannelSessionCommandContext,
): ChannelSessionCommandResult {
  if (!input.channel.ownerUserId) {
    return { content: 'No channel owner is available for this conversation.' };
  }

  const sessionId = upsertChannelSession({
    chatId: input.chatId,
    channel: input.channel,
    sessionKey: buildChannelSessionKey(input.channel.id, input.chatId),
    userId: input.channel.ownerUserId,
  });
  sqliteRun('DELETE FROM part_v2 WHERE session_id = ? AND user_id = ?', [
    sessionId,
    input.channel.ownerUserId,
  ]);
  sqliteRun('DELETE FROM message_v2 WHERE session_id = ? AND user_id = ?', [
    sessionId,
    input.channel.ownerUserId,
  ]);
  sqliteRun(
    "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [sessionId, input.channel.ownerUserId],
  );
  return { content: 'Session cleared. Starting fresh.' };
}

function formatNumber(value: number): string {
  if (value < 1_000) {
    return String(value);
  }
  if (value < 1_000_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function getChannelUsageStats(
  input: ChannelSessionCommandContext,
): ChannelSessionCommandResult {
  const messages = readChannelMessages(input);
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  const usage = assistantMessages.reduce(
    (acc, message) => {
      const providerUsage = message.providerUsage;
      return {
        inputTokens: acc.inputTokens + (providerUsage?.inputTokens ?? 0),
        outputTokens: acc.outputTokens + (providerUsage?.outputTokens ?? 0),
        reasoningTokens: acc.reasoningTokens + (providerUsage?.reasoningTokens ?? 0),
        cacheReadTokens: acc.cacheReadTokens + (providerUsage?.cacheReadTokens ?? 0),
        cacheWriteTokens: acc.cacheWriteTokens + (providerUsage?.cacheWriteTokens ?? 0),
      };
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  );
  const totalTokens = usage.inputTokens + usage.outputTokens;
  if (totalTokens === 0) {
    return { content: 'No token usage data available.' };
  }

  return {
    content: [
      'Usage statistics',
      `Total: ${formatNumber(totalTokens)} tokens`,
      `Input: ${formatNumber(usage.inputTokens)}`,
      `Output: ${formatNumber(usage.outputTokens)}`,
      `Reasoning: ${formatNumber(usage.reasoningTokens)}`,
      `Cache read: ${formatNumber(usage.cacheReadTokens)}`,
      `Cache write: ${formatNumber(usage.cacheWriteTokens)}`,
      `Assistant replies: ${assistantMessages.length}`,
    ].join('\n'),
  };
}

export async function compactChannelConversation(
  input: ChannelSessionCommandContext,
): Promise<ChannelSessionCommandResult> {
  if (!input.channel.ownerUserId) {
    return { content: 'No channel owner is available for this conversation.' };
  }

  const userId = input.channel.ownerUserId;
  const sessionId = upsertChannelSession({
    chatId: input.chatId,
    channel: input.channel,
    sessionKey: buildChannelSessionKey(input.channel.id, input.chatId),
    userId,
  });
  const messages = listSessionMessagesV2({ sessionId, userId });
  if (messages.length < 6) {
    return { content: 'Too few messages to compress.' };
  }

  const compactionSettingsRow = sqliteGet<{ readonly value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [userId, COMPACTION_SETTINGS_KEY],
  );
  const compactionSettings = readCompactionSettings(parseStoredJson(compactionSettingsRow?.value));
  const compaction = await executeSessionCompaction({
    metadataJson: readSessionMetadata(sessionId, userId),
    messages,
    prune: compactionSettings.prune,
    recentMessagesKept: compactionSettings.recentMessagesKept,
    route: await resolveCompactCommandRoute(userId),
    sessionId,
    trigger: 'manual',
    userId,
  });
  const compactedCount = compaction.durableSummary?.newlySummarizedMessages ?? 0;
  if (compactedCount === 0) {
    return { content: 'Context is already compact.' };
  }

  return { content: `Context compressed. Cleaned ${compactedCount} messages.` };
}
