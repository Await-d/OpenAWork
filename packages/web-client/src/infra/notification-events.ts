import type { NotificationRecord } from './notifications.js';

/**
 * `/notification-events` 通道的客户端封装。
 *
 * 协议极简：服务端只推「脏标记 + 权威红点数」，不推完整通知结构；列表内容由调用方
 * 自行走 `createNotificationsClient().list()` 拉一次。这样 WS 侧不必复刻 HTTP 的序列化，
 * 也就不会出现「WS 与 REST 字段漂移」这类双维护陷阱。
 *
 * 一致性由握手快照兜底：每次连接建立（含每次重连）自动发 `sync` 换一份全量快照。
 * 总线不重放事件，所以断线期间的变更靠这一步补齐——这也是这套机制**不需要任何定时
 * 轮询**的原因。
 */

const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const CLIENT_PING_INTERVAL_MS = 15_000;
const LIVENESS_TIMEOUT_MS = 40_000;

export type NotificationChangeReason =
  'acted' | 'archived' | 'created' | 'expired' | 'read' | 'updated';

export type NotificationEventsStatus = 'closed' | 'connected' | 'connecting' | 'reconnecting';

export interface NotificationEventsSnapshot {
  browserBroadcasts: NotificationRecord[];
  notifications: NotificationRecord[];
  pendingActionableCount: number;
}

export interface NotificationChangedEvent {
  pendingActionableCount: number;
  reason: NotificationChangeReason;
  timestamp: number;
  type: 'notification.changed';
}

export interface NotificationEventsHandlers {
  onChange?(event: NotificationChangedEvent): void;
  onError?(error: Error): void;
  onSnapshot?(snapshot: NotificationEventsSnapshot): void;
  onStatusChange?(status: NotificationEventsStatus): void;
}

export interface NotificationEventsConnection {
  /** 主动断开并停止重连（登出、token 失效、组件卸载）。 */
  close(): void;
  /** 手动补一次全量快照。 */
  requestSnapshot(): void;
}

/** 服务端可能发出的帧。未识别的 type 一律忽略——协议向前兼容，不因新增事件类型而崩。 */
interface ConnectedFrame {
  type: 'connected';
  userId: string;
}

interface ErrorFrame {
  code: string;
  type: 'error';
}

interface PongFrame {
  timestamp: number;
  type: 'pong';
}

/** 快照 = 权威数据 + 帧标签。数据部分与 HTTP 响应体同构。 */
type SnapshotFrame = NotificationEventsSnapshot & { type: 'notification.snapshot' };

type ServerFrame =
  ConnectedFrame | ErrorFrame | NotificationChangedEvent | PongFrame | SnapshotFrame;

export function createNotificationEventsConnection(input: {
  gatewayUrl: string;
  handlers: NotificationEventsHandlers;
  token: string;
}): NotificationEventsConnection {
  const { gatewayUrl, handlers, token } = input;

  let manualClose = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let livenessTimer: ReturnType<typeof setInterval> | null = null;
  let status: NotificationEventsStatus = 'closed';
  let ws: WebSocket | null = null;
  let lastMessageAt = 0;

  const setStatus = (next: NotificationEventsStatus): void => {
    if (status === next) return;
    status = next;
    safeInvoke(() => handlers.onStatusChange?.(next));
  };

  const stopTimers = (): void => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (livenessTimer) {
      clearInterval(livenessTimer);
      livenessTimer = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (manualClose || reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    reconnectAttempt += 1;
    setStatus('reconnecting');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  };

  const handleClose = (socket: WebSocket): void => {
    if (ws === socket) {
      ws = null;
    }
    stopTimers();
    if (manualClose) {
      setStatus('closed');
      return;
    }
    scheduleReconnect();
  };

  const requestSnapshot = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: 'sync' }));
    } catch (error) {
      safeInvoke(() => handlers.onError?.(toError(error)));
    }
  };

  function open(): void {
    if (manualClose) return;
    setStatus(reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    const protocol = gatewayUrl.startsWith('https') ? 'wss' : 'ws';
    const base = gatewayUrl.replace(/^https?/, protocol);
    const params = new URLSearchParams({ token });

    let socket: WebSocket;
    try {
      socket = new WebSocket(`${base}/notification-events?${params.toString()}`);
    } catch (error) {
      // 环境可能根本没有 WebSocket 实现（Node 测试、SSR）。它只是拿不到实时推送，
      // 不该把整个应用炸掉——退化成「没有实时性」而不是崩溃。
      safeInvoke(() => handlers.onError?.(toError(error)));
      scheduleReconnect();
      return;
    }

    // 闭包捕获：迟到的 onclose / onmessage 不得干扰后来建立的新连接。
    const current = socket;
    ws = current;
    reconnectAttempt = 0;
    lastMessageAt = Date.now();

    current.onopen = () => {
      if (ws !== current) return;
      setStatus('connected');
      // 握手即对账：漏掉的重连前事件在这一步被全量快照覆盖。
      requestSnapshot();
      startProbes(current);
    };

    current.onmessage = (event: MessageEvent) => {
      if (ws !== current) return;
      lastMessageAt = Date.now();
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(event.data)) as ServerFrame;
      } catch (error) {
        safeInvoke(() => handlers.onError?.(toError(error)));
        return;
      }
      if (frame.type === 'notification.changed') {
        safeInvoke(() => handlers.onChange?.(frame));
        return;
      }
      if (frame.type === 'notification.snapshot') {
        safeInvoke(() =>
          handlers.onSnapshot?.({
            browserBroadcasts: frame.browserBroadcasts ?? [],
            notifications: frame.notifications ?? [],
            pendingActionableCount: frame.pendingActionableCount ?? 0,
          }),
        );
        return;
      }
      if (frame.type === 'error') {
        safeInvoke(() => handlers.onError?.(new Error(`通知通道错误：${frame.code}`)));
        // 鉴权类错误重连无意义——token 失效只会让服务端继续拒连，白白空转退避。
        if (frame.code === 'UNAUTHORIZED') {
          manualClose = true;
          setStatus('closed');
          current.close();
        }
      }
    };

    current.onclose = () => {
      handleClose(current);
    };
    current.onerror = () => {
      // 真正的 close 事件会紧随其后，这里只保证半开 socket 也会走到 handleClose。
      if (ws === current) {
        current.close();
      }
    };
  }

  function startProbes(current: WebSocket): void {
    stopTimers();
    pingTimer = setInterval(() => {
      try {
        current.send(JSON.stringify({ type: 'ping' }));
      } catch {
        current.close();
      }
    }, CLIENT_PING_INTERVAL_MS);
    livenessTimer = setInterval(() => {
      if (Date.now() - lastMessageAt > LIVENESS_TIMEOUT_MS) {
        // 服务端每 10s ping 一次且对应用层 ping 必回 pong，40s 全静默只能是链路已死。
        current.close();
      }
    }, CLIENT_PING_INTERVAL_MS);
  }

  open();

  return {
    close(): void {
      manualClose = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      stopTimers();
      const current = ws;
      ws = null;
      setStatus('closed');
      if (current) {
        current.onclose = null;
        current.onmessage = null;
        current.onerror = null;
        current.close();
      }
    },
    requestSnapshot,
  };
}

/**
 * handler 抛错不得影响 socket 生命周期——它由外部订阅者（React effect）提供，
 * 一次异常不该把整条通知链带走。
 */
function safeInvoke(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.error('[notification-events] handler threw, isolating', error);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
