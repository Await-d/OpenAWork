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
  UpstreamStreamSummary,
} from '@openAwork/shared';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@openAwork/web-client';
import { formatGatewayStreamErrorMessage } from '../../../hooks/gateway/useGatewayClient.js';
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
  hasGatewayAdvancedRound,
  resolveNextRoundIndex,
  shouldStartNewRound,
} from './stream-round-boundary.js';
import { createRoundAssistantRequestId } from './round-request-id.js';
import {
  applyPermissionDecisionToLocalAssistantMessages,
  applyToolResultToLocalAssistantMessages,
  type ChatMessage,
  type ChatMessagePart,
  createAssistantTraceContent,
  dismissPermissionEventMessage,
  estimateTokenCount,
  hasActivePendingPermissionRequest,
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
  setLatestUpstreamSummary: React.Dispatch<React.SetStateAction<UpstreamStreamSummary | null>>;
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
  /**
   * Client request id that started this stream (the rid the gateway persists
   * against). When present, every committed round is stamped with the request
   * id the gateway stored for that same round: the raw rid for the final
   * (`end_turn`) round, `${rid}:assistant:${round}` for intermediate rounds
   * (see `round-request-id`). Omit / pass null when the consumer has no rid.
   */
  clientRequestId?: string | null;
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
  /** Optional hook called when a terminal upstream summary arrives. */
  onUpstreamSummary?: (summary: UpstreamStreamSummary) => void;
}

export interface ConversationStreamHandlers {
  /**
   * Wire one inbound RunEvent into the streaming state. Idempotent for the
   * same event id (gateway guarantees uniqueness per round).
   */
  handleEvent: (event: RunEvent) => void;
  /** Reset all streaming buffers and refs. Call between rounds. */
  resetRoundAccumulators: () => void;
  /**
   * Commit the current round into a finalized assistant message.
   *
   * `roundKind` selects the request id the gateway persisted for that round:
   * `'intermediate'` stamps `${clientRequestId}:assistant:${round}` (the round
   * ended with `tool_use`), `'final'` stamps the raw `clientRequestId`.
   */
  commitCurrentRound: (timestamp: number, roundKind: 'intermediate' | 'final') => void;
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
      /** tool result 的图片附件（`computer_use` 最终截图）。 */
      attachments?: InputImageContent[];
      toolCallId: string;
      status: 'streaming' | 'completed';
      toolName: string;
    }
  >;
  toolCallIds: Set<string>;
  /** Round currently being accumulated (1-based); see `stream-round-boundary`. */
  currentRoundIndex: number;
  /** Highest round the gateway reported as finished via `usage.round`. */
  lastCompletedRound: number | null;
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
    currentRoundIndex: 1,
    lastCompletedRound: null,
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
    acc.currentRoundIndex = 1;
    acc.lastCompletedRound = null;
    acc.startedAt = Date.now();
    setters.setStreamBuffer('');
    setters.setStreamThinkingBuffer('');
    setters.setStreamThinkingBlocks([]);
    setters.setStreamingSegments([]);
  }, [setters]);

  const commitCurrentRound = useCallback(
    (timestamp: number, roundKind: 'intermediate' | 'final') => {
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

      const rawClientRequestId = configRef.current.clientRequestId?.trim();
      const committedClientRequestId = rawClientRequestId
        ? roundKind === 'intermediate'
          ? createRoundAssistantRequestId(rawClientRequestId, acc.currentRoundIndex)
          : rawClientRequestId
        : undefined;

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
            ...(committedClientRequestId ? { clientRequestId: committedClientRequestId } : {}),
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
      acc.toolCallIds.clear();
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

  /**
   * Close the round that is currently accumulating when the gateway has moved
   * on (see `stream-round-boundary`). Must run *before* the next round's content
   * is appended, and never on the `usage` chunk itself — the tool results of the
   * round that just ended still arrive after that chunk.
   */
  const closeRoundIfGatewayAdvanced = useCallback(
    (options?: { gatewayOnly?: boolean }) => {
      const acc = accumulatorRef.current;
      const boundary = options?.gatewayOnly
        ? hasGatewayAdvancedRound({
            currentRoundIndex: acc.currentRoundIndex,
            lastCompletedRound: acc.lastCompletedRound,
          })
        : shouldStartNewRound({
            currentRoundIndex: acc.currentRoundIndex,
            lastCompletedRound: acc.lastCompletedRound,
            toolCalls: acc.liveToolCalls.values(),
          });
      if (!boundary) {
        return;
      }
      commitCurrentRound(Date.now(), 'intermediate');
      acc.currentRoundIndex = resolveNextRoundIndex({
        currentRoundIndex: acc.currentRoundIndex,
        lastCompletedRound: acc.lastCompletedRound,
      });
    },
    [commitCurrentRound],
  );

  const handleEvent = useCallback(
    (event: RunEvent) => {
      const acc = accumulatorRef.current;
      const closingMessageId = refs.currentAssistantStreamMessageIdRef.current;
      if (!closingMessageId) return;

      // ─── text_delta ───────────────────────────────────────────────
      if (event.type === 'text_delta') {
        observeFirstToken(event.occurredAt);
        // Text arriving after the gateway finished the previous round belongs to
        // the next model round (one persisted assistant message per round).
        // Without this the live view renders a `tool → text` bubble that the
        // persisted transcript later splits in two.
        closeRoundIfGatewayAdvanced();
        const textMessageId = refs.currentAssistantStreamMessageIdRef.current ?? closingMessageId;
        acc.text += event.delta;
        acc.segments = appendStreamingTextDelta(acc.segments, event.delta, textMessageId);
        setters.setStreamBuffer(acc.text);
        setters.setStreamingSegments(acc.segments);
        return;
      }

      // ─── thinking_start ───────────────────────────────────────────
      if (event.type === 'thinking_start') {
        observeFirstToken(event.occurredAt);
        closeRoundIfGatewayAdvanced();
        return;
      }

      // ─── thinking_delta ───────────────────────────────────────────
      if (event.type === 'thinking_delta') {
        observeFirstToken(event.occurredAt);
        // Mirror the `text_delta` boundary so streams that never emit an
        // explicit `thinking_start` (or attach replays) still split rounds the
        // same way the gateway does.
        closeRoundIfGatewayAdvanced();
        const thinkingMessageId =
          refs.currentAssistantStreamMessageIdRef.current ?? closingMessageId;
        const chunk = event as StreamThinkingChunk;
        acc.thinkingBlocks = appendStreamingThinkingChunk(acc.thinkingBlocks, chunk, {
          forceNewBlock: acc.segments[acc.segments.length - 1]?.type !== 'reasoning',
        });
        acc.segments = appendStreamingThinkingDelta(
          acc.segments,
          acc.reasoningMeta,
          chunk,
          thinkingMessageId,
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
        // A round may start with a bare tool call (chained tool use without text
        // or reasoning). Only the gateway signal is trusted here — parallel tool
        // calls of one round all stream before that round's `usage` chunk, while
        // the tool-result fallback would split a resumed round.
        closeRoundIfGatewayAdvanced({ gatewayOnly: true });
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
        // A `tool_result` that is still waiting for approval keeps the card in
        // the paused state; otherwise the part must leave `running`, so the live
        // team view does not show a spinner for a finished tool until refresh.
        const hasPendingPermission = hasActivePendingPermissionRequest(event);
        const previous = acc.liveToolCalls.get(event.toolCallId);
        acc.liveToolCalls.set(event.toolCallId, {
          createdAt: previous?.createdAt ?? Date.now(),
          inputText: previous?.inputText ?? '',
          output: event.output,
          isError: hasPendingPermission ? false : event.isError,
          resumedAfterApproval: event.resumedAfterApproval,
          // 附件只在本次 result 携带时覆盖；否则沿用上一次的。
          ...(event.attachments && event.attachments.length > 0
            ? { attachments: event.attachments }
            : previous?.attachments
              ? { attachments: previous.attachments }
              : {}),
          toolCallId: event.toolCallId,
          status: 'completed',
          toolName: event.toolName,
        });
        acc.segments = applyToolResultToStreamingSegment(acc.segments, {
          toolCallId: event.toolCallId,
          output: event.output,
          isError: hasPendingPermission ? false : event.isError,
          status: hasPendingPermission ? 'paused' : event.isError ? 'failed' : 'completed',
          ...(event.attachments && event.attachments.length > 0
            ? { attachments: event.attachments }
            : {}),
          ...(hasPendingPermission && event.pendingPermissionRequestId
            ? { pendingPermissionRequestId: event.pendingPermissionRequestId }
            : {}),
          ...(event.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
        });
        setters.setStreamingSegments(acc.segments);
        // Also reflect the tool result in any already-committed assistant
        // message (multi-round streams).
        setters.setMessages((prev) => applyToolResultToLocalAssistantMessages(prev, event));
        return;
      }

      // ─── usage ────────────────────────────────────────────────────
      if (event.type === 'usage') {
        // The gateway reports a round's index as soon as that round is over.
        // Record it only; the boundary itself is applied when the next round's
        // content arrives (this round's tool results still follow this chunk).
        acc.lastCompletedRound = Math.max(acc.lastCompletedRound ?? 0, event.round);
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
        if (event.upstreamSummary) {
          setters.setLatestUpstreamSummary(event.upstreamSummary);
          configRef.current.onUpstreamSummary?.(event.upstreamSummary);
        }
        commitCurrentRound(Date.now(), 'final');
        configRef.current.onStreamDone?.(event.stopReason, event.cancellation, event.agentId);
        return;
      }

      // ─── error ────────────────────────────────────────────────────
      if (event.type === 'error') {
        if (event.upstreamSummary) {
          setters.setLatestUpstreamSummary(event.upstreamSummary);
          configRef.current.onUpstreamSummary?.(event.upstreamSummary);
        }
        setters.setStreamError(
          formatGatewayStreamErrorMessage(
            typeof event.code === 'string' ? event.code : 'STREAM_ERROR',
            event.message,
          ),
        );
        configRef.current.onStreamError?.(event.code, event.message);
        return;
      }

      // ─── chat-only events (terminal / dev / sub-agent / etc.) ────
      configRef.current.onChatOnlyEvent?.(event);
    },
    [refs, setters, observeFirstToken, commitCurrentRound, closeRoundIfGatewayAdvanced],
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
