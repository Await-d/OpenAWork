import type { StreamChunk } from '@openAwork/shared';

export type StreamChunkHandler = (chunk: StreamChunk) => void;

export interface SendMessageOptions {
  clientRequestId?: string;
  model?: string;
  temperature?: number;
}

export class GatewayWebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Set<StreamChunkHandler> = new Set();
  private pendingPayload: string | null = null;
  private gatewayUrl: string;
  private token: string;

  constructor(gatewayUrl: string, token: string) {
    this.gatewayUrl = gatewayUrl;
    this.token = token;
  }

  connect(sessionId: string): void {
    const protocol = this.gatewayUrl.startsWith('https') ? 'wss' : 'ws';
    const base = this.gatewayUrl.replace(/^https?/, protocol);
    const params = new URLSearchParams({ token: this.token });
    this.ws = new WebSocket(`${base}/sessions/${sessionId}/stream?${params.toString()}`);

    this.ws.onopen = () => {
      if (this.pendingPayload) {
        this.ws?.send(this.pendingPayload);
        this.pendingPayload = null;
      }
    };

    this.ws.onmessage = (ev) => {
      const chunk = JSON.parse(ev.data as string) as StreamChunk;
      for (const h of this.handlers) h(chunk);
    };

    this.ws.onerror = () => {
      const errChunk: StreamChunk = { type: 'error', code: 'WS_ERROR', message: 'WebSocket error' };
      for (const h of this.handlers) h(errChunk);
    };
  }

  send(message: string, options: SendMessageOptions = {}): void {
    const clientRequestId = options.clientRequestId ?? crypto.randomUUID();
    const payload = JSON.stringify({
      clientRequestId,
      message,
      model: options.model ?? 'default',
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    });

    if (!this.ws) return;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return;
    }
    this.pendingPayload = payload;
  }

  onChunk(handler: StreamChunkHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.pendingPayload = null;
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}
