import { useCallback, useMemo, useRef, useState } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';
import { stripOversizedInlineImageUrls } from './sanitize-input-image-parts.js';
import type {
  DialogueMode,
  InputImageContent,
  RunEvent,
  RunEventCursor,
  RunEventEnvelope,
  StreamCancellationSummary,
  StreamChunk,
  StreamDoneChunk,
  StreamThinkingChunk,
  StreamThinkingEndChunk,
  StreamThinkingStartChunk,
  StreamToolCallChunk,
  UpstreamStreamSummary,
} from '@openAwork/shared';

interface StreamCallbacks {
  agentId?: string;
  dialogueMode?: DialogueMode;
  displayMessage?: string;
  inputParts?: InputImageContent[];
  providerId?: string;
  onEvent?: (event: RunEvent | StreamChunk) => void;
  onDelta: (delta: string) => void;
  onThinkingStart?: (chunk: StreamThinkingStartChunk) => void;
  onThinkingDelta?: (chunk: StreamThinkingChunk) => void;
  onThinkingEnd?: (chunk: StreamThinkingEndChunk) => void;
  onToolCall?: (chunk: StreamToolCallChunk) => void;
  onDone: (
    stopReason?: StreamDoneChunk['stopReason'] | 'cancelled',
    agentId?: string,
    cancellation?: StreamCancellationSummary,
    upstreamSummary?: UpstreamStreamSummary,
  ) => void;
  onError: (code: string, message?: string, technicalDetail?: string) => void;
  onReconnectRequired?: (reason: 'attach_stream_disconnected', technicalDetail?: string) => void;
  model?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  webSearchEnabled?: boolean;
  yoloMode?: boolean;
}

interface ThinkingChunkDispatchCallbacks {
  onEvent?: (event: RunEvent | StreamChunk) => void;
  onThinkingStart?: (chunk: StreamThinkingStartChunk) => void;
  onThinkingDelta?: (chunk: StreamThinkingChunk) => void;
  onThinkingEnd?: (chunk: StreamThinkingEndChunk) => void;
}

type GatewayErrorChunk = Extract<StreamChunk | RunEvent, { type: 'error' }>;

interface GatewayClient {
  attachToActiveStream: (
    sessionId: string,
    callbacks: StreamCallbacks,
  ) => Promise<AttachActiveStreamResult>;
  getActiveStreamClientRequestId: () => string | null;
  getActiveStreamSessionId: () => string | null;
  stream: (sessionId: string, message: string, callbacks: StreamCallbacks) => void;
  stopStream: () => Promise<boolean>;
}

export const STREAM_CLIENT_ERROR_MESSAGES = {
  attachInvalidPayload: '实时流数据解析失败。',
  sseInvalidPayload: 'SSE 数据解析失败。',
  wsInvalidPayload: 'WebSocket 数据解析失败。',
} as const;

/**
 * 取消码判定。网关在“取消”场景（用户停止 / 父会话级联中断 / 连接被新请求顶替）
 * 也会下发 `code: 'ABORTED'` 的 error chunk；它语义上是取消而不是失败。
 * 客户端必须把它归入 `done('cancelled')` 通道，否则页面会误报红色错误条、
 * 落一条 `[错误: ABORTED]` 气泡，并吞掉网关随后补发的取消摘要。
 */
export function isCancellationStreamCode(code: string): boolean {
  return code === 'ABORTED';
}

/** 取消态统一用户文案，避免把上游英文原始 message（如 `upstream stream aborted`）透传到界面。 */
export const CANCELLATION_STREAM_MESSAGE = '本次生成已取消。';

export function formatGatewayStreamErrorMessage(
  code: string,
  message?: string,
  technicalDetail?: string,
): string {
  const normalizedMessage = message?.trim();
  const normalizedTechnicalDetail = technicalDetail?.trim();
  const appendTechnicalDetail = (baseMessage: string): string =>
    normalizedTechnicalDetail && normalizedTechnicalDetail !== baseMessage
      ? `${baseMessage}\n\n技术详情：${normalizedTechnicalDetail}`
      : baseMessage;

  if (isCancellationStreamCode(code)) {
    return appendTechnicalDetail(CANCELLATION_STREAM_MESSAGE);
  }

  if (normalizedMessage) {
    return appendTechnicalDetail(normalizedMessage);
  }

  const fallbackMessage = (() => {
    switch (code) {
      case 'REQUEST_REPLAY_FAILED':
        return '请求重放失败。';
      case 'SESSION_ALREADY_RUNNING':
        return '当前会话已有请求正在运行。';
      case 'MODEL_ERROR':
        return '模型响应失败，请稍后重试。';
      case 'STREAM_ERROR':
        return '流式响应处理中断，请稍后重试。';
      case 'V2_UPSTREAM_ERROR':
        return '上游模型服务暂时不可用，请稍后重试。';
      case 'WS_STREAM_ERROR':
        return 'WebSocket 流式响应处理中断，请稍后重试。';
      case 'SSE_STREAM_ERROR':
        return 'SSE 流式响应处理中断，请稍后重试。';
      case 'ATTACH_STREAM_DISCONNECTED':
        return '实时流连接已断开。';
      case 'ATTACH_STREAM_INVALID_PAYLOAD':
        return STREAM_CLIENT_ERROR_MESSAGES.attachInvalidPayload;
      case 'SSE_INVALID_PAYLOAD':
        return STREAM_CLIENT_ERROR_MESSAGES.sseInvalidPayload;
      case 'WS_INVALID_PAYLOAD':
        return STREAM_CLIENT_ERROR_MESSAGES.wsInvalidPayload;
      case 'SSE_ERROR':
        return 'SSE 连接异常。';
      case 'WS_ERROR':
        return 'WebSocket 连接异常。';
      default:
        return code;
    }
  })();
  return appendTechnicalDetail(fallbackMessage);
}

export function describeSseConnectionFailure(input: {
  gatewayUrl: string;
  sessionId: string;
  opened?: boolean;
  attempts?: number;
}): string {
  let gateway = input.gatewayUrl;
  try {
    gateway = new URL(input.gatewayUrl).origin;
  } catch {
    // 配置页会自行校验地址；这里保留输入值使连接错误仍可定位。
  }
  const phase = input.opened ? '流式传输过程中' : '收到 SSE 响应前';
  const retryNote =
    input.attempts && input.attempts > 0 ? `已自动重连 ${input.attempts} 次仍未成功。` : '';
  return `连接在${phase}中断。Gateway：${gateway}；会话：${input.sessionId}。${retryNote}浏览器没有提供底层失败原因。`;
}

interface ActiveStreamSnapshot {
  clientRequestId: string;
  lastSeq: number;
  sessionId: string;
  startedAt: number;
  transport: 'attach-sse' | 'sse' | 'ws';
}

interface AttachEventSourceLike {
  close: EventSource['close'];
  onerror: EventSource['onerror'];
  onmessage: EventSource['onmessage'];
  onopen: EventSource['onopen'];
}

interface AttachableActiveStream {
  clientRequestId: string;
  lastSeq: number;
  sessionId: string;
  startedAtMs: number;
}

interface AttachActiveStreamConnectionOptions {
  activeStream: AttachableActiveStream;
  callbacks: StreamCallbacks;
  createEventSource?: (url: string) => AttachEventSourceLike;
  gatewayUrl: string;
  getCurrentActiveRequest: () => ActiveStreamSnapshot | null;
  getCurrentEventSource: () => AttachEventSourceLike | null;
  isStopRequested: () => boolean;
  requestedAfterSeq: number;
  sessionId: string;
  setCurrentEventSource: (eventSource: AttachEventSourceLike | null) => void;
  syncActiveRequest: (snapshot: ActiveStreamSnapshot | null) => void;
  token: string;
  clearCallbacks: () => void;
  resetStopRequested: () => void;
}

interface AttachActiveStreamSessionOptions {
  callbacks: StreamCallbacks;
  clearCallbacks: () => void;
  closeExistingTransports: () => void;
  connectEventSource?: (options: AttachActiveStreamConnectionOptions) => Promise<boolean>;
  gatewayUrl: string;
  getCurrentActiveRequest: () => ActiveStreamSnapshot | null;
  getCurrentEventSource: () => AttachEventSourceLike | null;
  hasOpenTransports: () => boolean;
  isStopRequested: () => boolean;
  resetStopRequested: () => void;
  sessionId: string;
  sessionsClient: {
    getActiveStream: (token: string, sessionId: string) => Promise<AttachableActiveStream | null>;
  };
  setCallbacks: (callbacks: StreamCallbacks) => void;
  setCurrentEventSource: (eventSource: AttachEventSourceLike | null) => void;
  syncActiveRequest: (snapshot: ActiveStreamSnapshot | null) => void;
  token: string;
}

/**
 * §0.153: client-side WS liveness probe for the live chat stream.
 *
 * The chat WS (`stream()` below) reconnects via SSE fallback on `onclose` /
 * `onerror`, but a HALF-OPEN socket (server vanished with no FIN — laptop
 * sleep, NAT/idle drop, network partition) never fires either, so the browser
 * holds the socket OPEN for the OS TCP timeout (minutes, sometimes never) and
 * the chat spinner hangs. The gateway answers an app-level `{type:'ping'}`
 * with `pong` (§0.153 route branch), so the client pings on an interval and,
 * once the server has gone silent past a tolerance window, closes the socket
 * — which triggers the existing (idempotent, clientRequestId-deduped) SSE
 * fallback. Mirrors mobile §0.147 / team-events §0.150.
 */
const CHAT_WS_CLIENT_PING_INTERVAL_MS = 15_000;
const CHAT_WS_CLIENT_LIVENESS_TIMEOUT_MS = 40_000;

/**
 * Pure decision for one chat-WS liveness tick. `ping` keeps the socket primed;
 * `reconnect` means the server has gone silent past the tolerance window, so
 * the caller must tear the socket down and let the SSE fallback take over.
 * Exported for unit testing.
 */
export function resolveChatWsLivenessAction(input: {
  msSinceLastServerActivity: number;
  livenessTimeoutMs?: number;
}): 'ping' | 'reconnect' {
  const timeout = input.livenessTimeoutMs ?? CHAT_WS_CLIENT_LIVENESS_TIMEOUT_MS;
  return input.msSinceLastServerActivity > timeout ? 'reconnect' : 'ping';
}

/**
 * SSE 回退的有界重试预算。EventSource 对非 200 响应（401/404/409）不会自动
 * 重连；网络类错误虽然浏览器会自行重连，但 URL 里的 token 与 afterSeq 都是
 * 旧值。因此统一由客户端做「刷新 token → 带最新游标重开」的退避重试，避免
 * 一次瞬时抖动（网关重启、休眠唤醒、token 轮换）就向用户抛「SSE 连接异常」。
 */
export const SSE_FALLBACK_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

/** 打开 SSE 回退前，access token 距过期不足该阈值就先刷新，避免 401 硬失败。 */
export const SSE_TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * 解析打开 SSE 回退时应使用的最新 token。
 *
 * `stream()` 闭包里的 token 是用户点击发送那一刻的值；长回合（思考 / 工具执行
 * 超过 access token 有效期）中 WS 掉线回退 SSE 时它可能已经过期，而 EventSource
 * 对 401 是硬失败（不重连），表现为「连接在收到 SSE 响应前中断」。
 * 因此回退打开前统一从认证 store 取最新 token，临近过期先走单飞刷新。
 */
export async function resolveFreshStreamToken(fallbackToken: string | null): Promise<string> {
  const authState = useAuthStore.getState();
  const currentToken = authState.accessToken ?? fallbackToken ?? '';
  if (!authState.refreshToken) {
    return currentToken;
  }
  const expiresAt = authState.tokenExpiresAt;
  if (expiresAt !== null && expiresAt - Date.now() > SSE_TOKEN_REFRESH_MARGIN_MS) {
    return currentToken;
  }
  await authState.refreshAccessToken();
  return useAuthStore.getState().accessToken ?? currentToken;
}

function classifyAttachStreamError(input: {
  opened: boolean;
  stopRequested: boolean;
}): 'open_failed' | 'cancelled' | 'reconnect_required' {
  if (!input.opened) {
    return 'open_failed';
  }

  if (input.stopRequested) {
    return 'cancelled';
  }

  return 'reconnect_required';
}

function createGatewayEventSource(url: string): EventSource {
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
      resolve(true);
    };

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
        if (cursorSeq <= requestedAfterSeq) {
          return;
        }
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
        const event = parsed.payload.event;
        handleChunk(
          typeof event === 'object' && event !== null
            ? {
                ...event,
                eventId:
                  typeof (event as { eventId?: unknown }).eventId === 'string'
                    ? (event as { eventId: string }).eventId
                    : `run-seq:${cursorSeq}`,
              }
            : event,
        );
        return;
      }
      handleChunk(parsed);
    };

    eventSource.onerror = () => {
      if (settled) {
        return;
      }
      const errorAction = classifyAttachStreamError({
        opened,
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

      settled = true;
      cleanup(false, eventSource);
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

function isRunEventEnvelope(value: unknown): value is RunEventEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const payload = record['payload'];
  return (
    record['aggregateType'] === 'run' &&
    typeof record['seq'] === 'number' &&
    payload !== null &&
    typeof payload === 'object' &&
    'event' in (payload as Record<string, unknown>)
  );
}

function extractRuntimeTextDelta(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractRuntimeTextDelta(item)).join('');
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  const candidates = [record['text'], record['content'], record['markdown'], record['value']];
  return candidates.map((item) => extractRuntimeTextDelta(item)).join('');
}

function readGatewayEventId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const eventId = (value as { eventId?: unknown }).eventId;
  return typeof eventId === 'string' && eventId.length > 0 ? eventId : null;
}

function readGatewayCursor(value: unknown): RunEventCursor | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const cursor = (value as { cursor?: unknown }).cursor;
  if (!cursor || typeof cursor !== 'object') {
    return null;
  }

  const clientRequestId = (cursor as { clientRequestId?: unknown }).clientRequestId;
  const seq = (cursor as { seq?: unknown }).seq;
  if (
    typeof clientRequestId !== 'string' ||
    clientRequestId.length === 0 ||
    typeof seq !== 'number' ||
    !Number.isSafeInteger(seq) ||
    seq < 1
  ) {
    return null;
  }

  return { clientRequestId, seq };
}

function isThinkingDeltaChunk(value: unknown): value is StreamThinkingChunk {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record['type'] === 'thinking_delta' && typeof record['delta'] === 'string';
}

function isThinkingEndChunk(value: unknown): value is StreamThinkingEndChunk {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record['type'] === 'thinking_end';
}

function isThinkingStartChunk(value: unknown): value is StreamThinkingStartChunk {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record['type'] === 'thinking_start';
}

export function dispatchThinkingChunk(
  callbacks: ThinkingChunkDispatchCallbacks,
  chunk: StreamThinkingChunk,
): void {
  callbacks.onThinkingDelta?.({
    ...chunk,
    delta: extractRuntimeTextDelta(chunk.delta),
  });
  callbacks.onEvent?.(chunk);
}

export function dispatchThinkingEndChunk(
  callbacks: ThinkingChunkDispatchCallbacks,
  chunk: StreamThinkingEndChunk,
): void {
  callbacks.onThinkingEnd?.(chunk);
  callbacks.onEvent?.(chunk);
}

export function dispatchThinkingStartChunk(
  callbacks: ThinkingChunkDispatchCallbacks,
  chunk: StreamThinkingStartChunk,
): void {
  callbacks.onThinkingStart?.(chunk);
  callbacks.onEvent?.(chunk);
}

function createGatewayChunkDispatcher(input: {
  callbacks: StreamCallbacks;
  deliveredEventIds?: Set<string>;
  isSettled: () => boolean;
  onDoneChunk: (chunk: StreamDoneChunk) => void;
  onErrorChunk: (chunk: GatewayErrorChunk) => void;
}): (chunk: StreamChunk | RunEvent) => void {
  const { callbacks, deliveredEventIds, isSettled, onDoneChunk, onErrorChunk } = input;

  return (chunk) => {
    if (isSettled()) return;

    const eventId = readGatewayEventId(chunk);
    if (eventId && deliveredEventIds) {
      if (deliveredEventIds.has(eventId)) {
        return;
      }
      deliveredEventIds.add(eventId);
    }

    if (isThinkingStartChunk(chunk)) {
      dispatchThinkingStartChunk(callbacks, chunk);
      return;
    }
    if (isThinkingDeltaChunk(chunk)) {
      dispatchThinkingChunk(callbacks, chunk);
      return;
    }
    if (isThinkingEndChunk(chunk)) {
      dispatchThinkingEndChunk(callbacks, chunk);
      return;
    }

    switch (chunk.type) {
      case 'text_delta':
        callbacks.onDelta(extractRuntimeTextDelta(chunk.delta));
        return;
      case 'tool_call_delta':
        callbacks.onToolCall?.(chunk);
        callbacks.onEvent?.(chunk);
        return;
      case 'done':
        onDoneChunk(chunk);
        return;
      case 'error':
        onErrorChunk(chunk);
        return;
      default:
        callbacks.onEvent?.(chunk);
        return;
    }
  };
}

function getActiveStreamStorageKey(): string {
  const email = useAuthStore.getState().email?.trim().toLowerCase() ?? 'anonymous';
  return `openAwork-active-stream:${email}`;
}

function readPersistedActiveStreamSnapshot(): ActiveStreamSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(getActiveStreamStorageKey());
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    if (
      typeof parsed['clientRequestId'] !== 'string' ||
      (parsed['lastSeq'] !== undefined && typeof parsed['lastSeq'] !== 'number') ||
      typeof parsed['sessionId'] !== 'string' ||
      typeof parsed['startedAt'] !== 'number'
    ) {
      window.sessionStorage.removeItem(getActiveStreamStorageKey());
      return null;
    }

    return {
      clientRequestId: parsed['clientRequestId'],
      lastSeq: typeof parsed['lastSeq'] === 'number' ? parsed['lastSeq'] : 0,
      sessionId: parsed['sessionId'],
      startedAt: parsed['startedAt'],
      transport:
        parsed['transport'] === 'attach-sse' || parsed['transport'] === 'sse'
          ? parsed['transport']
          : 'ws',
    };
  } catch {
    window.sessionStorage.removeItem(getActiveStreamStorageKey());
    return null;
  }
}

export function readPersistedActiveStreamSessionId(): string | null {
  return readPersistedActiveStreamSnapshot()?.sessionId ?? null;
}

function persistActiveStreamSnapshot(snapshot: ActiveStreamSnapshot | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  const storageKey = getActiveStreamStorageKey();
  if (!snapshot) {
    window.sessionStorage.removeItem(storageKey);
    return;
  }

  window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
}

export function useGatewayClient(token: string | null): GatewayClient {
  const initialActiveRequest = readPersistedActiveStreamSnapshot();
  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const callbacksRef = useRef<StreamCallbacks | null>(null);
  const activeRequestRef = useRef<ActiveStreamSnapshot | null>(initialActiveRequest);
  const [activeStreamSessionId, setActiveStreamSessionId] = useState<string | null>(
    initialActiveRequest?.sessionId ?? null,
  );
  const stopRequestedRef = useRef(false);
  // Monotonically increasing generation counter. Every stream() and
  // closeExistingTransports() call bumps this. WS/SSE error handlers
  // capture the value at creation time and bail out when it no longer
  // matches, preventing stale fallback attempts from racing with a
  // newer stream or attach flow.
  const streamGenerationRef = useRef(0);
  // SSE 回退的有界重连定时器。跨 stream() 生命周期持有，确保新消息 / attach
  // 接管时能取消上一条流遗留的重试，而不是让旧闭包静默重开连接。
  const sseRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSseRetryTimer = useCallback(() => {
    if (sseRetryTimerRef.current !== null) {
      clearTimeout(sseRetryTimerRef.current);
      sseRetryTimerRef.current = null;
    }
  }, []);

  const syncActiveRequest = useCallback((snapshot: ActiveStreamSnapshot | null) => {
    activeRequestRef.current = snapshot;
    setActiveStreamSessionId(snapshot?.sessionId ?? null);
    persistActiveStreamSnapshot(snapshot);
  }, []);

  const attachToActiveStream = useCallback(
    async (sessionId: string, callbacks: StreamCallbacks): Promise<AttachActiveStreamResult> => {
      if (!token) {
        return { status: 'transport_failed' };
      }

      const gatewayUrl = useAuthStore.getState().gatewayUrl;
      const sessionsClient = createSessionsClient(gatewayUrl);
      return await attachActiveStreamSession({
        callbacks,
        clearCallbacks: () => {
          callbacksRef.current = null;
        },
        closeExistingTransports: () => {
          streamGenerationRef.current += 1;
          console.log('[ATTACH] closeExistingTransports gen:', streamGenerationRef.current);
          clearSseRetryTimer();
          wsRef.current?.close();
          sseRef.current?.close();
          wsRef.current = null;
          sseRef.current = null;
        },
        gatewayUrl,
        getCurrentActiveRequest: () => activeRequestRef.current,
        getCurrentEventSource: () => sseRef.current,
        hasOpenTransports: () => Boolean(wsRef.current || sseRef.current),
        isStopRequested: () => stopRequestedRef.current,
        resetStopRequested: () => {
          stopRequestedRef.current = false;
        },
        sessionId,
        sessionsClient,
        setCallbacks: (nextCallbacks) => {
          callbacksRef.current = nextCallbacks;
        },
        setCurrentEventSource: (eventSource) => {
          sseRef.current = eventSource as EventSource | null;
        },
        syncActiveRequest,
        token: token ?? '',
      });
    },
    [clearSseRetryTimer, token],
  );

  const stopStream = useCallback(async (): Promise<boolean> => {
    const activeRequest = activeRequestRef.current;
    if (!activeRequest || !token) {
      return false;
    }

    // 用户已明确停止：取消待触发的 SSE 自动重连，避免停止后又被重试拉活。
    clearSseRetryTimer();
    stopRequestedRef.current = true;
    const gatewayUrl = useAuthStore.getState().gatewayUrl;
    const sessionsClient = createSessionsClient(gatewayUrl);
    const stopped = await sessionsClient.stopStream(
      token,
      activeRequest.sessionId,
      activeRequest.clientRequestId,
    );
    if (!stopped) {
      syncActiveRequest(null);
      stopRequestedRef.current = false;
      callbacksRef.current = null;
      return false;
    }

    if (!wsRef.current && !sseRef.current) {
      syncActiveRequest(null);
      stopRequestedRef.current = false;
      callbacksRef.current = null;
    }

    return stopped;
  }, [clearSseRetryTimer, syncActiveRequest, token]);

  const getActiveStreamSessionId = useCallback((): string | null => {
    return activeStreamSessionId;
  }, [activeStreamSessionId]);

  const getActiveStreamClientRequestId = useCallback((): string | null => {
    return activeRequestRef.current?.clientRequestId ?? null;
  }, []);

  const stream = useCallback(
    (sessionId: string, message: string, callbacks: StreamCallbacks) => {
      callbacksRef.current = callbacks;
      streamGenerationRef.current += 1;
      const streamGeneration = streamGenerationRef.current;

      const gatewayUrl = useAuthStore.getState().gatewayUrl;
      const clientRequestId = crypto.randomUUID();
      syncActiveRequest({
        clientRequestId,
        lastSeq: 0,
        sessionId,
        startedAt: Date.now(),
        transport: 'ws',
      });
      stopRequestedRef.current = false;
      const model = callbacks.model ?? 'default';
      const agentId = callbacks.agentId?.trim() || undefined;
      const providerId = callbacks.providerId;
      const displayMessage = callbacks.displayMessage;
      const dialogueMode = callbacks.dialogueMode;
      const thinkingEnabled = callbacks.thinkingEnabled;
      const reasoningEffort = callbacks.reasoningEffort;
      const webSearchEnabled = callbacks.webSearchEnabled === true;
      const yoloMode = callbacks.yoloMode === true;
      const inputParts = callbacks.inputParts
        ? stripOversizedInlineImageUrls(callbacks.inputParts)
        : undefined;
      const wsBase = gatewayUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
      const wsUrl = `${wsBase}/sessions/${sessionId}/stream?token=${encodeURIComponent(token ?? '')}`;

      wsRef.current?.close();
      sseRef.current?.close();
      clearSseRetryTimer();

      let settled = false;
      let fallbackStarted = false;
      // SSE 回退的有界重连状态（见 SSE_FALLBACK_RETRY_DELAYS_MS 注释）。
      let sseAttempt = 0;
      let sseOpened = false;
      const deliveredEventIds = new Set<string>();
      // §0.153: chat-WS half-open liveness probe state (scoped to this stream).
      let livenessTimer: ReturnType<typeof setInterval> | null = null;
      let lastServerActivityAt = 0;
      const stopLivenessProbe = () => {
        if (livenessTimer) {
          clearInterval(livenessTimer);
          livenessTimer = null;
        }
      };

      const cleanup = () => {
        stopLivenessProbe();
        clearSseRetryTimer();
        wsRef.current?.close();
        sseRef.current?.close();
        wsRef.current = null;
        sseRef.current = null;
        callbacksRef.current = null;
        syncActiveRequest(null);
        stopRequestedRef.current = false;
      };

      const dispatchChunk = createGatewayChunkDispatcher({
        callbacks,
        deliveredEventIds,
        isSettled: () => settled,
        onDoneChunk: (chunk) => {
          settled = true;
          cleanup();
          callbacks.onEvent?.(chunk);
          callbacks.onDone(
            chunk.stopReason,
            chunk.agentId,
            chunk.cancellation,
            chunk.upstreamSummary,
          );
        },
        onErrorChunk: (chunk) => {
          settled = true;
          cleanup();
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
      const handleChunk = (chunk: StreamChunk | RunEvent) => {
        const cursor = readGatewayCursor(chunk);
        const activeRequest = activeRequestRef.current;
        if (
          cursor &&
          activeRequest?.clientRequestId === cursor.clientRequestId &&
          cursor.seq > activeRequest.lastSeq
        ) {
          // 在事件分发前推进游标。分发会触发 React 更新甚至页面重挂载，
          // 若此时仍保存 0，新的 attach 会从头重放已展示的 thinking/tool/text。
          syncActiveRequest({
            ...activeRequest,
            lastSeq: cursor.seq,
          });
        }
        dispatchChunk(chunk);
      };

      const startSse = () => {
        if (fallbackStarted || settled || streamGenerationRef.current !== streamGeneration) {
          console.log(
            '[STREAM] startSse skipped: fallback=',
            fallbackStarted,
            'settled=',
            settled,
            'gen=',
            streamGeneration,
            'current=',
            streamGenerationRef.current,
          );
          return;
        }
        fallbackStarted = true;
        void (async () => {
          // 回退打开前取最新 token（必要时单飞刷新），避免长回合里闭包 token
          // 过期导致 EventSource 401 硬失败——那会直接抛「SSE 连接异常」。
          const sseToken = await resolveFreshStreamToken(token);
          // token 解析（可能包含一次刷新网络往返）期间流可能已被接管 / 停止：
          // 快照被清空或已指向别的 clientRequestId 时不得再打开回退连接，
          // 否则停止后的会话会被重新拉活、并从头重放已展示的事件。
          if (
            settled ||
            streamGenerationRef.current !== streamGeneration ||
            activeRequestRef.current?.clientRequestId !== clientRequestId
          ) {
            return;
          }
          console.log(
            '[STREAM] startSse fallback initiated for session',
            sessionId,
            'attempt=',
            sseAttempt,
          );
          const requestedAfterSeq =
            activeRequestRef.current?.clientRequestId === clientRequestId
              ? activeRequestRef.current.lastSeq
              : 0;
          if (activeRequestRef.current) {
            syncActiveRequest({
              ...activeRequestRef.current,
              transport: 'sse',
            });
          }
          const params = new URLSearchParams({
            ...(agentId ? { agentId } : {}),
            ...(dialogueMode ? { dialogueMode } : {}),
            ...(displayMessage ? { displayMessage } : {}),
            ...(inputParts ? { inputParts: JSON.stringify(inputParts) } : {}),
            message,
            model,
            ...(providerId ? { providerId } : {}),
            clientRequestId,
            afterSeq: String(requestedAfterSeq),
            token: sseToken,
            webSearchEnabled: webSearchEnabled ? '1' : '0',
            yoloMode: yoloMode ? '1' : '0',
            ...(thinkingEnabled !== undefined
              ? { thinkingEnabled: thinkingEnabled ? '1' : '0' }
              : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
          });
          const es = new EventSource(
            `${gatewayUrl}/sessions/${sessionId}/stream/sse?${params.toString()}`,
          );
          sseRef.current = es;
          es.onopen = () => {
            sseOpened = true;
          };
          es.onmessage = (event) => {
            const chunk = safeParseGatewayEventData<StreamChunk | RunEvent>({
              rawData: event.data as string,
              invalidCode: 'SSE_INVALID_PAYLOAD',
              invalidMessage: STREAM_CLIENT_ERROR_MESSAGES.sseInvalidPayload,
              onError: (code, message) => {
                if (!settled && streamGenerationRef.current === streamGeneration) {
                  settled = true;
                  cleanup();
                  callbacks.onError(code, message);
                }
              },
            });
            if (!chunk) {
              return;
            }
            handleChunk(chunk);
          };
          es.onerror = () => {
            console.log(
              '[STREAM] SSE onerror: settled=',
              settled,
              'gen=',
              streamGeneration,
              'current=',
              streamGenerationRef.current,
              'stopReq=',
              stopRequestedRef.current,
              'attempt=',
              sseAttempt,
            );
            if (settled || streamGenerationRef.current !== streamGeneration) {
              return;
            }
            if (stopRequestedRef.current) {
              settled = true;
              cleanup();
              callbacks.onDone('cancelled');
              return;
            }
            // 统一由下面的退避重试接管重连：浏览器对已关闭的 EventSource
            // 不会再自动重连，而重连必须携带新 token 与最新 afterSeq 游标
            // （网关支持按 clientRequestId + afterSeq 重放，不会重复执行）。
            es.close();
            if (sseRef.current === es) {
              sseRef.current = null;
            }
            // 同一次失败的连接可能派发多次 onerror（浏览器重连尝试）；已排期
            // 重试时直接忽略，避免覆盖定时器引用造成重复重连。
            if (sseRetryTimerRef.current !== null) {
              return;
            }
            const retryDelay = SSE_FALLBACK_RETRY_DELAYS_MS[sseAttempt];
            if (retryDelay !== undefined) {
              sseAttempt += 1;
              sseRetryTimerRef.current = setTimeout(() => {
                sseRetryTimerRef.current = null;
                fallbackStarted = false;
                startSse();
              }, retryDelay);
              return;
            }
            settled = true;
            cleanup();
            callbacks.onError(
              'SSE_ERROR',
              'SSE 连接异常。',
              describeSseConnectionFailure({
                attempts: sseAttempt,
                gatewayUrl,
                opened: sseOpened,
                sessionId,
              }),
            );
          };
        })();
      };

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              ...(agentId ? { agentId } : {}),
              ...(dialogueMode ? { dialogueMode } : {}),
              ...(displayMessage ? { displayMessage } : {}),
              ...(inputParts ? { inputParts } : {}),
              message,
              model,
              ...(providerId ? { providerId } : {}),
              clientRequestId,
              ...(thinkingEnabled !== undefined ? { thinkingEnabled } : {}),
              ...(reasoningEffort ? { reasoningEffort } : {}),
              webSearchEnabled,
              yoloMode,
            }),
          );
          // §0.153: arm the half-open liveness probe. The server answers our
          // `{type:'ping'}` with `pong` and emits chunks during a live turn;
          // if NOTHING arrives within the tolerance window the socket is
          // presumed half-open (server vanished without a FIN) and we close it
          lastServerActivityAt = Date.now();
          stopLivenessProbe();
          livenessTimer = setInterval(() => {
            if (settled || streamGenerationRef.current !== streamGeneration) {
              stopLivenessProbe();
              return;
            }
            if (ws.readyState !== WebSocket.OPEN) return;
            const action = resolveChatWsLivenessAction({
              msSinceLastServerActivity: Date.now() - lastServerActivityAt,
            });
            if (action === 'reconnect') {
              // Server silent past tolerance → presume half-open. Closing runs
              // the onclose handler, which falls back to SSE (idempotent).
              stopLivenessProbe();
              try {
                ws.close();
              } catch {
                /* already closing/closed */
              }
              return;
            }
            try {
              ws.send(JSON.stringify({ type: 'ping' }));
            } catch {
              stopLivenessProbe();
              try {
                ws.close();
              } catch {
                /* noop */
              }
            }
          }, CHAT_WS_CLIENT_PING_INTERVAL_MS);
        };

        ws.onmessage = (event) => {
          // Any frame proves the server is alive — refresh the watchdog.
          lastServerActivityAt = Date.now();
          const chunk = safeParseGatewayEventData<StreamChunk | RunEvent>({
            rawData: event.data as string,
            invalidCode: 'WS_INVALID_PAYLOAD',
            invalidMessage: STREAM_CLIENT_ERROR_MESSAGES.wsInvalidPayload,
            onError: (code, message) => {
              if (!settled && streamGenerationRef.current === streamGeneration) {
                settled = true;
                cleanup();
                callbacks.onError(code, message);
              }
            },
          });
          if (!chunk) {
            return;
          }
          // §0.153: swallow the liveness `pong` (it already refreshed activity
          // above) so it is never forwarded to consumers as a stream event.
          if ((chunk as { type?: unknown }).type === 'pong') {
            return;
          }
          handleChunk(chunk);
        };

        ws.onerror = () => {
          console.log(
            '[STREAM] WS onerror: gen=',
            streamGeneration,
            'current=',
            streamGenerationRef.current,
          );
          ws.close();
          if (streamGenerationRef.current === streamGeneration) {
            startSse();
          }
        };

        ws.onclose = () => {
          console.log(
            '[STREAM] WS onclose: settled=',
            settled,
            'gen=',
            streamGeneration,
            'current=',
            streamGenerationRef.current,
            'stopReq=',
            stopRequestedRef.current,
          );
          if (settled || streamGenerationRef.current !== streamGeneration) {
            return;
          }
          if (stopRequestedRef.current) {
            settled = true;
            cleanup();
            callbacks.onDone('cancelled');
            return;
          }
          startSse();
        };
      } catch {
        startSse();
      }
    },
    [clearSseRetryTimer, syncActiveRequest, token],
  );

  return useMemo(
    () => ({
      attachToActiveStream,
      getActiveStreamClientRequestId,
      getActiveStreamSessionId,
      stream,
      stopStream,
    }),
    [
      attachToActiveStream,
      getActiveStreamClientRequestId,
      getActiveStreamSessionId,
      stream,
      stopStream,
    ],
  );
}

export { classifyAttachStreamError };
