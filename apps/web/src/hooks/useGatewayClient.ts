import { useRef, useCallback, useState } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import { useAuthStore } from '../stores/auth.js';
import type {
  DialogueMode,
  InputImageContent,
  RunEvent,
  RunEventEnvelope,
  StreamCancellationSummary,
  StreamChunk,
  StreamDoneChunk,
  StreamThinkingChunk,
  StreamThinkingEndChunk,
  StreamThinkingStartChunk,
  StreamToolCallChunk,
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
  ) => void;
  onError: (code: string, message?: string) => void;
  onReconnectRequired?: (reason: 'attach_stream_disconnected') => void;
  model?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  webSearchEnabled?: boolean;
  yoloMode?: boolean;
}

interface ThinkingChunkDispatchCallbacks {
  onEvent?: (event: RunEvent | StreamChunk) => void;
  onThinkingStart?: (chunk: StreamThinkingStartChunk) => void;
  onThinkingDelta?: (chunk: StreamThinkingChunk) => void;
  onThinkingEnd?: (chunk: StreamThinkingEndChunk) => void;
}

interface GatewayClient {
  attachToActiveStream: (sessionId: string, callbacks: StreamCallbacks) => Promise<boolean>;
  getActiveStreamSessionId: () => string | null;
  stream: (sessionId: string, message: string, callbacks: StreamCallbacks) => void;
  stopStream: () => Promise<boolean>;
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

    const handleChunk = (chunk: StreamChunk | RunEvent, eventSource: AttachEventSourceLike) => {
      if (settled) return;
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
          settled = true;
          cleanup(true, eventSource);
          callbacks.onEvent?.(chunk);
          callbacks.onDone(chunk.stopReason, chunk.agentId, chunk.cancellation);
          return;
        case 'error':
          settled = true;
          cleanup(true, eventSource);
          callbacks.onEvent?.(chunk);
          callbacks.onError(chunk.code, chunk.message);
          return;
        default:
          callbacks.onEvent?.(chunk);
          return;
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

    eventSource.onopen = () => {
      opened = true;
      resolve(true);
    };

    eventSource.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as RunEventEnvelope | StreamChunk | RunEvent;
      if (isRunEventEnvelope(parsed)) {
        const cursorSeq = parsed.payload.cursor?.seq ?? parsed.seq;
        const currentActiveRequest = getCurrentActiveRequest();
        if (currentActiveRequest?.clientRequestId === activeStream.clientRequestId) {
          syncActiveRequest({
            ...currentActiveRequest,
            lastSeq: Math.max(currentActiveRequest.lastSeq, cursorSeq),
            transport: 'attach-sse',
          });
        }
        handleChunk(parsed.payload.event, eventSource);
        return;
      }
      handleChunk(parsed, eventSource);
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
      if (callbacks.onReconnectRequired) {
        callbacks.onReconnectRequired('attach_stream_disconnected');
        return;
      }
      callbacks.onError('ATTACH_STREAM_DISCONNECTED', '实时流连接已断开');
    };
  });
}

export async function attachActiveStreamSession(
  options: AttachActiveStreamSessionOptions,
): Promise<boolean> {
  const {
    callbacks,
    clearCallbacks,
    closeExistingTransports,
    connectEventSource = connectAttachEventSource,
    gatewayUrl,
    getCurrentActiveRequest,
    getCurrentEventSource,
    hasOpenTransports,
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
    return false;
  }

  if (!activeStream) {
    if (
      getCurrentActiveRequest()?.sessionId === sessionId &&
      !hasOpenTransports() &&
      getCurrentEventSource() === null
    ) {
      syncActiveRequest(null);
    }
    clearCallbacks();
    return false;
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

  return await connectEventSource({
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

  const syncActiveRequest = useCallback((snapshot: ActiveStreamSnapshot | null) => {
    activeRequestRef.current = snapshot;
    setActiveStreamSessionId(snapshot?.sessionId ?? null);
    persistActiveStreamSnapshot(snapshot);
  }, []);

  const attachToActiveStream = useCallback(
    async (sessionId: string, callbacks: StreamCallbacks): Promise<boolean> => {
      if (!token) {
        return false;
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
          wsRef.current?.close();
          sseRef.current?.close();
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
    [token],
  );

  const stopStream = useCallback(async (): Promise<boolean> => {
    const activeRequest = activeRequestRef.current;
    if (!activeRequest || !token) {
      return false;
    }

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
  }, [syncActiveRequest, token]);

  const getActiveStreamSessionId = useCallback((): string | null => {
    return activeStreamSessionId;
  }, [activeStreamSessionId]);

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
      const inputParts = callbacks.inputParts;
      const wsBase = gatewayUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
      const wsUrl = `${wsBase}/sessions/${sessionId}/stream?token=${encodeURIComponent(token ?? '')}`;

      wsRef.current?.close();
      sseRef.current?.close();

      let settled = false;
      let fallbackStarted = false;

      const cleanup = () => {
        wsRef.current?.close();
        sseRef.current?.close();
        wsRef.current = null;
        sseRef.current = null;
        callbacksRef.current = null;
        syncActiveRequest(null);
        stopRequestedRef.current = false;
      };

      const handleChunk = (chunk: StreamChunk | RunEvent) => {
        if (settled) return;
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
            settled = true;
            cleanup();
            callbacks.onEvent?.(chunk);
            callbacks.onDone(chunk.stopReason, chunk.agentId, chunk.cancellation);
            return;
          case 'error':
            settled = true;
            cleanup();
            callbacks.onEvent?.(chunk);
            callbacks.onError(chunk.code, chunk.message);
            return;
          default:
            callbacks.onEvent?.(chunk);
            return;
        }
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
        console.log('[STREAM] startSse fallback initiated for session', sessionId);
        fallbackStarted = true;
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
          token: token ?? '',
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
        es.onmessage = (event) => {
          const chunk = JSON.parse(event.data as string) as StreamChunk | RunEvent;
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
          );
          if (!settled && streamGenerationRef.current === streamGeneration) {
            const wasStopRequested = stopRequestedRef.current;
            settled = true;
            cleanup();
            if (wasStopRequested) {
              callbacks.onDone('cancelled');
              return;
            }
            callbacks.onError('SSE_ERROR', 'SSE connection error');
          }
        };
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
        };

        ws.onmessage = (event) => {
          const chunk = JSON.parse(event.data as string) as StreamChunk | RunEvent;
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
    [syncActiveRequest, token],
  );

  return { attachToActiveStream, getActiveStreamSessionId, stream, stopStream };
}

export { classifyAttachStreamError };
