import type { Message } from '@openAwork/shared';
import { sqliteRun, sqliteTransaction } from '../infra/db.js';
import {
  appendCompactionMarkerMessageV2 as appendCompactionMarkerMessage,
} from '../message/message-v2-adapter.js';
import { findToolPartByCallID, updatePart } from '../message/message-store-v2.js';
import type { ToolPart } from '../message/message-v2-schema.js';
import {
  mergeCompactionMetadata,
  readPersistedCompactionMemory,
} from './compaction-metadata.js';
import { buildDurableCompactionSummary } from '../session/session-message-store.js';
import { stringifyToolResultOutput } from '../tools/tool-result-contract.js';

export type AutomaticProjectionKind = 'reactive' | 'tool_output';

export interface PersistCompactionProjectionInput {
  readonly clientRequestId: string;
  readonly kind: AutomaticProjectionKind;
  readonly metadataJson: string;
  readonly originalMessages: Message[];
  readonly projectedMessages: Message[];
  readonly round: number;
  readonly sessionId: string;
  readonly userId: string;
  readonly droppedMessages?: Message[];
  readonly truncatedCount?: number;
}

export interface PersistCompactionProjectionResult {
  readonly metadataJson: string;
  readonly summary: string;
  readonly signature?: string;
  readonly projectedMessages: Message[];
}

function assertNever(value: never): never {
  throw new Error(`Unexpected tool state: ${JSON.stringify(value)}`);
}

function projectToolPartOutput(part: ToolPart, output: string): ToolPart | null {
  switch (part.state.status) {
    case 'completed':
      return { ...part, state: { ...part.state, output } };
    case 'error':
      return { ...part, state: { ...part.state, error: output } };
    case 'pending':
    case 'running':
      return null;
    default:
      return assertNever(part.state);
  }
}

function persistToolOutputProjection(input: {
  readonly messages: Message[];
  readonly sessionId: string;
  readonly userId: string;
}): number {
  const projectedCallIds = new Set<string>();
  let updatedCount = 0;
  for (const message of input.messages) {
    for (const content of message.content) {
      if (content.type !== 'tool_result' || projectedCallIds.has(content.toolCallId)) {
        continue;
      }
      projectedCallIds.add(content.toolCallId);
      const part = findToolPartByCallID({
        callID: content.toolCallId,
        sessionId: input.sessionId,
      });
      if (!part || part.type !== 'tool') {
        continue;
      }
      const updated = projectToolPartOutput(part, stringifyToolResultOutput(content.output));
      if (!updated) {
        continue;
      }
      updatePart({ sessionId: input.sessionId, userId: input.userId, part: updated });
      updatedCount += 1;
    }
  }
  return updatedCount;
}

export function persistCompactionProjection(
  input: PersistCompactionProjectionInput,
): PersistCompactionProjectionResult {
  const summaryMessages =
    input.kind === 'reactive'
      ? (input.droppedMessages ?? input.originalMessages.slice(0, -input.projectedMessages.length))
      : input.originalMessages;
  const durableSummary =
    summaryMessages.length > 0
      ? buildDurableCompactionSummary({
          existingMemory: readPersistedCompactionMemory(input.metadataJson),
          messages: summaryMessages,
          recentMessagesKept: input.projectedMessages.length,
          trigger: 'automatic',
        })
      : null;
  const summary =
    input.kind === 'reactive'
      ? (durableSummary?.structuredSummary ?? '上下文超限后已丢弃较早对话轮次。')
      : `上下文超限后已持久化 ${input.truncatedCount ?? 0} 个工具输出截断。`;
  const metadata = {
    ...mergeCompactionMetadata(input.metadataJson, {
      ...(durableSummary?.persistedMemory ? { persistedMemory: durableSummary.persistedMemory } : {}),
      omittedMessages: durableSummary?.totalRepresentedMessages ?? 0,
      recentMessagesKept: input.projectedMessages.length,
      ...(durableSummary?.signature ? { signature: durableSummary.signature } : {}),
      summary,
      trigger: 'automatic',
    }),
    lastCompactionLlmSummary: summary,
    lastCompactionSource: input.kind,
    consecutiveCompactionFailures: 0,
  };
  const metadataJson = JSON.stringify(metadata);

  sqliteTransaction(() => {
    if (input.kind === 'tool_output') {
      persistToolOutputProjection({
        messages: input.projectedMessages,
        sessionId: input.sessionId,
        userId: input.userId,
      });
    }
    sqliteRun(
      "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [metadataJson, input.sessionId, input.userId],
    );
    if (input.kind === 'reactive' && durableSummary) {
      const tailStartMessageId = input.projectedMessages[0]?.id;
      appendCompactionMarkerMessage({
        clientRequestId: `compaction-marker:${input.clientRequestId}:${input.round}:${durableSummary.signature}`,
        persistedMemory: durableSummary.persistedMemory,
        sessionId: input.sessionId,
        signature: durableSummary.signature,
        summary,
        trigger: 'automatic',
        omittedMessages: durableSummary.totalRepresentedMessages,
        userId: input.userId,
        ...(tailStartMessageId ? { tailStartMessageId } : {}),
      });
    }
  });

  return {
    metadataJson,
    projectedMessages: input.projectedMessages,
    summary,
    ...(durableSummary?.signature ? { signature: durableSummary.signature } : {}),
  };
}
