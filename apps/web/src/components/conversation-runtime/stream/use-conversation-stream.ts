/**
 * useConversationStream · 共享流消费 hook
 *
 * 把 ChatPage `sendMessage` 中"通用"的那一段流式消费逻辑抽出来，让 chat 与
 * team 共享同一份消息累积/segments/reveal/usage/permission/question 状态机。
 *
 * **设计边界**：
 * - 这个 hook 只处理与 sessionId 寻址的 chat 协议事件（text_delta / thinking_*
 *   / tool_call_delta / tool_result / usage / done / error / permission_*
 *   / question_*）。
 * - chat 特有副作用（terminal / dev-server-detect / right-panel / sub-agent /
 *   audit_ref / task_update 等）通过 `onChatOnlyEvent` 钩子上抛，由消费方
 *   自己处理；本 hook 不感知。
 * - 与 `useSessionConversationState` 一一组合：调用方把 hook 暴露的 streaming
 *   state setters 直接传进来，不做二次缓存。
 *
 * 关联文档：`docs/chat-conversation-reuse-plan.md` v1.5（"C + 读侧合并"决策）
 */

import { useCallback, useRef } from 'react';
import type {
  InputImageContent,
  RunEvent,
  StreamThinkingChunk,
  StreamThinkingEndChunk,
} from '@openAwork/shared';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@openAwork/web-client';
import {
  createPendingPermissionRequestSnapshot,
  dedupePendingPermissionRequests,
} from '@openAwork/web-client';
import {
  appendStreamingTextDelta,
  appendStreamingThinkingDelta,
  applyToolResultToStreamingSegment,
  markStreamingReasoningSegmentEnded,
  upsertStreamingToolSegment,
} from './streaming-segments.js';
import {
  appendStreamingThinkingChunk,
  extractStreamingThinkingTexts,
  joinStreamingThinkingTexts,
  markStreamingThinkingChunkEnded,
  type StreamingThinkingBlock,
} from './streaming-thinking.js';
import { mergeChatBackendUsageSnapshot, type ChatBackendUsageSnapshot } from './stream-usage.js';
import {
  applyPermissionDecisionToLocalAssistantMessages,
  applyToolResultToLocalAssistantMessages,
  type ChatMessage,
  type ChatMessagePart,
  createAssistantTraceContent,
  dismissPermissionEventMessage,
  estimateTokenCount,
  parseToolCallInputText,
  partsFromAssistantTrace,
  replaceOrAppendStreamedAssistantMessage,
  upsertPermissionEventMessage,
} from '../messages/support.js';
import { makeOrderedMessageId } from '../messages/ordered-id.js';
import type { SessionStateStatus } from '../session/session-runtime.js';

/** Chat-only events that this hook does NOT handle directly. The consumer
 * (ChatPage / future chat owner) is expected to listen for them via
 * `onChatOnlyEvent`. */
export type ChatOnlyEventType =
  | 'tool_progress'
  | 'audit_ref'
  | 'task_update'
  | 'session_child'
  | 'compaction'
  | 'terminal_started'
  | 'terminal_output'
  | 'terminal_exited'
  | 'tool_search';

export interface ConversationStreamRefs {
  // Active assistant message id for the current round; used to align
  // streaming segments with the eventual committed message.
  currentAssistantStreamMessageIdRef: React.MutableRefObject<string | null>;
  streamingRef: React.MutableRefObject<boolean>;
  stoppingStreamRef: React.MutableRefObject<boolean>;
}

export interface ConversationStreamSetters {
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setStoppingStream: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamBuffer: React.Dispatch<React.SetStateAction<string>>;
  setStreamThinkingBuffer: React.Dispatch<React.SetStateAction<string>>;
  setStreamThinkingBlocks: React.Dispatch<React.SetStateAction<StreamingThinkingBlock[]>>;
  setStreamingSegments: React.Dispatch<React.SetStateAction<ChatMessagePart[]>>;
  setReportedStreamUsage: React.Dispatch<React.SetStateAction<ChatBackendUsageSnapshot | null>>;
  setStreamError: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveStreamStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setActiveStreamFirstTokenLatencyMs: React.Dispatch<React.SetStateAction<number | null>>;
  setSessionStateStatus: React.Dispatch<React.SetStateAction<SessionStateStatus | null>>;
  setPendingPermissions: React.Dispatch<React.SetStateAction<PendingPermissionRequest[]>>;
}

export interface ConversationStreamConfig {
  /** Identifier of the session this stream belongs to (for permission snapshots). */
  sessionId: string | null;
  /** Provider id used to render the assistant message metadata. */
  requestProviderId?: string;
  /** Model label used to render the assistant message metadata. */
  requestModelLabel?: string;
  /** Agent id attached to the round. */
  requestAgentId?: string;
  /** When the request originated (Date.now()) — used to compute latency. */
  requestStartedAt: number;
  /** When set, the consumer wants to receive every event (chat-only included). */
  onChatOnlyEvent?: (event: RunEvent) => void;
  /** Optional hook fired when the round's first token arrives (any kind). */
  onFirstToken?: (latencyMs: number) => void;
  /** Optional hook called once the stream is fully done (success/error/cancel). */
  onStreamDone?: (stopReason?: string, cancellation?: unknown, finalAgentId?: string) => void;
  /** Optional hook called when an error event arrives. */
  onStreamError?: (code: string, message?: string) => void;
}

export interface ConversationStreamHandlers {
  /**
   * Wire one inbound RunEvent into the streaming state. Idempotent for the
   * same event id (gateway guarantees uniqueness per round).
   */
  handleEvent: (event: RunEvent) => void;
  /** Reset all streaming buffers and refs. Call between rounds. */
  resetRoundAccumulators: () => void;
  /** Commit the current round into a finalized assistant message. */
  commitCurrentRound: (timestamp: number) => void;
  /** Snapshot of the current segments (read-only, for the caller). */
  getCurrentSegments: () => ChatMessagePart[];
  /** Snapshot of the current accumulated text. */
  getAccumulatedText: () => string;
}

interface RoundAccumulator {
  text: string;
  thinkingText: string;
  thinkingBlocks: StreamingThinkingBlock[];
  segments: ChatMessagePart[];
  reasoningMeta: Map<string, { blockKey: string }>;
  liveToolCalls: Map<
    string,
    {
      createdAt: number;
      inputText: string;
      output?: unknown;
      isError?: boolean;
      resumedAfterApproval?: boolean;
      toolCallId: string;
      status: 'streaming' | 'completed';
      toolName: string;
    }
  >;
  toolCallIds: Set<string>;
  startedAt: number;
  firstTokenObservedAt: number | null;
  firstTokenLatencyAttached: boolean;
}

function makeAccumulator(startedAt: number): RoundAccumulator {
  return {
    text: '',
    thinkingText: '',
    thinkingBlocks: [],
    segments: [],
    reasoningMeta: new Map(),
    liveToolCalls: new Map(),
    toolCallIds: new Set(),
    startedAt,
    firstTokenObservedAt: null,
    firstTokenLatencyAttached: false,
  };
}

/**
 * Build a streaming consumer state machine. Returns plain handlers; the
 * caller decides when to call `handleEvent` (e.g. inside an SSE/WS callback)
 * and when to commit the round (typically on `done` or before the next
 * `thinking_start` after a tool call).
 */
export function useConversationStream(
  refs: ConversationStreamRefs,
  setters: ConversationStreamSetters,
  config: ConversationStreamConfig,
): ConversationStreamHandlers {
  const accumulatorRef = useRef<RoundAccumulator>(makeAccumulator(config.requestStartedAt));
  const configRef = useRef(config);
  configRef.current = config;

  const resetRoundAccumulators = useCallback(() => {
    const acc = accumulatorRef.current;
    acc.text = '';
    acc.thinkingText = '';
    acc.thinkingBlocks = [];
    acc.segments = [];
    acc.reasoningMeta.clear();
    acc.liveToolCalls.clear();
    acc.toolCallIds.clear();
    acc.startedAt = Date.now();
    setters.setStreamBuffer('');
    setters.setStreamThinkingBuffer('');
    setters.setStreamThinkingBlocks([]);
    setters.setStreamingSegments([]);
  }, [setters]);

  const commitCurrentRound = useCallback(
    (timestamp: number) => {
      const acc = accumulatorRef.current;
      const closingMessageId = refs.currentAssistantStreamMessageIdRef.current;
      if (!closingMessageId) return;
      if (
        acc.liveToolCalls.size === 0 &&
        acc.thinkingText.trim().length === 0 &&
        acc.text.trim().length === 0
      ) {
        return;
      }

      const reasoningBlocks = acc.thinkingBlocks.map((b) => b.text);
      const reasoningBlocksTimings = acc.thinkingBlocks.map((b) => ({
        ...(b.startedAt !== undefined ? { startedAt: b.startedAt } : {}),
        ...(b.endedAt !== undefined ? { endedAt: b.endedAt } : {}),
      }));
      const toolCalls = Array.from(acc.liveToolCalls.values()).map((tc) => {
        const status: 'running' | 'paused' | 'completed' | 'failed' =
          tc.status === 'completed' ? 'completed' : tc.isError === true ? 'failed' : 'running';
        return {
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: parseToolCallInputText(tc.inputText),
          output: tc.output,
          isError: tc.isError,
          resumedAfterApproval: tc.resumedAfterApproval,
          createdAt: tc.createdAt,
          status,
        };
      });
      const content = createAssistantTraceContent({
        text: acc.text,
        reasoningBlocks,
        reasoningBlocksTimings,
        toolCalls,
        status: 'completed',
      } as Parameters<typeof createAssistantTraceContent>[0]);
      const fallbackParts = partsFromAssistantTrace(closingMessageId, {
        text: acc.text,
        reasoningBlocks,
        reasoningBlocksTimings,
        toolCalls,
      });
      const parts = acc.segments.length > 0 ? acc.segments : fallbackParts;
      const roundToolCallIds = new Set(acc.toolCallIds);

      const shouldAttachLatency =
        acc.firstTokenObservedAt !== null && !acc.firstTokenLatencyAttached;

      setters.setMessages((prev) =>
        replaceOrAppendStreamedAssistantMessage(
          prev,
          {
            id: closingMessageId,
            role: 'assistant',
            content,
            parts,
            createdAt: timestamp,
            durationMs: timestamp - acc.startedAt,
            tokenEstimate: estimateTokenCount(
              [acc.thinkingText, acc.text].filter((s) => s.trim().length > 0).join('\n\n'),
            ),
            toolCallCount: roundToolCallIds.size,
            providerId: configRef.current.requestProviderId,
            model: configRef.current.requestModelLabel,
            agentId: configRef.current.requestAgentId,
            ...(shouldAttachLatency && acc.firstTokenObservedAt !== null
              ? {
                  firstTokenLatencyMs:
                    acc.firstTokenObservedAt - configRef.current.requestStartedAt,
                }
              : {}),
            status: 'completed',
          },
          roundToolCallIds,
        ),
      );

      if (shouldAttachLatency) acc.firstTokenLatencyAttached = true;

      // Reset the round accumulators so the next round starts clean.
      acc.text = '';
      acc.thinkingText = '';
      acc.thinkingBlocks = [];
      acc.segments = [];
      acc.reasoningMeta.clear();
      acc.liveToolCalls.clear();
      acc.startedAt = timestamp;
      // Roll the streaming message id forward so the next round occupies its
      // own slot in the message list (mirrors gateway persistence ordering).
      refs.currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
      setters.setStreamBuffer('');
      setters.setStreamThinkingBuffer('');
      setters.setStreamThinkingBlocks([]);
      setters.setStreamingSegments([]);
    },
    [refs, setters],
  );

  const observeFirstToken = useCallback(
    (occurredAt: number | undefined) => {
      const acc = accumulatorRef.current;
      if (acc.firstTokenObservedAt !== null) return;
      const ts = occurredAt ?? Date.now();
      acc.firstTokenObservedAt = ts;
      const latency = ts - configRef.current.requestStartedAt;
      setters.setActiveStreamFirstTokenLatencyMs(latency);
      configRef.current.onFirstToken?.(latency);
    },
    [setters],
  );

  const handleEvent = useCallback(
    (event: RunEvent) => {
      const acc = accumulatorRef.current;
      const closingMessageId = refs.currentAssistantStreamMessageIdRef.current;
      if (!closingMessageId) return;

      // ─── text_delta ───────────────────────────────────────────────
      if (event.type === 'text_delta') {
        observeFirstToken(event.occurredAt);
        // If we got new text after a tool round already started, finalize the
        // current round into a message and start a new one — mirrors the
        // gateway's per-round persistence model.
        if (acc.liveToolCalls.size > 0 && acc.text.length === 0) {
          // Note: ChatPage commits the round on a fresh thinking_start *after*
          // any tool. For simplicity we mirror the same boundary on text
          // arriving after tools by deferring commit to the round's done
          // event (gateway also fires done at the end of each round).
        }
        acc.text += event.delta;
        acc.segments = appendStreamingTextDelta(acc.segments, event.delta, closingMessageId);
        setters.setStreamBuffer(acc.text);
        setters.setStreamingSegments(acc.segments);
        return;
      }

      // ─── thinking_start ───────────────────────────────────────────
      if (event.type === 'thinking_start') {
        observeFirstToken(event.occurredAt);
        // If a fresh thinking block arrives after a tool call, commit the
        // current round and roll the message id forward.
        if (acc.liveToolCalls.size > 0) {
          commitCurrentRound(Date.now());
        }
        return;
      }

      // ─── thinking_delta ───────────────────────────────────────────
      if (event.type === 'thinking_delta') {
        observeFirstToken(event.occurredAt);
        const chunk = event as StreamThinkingChunk;
        acc.thinkingBlocks = appendStreamingThinkingChunk(acc.thinkingBlocks, chunk);
        acc.segments = appendStreamingThinkingDelta(
          acc.segments,
          acc.reasoningMeta,
          chunk,
          closingMessageId,
        );
        acc.thinkingText = joinStreamingThinkingTexts(acc.thinkingBlocks);
        setters.setStreamThinkingBuffer(acc.thinkingText);
        setters.setStreamThinkingBlocks(acc.thinkingBlocks);
        setters.setStreamingSegments(acc.segments);
        return;
      }

      // ─── thinking_end ─────────────────────────────────────────────
      if (event.type === 'thinking_end') {
        const chunk = event as StreamThinkingEndChunk;
        acc.thinkingBlocks = markStreamingThinkingChunkEnded(acc.thinkingBlocks, chunk);
        acc.segments = markStreamingReasoningSegmentEnded(acc.segments, acc.reasoningMeta, chunk);
        setters.setStreamThinkingBlocks(acc.thinkingBlocks);
        setters.setStreamingSegments(acc.segments);
        const texts = extractStreamingThinkingTexts(acc.thinkingBlocks);
        setters.setStreamThinkingBuffer(texts.join('\n\n'));
        return;
      }

      // ─── tool_call_delta ──────────────────────────────────────────
      if (event.type === 'tool_call_delta') {
        observeFirstToken(event.occurredAt);
        acc.toolCallIds.add(event.toolCallId);
        const previous = acc.liveToolCalls.get(event.toolCallId);
        const nextInputText = `${previous?.inputText ?? ''}${event.inputDelta}`;
        acc.liveToolCalls.set(event.toolCallId, {
          createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
          inputText: nextInputText,
          output: previous?.output,
          isError: previous?.isError,
          resumedAfterApproval: previous?.resumedAfterApproval,
          toolCallId: event.toolCallId,
          status: 'streaming',
          toolName: event.toolName,
        });
        acc.segments = upsertStreamingToolSegment(acc.segments, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: parseToolCallInputText(nextInputText),
          status: 'running',
        });
        setters.setStreamingSegments(acc.segments);
        return;
      }

      // ─── tool_result ──────────────────────────────────────────────
      if (event.type === 'tool_result') {
        const previous = acc.liveToolCalls.get(event.toolCallId);
        acc.liveToolCalls.set(event.toolCallId, {
          createdAt: previous?.createdAt ?? Date.now(),
          inputText: previous?.inputText ?? '',
          output: event.output,
          isError: event.isError,
          resumedAfterApproval: event.resumedAfterApproval,
          toolCallId: event.toolCallId,
          status: 'completed',
          toolName: event.toolName,
        });
        acc.segments = applyToolResultToStreamingSegment(acc.segments, event);
        setters.setStreamingSegments(acc.segments);
        // Also reflect the tool result in any already-committed assistant
        // message (multi-round streams).
        setters.setMessages((prev) => applyToolResultToLocalAssistantMessages(prev, event));
        return;
      }

      // ─── usage ────────────────────────────────────────────────────
      if (event.type === 'usage') {
        setters.setReportedStreamUsage((prev) => mergeChatBackendUsageSnapshot(prev, event));
        return;
      }

      // ─── permission_asked ─────────────────────────────────────────
      if (event.type === 'permission_asked') {
        const sid = configRef.current.sessionId;
        setters.setSessionStateStatus('paused');
        setters.setMessages((prev) => upsertPermissionEventMessage(prev, event));
        if (sid) {
          setters.setPendingPermissions((prev) =>
            dedupePendingPermissionRequests([
              createPendingPermissionRequestSnapshot(event, sid),
              ...prev,
            ]),
          );
        }
        return;
      }

      // ─── permission_replied ───────────────────────────────────────
      if (event.type === 'permission_replied') {
        if (event.decision !== 'reject') {
          setters.setSessionStateStatus('running');
        }
        setters.setMessages((prev) =>
          dismissPermissionEventMessage(
            applyPermissionDecisionToLocalAssistantMessages(
              prev,
              event.requestId,
              event.decision,
              event.feedback,
            ),
            event.requestId,
          ),
        );
        setters.setPendingPermissions((prev) =>
          prev.filter((p) => p.requestId !== event.requestId),
        );
        return;
      }

      // ─── question_asked ───────────────────────────────────────────
      if (event.type === 'question_asked') {
        setters.setSessionStateStatus('paused');
        return;
      }

      // ─── question_replied ─────────────────────────────────────────
      if (event.type === 'question_replied') {
        setters.setSessionStateStatus(event.status === 'answered' ? 'running' : 'idle');
        return;
      }

      // ─── done ─────────────────────────────────────────────────────
      if (event.type === 'done') {
        commitCurrentRound(Date.now());
        configRef.current.onStreamDone?.(event.stopReason, event.cancellation, event.agentId);
        return;
      }

      // ─── error ────────────────────────────────────────────────────
      if (event.type === 'error') {
        setters.setStreamError(event.message ?? event.code ?? 'stream error');
        configRef.current.onStreamError?.(event.code, event.message);
        return;
      }

      // ─── chat-only events (terminal / dev / sub-agent / etc.) ────
      configRef.current.onChatOnlyEvent?.(event);
    },
    [refs, setters, observeFirstToken, commitCurrentRound],
  );

  const getCurrentSegments = useCallback(() => accumulatorRef.current.segments, []);
  const getAccumulatedText = useCallback(() => accumulatorRef.current.text, []);

  return {
    handleEvent,
    resetRoundAccumulators,
    commitCurrentRound,
    getCurrentSegments,
    getAccumulatedText,
  };
}
