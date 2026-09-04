import { dispatchStreamEvent } from './gateway-ws.js';
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
    const agentId = options.agentId?.trim() || undefined;

    const params = new URLSearchParams({
      ...(agentId ? { agentId } : {}),
      clientRequestId,
      ...(options.dialogueMode ? { dialogueMode: options.dialogueMode } : {}),
      ...(options.inputParts ? { inputParts: JSON.stringify(options.inputParts) } : {}),
      message,
      model: options.model ?? 'default',
      token: this.token,
      ...(options.temperature !== undefined ? { temperature: String(options.temperature) } : {}),
      ...(options.yoloMode !== undefined ? { yoloMode: options.yoloMode ? '1' : '0' } : {}),
    });

    this.es = new EventSource(
      `${this.gatewayUrl}/sessions/${sessionId}/stream/sse?${params.toString()}`,
    );

    this.es.onmessage = (ev) => {
      let chunk: GatewayStreamEvent;
      try {
        chunk = JSON.parse(ev.data as string) as GatewayStreamEvent;
      } catch {
        const errChunk: GatewayStreamEvent = {
          type: 'error',
          code: 'SSE_INVALID_PAYLOAD',
          message: 'SSE 数据解析失败。',
        };
        dispatchStreamEvent(this.handlers, errChunk);
        this.es?.close();
        return;
      }
      dispatchStreamEvent(this.handlers, chunk);
      if (chunk.type === 'done' || chunk.type === 'error') this.es?.close();
    };

    this.es.onerror = () => {
      let gateway = this.gatewayUrl;
      try {
        gateway = new URL(this.gatewayUrl).origin;
      } catch {
        // 连接配置无效时保留原始值，便于用户修正网关地址。
      }
      const errChunk: GatewayStreamEvent = {
        type: 'error',
        code: 'SSE_ERROR',
        message: 'SSE 连接异常。',
        technicalDetail:
          `连接在收到 SSE 响应前中断。Gateway：${gateway}；会话：${sessionId}。` +
          '浏览器没有提供底层失败原因。',
      };
      dispatchStreamEvent(this.handlers, errChunk);
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
