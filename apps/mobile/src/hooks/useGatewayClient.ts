import { useRef, useEffect, useCallback } from 'react';
import type { DialogueMode, InputImageContent, RunEvent } from '@openAwork/shared';
import {
  extractRuntimeTextDelta,
  extractRuntimeThinkingDelta,
} from '../chat/chat-message-content.js';

export type ActivityEvent =
  | { kind: 'tool_start'; id: string; name: string }
  | {
      kind: 'tool_result';
      id: string;
      name: string;
      isError: boolean;
      output?: string;
      reason?: string;
    }
  | {
      kind: 'task_update';
      id: string;
      name: string;
      status: 'running' | 'done' | 'error';
      assignedAgent?: string;
      reason?: string;
      sessionId?: string;
      output?: string;
    };

export type StreamHandlers = {
  onDelta: (delta: string) => void;
  onDone: (stopReason: string) => void;
  onError: (code: string, message: string) => void;
  onConnected?: () => void;
  onActivity?: (event: ActivityEvent) => void;
  onThinkingDelta?: (delta: string) => void;
};

export type StreamOptions = {
  agentId?: string;
  displayMessage?: string;
  dialogueMode?: DialogueMode;
  inputParts?: InputImageContent[];
  yoloMode?: boolean;
};

/**
 * Upper bound on payloads buffered while the socket is not yet OPEN. The
 * buffer keeps sends fired during CONNECTING from being lost, but if the
 * gateway is unreachable the socket never opens and a chatty caller (rapid
 * retries, automated resends) would otherwise grow this array without limit
 * — an unbounded client-side memory leak. When the cap is exceeded we drop
 * the oldest queued payload (FIFO eviction): the most recent send intent is
 * the one worth keeping, and the stale head was already superseded.
 */
const MAX_PENDING_PAYLOADS = 64;

export class MobileGatewayClient {
  private ws: WebSocket | null = null;
  private pendingPayloads: string[] = [];
  private gatewayUrl: string;
  private token: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private handlers: StreamHandlers | null = null;
  private currentSessionId: string | null = null;
  /**
   * True once a terminal chunk (`done` / `error`, including the synthetic
   * close error below) has been delivered for the CURRENT turn. Reset when a
   * new turn starts (`connect` / `send`). Guards `onclose` so a socket that
   * dies without a terminal chunk still surfaces exactly one terminal event
   * instead of leaving the chat UI spinner hanging forever.
   */
  private terminalDispatched = false;

  constructor(gatewayUrl: string, token: string) {
    this.gatewayUrl = gatewayUrl;
    this.token = token;
  }

  connect(sessionId: string, handlers: StreamHandlers): void {
    this.currentSessionId = sessionId;
    this.handlers = handlers;
    this.terminalDispatched = false;
    this.openConnection(sessionId);
  }

  private openConnection(sessionId: string): void {
    const protocol = this.gatewayUrl.startsWith('https') ? 'wss' : 'ws';
    const base = this.gatewayUrl.replace(/^https?/, protocol);
    const WebSocketWithOptions = WebSocket as unknown as {
      new (
        url: string,
        protocols?: string | string[],
        options?: { headers?: Record<string, string> },
      ): WebSocket;
    };
    this.ws = new WebSocketWithOptions(`${base}/sessions/${sessionId}/stream`, undefined, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      // Flush every payload queued while CONNECTING; a single-slot buffer
      // would drop all but the last when sends fire back-to-back.
      if (this.pendingPayloads.length > 0) {
        const queued = this.pendingPayloads;
        this.pendingPayloads = [];
        for (const payload of queued) {
          this.ws?.send(payload);
        }
      }
      this.handlers?.onConnected?.();
    };

    this.ws.onmessage = (ev) => {
      if (!this.handlers) return;
      let chunk: RunEvent;
      try {
        chunk = JSON.parse(ev.data as string) as RunEvent;
      } catch {
        // A malformed frame must not throw out of the WS event loop and
        // tear the socket down; surface it as a structured error instead.
        this.handlers.onError('WS_INVALID_PAYLOAD', 'WebSocket 数据解析失败。');
        return;
      }
      try {
        this.dispatchChunk(chunk);
      } catch {
        // A consumer handler (React state setter on an unmounted screen,
        // etc.) throwing must not break the connection.
        this.handlers.onError('WS_HANDLER_ERROR', '消息处理回调异常。');
      }
    };

    this.ws.onclose = (ev) => {
      // Reconnect only for an unclean drop while we still have budget AND a
      // live session to resume into (a manual disconnect() nulls
      // currentSessionId, so a late close never resurrects the socket).
      const willReconnect =
        !ev.wasClean &&
        this.reconnectAttempts < this.maxReconnectAttempts &&
        this.currentSessionId !== null;
      if (willReconnect) {
        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
          if (this.currentSessionId) this.openConnection(this.currentSessionId);
        }, delay);
        return;
      }
      // No further reconnect: a server-initiated clean close mid-turn (1001
      // going-away) or an exhausted reconnect budget would otherwise leave
      // the consumer stranded on a non-terminal state (mobile never
      // re-attaches to the in-flight run). Surface exactly one synthetic
      // terminal error so the chat UI can settle. Skipped when a terminal
      // chunk / WS_ERROR already fired, or after a manual disconnect (which
      // nulls handlers).
      if (this.handlers && !this.terminalDispatched) {
        this.terminalDispatched = true;
        this.handlers.onError('WS_CLOSED', 'WebSocket 连接已关闭。');
      }
    };

    this.ws.onerror = () => {
      this.terminalDispatched = true;
      this.handlers?.onError('WS_ERROR', 'WebSocket connection error');
    };
  }

  private dispatchChunk(chunk: RunEvent): void {
    if (!this.handlers) return;
    if (chunk.type === 'text_delta') {
      this.handlers.onDelta(extractRuntimeTextDelta(chunk.delta));
    } else if (chunk.type === 'thinking_delta') {
      this.handlers.onThinkingDelta?.(extractRuntimeThinkingDelta(chunk.delta));
    } else if (chunk.type === 'done') {
      this.terminalDispatched = true;
      this.handlers.onDone(chunk.stopReason);
    } else if (chunk.type === 'error') {
      this.terminalDispatched = true;
      this.handlers.onError(chunk.code, chunk.message);
    } else if (chunk.type === 'tool_call_delta') {
      this.handlers.onActivity?.({
        kind: 'tool_start',
        id: chunk.toolCallId,
        name: chunk.toolName,
      });
    } else if (chunk.type === 'tool_result') {
      this.handlers.onActivity?.({
        kind: 'tool_result',
        id: chunk.toolCallId,
        name: chunk.toolName,
        isError: chunk.isError,
        reason: chunk.reason,
        output:
          typeof chunk.output === 'string'
            ? chunk.reason === 'timeout'
              ? `原因：超时 · ${chunk.output}`
              : chunk.output
            : chunk.reason === 'timeout'
              ? '原因：超时'
              : undefined,
      });
    } else if (chunk.type === 'task_update') {
      this.handlers.onActivity?.({
        kind: 'task_update',
        id: chunk.taskId,
        name: chunk.assignedAgent ? `@${chunk.assignedAgent} · ${chunk.label}` : chunk.label,
        status:
          chunk.status === 'done'
            ? 'done'
            : chunk.status === 'failed' || chunk.status === 'cancelled'
              ? 'error'
              : 'running',
        assignedAgent: chunk.assignedAgent,
        reason: chunk.reason,
        sessionId: chunk.sessionId,
        output:
          chunk.errorMessage ??
          chunk.result ??
          (chunk.reason === 'timeout' ? '子任务执行超时。' : undefined) ??
          (chunk.status === 'cancelled' ? '子任务已取消。' : undefined),
      });
    }
  }

  send(message: string, options: StreamOptions = {}): void {
    // A send begins a new turn; allow onclose to surface a terminal event again.
    this.terminalDispatched = false;
    const agentId = options.agentId?.trim() || undefined;
    const dialogueMode = options.dialogueMode;
    const payload = JSON.stringify({
      ...(agentId ? { agentId } : {}),
      clientRequestId: crypto.randomUUID(),
      ...(options.displayMessage ? { displayMessage: options.displayMessage } : {}),
      ...(dialogueMode ? { dialogueMode } : {}),
      ...(options.inputParts ? { inputParts: options.inputParts } : {}),
      message,
      ...(options.yoloMode !== undefined ? { yoloMode: options.yoloMode } : {}),
    });

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return;
    }

    this.pendingPayloads.push(payload);
    // Evict oldest entries if the socket stayed un-OPEN long enough to
    // overflow the buffer (gateway unreachable / never connected).
    while (this.pendingPayloads.length > MAX_PENDING_PAYLOADS) {
      this.pendingPayloads.shift();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, 'user disconnect');
    this.ws = null;
    this.handlers = null;
    this.currentSessionId = null;
    this.pendingPayloads = [];
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export function useGatewayClient(gatewayUrl: string, token: string | null) {
  const clientRef = useRef<MobileGatewayClient | null>(null);

  useEffect(() => {
    if (!token) return;
    clientRef.current = new MobileGatewayClient(gatewayUrl, token);
    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [gatewayUrl, token]);

  const stream = useCallback(
    (sessionId: string, message: string, handlers: StreamHandlers, options: StreamOptions = {}) => {
      const client = clientRef.current;
      if (!client) return;
      client.connect(sessionId, handlers);
      client.send(message, options);
    },
    [],
  );

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  return { stream, disconnect };
}
