import type { RunEvent, RunEventEnvelope, StreamChunk, StreamDoneChunk } from '@openAwork/shared';

import {
  STREAM_CLIENT_ERROR_MESSAGES,
  createGatewayChunkDispatcher,
  formatGatewayStreamErrorMessage,
  isCancellationStreamCode,
  isNonTerminalStreamErrorCode,
  isRunEventEnvelope,
  readGatewayDeliveryIdentity,
} from './useGatewayClient.js';
import type { AttachStreamCloseAction } from './useGatewayClient.js';
import type {
  ActiveStreamSnapshot,
  AttachableActiveStream,
  AttachActiveStreamConnectionOptions,
  AttachActiveStreamSessionOptions,
  AttachEventSourceLike,
  StreamCallbacks,
} from './useGatewayClient.js';

export function classifyAttachStreamError(input: {
  opened: boolean;
  receivedEventCount: number;
  /**
   * 服务端是否在结束响应前显式发过 `attach-replay-end`。
   *
   * 该分支的语义是「流已终止，历史重放完毕，本次 attach 到此为止」——它一定是
   * 正常结束，哪怕重放出了若干条新事件。缺了这个判据，只要重放出过事件就会被判成
   * 断线，进而进入封顶 30s 的指数退避重连（表现为「自动重连中 · 约 Ns 后重试」）。
   */
  serverEndedCleanly?: boolean;
  stopRequested: boolean;
}): AttachStreamCloseAction {
  if (!input.opened) {
    return 'open_failed';
  }

  if (input.stopRequested) {
    return 'cancelled';
  }

  if (input.serverEndedCleanly === true) {
    return 'silent_close';
  }

  if (input.receivedEventCount === 0) {
    return 'silent_close';
  }

  return 'reconnect_required';
}

export function createGatewayEventSource(url: string): EventSource {
  if (typeof window !== 'undefined') {
    const maybeFactory = (
      window as typeof window & {
        __OPENAWORK_TEST_EVENT_SOURCE_FACTORY?: (url: string) => EventSource;
      }
    ).__OPENAWORK_TEST_EVENT_SOURCE_FACTORY;
    if (typeof maybeFactory === 'function') {
      return maybeFactory(url);
    }
  }

  return new EventSource(url);
}

export function safeParseGatewayEventData<T>(input: {
  rawData: string;
  onError: (code: string, message: string) => void;
  invalidCode: string;
  invalidMessage: string;
}): T | null {
  try {
    return JSON.parse(input.rawData) as T;
  } catch {
    input.onError(input.invalidCode, input.invalidMessage);
    return null;
  }
}

export function connectAttachEventSource(
  options: AttachActiveStreamConnectionOptions,
): Promise<boolean> {
  const {
    activeStream,
    callbacks,
    createEventSource = createGatewayEventSource,
    gatewayUrl,
    getCurrentActiveRequest,
    getCurrentEventSource,
    isStopRequested,
    requestedAfterSeq,
    sessionId,
    setCurrentEventSource,
    syncActiveRequest,
    token,
    clearCallbacks,
    resetStopRequested,
  } = options;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let opened = false;
    let openedAtMs = 0;
    /** 本次 attach 真正收到的有效事件数，用于区分「正常 EOF」与「传输中断」。 */
    let receivedEventCount = 0;
    /**
     * 服务端在「重放完毕」分支主动发过 `attach-replay-end`。
     *
     * EventSource 无法区分「服务端正常结束响应」与「网络断开」，两者都只触发
     * `onerror`。而「流已终止 → 重放历史 → 立即 EOF」是最常见的正常路径，若仅凭
     * 「收到过事件」就判断线，就会进入 800ms 起、封顶 30s 的指数退避重连（用户看到
     * 「自动重连中 · 约 25.6s 后重试」），而连接本身完全正常。这个信号把该路径
     * 明确标为正常结束。
     */
    let serverEndedCleanly = false;
    const deliveredEventIds = new Set<string>();

    const cleanup = (clearSnapshot: boolean, eventSource: AttachEventSourceLike) => {
      eventSource.close();
      if (getCurrentEventSource() === eventSource) {
        setCurrentEventSource(null);
      }
      clearCallbacks();
      resetStopRequested();
      if (clearSnapshot) {
        syncActiveRequest(null);
      }
    };

    const params = new URLSearchParams({
      afterSeq: String(requestedAfterSeq),
      clientRequestId: activeStream.clientRequestId,
      token,
    });
    const eventSource = createEventSource(
      `${gatewayUrl}/sessions/${sessionId}/stream/attach?${params.toString()}`,
    );
    setCurrentEventSource(eventSource);
    const handleChunk = createGatewayChunkDispatcher({
      callbacks,
      deliveredEventIds,
      isSettled: () => settled,
      onDoneChunk: (chunk) => {
        settled = true;
        cleanup(true, eventSource);
        callbacks.onEvent?.(chunk);
        callbacks.onDone(
          chunk.stopReason,
          chunk.agentId,
          chunk.cancellation,
          chunk.upstreamSummary,
        );
      },
      onErrorChunk: (chunk) => {
        // 与主链路（WS / SSE 回退）保持同一契约：流内非终态错误（如上游丢弃一次
        // 入参畸形的工具调用）只透传提示，不结算、不断连，让后续 delta / 工具调用 /
        // done 照常到达。按终态处理会立刻掐断 attach 传输，并把仍在后台执行的会话
        // 结算成「已结束 + 错误横幅」，用户只能靠刷新才看到后续内容。
        if (isNonTerminalStreamErrorCode(chunk.code)) {
          callbacks.onEvent?.(chunk);
          return;
        }
        settled = true;
        cleanup(true, eventSource);
        if (isCancellationStreamCode(chunk.code)) {
          const cancelledChunk: StreamDoneChunk = {
            type: 'done',
            stopReason: 'cancelled',
            ...(chunk.upstreamSummary ? { upstreamSummary: chunk.upstreamSummary } : {}),
          };
          callbacks.onEvent?.(cancelledChunk);
          callbacks.onDone('cancelled', undefined, undefined, chunk.upstreamSummary);
          return;
        }
        callbacks.onEvent?.(chunk);
        callbacks.onError(chunk.code, chunk.message, chunk.technicalDetail);
      },
    });

    eventSource.onopen = () => {
      opened = true;
      openedAtMs = Date.now();
      resolve(true);
    };

    // 具名事件：服务端「重放完毕、即将正常结束响应」的显式声明。
    // 兼容旧网关（不发该事件）与测试替身（可能未实现 addEventListener）。
    if (typeof eventSource.addEventListener === 'function') {
      eventSource.addEventListener('attach-replay-end', () => {
        serverEndedCleanly = true;
      });
    }

    eventSource.onmessage = (event) => {
      const parsed = safeParseGatewayEventData<RunEventEnvelope | StreamChunk | RunEvent>({
        rawData: event.data,
        invalidCode: 'ATTACH_STREAM_INVALID_PAYLOAD',
        invalidMessage: STREAM_CLIENT_ERROR_MESSAGES.attachInvalidPayload,
        onError: (code, message) => {
          settled = true;
          cleanup(false, eventSource);
          callbacks.onError(code, message);
        },
      });
      if (!parsed) {
        return;
      }
      if (isRunEventEnvelope(parsed)) {
        const cursorSeq = parsed.payload.cursor?.seq ?? parsed.seq;
        // `afterSeq` is an exclusive cursor. A reconnect can still deliver
        // the boundary row when the SSE subscription is established; do not
        // feed that row into the thinking/text accumulator a second time.
        //
        // 这里**必须先过滤再计数**：`receivedEventCount` 的唯一用途是让
        // `classifyAttachStreamError` 区分「服务端回放完毕正常 EOF」与「真实传输中断」。
        // 若把已被消费、因此原样丢弃的边界行也算进去，那么「游标已到末尾 → 网关立即
        // EOF」这种最常见的正常结束会被误判成断线，于是前端弹「自动重连中」并按退避
        // 无限重连——而连接本身完全正常。
        if (cursorSeq <= requestedAfterSeq) {
          return;
        }
        receivedEventCount += 1;
        const currentActiveRequest = getCurrentActiveRequest();
        if (currentActiveRequest?.clientRequestId === activeStream.clientRequestId) {
          syncActiveRequest({
            ...currentActiveRequest,
            lastSeq: Math.max(currentActiveRequest.lastSeq, cursorSeq),
            transport: 'attach-sse',
          });
        }
        // The envelope sequence is the stable identity for replayed events.
        // The nested event often has no eventId, so forwarding it unchanged
        // makes attach/reconnect deliver the same thinking/tool delta twice.
        // 复用主路径的同一套身份推导，避免两处实现漂移。
        const event = parsed.payload.event;
        const nestedIdentity =
          typeof event === 'object' && event !== null ? readGatewayDeliveryIdentity(event) : null;
        handleChunk(
          typeof event === 'object' && event !== null
            ? {
                ...event,
                eventId: nestedIdentity ?? `run-seq:${cursorSeq}`,
              }
            : event,
        );
        return;
      }
      // 裸chunk（无cursor）没有可过滤的游标，收到即视为有效投递。
      receivedEventCount += 1;
      handleChunk(parsed);
    };

    eventSource.onerror = () => {
      if (settled) {
        return;
      }
      const errorAction = classifyAttachStreamError({
        opened,
        receivedEventCount,
        // 服务端已声明「重放完毕的正常结束」：即便重放出过事件，也是正常 EOF，
        // 不能按断线处理（否则进入指数退避重连循环）。
        serverEndedCleanly,
        stopRequested: isStopRequested(),
      });
      if (errorAction === 'open_failed') {
        settled = true;
        cleanup(true, eventSource);
        resolve(false);
        return;
      }
      if (errorAction === 'cancelled') {
        settled = true;
        cleanup(true, eventSource);
        callbacks.onDone('cancelled');
        return;
      }

      const elapsedMs = openedAtMs === 0 ? 0 : Date.now() - openedAtMs;
      // 一次性诊断（不是每帧）：下次出现「老是断开」时，这几项能直接区分
      // 正常 EOF / 网关立即关闭 / 真实网络中断。
      console.warn('[ATTACH] stream closed', {
        action: errorAction,
        elapsedMs,
        gatewayUrl,
        opened,
        readyState: (eventSource as { readyState?: number }).readyState ?? null,
        receivedEventCount,
        sessionId,
      });

      settled = true;
      cleanup(false, eventSource);

      if (errorAction === 'silent_close') {
        // 打开后 0 事件：绝大多数是「服务端回放完毕立即结束」或校验失败后立即关闭。
        // 不报错、不弹红条，交给上层确认活跃流：仍活跃则重连，否则收敛到结束。
        if (callbacks.onReconnectRequired) {
          callbacks.onReconnectRequired('attach_stream_silent_close');
          return;
        }
        callbacks.onError(
          'ATTACH_STREAM_DISCONNECTED',
          '实时流连接已断开。',
          `SSE 打开后未收到任何事件即结束。Gateway：${gatewayUrl}；会话：${sessionId}。`,
        );
        return;
      }

      const detail = `连接在${opened ? '流式传输过程中' : '收到 SSE 响应前'}中断。Gateway：${gatewayUrl}；会话：${sessionId}。浏览器没有提供底层失败原因。`;
      if (callbacks.onReconnectRequired) {
        callbacks.onReconnectRequired('attach_stream_disconnected', detail);
        return;
      }
      callbacks.onError('ATTACH_STREAM_DISCONNECTED', '实时流连接已断开。', detail);
    };
  });
}

/**
 * attach 的终态契约。四种结果语义不同，调用方必须按状态分派：
 * - `attached`：已接上活跃流。
 * - `no_active_stream`：网关权威确认当前没有活跃流，是正常终态，不得触发重连提示。
 * - `stale`：归属已变化（会话已切换或更新的请求已接管），本次 attach 作废。
 * - `transport_failed`：真实的传输失败（查询活跃流异常 / SSE 打开失败），可走可见退避重试。
 */
export type AttachActiveStreamResult =
  | { status: 'attached' }
  | { status: 'no_active_stream' }
  | { status: 'stale' }
  | { status: 'transport_failed' };

export async function attachActiveStreamSession(
  options: AttachActiveStreamSessionOptions,
): Promise<AttachActiveStreamResult> {
  const {
    callbacks,
    clearCallbacks,
    closeExistingTransports,
    connectEventSource = connectAttachEventSource,
    gatewayUrl,
    getCurrentActiveRequest,
    getCurrentEventSource,
    isStopRequested,
    resetStopRequested,
    sessionId,
    sessionsClient,
    setCallbacks,
    setCurrentEventSource,
    syncActiveRequest,
    token,
  } = options;

  const existingSnapshot = getCurrentActiveRequest();
  let activeStream: AttachableActiveStream | null = null;
  try {
    activeStream = await sessionsClient.getActiveStream(token, sessionId);
  } catch {
    clearCallbacks();
    return { status: 'transport_failed' };
  }

  if (!activeStream) {
    // 网关已权威确认「没有活跃流」：陈旧快照必须无条件丢弃，否则
    // activeGatewayStreamSessionId 会一直指向当前会话，使 attach 判定永不进入终态。
    // `getCurrentActiveRequest() === existingSnapshot` 身份校验是竞态保护：若
    // getActiveStream 等待期间同一会话已由更新的 stream() 建立了新快照，则不能清除它。
    if (
      existingSnapshot?.sessionId === sessionId &&
      getCurrentActiveRequest() === existingSnapshot
    ) {
      syncActiveRequest(null);
    }
    clearCallbacks();
    return { status: 'no_active_stream' };
  }

  const currentAfterGet = getCurrentActiveRequest();
  if (
    currentAfterGet &&
    (currentAfterGet.sessionId !== sessionId ||
      currentAfterGet.clientRequestId !== activeStream.clientRequestId)
  ) {
    clearCallbacks();
    return { status: 'stale' };
  }

  const requestedAfterSeq =
    existingSnapshot?.sessionId === sessionId &&
    existingSnapshot.clientRequestId === activeStream.clientRequestId
      ? Math.min(existingSnapshot.lastSeq, activeStream.lastSeq)
      : activeStream.lastSeq;

  setCallbacks(callbacks);
  closeExistingTransports();
  resetStopRequested();
  syncActiveRequest({
    clientRequestId: activeStream.clientRequestId,
    lastSeq: requestedAfterSeq,
    sessionId: activeStream.sessionId,
    startedAt: activeStream.startedAtMs,
    transport: 'attach-sse',
  });

  const attached = await connectEventSource({
    activeStream,
    callbacks,
    gatewayUrl,
    getCurrentActiveRequest,
    getCurrentEventSource,
    isStopRequested,
    requestedAfterSeq,
    sessionId,
    setCurrentEventSource,
    syncActiveRequest,
    token,
    clearCallbacks,
    resetStopRequested,
  });
  return attached ? { status: 'attached' } : { status: 'transport_failed' };
}
