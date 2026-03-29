import { useRef, useEffect, useCallback } from 'react';
import type { StreamChunk } from '@openAwork/shared';
import { extractRuntimeTextDelta } from '../chat-message-content.js';

export type StreamHandlers = {
  onDelta: (delta: string) => void;
  onDone: (stopReason: string) => void;
  onError: (code: string, message: string) => void;
};

export class MobileGatewayClient {
  private ws: WebSocket | null = null;
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
    this.ws = new WebSocket(`${base}/sessions/${sessionId}/stream`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (ev) => {
      const chunk = JSON.parse(ev.data as string) as StreamChunk;
      if (!this.handlers) return;
      if (chunk.type === 'text_delta') {
        this.handlers.onDelta(extractRuntimeTextDelta(chunk.delta));
      } else if (chunk.type === 'done') {
        this.handlers.onDone(chunk.stopReason);
      } else if (chunk.type === 'error') {
        this.handlers.onError(chunk.code, chunk.message);
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

  send(message: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        message,
        authorization: `Bearer ${this.token}`,
      }),
    );
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

  const stream = useCallback((sessionId: string, message: string, handlers: StreamHandlers) => {
    const client = clientRef.current;
    if (!client) return;
    client.connect(sessionId, handlers);
    const WS_HANDSHAKE_DELAY_MS = 100;
    setTimeout(() => client.send(message), WS_HANDSHAKE_DELAY_MS);
  }, []);

  return { stream };
}
