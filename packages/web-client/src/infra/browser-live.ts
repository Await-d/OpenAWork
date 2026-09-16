/**
 * `/browser-live` 客户端：浏览器实时预览的双向 WS 通道 + REST 控制端点。
 *
 * 设计要点：
 * - 通道建立后网关先下发 `hello`，随后持续推送 screencast 帧与 console / network / nav 事件；
 *   Web 端上行 input / ack / control 指令。
 * - 信封 `BrowserLiveEnvelope` 与上行 `BrowserLiveClientMessage` 由 `@openAwork/shared` 统一定义，
 *   本模块只负责传输，不重复定义协议。
 * - 与 `gateway-ws` 一致：CONNECTING 期间的上行消息进入有界 FIFO，open 后按序冲刷；
 *   `readyState` 非 OPEN 时不再入队，close 由终态标志去重，保证调用方只收到一次关闭通知。
 */

import { BROWSER_LIVE_REST_PREFIX, BROWSER_LIVE_WS_PATH } from '@openAwork/shared';
import type { BrowserLiveClientMessage, BrowserLiveEnvelope } from '@openAwork/shared';

import {
  authHeader,
  fetchWithTimeout,
  HttpError,
  jsonAuthHeaders,
  readJsonErrorData,
} from '../gateway/http.js';

export interface BrowserLiveStatus {
  available: boolean;
  engine: string | null;
  screencast: boolean;
  reason?: string;
  installable?: boolean;
  source?: string | null;
  expectedRevision?: string | null;
  executablePath?: string | null;
}

export interface BrowserLiveScreenshotResult {
  artifactId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface BrowserLiveCallbacks {
  onEnvelope(envelope: BrowserLiveEnvelope): void;
  onOpen?(): void;
  onClose?(info: { code: number; reason: string }): void;
  onError?(error: Error): void;
}

export interface BrowserLiveConnection {
  send(message: BrowserLiveClientMessage): void;
  readonly readyState: number;
  close(): void;
}

export interface BrowserLiveClient {
  getStatus(token: string, options?: { signal?: AbortSignal }): Promise<BrowserLiveStatus>;
  start(token: string, input: { url?: string }, options?: { signal?: AbortSignal }): Promise<void>;
  stop(token: string, options?: { signal?: AbortSignal }): Promise<void>;
  screenshot(
    token: string,
    input: { sessionId: string; fullPage?: boolean },
    options?: { signal?: AbortSignal },
  ): Promise<BrowserLiveScreenshotResult>;
  connect(input: { token: string; callbacks: BrowserLiveCallbacks }): BrowserLiveConnection;
}

/**
 * CONNECTING 未 OPEN 期间允许缓存的上行消息上限。超过即丢最旧（FIFO 淘汰）：
 * 网关不可达时 socket 永不打开，若不设上限，高频 input 事件会把数组撑成内存泄漏。
 * 与 `gateway-ws` 的 `MAX_PENDING_PAYLOADS` 保持一致。
 */
const MAX_PENDING_PAYLOADS = 64;

async function performBrowserLiveRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  const response = await input.request();
  if (!response.ok) {
    throw new HttpError(
      `${input.actionLabel}失败（HTTP ${response.status}）。`,
      response.status,
      await readJsonErrorData(response),
    );
  }
  if (input.parseJson === false || response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  // 端点允许 200 + 空 body（仅副作用），此时按无返回处理。
  if (text.length === 0) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

class BrowserLiveSocketConnection implements BrowserLiveConnection {
  private readonly ws: WebSocket;
  private readonly callbacks: BrowserLiveCallbacks;
  private pendingMessages: string[] = [];
  /** 调用方主动 close() 后置位，保证关闭只触发一次。 */
  private closed = false;
  /** 关闭回调只派发一次（浏览器可能重复触发 onclose）。 */
  private closeDispatched = false;

  constructor(baseUrl: string, token: string, callbacks: BrowserLiveCallbacks) {
    this.callbacks = callbacks;
    const params = new URLSearchParams({ token });
    const wsUrl = `${baseUrl.replace(/^http/, 'ws')}${BROWSER_LIVE_WS_PATH}?${params.toString()}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      // 按序冲刷 CONNECTING 期间缓存的消息；单槽缓存会丢失除最后一条外的全部指令。
      const queued = this.pendingMessages;
      this.pendingMessages = [];
      for (const payload of queued) {
        ws.send(payload);
      }
      this.callbacks.onOpen?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      let envelope: BrowserLiveEnvelope;
      try {
        envelope = JSON.parse(event.data as string) as BrowserLiveEnvelope;
      } catch {
        // 信封不是 RunEvent，不能复用 dispatchStreamEvent；解析失败只上报并继续收流。
        this.callbacks.onError?.(new Error('BROWSER_LIVE_INVALID_PAYLOAD'));
        return;
      }
      this.callbacks.onEnvelope(envelope);
    };

    ws.onerror = () => {
      this.callbacks.onError?.(new Error('BROWSER_LIVE_WS_ERROR'));
    };

    ws.onclose = (event: CloseEvent) => {
      if (this.closeDispatched) return;
      this.closeDispatched = true;
      this.callbacks.onClose?.({ code: event.code, reason: event.reason });
    };
  }

  send(message: BrowserLiveClientMessage): void {
    const payload = JSON.stringify(message);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return;
    }
    // CLOSING / CLOSED 时丢弃：socket 不会再打开，继续入队只会堆积无意义数据。
    if (this.ws.readyState !== WebSocket.CONNECTING) {
      return;
    }
    this.pendingMessages.push(payload);
    while (this.pendingMessages.length > MAX_PENDING_PAYLOADS) {
      this.pendingMessages.shift();
    }
  }

  get readyState(): number {
    return this.ws.readyState;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pendingMessages = [];
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

export function createBrowserLiveClient(baseUrl: string): BrowserLiveClient {
  return {
    async getStatus(token, options) {
      return performBrowserLiveRequest<BrowserLiveStatus>({
        actionLabel: '读取浏览器实时预览状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}${BROWSER_LIVE_REST_PREFIX}/status`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async start(token, input, options) {
      await performBrowserLiveRequest({
        actionLabel: '启动浏览器实时预览',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}${BROWSER_LIVE_REST_PREFIX}/start`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
            signal: options?.signal,
          }),
      });
    },

    async stop(token, options) {
      await performBrowserLiveRequest({
        actionLabel: '停止浏览器实时预览',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}${BROWSER_LIVE_REST_PREFIX}/stop`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            // Fastify 5 收到 JSON content-type 的空 body 会直接 400，stop 无入参也需发合法 JSON。
            body: '{}',
            signal: options?.signal,
          }),
      });
    },

    async screenshot(token, input, options) {
      return performBrowserLiveRequest<BrowserLiveScreenshotResult>({
        actionLabel: '获取浏览器实时预览截图',
        request: () =>
          fetchWithTimeout(`${baseUrl}${BROWSER_LIVE_REST_PREFIX}/screenshot`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
            signal: options?.signal,
          }),
      });
    },

    connect(input) {
      return new BrowserLiveSocketConnection(baseUrl, input.token, input.callbacks);
    },
  };
}
