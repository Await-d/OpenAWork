import type { StreamThinkingChunk } from '@openAwork/shared';
import type { ChatMessagePart } from '../../../components/conversation-runtime/messages/support.js';
import {
  appendStreamingTextDelta,
  appendStreamingThinkingDelta,
} from '../../../components/conversation-runtime/stream/streaming-segments.js';
import {
  appendStreamingThinkingChunk,
  joinStreamingThinkingTexts,
} from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';

interface DeltaState {
  segments: ChatMessagePart[];
  thinkingBlocks: StreamingThinkingBlock[];
  thinking: string;
}

type PendingDelta =
  | { type: 'text'; delta: string; messageId: string }
  | {
      type: 'thinking';
      chunks: { chunk: StreamThinkingChunk; startedAt: number }[];
      messageId: string;
    };

/** Private wire buffer: published arrays/parts are never mutated. */
export function createStreamDeltaBatch() {
  let pending: PendingDelta[] = [];
  return {
    appendText(delta: string, messageId: string) {
      if (!delta) return;
      const last = pending[pending.length - 1];
      if (last?.type === 'text' && last.messageId === messageId) {
        last.delta += delta;
      } else {
        pending.push({ type: 'text', delta, messageId });
      }
    },
    appendThinking(chunk: StreamThinkingChunk, messageId: string) {
      if (!chunk.delta) return;
      const last = pending[pending.length - 1];
      if (
        last?.type === 'thinking' &&
        last.messageId === messageId &&
        last.chunks[0]?.chunk.itemId === chunk.itemId &&
        last.chunks[0]?.chunk.outputIndex === chunk.outputIndex &&
        last.chunks[0]?.chunk.summaryIndex === chunk.summaryIndex
      ) {
        last.chunks.push({ chunk: { ...chunk }, startedAt: Date.now() });
      } else {
        pending.push({
          type: 'thinking',
          chunks: [{ chunk: { ...chunk }, startedAt: Date.now() }],
          messageId,
        });
      }
    },
    drain(state: DeltaState, reasoningMeta: Map<string, { blockKey: string }>): DeltaState {
      if (pending.length === 0) return state;
      const batch = pending;
      pending = [];
      let { segments, thinkingBlocks, thinking } = state;
      let thinkingChanged = false;
      for (const entry of batch) {
        if (entry.type === 'text') {
          segments = appendStreamingTextDelta(segments, entry.delta, entry.messageId);
        } else {
          for (let index = 0; index < entry.chunks.length; index += 1) {
            const item = entry.chunks[index]!;
            let chunk = item.chunk;
            const lastSegment = segments[segments.length - 1];
            const lastBlock = thinkingBlocks[thinkingBlocks.length - 1];
            if (
              index > 0 &&
              lastSegment?.type === 'reasoning' &&
              lastBlock?.endedAt === undefined &&
              lastBlock?.key === reasoningMeta.get(lastSegment.id)?.blockKey
            ) {
              const remaining = entry.chunks.slice(index);
              chunk = {
                ...chunk,
                delta: remaining.map((item) => item.chunk.delta).join(''),
                occurredAt: remaining.find((item) => item.chunk.occurredAt !== undefined)?.chunk
                  .occurredAt,
              };
              index = entry.chunks.length;
            }
            thinkingBlocks = appendStreamingThinkingChunk(thinkingBlocks, chunk, {
              forceNewBlock: lastSegment?.type !== 'reasoning',
              now: () => item.startedAt,
            });
            segments = appendStreamingThinkingDelta(
              segments,
              reasoningMeta,
              chunk,
              entry.messageId,
            );
          }
          thinkingChanged = true;
        }
      }
      if (thinkingChanged) thinking = joinStreamingThinkingTexts(thinkingBlocks);
      return { segments, thinkingBlocks, thinking };
    },
  };
}
