import type { Message } from '@openAwork/shared';
import {
  COMPACTION_SETTINGS_KEY,
  readCompactionSettings,
} from '../compaction/compaction-policy.js';
import { sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import {
  getCompactionProviderConfig,
  getProviderConfigForSelection,
} from '../provider/provider-config.js';
import { resolveCompactionRoute, type ModelRouteConfig } from '../provider/model-router.js';
import { executeSessionCompaction } from '../session/session-compaction.js';
import {
  buildAlreadyCompactMessage,
  buildContextCompressedMessage,
  buildNoChannelOwnerMessage,
  buildNoTokenUsageDataMessage,
  buildResetConversationMessage,
  buildTooFewMessagesToCompressMessage,
  buildUsageStatisticsMessage,
} from './channel-localization.js';
import { normalizeChannelReplyLanguage } from './channel-reply-language.js';
import { buildChannelSessionKey, upsertChannelSession } from './channel-session-store.js';
import { deleteSessionMessageSearchDocumentsForSession } from '../session/session-search-store.js';
import type { ChannelInstance, ChannelReplyLanguage } from './types.js';

interface SessionMetadataRow {
  readonly metadata_json: string;
}

interface ChannelSessionCommandContext {
  readonly channel: ChannelInstance;
  readonly chatId: string;
  readonly replyLanguage?: ChannelReplyLanguage;
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
  if (!providers) {
    return null;
  }
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
  const language = resolveReplyLanguage(input);
  if (!input.channel.ownerUserId) {
    return { content: buildNoChannelOwnerMessage(language) };
  }

  const sessionId = upsertChannelSession({
    chatId: input.chatId,
    channel: input.channel,
    sessionKey: buildChannelSessionKey(input.channel.id, input.chatId),
    userId: input.channel.ownerUserId,
  });
  // 四条写操作必须原子：中途失败会留下「消息已删但搜索索引还在」这类
  // 不可见的不一致（reset 没有后续补偿路径）。
  sqliteTransaction(() => {
    sqliteRun('DELETE FROM part_v2 WHERE session_id = ? AND user_id = ?', [
      sessionId,
      input.channel.ownerUserId,
    ]);
    sqliteRun('DELETE FROM message_v2 WHERE session_id = ? AND user_id = ?', [
      sessionId,
      input.channel.ownerUserId,
    ]);
    // `/reset` 清的是会话内容，但 event_log 没有指向 sessions 的外键，
    // 不显式删就会把每次 reset 前的全量事件（含 part 快照里的 base64 图片）
    // 永久留在库里，只靠全局 50k 行配额回收。`event_sequences` 刻意保留：
    // `allocateNextSeq` 以它为游标，删掉会让重置后的 seq 回退。
    //
    // `session_entry`（typed 事件流）**刻意不删**：它的 seq 由
    // `MAX(seq) + 1` 现算（`session-entry-store.ts` 的 `nextSeq`），删行会让
    // seq 从 1 重新开始，而重连补齐按 `seq > afterSeq` 过滤——持有旧游标的
    // 客户端将永远看不到 reset 之后的流式事件。它的行随会话最终删除时由
    // FK 级联清理，不构成泄漏。
    sqliteRun('DELETE FROM event_log WHERE aggregate_id = ?', [sessionId]);
    // 搜索索引（FTS5 虚拟表）没有触发器同步，删除消息必须显式清，
    // 否则 reset 之后仍能搜到已删内容。
    deleteSessionMessageSearchDocumentsForSession(sessionId);
    sqliteRun(
      "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [sessionId, input.channel.ownerUserId],
    );
  });
  return { content: buildResetConversationMessage(language) };
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
  const language = resolveReplyLanguage(input);
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
    return { content: buildNoTokenUsageDataMessage(language) };
  }

  return {
    content: buildUsageStatisticsMessage({
      assistantReplies: assistantMessages.length,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      formatNumber,
      inputTokens: usage.inputTokens,
      language,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: `${formatNumber(totalTokens)} tokens`,
    }),
  };
}

export async function compactChannelConversation(
  input: ChannelSessionCommandContext,
): Promise<ChannelSessionCommandResult> {
  const language = resolveReplyLanguage(input);
  if (!input.channel.ownerUserId) {
    return { content: buildNoChannelOwnerMessage(language) };
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
    return { content: buildTooFewMessagesToCompressMessage(language) };
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
    return { content: buildAlreadyCompactMessage(language) };
  }

  return { content: buildContextCompressedMessage(language, compactedCount) };
}

function resolveReplyLanguage(input: ChannelSessionCommandContext): ChannelReplyLanguage {
  return normalizeChannelReplyLanguage(input.replyLanguage ?? input.channel.replyLanguage);
}
