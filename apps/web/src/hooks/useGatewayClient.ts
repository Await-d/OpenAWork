import { useRef, useCallback } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import { useAuthStore } from '../stores/auth.js';
import type {
  RunEvent,
  StreamChunk,
  StreamDoneChunk,
  StreamToolCallChunk,
} from '@openAwork/shared';

interface StreamCallbacks {
  displayMessage?: string;
  providerId?: string;
  onEvent?: (event: RunEvent | StreamChunk) => void;
  onDelta: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  onToolCall?: (chunk: StreamToolCallChunk) => void;
  onDone: (stopReason?: StreamDoneChunk['stopReason'] | 'cancelled') => void;
  onError: (code: string, message?: string) => void;
  model?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  webSearchEnabled?: boolean;
}

interface GatewayClient {
  getActiveStreamSessionId: () => string | null;
  stream: (sessionId: string, message: string, callbacks: StreamCallbacks) => void;
  stopStream: () => Promise<boolean>;
}

interface ActiveStreamSnapshot {
  clientRequestId: string;
  sessionId: string;
  startedAt: number;
}

interface ThinkingDeltaChunkLike {
  type: 'thinking_delta';
  delta: string;
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

function isThinkingDeltaChunk(value: unknown): value is ThinkingDeltaChunkLike {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record['type'] === 'thinking_delta' && typeof record['delta'] === 'string';
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
      typeof parsed['sessionId'] !== 'string' ||
      typeof parsed['startedAt'] !== 'number'
    ) {
      window.sessionStorage.removeItem(getActiveStreamStorageKey());
      return null;
    }

    return {
      clientRequestId: parsed['clientRequestId'],
      sessionId: parsed['sessionId'],
      startedAt: parsed['startedAt'],
    };
  } catch {
    window.sessionStorage.removeItem(getActiveStreamStorageKey());
    return null;
  }
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
  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const callbacksRef = useRef<StreamCallbacks | null>(null);
  const activeRequestRef = useRef<ActiveStreamSnapshot | null>(readPersistedActiveStreamSnapshot());
  const stopRequestedRef = useRef(false);

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
      activeRequestRef.current = null;
      persistActiveStreamSnapshot(null);
      stopRequestedRef.current = false;
      callbacksRef.current = null;
      return false;
    }

    if (!wsRef.current && !sseRef.current) {
      activeRequestRef.current = null;
      persistActiveStreamSnapshot(null);
      stopRequestedRef.current = false;
      callbacksRef.current = null;
    }

    return stopped;
  }, [token]);

  const getActiveStreamSessionId = useCallback((): string | null => {
    return activeRequestRef.current?.sessionId ?? null;
  }, []);

  const stream = useCallback(
    (sessionId: string, message: string, callbacks: StreamCallbacks) => {
      callbacksRef.current = callbacks;

      const gatewayUrl = useAuthStore.getState().gatewayUrl;
      const clientRequestId = crypto.randomUUID();
      activeRequestRef.current = { clientRequestId, sessionId, startedAt: Date.now() };
      persistActiveStreamSnapshot(activeRequestRef.current);
      stopRequestedRef.current = false;
      const model = callbacks.model ?? 'default';
      const providerId = callbacks.providerId;
      const displayMessage = callbacks.displayMessage;
      const thinkingEnabled = callbacks.thinkingEnabled;
      const reasoningEffort = callbacks.reasoningEffort;
      const webSearchEnabled = callbacks.webSearchEnabled === true;
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
        activeRequestRef.current = null;
        persistActiveStreamSnapshot(null);
        stopRequestedRef.current = false;
      };

      const handleChunk = (chunk: StreamChunk | RunEvent) => {
        if (settled) return;
        if (isThinkingDeltaChunk(chunk)) {
          callbacks.onThinkingDelta?.(extractRuntimeTextDelta(chunk.delta));
          callbacks.onEvent?.(chunk);
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
            callbacks.onDone(chunk.stopReason);
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
        if (fallbackStarted || settled) return;
        fallbackStarted = true;
        const params = new URLSearchParams({
          ...(displayMessage ? { displayMessage } : {}),
          message,
          model,
          ...(providerId ? { providerId } : {}),
          clientRequestId,
          token: token ?? '',
          webSearchEnabled: webSearchEnabled ? '1' : '0',
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
          if (!settled) {
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
              ...(displayMessage ? { displayMessage } : {}),
              message,
              model,
              ...(providerId ? { providerId } : {}),
              clientRequestId,
              ...(thinkingEnabled !== undefined ? { thinkingEnabled } : {}),
              ...(reasoningEffort ? { reasoningEffort } : {}),
              webSearchEnabled,
            }),
          );
        };

        ws.onmessage = (event) => {
          const chunk = JSON.parse(event.data as string) as StreamChunk | RunEvent;
          handleChunk(chunk);
        };

        ws.onerror = () => {
          ws.close();
          startSse();
        };

        ws.onclose = () => {
          if (settled) {
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
    [token],
  );

  return { getActiveStreamSessionId, stream, stopStream };
}
