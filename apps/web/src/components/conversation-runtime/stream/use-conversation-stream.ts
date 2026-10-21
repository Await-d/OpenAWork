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

import { useCallback, useEffect, useRef } from 'react';
import type {
  BatchSubToolProgress,
  InputImageContent,
  RunEvent,
  StreamThinkingChunk,
  StreamThinkingEndChunk,
  UpstreamStreamSummary,
} from '@openAwork/shared';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@openAwork/web-client';
import { formatGatewayStreamErrorMessage } from '../../../hooks/gateway/useGatewayClient.js';
import { isNonTerminalStreamErrorCode } from '../../../hooks/gateway/stream-error-classification.js';
import { writeRefCurrent } from '../../../utils/ref/ref-current.js';
import {
  createPendingPermissionRequestSnapshot,
  dedupePendingPermissionRequests,
} from '@openAwork/web-client';
import {
  appendStreamingTextDelta,
  appendStreamingThinkingDelta,
  applyToolProgressToStreamingSegment,
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
  /**
   * 本轮请求元信息（rid / provider / model / agent）。
   *
   * 走 refs 参数而不是 config 的取值函数：消费点在 SSE 事件回调里，必须读到「事件到达
   * 那一刻」的最新值；而在渲染期构造「读 ref 的 getter / 箭头函数」塞进配置对象，会被判为
   * "Handle get functions in ObjectExpression" 或 "Cannot access refs during render"，
   * 让整个 hook 静默退出优化。直接传 ref、与既有 `streamingRef` 同一模式则不受影响。
   */
  streamClientRequestIdRef: React.MutableRefObject<string | null>;
  requestProviderIdRef: React.MutableRefObject<string | undefined>;
  requestModelLabelRef: React.MutableRefObject<string | undefined>;
  requestAgentIdRef: React.MutableRefObject<string | undefined>;
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
      /** `tool_progress` 的实时快照（运行中的 bash / batch / computer_use）。 */
      batchProgress?: {
        subTools: BatchSubToolProgress[];
        completedCount: number;
        totalCount: number;
      };
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
  /**
   * 已投递事件的 `eventId`（网关按 `${runId}:evt:${seq}` 保证同一 run 内唯一）。
   *
   * 断线重连 / attach 会重放已展示过的 chunk，而本文件对 `text_delta` 是无条件
   * 累加、对 `tool_call_delta` 是无条件拼接入参——没有这道闸，重放会让正文与工具
   * 入参成倍损坏。轮次重置时一并清空，与流的新一轮对齐。
   */
  deliveredEventIds: Set<string>;
}

/**
 * 已投递事件的 `eventId` 上界。Set 只增不减，而多轮团队会话未必每轮都调
 * `resetRoundAccumulators`，长跑任务的 Set 会无界增长。超界时淘汰最旧的记录 ——
 * 重放窗口（断线重连 / attach 回补）远小于该上界，因此淘汰最旧项是安全的。
 */
const MAX_TRACKED_DELIVERY_IDS = 8192;

function rememberDeliveredEventId(deliveredEventIds: Set<string>, eventId: string): void {
  deliveredEventIds.add(eventId);
  if (deliveredEventIds.size > MAX_TRACKED_DELIVERY_IDS) {
    const oldest = deliveredEventIds.values().next();
    if (!oldest.done) {
      deliveredEventIds.delete(oldest.value);
    }
  }
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
    deliveredEventIds: new Set<string>(),
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
  // `refs.currentAssistantStreamMessageIdRef` 这种「以参数对象为根的成员访问」写
  // `.current` 时，编译器判不出它是 ref（类型来自 `ConversationStreamRefs` 接口），
  // 会当成「修改 props / 参数派生值」→ "Mutating component props or hook arguments"，
  // 整个 hook 退出优化。先取出成以 `Ref` 结尾的局部名（与 `props.pickerRef` 同一
  // 盲区，见 apps/web/AGENTS.md「ref 按名字推断」；in-repo 先例：
  // use-provider-catalog-actions.ts 解构出的 `providersRef`），**再**把赋值收进
  // 模块函数——仅解构不足以消除诊断（实测仍报同一诊断，见 utils/ref/ref-current.ts）。
  const {
    currentAssistantStreamMessageIdRef,
    requestAgentIdRef,
    requestModelLabelRef,
    requestProviderIdRef,
    streamClientRequestIdRef,
  } = refs;
  const accumulatorRef = useRef<RoundAccumulator>(makeAccumulator(config.requestStartedAt));
  const configRef = useRef(config);
  // 最新 config 的同步刻意放进 effect，而不是渲染期顶层赋值：渲染期写 ref 会被
  // React Compiler 判定为 "Cannot access refs during render" 并放弃优化本 hook。
  // configRef 只被 SSE/WS 的异步回调读取，effect 时序足够，不会读到过期值。
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const resetRoundAccumulators = useCallback(() => {
    const acc = accumulatorRef.current;
    acc.text = '';
    acc.thinkingText = '';
    acc.thinkingBlocks = [];
    acc.segments = [];
    acc.reasoningMeta.clear();
    acc.liveToolCalls.clear();
    acc.toolCallIds.clear();
    acc.deliveredEventIds.clear();
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
      const closingMessageId = currentAssistantStreamMessageIdRef.current;
      if (!closingMessageId) return;
      if (
        acc.liveToolCalls.size === 0 &&
        acc.thinkingText.trim().length === 0 &&
        acc.text.trim().length === 0
      ) {
        return;
      }

      const rawClientRequestId = streamClientRequestIdRef.current?.trim();
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
          input: {
            ...parseToolCallInputText(tc.inputText),
            ...(tc.batchProgress ? { _batchProgress: tc.batchProgress } : {}),
          },
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
            providerId: requestProviderIdRef.current,
            model: requestModelLabelRef.current,
            agentId: requestAgentIdRef.current,
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
      writeRefCurrent(currentAssistantStreamMessageIdRef, makeOrderedMessageId());
      setters.setStreamBuffer('');
      setters.setStreamThinkingBuffer('');
      setters.setStreamThinkingBlocks([]);
      setters.setStreamingSegments([]);
    },
    // deps 列具体字段而非整个 refs 对象：编译器要求 deps 能复现 memo 语义，
    // 传入的 ref 引用本身稳定，行为不变。
    // 补齐编译器推断出的依赖（本轮请求元信息的 ref，见 apps/web/AGENTS.md ②）。
    [
      currentAssistantStreamMessageIdRef,
      requestAgentIdRef,
      requestModelLabelRef,
      requestProviderIdRef,
      setters,
      streamClientRequestIdRef,
    ],
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
      const closingMessageId = currentAssistantStreamMessageIdRef.current;
      if (!closingMessageId) return;

      // 幂等闸：同一 `eventId` 只投递一次。缺 `eventId` 的事件无法构造稳定身份，
      // 照常处理（不回退到内容比较——正文 delta 允许合法重复）。
      const eventId = event.eventId;
      if (typeof eventId === 'string' && eventId.length > 0) {
        if (acc.deliveredEventIds.has(eventId)) {
          return;
        }
        rememberDeliveredEventId(acc.deliveredEventIds, eventId);
      }

      // ─── text_delta ───────────────────────────────────────────────
      if (event.type === 'text_delta') {
        observeFirstToken(event.occurredAt);
        // Text arriving after the gateway finished the previous round belongs to
        // the next model round (one persisted assistant message per round).
        // Without this the live view renders a `tool → text` bubble that the
        // persisted transcript later splits in two.
        closeRoundIfGatewayAdvanced();
        const textMessageId = currentAssistantStreamMessageIdRef.current ?? closingMessageId;
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
        const thinkingMessageId = currentAssistantStreamMessageIdRef.current ?? closingMessageId;
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

      // ─── tool_progress ────────────────────────────────────────────
      if (event.type === 'tool_progress') {
        const previous = acc.liveToolCalls.get(event.toolCallId);
        if (previous?.status === 'completed') {
          // 结果已结算（重放 / 乱序的迟到进度）不得把工具降级回 streaming。
          return;
        }
        acc.liveToolCalls.set(event.toolCallId, {
          createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
          inputText: previous?.inputText ?? '',
          output: previous?.output,
          isError: previous?.isError,
          resumedAfterApproval: previous?.resumedAfterApproval,
          ...(previous?.attachments ? { attachments: previous.attachments } : {}),
          batchProgress: {
            subTools: event.subTools,
            completedCount: event.completedCount,
            totalCount: event.totalCount,
          },
          toolCallId: event.toolCallId,
          status: 'streaming',
          toolName: event.toolName,
        });
        acc.segments = applyToolProgressToStreamingSegment(acc.segments, event);
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
        // 流内非终态错误（如上游丢弃一次入参畸形的工具调用）只表示「单次操作被
        // 放弃」，整条流仍在继续：不得升级成「流式失败」横幅——错误横幅是留给
        // 上游 / 网关级终态故障的。名单与传输层（useGatewayClient）、右侧面板状态
        // （chat-stream-state）共用同一份，避免多处各自硬编码而漂移。
        if (isNonTerminalStreamErrorCode(event.code)) {
          return;
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
    [
      currentAssistantStreamMessageIdRef,
      setters,
      observeFirstToken,
      commitCurrentRound,
      closeRoundIfGatewayAdvanced,
    ],
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
