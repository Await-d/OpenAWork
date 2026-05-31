/**
 * Regression: a WebSocket can go half-open — the peer vanishes (laptop sleep,
 * NAT timeout, network partition) WITHOUT a FIN — so the server-side 'close'
 * event never fires. The WS stream handler previously relied solely on
 * 'close', so a half-open socket and its run-event subscription would linger
 * for the process lifetime. The heartbeat pings on an interval and terminates
 * a peer that misses a pong, after which the normal 'close' teardown runs.
 */

import { describe, expect, it } from 'vitest';
import {
  installWsHeartbeat,
  type HeartbeatSocket,
} from '../../routes/ws-heartbeat.js';

interface FakeSocket extends HeartbeatSocket {
  pingCount: number;
  terminated: boolean;
  pongListeners: Array<() => void>;
  firePong: () => void;
}

function makeSocket(readyState = 1): FakeSocket {
  const s: FakeSocket = {
    readyState,
    pingCount: 0,
    terminated: false,
    pongListeners: [],
    ping() {
      this.pingCount += 1;
    },
    terminate() {
      this.terminated = true;
    },
    on(_event: 'pong', listener: () => void) {
      this.pongListeners.push(listener);
    },
    firePong() {
      for (const l of this.pongListeners) l();
    },
  };
  return s;
}

/** Manual timer harness so ticks are driven deterministically. */
function makeTimers() {
  const callbacks: Array<() => void> = [];
  return {
    setIntervalFn: ((cb: () => void) => {
      callbacks.push(cb);
      return callbacks.length as unknown as ReturnType<typeof setInterval>;
    }) as (cb: () => void, ms: number) => ReturnType<typeof setInterval>,
    clearIntervalFn: (() => {
      callbacks.length = 0;
    }) as (h: ReturnType<typeof setInterval>) => void,
    tick: () => {
      for (const cb of [...callbacks]) cb();
    },
  };
}

describe('installWsHeartbeat', () => {
  it('每个间隔在 socket OPEN 时发送 ping', () => {
    const socket = makeSocket(1);
    const timers = makeTimers();
    installWsHeartbeat(socket, {
      intervalMs: 1000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    timers.tick();
    expect(socket.pingCount).toBe(1);
    expect(socket.terminated).toBe(false);
  });

  it('对端在一个间隔内回 pong 时不被终止（持续存活）', () => {
    const socket = makeSocket(1);
    const timers = makeTimers();
    installWsHeartbeat(socket, {
      intervalMs: 1000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    timers.tick(); // ping #1, awaitingPong = true
    socket.firePong(); // peer answers
    timers.tick(); // awaitingPong was cleared → ping #2, not terminated

    expect(socket.pingCount).toBe(2);
    expect(socket.terminated).toBe(false);
  });

  it('对端整整一个间隔未回 pong 时终止 socket', () => {
    const socket = makeSocket(1);
    const timers = makeTimers();
    installWsHeartbeat(socket, {
      intervalMs: 1000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    timers.tick(); // ping #1, awaitingPong = true
    timers.tick(); // still awaiting → peer is gone → terminate

    expect(socket.terminated).toBe(true);
  });

  it('socket 未 OPEN 时不 ping（等待 close 或下次 tick）', () => {
    const socket = makeSocket(0); // CONNECTING
    const timers = makeTimers();
    installWsHeartbeat(socket, {
      intervalMs: 1000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    timers.tick();
    expect(socket.pingCount).toBe(0);
    expect(socket.terminated).toBe(false);
  });

  it('stop() 后不再 ping（幂等）', () => {
    const socket = makeSocket(1);
    const timers = makeTimers();
    const stop = installWsHeartbeat(socket, {
      intervalMs: 1000,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });

    stop();
    stop(); // idempotent
    timers.tick();
    expect(socket.pingCount).toBe(0);
  });
});
