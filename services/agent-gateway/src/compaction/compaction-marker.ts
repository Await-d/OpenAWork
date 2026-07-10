import { randomUUID } from 'node:crypto';
import type { Message, MessageContent } from '@openAwork/shared';
import type { PersistedCompactionMemory } from './compaction-metadata.js';

const DEFAULT_COMPACTION_MARKER_TYPE = 'compaction_marker';

interface CompactionMarkerCodecOptions {
  clientRequestPrefix?: string;
  markerType?: string;
  source: string;
}

export interface CompactionMarkerRecord {
  omittedMessages?: number;
  persistedMemory?: PersistedCompactionMemory | null;
  signature?: string;
  summary: string;
  /**
   * ID of the first message in the verbatim tail that the compaction
   * preserved. Subsequent compaction rounds use it to know exactly
   * where the prior summary stops, so they can re-summarize from
   * the same boundary instead of re-deriving it from message counts.
   * Mirrors opencode's `tail_start_id` on the compaction part.
   */
  tailStartMessageId?: string;
  trigger: string;
}

export function buildCompactionMarkerPayload(
  input: {
    omittedMessages?: number;
    persistedMemory?: unknown;
    signature?: string;
    summary: string;
    tailStartMessageId?: string;
    trigger: string;
  } & CompactionMarkerCodecOptions,
): { payload: Record<string, unknown>; clientRequestId: string; text: string } {
  const markerType = input.markerType ?? DEFAULT_COMPACTION_MARKER_TYPE;
  const clientRequestPrefix = input.clientRequestPrefix ?? 'compaction-marker';
  const payload = {
    source: input.source,
    type: markerType,
    payload: {
      summary: input.summary,
      trigger: input.trigger,
      ...(input.persistedMemory ? { persistedMemory: input.persistedMemory } : {}),
      ...(typeof input.signature === 'string' && input.signature.length > 0
        ? { signature: input.signature }
        : {}),
      ...(typeof input.omittedMessages === 'number'
        ? { omittedMessages: input.omittedMessages }
        : {}),
      ...(typeof input.tailStartMessageId === 'string' && input.tailStartMessageId.length > 0
        ? { tailStartMessageId: input.tailStartMessageId }
        : {}),
    },
  };

  return {
    payload,
    clientRequestId: `${clientRequestPrefix}:${input.signature ?? randomUUID()}`,
    text: JSON.stringify(payload),
  };
}

export function parseCompactionMarkerText(
  value: string,
  options: Pick<CompactionMarkerCodecOptions, 'source' | 'markerType'>,
): CompactionMarkerRecord | null {
  try {
    const markerType = options.markerType ?? DEFAULT_COMPACTION_MARKER_TYPE;
    const parsed = JSON.parse(value) as {
      source?: unknown;
      type?: unknown;
      payload?: Record<string, unknown>;
    };
    if (
      parsed.source !== options.source ||
      parsed.type !== markerType ||
      !parsed.payload ||
      typeof parsed.payload.summary !== 'string' ||
      typeof parsed.payload.trigger !== 'string'
    ) {
      return null;
    }

    return {
      summary: parsed.payload.summary,
      trigger: parsed.payload.trigger,
      ...(parsed.payload.persistedMemory && typeof parsed.payload.persistedMemory === 'object'
        ? { persistedMemory: parsed.payload.persistedMemory as PersistedCompactionMemory }
        : {}),
      ...(typeof parsed.payload.signature === 'string' && parsed.payload.signature.length > 0
        ? { signature: parsed.payload.signature }
        : {}),
      ...(typeof parsed.payload.omittedMessages === 'number'
        ? { omittedMessages: parsed.payload.omittedMessages }
        : {}),
      ...(typeof parsed.payload.tailStartMessageId === 'string' &&
      parsed.payload.tailStartMessageId.length > 0
        ? { tailStartMessageId: parsed.payload.tailStartMessageId }
        : {}),
    };
  } catch {
    return null;
  }
}

export function isCompactionMarkerMessageWithOptions(
  message: Message,
  options: Pick<CompactionMarkerCodecOptions, 'source' | 'markerType'>,
): boolean {
  return (
    message.role === 'assistant' &&
    message.content.length > 0 &&
    message.content.every(
      (content) =>
        content.type === 'text' && parseCompactionMarkerText(content.text, options) !== null,
    )
  );
}

export function readLatestCompactionMarkerWithOptions(
  messages: Message[],
  options: Pick<CompactionMarkerCodecOptions, 'source' | 'markerType'>,
): CompactionMarkerRecord | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !isCompactionMarkerMessageWithOptions(message, options)) {
      continue;
    }

    for (const content of message.content) {
      if (content.type !== 'text') {
        continue;
      }
      const marker = parseCompactionMarkerText(content.text, options);
      if (marker) {
        return marker;
      }
    }
  }

  return null;
}

export function buildCompactionMarkerContent(
  input: {
    omittedMessages?: number;
    persistedMemory?: unknown;
    signature?: string;
    summary: string;
    tailStartMessageId?: string;
    trigger: string;
  } & CompactionMarkerCodecOptions,
): { clientRequestId: string; content: MessageContent[] } {
  const built = buildCompactionMarkerPayload(input);
  return {
    clientRequestId: built.clientRequestId,
    content: [{ type: 'text', text: built.text }],
  };
}
