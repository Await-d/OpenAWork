import type { GatewayStreamEvent, SendMessageOptions, StreamEventHandler } from './gateway-ws.js';

export class GatewaySSEClient {
  private es: EventSource | null = null;
  private handlers: Set<StreamEventHandler> = new Set();
  private gatewayUrl: string;
  private token: string;

  constructor(gatewayUrl: string, token: string) {
    this.gatewayUrl = gatewayUrl;
    this.token = token;
  }

  connectAndStream(sessionId: string, message: string, options: SendMessageOptions = {}): void {
    this.es?.close();
    const clientRequestId = options.clientRequestId ?? crypto.randomUUID();

    const params = new URLSearchParams({
      clientRequestId,
      message,
      model: options.model ?? 'default',
      token: this.token,
      ...(options.temperature !== undefined ? { temperature: String(options.temperature) } : {}),
    });

    this.es = new EventSource(
      `${this.gatewayUrl}/sessions/${sessionId}/stream/sse?${params.toString()}`,
    );

    this.es.onmessage = (ev) => {
      const chunk = JSON.parse(ev.data as string) as GatewayStreamEvent;
      for (const h of this.handlers) h(chunk);
      if (chunk.type === 'done' || chunk.type === 'error') this.es?.close();
    };

    this.es.onerror = () => {
      const errChunk: GatewayStreamEvent = {
        type: 'error',
        code: 'SSE_ERROR',
        message: 'SSE connection error',
      };
      for (const h of this.handlers) h(errChunk);
      this.es?.close();
    };
  }

  onChunk(handler: StreamEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect(): void {
    this.es?.close();
    this.es = null;
  }
}
