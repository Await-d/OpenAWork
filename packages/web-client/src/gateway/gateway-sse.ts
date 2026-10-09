import { dispatchStreamEvent } from './gateway-ws.js';
import type { GatewayStreamEvent, SendMessageOptions, StreamEventHandler } from './gateway-ws.js';

/**
 * 浏览器端 SSE 客户端。
 *
 * 排障要点（此前缺失，故障后完全无法定位）：
 * - `EventSource` 的 `onerror` **不提供任何底层原因**，只看 `readyState` 无法区分
 *   「网关未启动 / CORS 拦截 / 认证失败 / 连接被重置」。这里把**可观测的状态全部
 *   写进 `technicalDetail`**（readyState、已接收事件数、经过时长、地址、会话），
 *   使这条错误在客户端侧不至于丢失全部根因信息。
 * - 解析失败时保留原始数据片段：只报「SSE 数据解析失败」无法定位是哪一段协议
 *   不兼容（网关升级 / 代理改写）。
 */
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

    // 连接诊断上下文：只在本次连接生命周期内有效，故声明为局部状态。
    const startedAt = Date.now();
    let receivedEvents = 0;

    this.es.onopen = () => {
      receivedEvents += 1;
    };

    this.es.onmessage = (ev) => {
      receivedEvents += 1;
      let chunk: GatewayStreamEvent;
      try {
        chunk = JSON.parse(ev.data as string) as GatewayStreamEvent;
      } catch {
        const errChunk: GatewayStreamEvent = {
          type: 'error',
          code: 'SSE_INVALID_PAYLOAD',
          message: 'SSE 数据解析失败。',
          technicalDetail: this.buildDiagnosticDetail(sessionId, {
            receivedEvents,
            startedAt,
            extra: `无法解析的事件数据：${String(ev.data).slice(0, 200)}`,
          }),
        };
        dispatchStreamEvent(this.handlers, errChunk);
        this.es?.close();
        return;
      }
      dispatchStreamEvent(this.handlers, chunk);
      if (chunk.type === 'done' || chunk.type === 'error') this.es?.close();
    };

    this.es.onerror = () => {
      const errChunk: GatewayStreamEvent = {
        type: 'error',
        code: 'SSE_ERROR',
        message: 'SSE 连接异常。',
        technicalDetail: this.buildDiagnosticDetail(sessionId, {
          receivedEvents,
          startedAt,
          extra: `浏览器没有提供底层失败原因；readyState=${this.es?.readyState ?? 'unknown'}`,
        }),
      };
      dispatchStreamEvent(this.handlers, errChunk);
      this.es?.close();
    };
  }

  /**
   * 拼装错误诊断正文。
   *
   * 只取 origin 而非完整 URL：`params` 里带着 `message` 与 `token`，整串带出去会
   * 把用户输入和令牌写进错误日志与 UI 文本。
   */
  private buildDiagnosticDetail(
    sessionId: string,
    info: { receivedEvents: number; startedAt: number; extra?: string },
  ): string {
    let gateway = this.gatewayUrl;
    try {
      gateway = new URL(this.gatewayUrl).origin;
    } catch {
      // 连接配置无效时保留原始值，便于用户修正网关地址。
    }
    const parts = [
      `Gateway：${gateway}`,
      `会话：${sessionId}`,
      `已接收事件数：${info.receivedEvents}`,
      `连接时长：${Math.max(0, Date.now() - info.startedAt)}ms`,
    ];
    if (info.extra) parts.push(info.extra);
    parts.push('常见原因：网关未启动、地址/端口错误、登录已失效、网络中断。');
    return parts.join('；');
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
