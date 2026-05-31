/**
 * WebSocket liveness probe (ping/pong heartbeat).
 *
 * A WebSocket can go half-open — the peer vanishes (laptop sleep, NAT / idle
 * timeout, network partition, force-killed mobile app) WITHOUT ever sending a
 * FIN / close frame — so the server-side `'close'` event never fires. Without
 * a liveness probe the socket, its `subscribeSessionRunEvents` subscription,
 * and all per-connection state stay pinned for the entire process lifetime;
 * enough half-open sockets accumulate into a real leak (and keep fanning every
 * published run event out to a dead peer).
 *
 * The SSE paths already defend against this via their 10s keepalive write,
 * which fails fast on a dead socket and triggers cleanup. WS had no equivalent:
 * it relied solely on the TCP `'close'` event, which a half-open socket never
 * delivers. This pings on an interval and terminates the socket once the peer
 * misses a full interval without answering a pong, after which the normal
 * `'close'` teardown runs.
 */

/** Minimal slice of the `ws` socket this probe needs (eases testing). */
export interface HeartbeatSocket {
  /** ws readyState: 1 === OPEN. */
  readyState: number;
  ping: () => void;
  terminate: () => void;
  on: (event: 'pong', listener: () => void) => void;
}

export interface WsHeartbeatOptions {
  /** Ping cadence; also the grace window for a pong. Default 30s. */
  intervalMs?: number;
  /** Injectable timers for deterministic testing. */
  setIntervalFn?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
}

export const DEFAULT_WS_HEARTBEAT_INTERVAL_MS = 30_000;
const WS_OPEN = 1;

/**
 * Install a ping/pong liveness probe on a WebSocket. Returns a `stop` thunk
 * (idempotent) that the caller MUST invoke from the socket's `'close'` handler
 * so the timer never outlives the connection.
 */
export function installWsHeartbeat(
  socket: HeartbeatSocket,
  options: WsHeartbeatOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_WS_HEARTBEAT_INTERVAL_MS;
  const setIntervalFn = options.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms));
  const clearIntervalFn = options.clearIntervalFn ?? ((h) => clearInterval(h));

  let awaitingPong = false;
  let stopped = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearIntervalFn(timer);
  };

  const terminate = (): void => {
    stop();
    try {
      socket.terminate();
    } catch {
      // already destroyed — nothing more to do
    }
  };

  socket.on('pong', () => {
    awaitingPong = false;
  });

  const timer = setIntervalFn(() => {
    if (stopped) return;
    // Not open yet / already closing: don't ping, just wait for the next tick
    // or the 'close' teardown.
    if (socket.readyState !== WS_OPEN) return;
    if (awaitingPong) {
      // Missed a full interval without a pong → peer is gone. Terminate; the
      // socket's 'close' handler runs the rest of the teardown.
      terminate();
      return;
    }
    awaitingPong = true;
    try {
      socket.ping();
    } catch {
      // Ping threw (socket died between the readyState check and here).
      terminate();
    }
  }, intervalMs);

  (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();

  return stop;
}
