import type { Message } from '@openAwork/shared';
import { callCompactionLlm } from './compaction-llm.js';
import {
  mergeCompactionMetadata,
  readLastCompactionLlmSummary,
  readPersistedCompactionMemory,
  type CompactionTrigger,
} from './compaction-metadata.js';
import { sqliteRun } from './db.js';
import type { ModelRouteConfig } from './model-router.js';
import {
  appendCompactionMarkerMessage,
  buildDurableCompactionSummary,
  buildPreparedUpstreamConversation,
  buildStructuredCompactionSummary,
  hasCompactionMarker,
  type DurableCompactionSummary,
} from './session-message-store.js';

export interface ExecuteSessionCompactionInput {
  legacyMessagesJson?: string;
  metadataJson: string;
  messages: Message[];
  prune?: boolean;
  route: ModelRouteConfig | null;
  sessionId: string;
  signal?: AbortSignal;
  trigger: CompactionTrigger;
  userId: string;
}

export interface ExecuteSessionCompactionResult {
  durableSummary: DurableCompactionSummary | null;
  llmErrorMessage?: string;
  llmSummary?: string;
  metadata: Record<string, unknown>;
  metadataJson: string;
  summary: string;
}

const PRUNED_TOOL_RESULT_PLACEHOLDER = '[Old tool result content cleared by compaction prune]';

export function pruneMessagesForCompaction(
  messages: Message[],
  options: { keepRecentToolResults?: number } = {},
): Message[] {
  const keepRecentToolResults = options.keepRecentToolResults ?? 2;
  const toolResultPositions: Array<{ contentIndex: number; messageIndex: number }> = [];

  messages.forEach((message, messageIndex) => {
    message.content.forEach((content, contentIndex) => {
      if (content.type === 'tool_result') {
        toolResultPositions.push({ messageIndex, contentIndex });
      }
    });
  });

  const keepStartIndex = Math.max(0, toolResultPositions.length - keepRecentToolResults);
  const keepKeys = new Set(
    toolResultPositions
      .slice(keepStartIndex)
      .map((item) => `${item.messageIndex}:${item.contentIndex}`),
  );

  return messages.map((message, messageIndex) => ({
    ...message,
    content: message.content.map((content, contentIndex) => {
      if (content.type !== 'tool_result') {
        return content;
      }

      if (keepKeys.has(`${messageIndex}:${contentIndex}`)) {
        return content;
      }

      return {
        ...content,
        output: PRUNED_TOOL_RESULT_PLACEHOLDER,
      };
    }),
  }));
}

export async function executeSessionCompaction(
  input: ExecuteSessionCompactionInput,
): Promise<ExecuteSessionCompactionResult> {
  const existingMemory = readPersistedCompactionMemory(input.metadataJson);
  const durableSummary = buildDurableCompactionSummary({
    existingMemory,
    messages: input.messages,
    recentMessagesKept: 0,
    trigger: input.trigger,
  });

  let llmSummary: string | undefined;
  let llmErrorMessage: string | undefined;
  if (input.route) {
    const prunedMessages =
      input.prune === false ? input.messages : pruneMessagesForCompaction(input.messages);
    const markerPresent = hasCompactionMarker(prunedMessages);
    const conversationMessages = buildPreparedUpstreamConversation(prunedMessages, {
      contextWindow: 1,
      ...(markerPresent
        ? {}
        : {
            llmCompactionSummary: readLastCompactionLlmSummary(input.metadataJson),
            persistedMemory: existingMemory,
          }),
    }).messages;
    try {
      const result = await callCompactionLlm({
        conversationMessages,
        route: input.route,
        signal: input.signal,
      });
      llmSummary = result.summary;
    } catch (error: unknown) {
      llmErrorMessage = error instanceof Error ? error.message : 'unknown compaction llm error';
    }
  }

  const summary =
    llmSummary ??
    durableSummary?.structuredSummary ??
    buildStructuredCompactionSummary({
      messages: input.messages,
      recentMessagesKept: 0,
      trigger: input.trigger,
    });

  const metadata = {
    ...mergeCompactionMetadata(input.metadataJson, {
      persistedMemory: durableSummary?.persistedMemory,
      summary,
      trigger: input.trigger,
      omittedMessages: durableSummary?.totalRepresentedMessages ?? input.messages.length,
      recentMessagesKept: 0,
      signature: durableSummary?.signature,
    }),
    lastCompactionLlmSummary: summary,
  };
  const metadataJson = JSON.stringify(metadata);

  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [metadataJson, input.sessionId, input.userId],
  );

  appendCompactionMarkerMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    legacyMessagesJson: input.legacyMessagesJson,
    persistedMemory: durableSummary?.persistedMemory,
    signature: durableSummary?.signature,
    summary,
    trigger: input.trigger,
    omittedMessages: durableSummary?.totalRepresentedMessages ?? input.messages.length,
  });

  return {
    durableSummary,
    ...(llmErrorMessage ? { llmErrorMessage } : {}),
    ...(llmSummary ? { llmSummary } : {}),
    metadata,
    metadataJson,
    summary,
  };
}
