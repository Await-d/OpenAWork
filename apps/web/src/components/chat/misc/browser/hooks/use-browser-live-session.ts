/**
 * CDP 实时预览通道（`/browser-live`）的会话生命周期。
 *
 * 职责：
 * - 从既有认证 store 取 `gatewayUrl` + `token`（不经过 props 传递），用 REST
 *   `/browser-live/status` 判断引擎可用性；
 * - 可用时建立 WS 通道，把网关下行的 `hello / frame / console / network / node /
 *   error` 信封扇出给所有订阅者（帧渲染、控制台桥接、元素拾取各自订阅）；
 * - 掉线后按 500ms → 1s → 2s → 4s 退避重连（最多 5 次），重连成功必须重发
 *   `control.screencast.start`——hub 只为「新 controller」恢复产帧，否则预览会
 *   停在最后一帧。
 *
 * 注意：本 hook 只做传输与生命周期，不做任何 UI 决策。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserLiveClient } from '@openAwork/web-client';
import type {
  BrowserLiveCallbacks,
  BrowserLiveClient,
  BrowserLiveConnection,
  BrowserLiveStatus,
} from '@openAwork/web-client';
import type {
  BrowserLiveClientMessage,
  BrowserLiveEnvelope,
  BrowserLiveHelloPayload,
} from '@openAwork/shared';

import { useAuthStore } from '../../../../../stores/auth/auth.js';

export type BrowserLivePhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** 重连退避序列：500ms → 1s → 2s → 4s；超出序列后沿用最后一个值。 */
export const BROWSER_LIVE_RECONNECT_DELAYS_MS: readonly number[] = [500, 1000, 2000, 4000];

/** 单次停线允许的最大重连次数；用尽后进入 `error` 终态。 */
export const BROWSER_LIVE_MAX_RECONNECT_ATTEMPTS = 5;

/**
 * `send` 在连接建立前的待发队列上限。React 的 effect 顺序是子先父后：引擎在挂载期
 * 发出的 `navigate` / `screencast.start` 早于父 hook 建连，必须缓冲而不是丢弃。
 * 溢出时丢最旧（FIFO 淘汰），生产者失控时只保留最近的意图，避免内存无限增长。
 * 与 web-client socket 层的 `MAX_PENDING_PAYLOADS` 保持同一数量级。
 */
export const BROWSER_LIVE_MAX_PENDING_SENDS = 64;

/** 截图等待上限；超时按失败返回，避免调用方的 Promise 永久挂起。 */
const SCREENSHOT_TIMEOUT_MS = 15_000;

/** WS `screenshot` 回复的是内联 base64（需要 artifact 请走 REST 端点）。 */
export interface BrowserLiveScreenshotFrame {
  data: string;
  mimeType: string;
  fullPage: boolean;
}

export interface BrowserLiveSession {
  availability: BrowserLiveStatus | null;
  phase: BrowserLivePhase;
  lastError: string | null;
  /** 网关声明不可用时给用户的中文可操作提示；可用 / 未探测时为 null。 */
  unavailableHint: string | null;
  send: (message: BrowserLiveClientMessage) => void;
  screenshot: (options?: { fullPage?: boolean }) => Promise<BrowserLiveScreenshotFrame | null>;
  close: () => void;
  /** 重新探测网关可用性（安装调试浏览器成功后调用，无需刷新页面即可接入实时引擎）。 */
  recheckAvailability: () => void;
  /** 订阅下行信封；返回取消订阅函数。多个消费者（帧渲染 / 控制台桥接）互不影响。 */
  subscribe: (listener: (envelope: BrowserLiveEnvelope) => void) => () => void;
}

export interface UseBrowserLiveSessionOptions {
  /** 是否启用通道；false 时完全不发请求（Tauri 原生 webview / fallback 场景）。 */
  enabled: boolean;
  /** 测试注入点；缺省用 `createBrowserLiveClient`。 */
  clientFactory?: (baseUrl: string) => BrowserLiveClient;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return typeof error === 'string' ? error : '实时预览不可用。';
}

/**
 * 网关运行环境未启用实时预览时下发的 reason 契约串。
 *
 * 网关把它作为 `reason` 原样下发（`BROWSER_LIVE_DISABLED_MESSAGE`），不是探针
 * token；Web 端不能 import 网关包，只能按同一字面量匹配。
 */
export const BROWSER_LIVE_DISABLED_REASON = 'browser live view is disabled in this runtime';

/**
 * 把协议里机器可读的 `reason` 翻译成用户可操作的中文提示。
 *
 * 覆盖探针的四个 token（`ready` 只会在可用状态出现，不会走到这里）与
 * disabled-runtime 契约串；未知 reason 不外泄原始 token，只给通用提示，
 * 原始值仍保留在控制台可见的 `availability.reason` 里。
 */
export function describeBrowserLiveUnavailable(reason: string | null | undefined): string | null {
  if (typeof reason !== 'string' || reason.length === 0) {
    return null;
  }
  switch (reason) {
    case 'browser-missing':
      return '未检测到可用的调试浏览器：可点击下方「安装调试浏览器」自动安装，或安装 Chrome/Edge，也可执行 npx playwright install chromium；当前已自动切换为 iframe 预览。';
    case 'browser-outdated':
      return '调试浏览器版本与当前 Playwright 不匹配：可点击下方「安装调试浏览器」重新安装，也可重新执行 npx playwright install chromium；当前已自动切换为 iframe 预览。';
    case 'probe-failed':
      return '调试浏览器检测失败，请稍后重试或确认 Playwright 浏览器安装完整；当前已自动切换为 iframe 预览。';
    case BROWSER_LIVE_DISABLED_REASON:
      return '当前网关未启用浏览器实时预览：设置 OPENAWORK_BROWSER_LIVE=1 后重启网关（桌面端 sidecar 由 DESKTOP_AUTOMATION=1 启用）；当前已自动切换为 iframe 预览。';
    default:
      return '浏览器实时预览不可用，当前已自动切换为 iframe 预览。';
  }
}

/** 校验并收敛 `screenshot` 信封载荷；形状不符时返回 null 而不是抛出。 */
function toScreenshotFrame(payload: unknown): BrowserLiveScreenshotFrame | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const data = record['data'];
  if (typeof data !== 'string' || data.length === 0) return null;
  return {
    data,
    mimeType: typeof record['mimeType'] === 'string' ? record['mimeType'] : 'image/jpeg',
    fullPage: record['fullPage'] === true,
  };
}

export function useBrowserLiveSession({
  enabled,
  clientFactory = createBrowserLiveClient,
}: UseBrowserLiveSessionOptions): BrowserLiveSession {
  const token = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);

  const [availability, setAvailability] = useState<BrowserLiveStatus | null>(null);
  const [phase, setPhase] = useState<BrowserLivePhase>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  /** 递增即强制重新探测可用性（安装完成后接入实时引擎，无需刷新页面）。 */
  const [availabilityNonce, setAvailabilityNonce] = useState(0);

  const listenersRef = useRef(new Set<(envelope: BrowserLiveEnvelope) => void>());
  const connectionRef = useRef<BrowserLiveConnection | null>(null);
  /** 连接就绪前缓冲的上行消息；首个下行信封到达时按 FIFO 冲刷。 */
  const pendingSendsRef = useRef<BrowserLiveClientMessage[]>([]);
  /**
   * 网关在 `hello` 之前仍处于 acquire（冷启动要拉起浏览器），尚未挂上消息监听；
   * 这段时间发出的上行消息会被直接丢弃。首个信封到达才算通道真正可用。
   */
  const channelReadyRef = useRef(false);
  /** `close()` 后置位：本次 effect 生命周期内不再重连。 */
  const stoppedRef = useRef(false);
  const screenshotRef = useRef<((frame: BrowserLiveScreenshotFrame | null) => void) | null>(null);

  const client = useMemo(
    () => (enabled && token ? clientFactory(gatewayUrl) : null),
    [enabled, token, gatewayUrl, clientFactory],
  );

  // ── 可用性握手：REST /browser-live/status ───────────────────────────
  useEffect(() => {
    if (!client || !token) {
      setAvailability(null);
      return;
    }

    let disposed = false;
    const controller = new AbortController();
    client
      .getStatus(token, { signal: controller.signal })
      .then((status) => {
        if (!disposed) setAvailability(status);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setAvailability({
          available: false,
          engine: null,
          screencast: false,
          reason: describeError(error),
        });
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [client, token, availabilityNonce]);

  const available = availability?.available === true;
  const unavailableHint = useMemo(
    () =>
      availability && !availability.available
        ? describeBrowserLiveUnavailable(availability.reason)
        : null,
    [availability],
  );

  // ── 通道生命周期 + 重连 ─────────────────────────────────────────────
  useEffect(() => {
    if (!client || !token || !available) return;

    stoppedRef.current = false;
    let disposed = false;
    /** 网关明确声明不可用时置位：不再重连（重试同一个 503 没有意义）。 */
    let fatal = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active: BrowserLiveConnection | null = null;

    const clearTimer = (): void => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    };

    const settleScreenshot = (frame: BrowserLiveScreenshotFrame | null): void => {
      const resolve = screenshotRef.current;
      screenshotRef.current = null;
      resolve?.(frame);
    };

    /** 丢弃待发队列：终态 / 会话关闭后，旧消息不能落到下一个连接里。 */
    const clearPendingSends = (): void => {
      pendingSendsRef.current = [];
    };

    /** 通道可用后按 FIFO 冲刷缓冲消息；队列只属于当前连接代次。 */
    const flushPendingSends = (connection: BrowserLiveConnection): void => {
      const pending = pendingSendsRef.current;
      if (pending.length === 0) return;
      pendingSendsRef.current = [];
      for (const message of pending) {
        connection.send(message);
      }
    };

    const open = (isReconnect: boolean): void => {
      if (disposed) return;
      channelReadyRef.current = false;
      setPhase(isReconnect ? 'reconnecting' : 'connecting');

      const callbacks: BrowserLiveCallbacks = {
        onEnvelope: (envelope) => {
          if (disposed) return;

          // 首个信封 = 网关已完成 acquire 并挂上消息监听：此刻才能把缓冲的上行消息交给
          // 连接。早于 hello 直接发送会在网关的 acquire 窗口里被静默丢弃（冷会话必丢 navigate）。
          if (!channelReadyRef.current) {
            channelReadyRef.current = true;
            const connection = connectionRef.current;
            if (connection !== null) flushPendingSends(connection);
          }

          if (envelope.ch === 'hello') {
            const hello = envelope.payload as BrowserLiveHelloPayload;
            setAvailability({
              available: hello.available === true,
              engine: typeof hello.engine === 'string' ? hello.engine : null,
              screencast: hello.screencast === true,
              ...(typeof hello.reason === 'string' ? { reason: hello.reason } : {}),
            });
            if (hello.available !== true) {
              fatal = true;
              clearPendingSends();
              setLastError(
                typeof hello.reason === 'string' && hello.reason.length > 0
                  ? hello.reason
                  : '实时预览不可用。',
              );
              setPhase('error');
              active?.close();
              return;
            }
            // hello 每个连接一次：重连后在这里重新请求 screencast，hub 才会为新的
            // controller 恢复产帧；不支持 screencast 的引擎则安静降级。
            if (hello.screencast === true) {
              active?.send({ ch: 'control', action: 'screencast.start' });
            }
          }

          if (envelope.ch === 'screenshot') {
            settleScreenshot(toScreenshotFrame(envelope.payload));
          }

          for (const listener of listenersRef.current) {
            listener(envelope);
          }
        },
        onOpen: () => {
          if (disposed || fatal) return;
          attempt = 0;
          setLastError(null);
          setPhase('connected');
        },
        onClose: ({ code, reason }) => {
          if (disposed || fatal) return;
          channelReadyRef.current = false;
          connectionRef.current = null;
          if (stoppedRef.current) {
            setPhase('idle');
            return;
          }
          if (attempt >= BROWSER_LIVE_MAX_RECONNECT_ATTEMPTS) {
            clearPendingSends();
            setPhase('error');
            setLastError(`实时通道已断开（${code}）${reason.length > 0 ? `：${reason}` : ''}`);
            return;
          }
          const delay =
            BROWSER_LIVE_RECONNECT_DELAYS_MS[
              Math.min(attempt, BROWSER_LIVE_RECONNECT_DELAYS_MS.length - 1)
            ] ?? 4000;
          attempt += 1;
          setPhase('reconnecting');
          timer = setTimeout(() => {
            timer = null;
            open(true);
          }, delay);
        },
        onError: (error) => {
          if (disposed) return;
          setLastError(error.message);
        },
      };

      active = client.connect({ token, callbacks });
      connectionRef.current = active;
    };

    open(false);

    return () => {
      disposed = true;
      channelReadyRef.current = false;
      clearTimer();
      settleScreenshot(null);
      clearPendingSends();
      const connection = active;
      active = null;
      connectionRef.current = null;
      connection?.close();
      setPhase('idle');
    };
  }, [client, token, available]);

  /**
   * 上行发送：通道可用（收到首个下行信封）前一律进入有界待发队列，之后按 FIFO 补发。
   * React 的 effect 顺序是「子先父后」，消费方挂载期的首条指令必然早于本 hook 建连；
   * 而建连成功也不等于网关可收——acquire 窗口内的消息会被丢弃，所以以 hello 为界。
   */
  const send = useCallback((message: BrowserLiveClientMessage): void => {
    const connection = connectionRef.current;
    if (connection !== null && channelReadyRef.current) {
      connection.send(message);
      return;
    }
    const pending = pendingSendsRef.current;
    pending.push(message);
    while (pending.length > BROWSER_LIVE_MAX_PENDING_SENDS) {
      pending.shift();
    }
  }, []);

  const screenshot = useCallback(
    async (options?: { fullPage?: boolean }): Promise<BrowserLiveScreenshotFrame | null> => {
      const connection = connectionRef.current;
      if (!connection) return null;

      return new Promise<BrowserLiveScreenshotFrame | null>((resolve) => {
        // 同一时刻只保留一个等待者：新的截图请求直接作废上一个。
        screenshotRef.current?.(null);

        const timer = setTimeout(() => {
          screenshotRef.current = null;
          resolve(null);
        }, SCREENSHOT_TIMEOUT_MS);

        screenshotRef.current = (frame) => {
          clearTimeout(timer);
          resolve(frame);
        };

        connection.send({
          ch: 'control',
          action: 'screenshot',
          ...(options?.fullPage !== undefined ? { fullPage: options.fullPage } : {}),
        });
      });
    },
    [],
  );

  const close = useCallback((): void => {
    stoppedRef.current = true;
    channelReadyRef.current = false;
    pendingSendsRef.current = [];
    const connection = connectionRef.current;
    connectionRef.current = null;
    connection?.close();
    screenshotRef.current?.(null);
    setPhase('idle');
  }, []);

  const subscribe = useCallback(
    (listener: (envelope: BrowserLiveEnvelope) => void): (() => void) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  const recheckAvailability = useCallback((): void => {
    setAvailabilityNonce((value) => value + 1);
  }, []);

  return useMemo(
    () => ({
      availability,
      phase,
      lastError,
      unavailableHint,
      send,
      screenshot,
      close,
      recheckAvailability,
      subscribe,
    }),
    [
      availability,
      phase,
      lastError,
      unavailableHint,
      send,
      screenshot,
      close,
      recheckAvailability,
      subscribe,
    ],
  );
}
