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

import {
  BROWSER_LIVE_BINARY_FRAME_KIND,
  BROWSER_LIVE_REST_PREFIX,
  BROWSER_LIVE_WS_PATH,
} from '@openAwork/shared';
import type {
  BrowserLiveBinaryFramePayload,
  BrowserLiveClientMessage,
  BrowserLiveEnvelope,
  BrowserLiveFrameBinaryHeader,
} from '@openAwork/shared';

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

/** 应用内安装调试浏览器的状态机快照。 */
export type BrowserInstallState = 'idle' | 'running' | 'succeeded' | 'failed' | 'unavailable';

export interface BrowserInstallStatus {
  state: BrowserInstallState;
  startedAt: number | null;
  finishedAt: number | null;
  /** 最近若干行安装输出，用于展示进度。 */
  tailLog: string[];
  error: string | null;
  browsersPath: string | null;
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
  /** 触发应用内安装调试浏览器；若已有安装在进行中，网关返回 409（HttpError）。 */
  installBrowser(token: string, options?: { signal?: AbortSignal }): Promise<void>;
  getInstallStatus(
    token: string,
    options?: { signal?: AbortSignal },
  ): Promise<BrowserInstallStatus>;
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

/**
 * 解析二进制帧消息（线路格式见 shared 的 `BROWSER_LIVE_BINARY_FRAME_KIND`）。
 *
 * 任何校验失败都返回 null 而不是抛出：线路数据不可信，坏一帧只该丢一帧。
 */
export function parseBinaryFrameMessage(
  data: ArrayBuffer,
): BrowserLiveEnvelope<BrowserLiveBinaryFramePayload> | null {
  if (data.byteLength < 5) return null;
  const view = new DataView(data);
  if (view.getUint8(0) !== BROWSER_LIVE_BINARY_FRAME_KIND) return null;
  const headerLength = view.getUint32(1, true);
  if (headerLength <= 0 || 5 + headerLength >= data.byteLength) return null;

  let header: BrowserLiveFrameBinaryHeader;
  try {
    header = JSON.parse(
      new TextDecoder().decode(new Uint8Array(data, 5, headerLength)),
    ) as BrowserLiveFrameBinaryHeader;
  } catch {
    return null;
  }
  if (
    typeof header.deviceWidth !== 'number' ||
    typeof header.deviceHeight !== 'number' ||
    typeof header.frameSessionId !== 'number'
  ) {
    return null;
  }

  return {
    ch: 'frame',
    seq: typeof header.seq === 'number' ? header.seq : 0,
    ts: typeof header.ts === 'number' ? header.ts : Date.now(),
    payload: {
      mimeType: 'image/jpeg',
      // 复制一次图像字节：Blob 需要独立 buffer，不能长期占着整条 WS 的缓冲区
      // （`slice` 在这里既完成复制又保持 `ArrayBuffer` 类型，后续 decode 直接吃它）。
      data: data.slice(5 + headerLength),
      deviceWidth: header.deviceWidth,
      deviceHeight: header.deviceHeight,
      offsetTop: typeof header.offsetTop === 'number' ? header.offsetTop : 0,
      pageScaleFactor: typeof header.pageScaleFactor === 'number' ? header.pageScaleFactor : 1,
      scrollOffsetX: typeof header.scrollOffsetX === 'number' ? header.scrollOffsetX : 0,
      scrollOffsetY: typeof header.scrollOffsetY === 'number' ? header.scrollOffsetY : 0,
      frameSessionId: header.frameSessionId,
      // 代次透传给画面管线：二进制路径同样要能丢弃旧页面的迟到帧。
      ...(typeof header.generation === 'number' ? { generation: header.generation } : {}),
    },
  };
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
    // 二进制帧走 ArrayBuffer；不设这个时浏览器会给 Blob，每帧还要异步读一次。
    ws.binaryType = 'arraybuffer';
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
      // 二进制帧（controller 协商 `binary: true` 后出现）：不经过 JSON，直接构造信封。
      if (event.data instanceof ArrayBuffer) {
        const binaryFrame = parseBinaryFrameMessage(event.data);
        if (binaryFrame === null) {
          this.callbacks.onError?.(new Error('BROWSER_LIVE_INVALID_PAYLOAD'));
          return;
        }
        this.callbacks.onEnvelope(binaryFrame);
        return;
      }
      if (typeof event.data !== 'string') {
        // Blob（binaryType 未生效）或其它可传输对象：当前协议不认识，丢弃并上报。
        this.callbacks.onError?.(new Error('BROWSER_LIVE_INVALID_PAYLOAD'));
        return;
      }
      let envelope: BrowserLiveEnvelope;
      try {
        envelope = JSON.parse(event.data) as BrowserLiveEnvelope;
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

    async installBrowser(token, options) {
      await performBrowserLiveRequest({
        actionLabel: '安装调试浏览器',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}${BROWSER_LIVE_REST_PREFIX}/install-browser`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            // Fastify 5 收到 JSON content-type 的空 body 会直接 400；无入参也需发合法 JSON。
            body: '{}',
            signal: options?.signal,
          }),
      });
    },

    async getInstallStatus(token, options) {
      return performBrowserLiveRequest<BrowserInstallStatus>({
        actionLabel: '读取调试浏览器安装状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}${BROWSER_LIVE_REST_PREFIX}/install-browser/status`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    connect(input) {
      return new BrowserLiveSocketConnection(baseUrl, input.token, input.callbacks);
    },
  };
}
