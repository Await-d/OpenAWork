import { useRef, useEffect, useCallback } from 'react';
import type { DialogueMode, RunEvent } from '@openAwork/shared';
import { extractRuntimeTextDelta, extractRuntimeThinkingDelta } from '../chat-message-content.js';

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
  dialogueMode?: DialogueMode;
  yoloMode?: boolean;
};

export class MobileGatewayClient {
  private ws: WebSocket | null = null;
  private pendingPayload: string | null = null;
  private gatewayUrl: string;
  private token: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private handlers: StreamHandlers | null = null;
  private currentSessionId: string | null = null;

  constructor(gatewayUrl: string, token: string) {
    this.gatewayUrl = gatewayUrl;
    this.token = token;
  }

  connect(sessionId: string, handlers: StreamHandlers): void {
    this.currentSessionId = sessionId;
    this.handlers = handlers;
    this.openConnection(sessionId);
  }

  private openConnection(sessionId: string): void {
    const protocol = this.gatewayUrl.startsWith('https') ? 'wss' : 'ws';
    const base = this.gatewayUrl.replace(/^https?/, protocol);
    const params = new URLSearchParams({ token: this.token });
    this.ws = new WebSocket(`${base}/sessions/${sessionId}/stream?${params.toString()}`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      if (this.pendingPayload) {
        this.ws?.send(this.pendingPayload);
        this.pendingPayload = null;
      }
      this.handlers?.onConnected?.();
    };

    this.ws.onmessage = (ev) => {
      const chunk = JSON.parse(ev.data as string) as RunEvent;
      if (!this.handlers) return;
      if (chunk.type === 'text_delta') {
        this.handlers.onDelta(extractRuntimeTextDelta(chunk.delta));
      } else if (chunk.type === 'thinking_delta') {
        this.handlers.onThinkingDelta?.(extractRuntimeThinkingDelta(chunk.delta));
      } else if (chunk.type === 'done') {
        this.handlers.onDone(chunk.stopReason);
      } else if (chunk.type === 'error') {
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
    };

    this.ws.onclose = (ev) => {
      if (!ev.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
          if (this.currentSessionId) this.openConnection(this.currentSessionId);
        }, delay);
      }
    };

    this.ws.onerror = () => {
      this.handlers?.onError('WS_ERROR', 'WebSocket connection error');
    };
  }

  send(message: string, options: StreamOptions = {}): void {
    const agentId = options.agentId?.trim() || undefined;
    const dialogueMode = options.dialogueMode;
    const payload = JSON.stringify({
      ...(agentId ? { agentId } : {}),
      clientRequestId: crypto.randomUUID(),
      ...(dialogueMode ? { dialogueMode } : {}),
      message,
      ...(options.yoloMode !== undefined ? { yoloMode: options.yoloMode } : {}),
    });

    if (!this.ws) {
      this.pendingPayload = payload;
      return;
    }

    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return;
    }

    this.pendingPayload = payload;
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, 'user disconnect');
    this.ws = null;
    this.handlers = null;
    this.currentSessionId = null;
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
