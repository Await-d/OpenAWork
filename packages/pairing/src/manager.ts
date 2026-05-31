import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

export interface PairingSession {
  token: string;
  qrData: string;
  hostUrl: string;
  expiresAt: number;
}

export interface ClientInfo {
  deviceName: string;
  platform: 'ios' | 'android' | 'web';
  connectedAt: number;
}

export interface PairingManager {
  generatePairingCode(): Promise<PairingSession>;
  waitForClient(token: string, timeoutMs?: number): Promise<ClientInfo>;
  connectWithToken(hostUrl: string, token: string): Promise<void>;
  verifyConnection(): Promise<boolean>;
  disconnect(): Promise<void>;
}

export type PairingStatus = 'idle' | 'waiting' | 'connecting' | 'connected' | 'expired' | 'failed';

/** Internal registry entry for a `waitForClient` caller. */
interface PendingClientWaiter {
  resolve: (client: ClientInfo) => void;
  // Pinned to `Error` (rather than `unknown`) so the only rejection paths —
  // `PairingTimeoutError` from the watchdog and `PairingDisconnectedError`
  // from `disconnect()` — flow through a typed Error contract; this also
  // satisfies @typescript-eslint/prefer-promise-reject-errors.
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const PAIRING_PROTOCOL_VERSION = '1';
const PAIRING_TTL_MS = 5 * 60 * 1000;
/** Default ceiling for a single `connectWithToken` / `verifyConnection` HTTP call. */
const PAIRING_FETCH_TIMEOUT_MS = 15_000;

/**
 * Error thrown when {@link PairingManagerImpl.waitForClient} gives up
 * after `timeoutMs`. Named so callers can distinguish a genuine pairing
 * timeout from other rejections.
 */
export class PairingTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Pairing timed out after ${timeoutMs}ms`);
    this.name = 'PairingTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Error thrown when an in-flight {@link PairingManagerImpl.waitForClient}
 * waiter is cancelled by `disconnect()`. Distinct from
 * {@link PairingTimeoutError} so callers can tell
 * "client never showed up" apart from "manager was torn down".
 */
export class PairingDisconnectedError extends Error {
  constructor() {
    super('Pairing manager disconnected before client confirmation');
    this.name = 'PairingDisconnectedError';
  }
}

/**
 * Hard ceiling applied to {@link PairingManagerImpl.waitForClient} when
 * the caller passes no `timeoutMs` (or a non-positive one). Without
 * this guard the returned Promise would stay pending forever if no
 * client ever arrived: `confirmClient` checks `verifyToken`, so once
 * the session's TTL elapses the waiter is simply orphaned and the
 * caller's stack frame would never unwind. Pinned to the session TTL
 * so the bound matches the natural validity of the QR code.
 */
const PAIRING_DEFAULT_WAIT_TIMEOUT_MS = PAIRING_TTL_MS;

/** A `fetch` that aborts after `timeoutMs` instead of hanging forever. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Constant-time string compare for the pairing token. `verifyToken` gates
 * `/pairing/login`, which issues a FULL admin token to any caller that passes
 * it, so a non-constant-time `===` would leak the active token byte-by-byte to
 * a timing attacker on the LAN. Tokens are fixed-length hex; comparing lengths
 * first only reveals the (public, constant) token length, not its contents.
 */
function constantTimeTokenEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function generateToken(): string {
  return createHash('sha256').update(randomBytes(32)).digest('hex').slice(0, 32);
}

function buildQRData(hostUrl: string, token: string): string {
  return JSON.stringify({ hostUrl, token, version: PAIRING_PROTOCOL_VERSION });
}

function detectLocalAddress(): string {
  try {
    const nets = networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const iface of list ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (_e) {
    void _e;
  }
  return '127.0.0.1';
}

export class PairingManagerImpl implements PairingManager {
  private port: number;
  private activeSession: PairingSession | null = null;
  private connectedHost: string | null = null;
  private connectionVerified = false;
  private pendingClients = new Map<string, Set<PendingClientWaiter>>();

  constructor(port = 3000) {
    this.port = port;
  }

  async generatePairingCode(): Promise<PairingSession> {
    if (this.activeSession && this.activeSession.expiresAt > Date.now()) {
      return this.activeSession;
    }
    const token = generateToken();
    const hostUrl = `http://${detectLocalAddress()}:${this.port}`;
    const qrData = buildQRData(hostUrl, token);
    this.activeSession = { token, qrData, hostUrl, expiresAt: Date.now() + PAIRING_TTL_MS };
    return this.activeSession;
  }

  verifyToken(token: string): boolean {
    const session = this.activeSession;
    if (!session || session.expiresAt <= Date.now()) {
      return false;
    }
    return constantTimeTokenEqual(session.token, token);
  }

  getActiveSession(): PairingSession | null {
    if (this.activeSession && this.activeSession.expiresAt <= Date.now()) {
      this.activeSession = null;
    }
    return this.activeSession ? { ...this.activeSession } : null;
  }

  async waitForClient(token: string, timeoutMs?: number): Promise<ClientInfo> {
    return new Promise<ClientInfo>((resolve, reject) => {
      const waiters = this.pendingClients.get(token) ?? new Set<PendingClientWaiter>();

      const waiter: PendingClientWaiter = {
        resolve,
        reject,
        timer: undefined,
      };

      const detach = (): void => {
        if (waiter.timer) {
          clearTimeout(waiter.timer);
          waiter.timer = undefined;
        }
        const set = this.pendingClients.get(token);
        if (set) {
          set.delete(waiter);
          if (set.size === 0) {
            this.pendingClients.delete(token);
          }
        }
      };

      // Wrap resolve so the timer + registry entry are always cleaned up
      // when the client arrives, preventing a leaked timer / Map entry.
      waiter.resolve = (client: ClientInfo): void => {
        detach();
        resolve(client);
      };
      // Wrap reject the same way so the timer + registry entry are
      // released when `disconnect()` cancels the waiter — without this
      // wrap the `pendingClients` entry would survive disconnect even
      // though we just rejected its promise.
      waiter.reject = (reason: Error): void => {
        detach();
        reject(reason);
      };

      // Resolve the effective ceiling: caller-supplied positive
      // `timeoutMs` wins; otherwise fall back to the session-TTL
      // default so a `waitForClient(token)` (no timeout) call cannot
      // hang forever — `confirmClient` rejects expired tokens via
      // `verifyToken`, so once the TTL passes a waiter without a timer
      // would be orphaned and the caller's stack frame would never
      // unwind.
      const effectiveTimeoutMs =
        typeof timeoutMs === 'number' && timeoutMs > 0
          ? timeoutMs
          : PAIRING_DEFAULT_WAIT_TIMEOUT_MS;
      waiter.timer = setTimeout(() => {
        detach();
        reject(new PairingTimeoutError(effectiveTimeoutMs));
      }, effectiveTimeoutMs);

      waiters.add(waiter);
      this.pendingClients.set(token, waiters);
    });
  }

  confirmClient(token: string, client: ClientInfo): boolean {
    if (!this.verifyToken(token)) {
      return false;
    }
    const waiters = this.pendingClients.get(token);
    if (waiters) {
      // Snapshot first: each `resolve` mutates the set via its detach hook.
      for (const waiter of [...waiters]) {
        waiter.resolve(client);
      }
    }
    this.pendingClients.delete(token);
    this.activeSession = null;
    return true;
  }

  async connectWithToken(hostUrl: string, token: string): Promise<void> {
    const res = await fetchWithTimeout(
      `${hostUrl}/pairing/connect`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, deviceName: 'Mobile Client', platform: 'web' }),
      },
      PAIRING_FETCH_TIMEOUT_MS,
    );

    if (!res.ok) throw new Error(`Pairing connection failed: ${res.status}`);
    this.connectedHost = hostUrl;
    this.connectionVerified = true;
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.connectedHost) return false;
    try {
      const res = await fetchWithTimeout(
        `${this.connectedHost}/pairing/ping`,
        { method: 'GET' },
        PAIRING_FETCH_TIMEOUT_MS,
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connectedHost = null;
    this.connectionVerified = false;
    // Reject — not just drop — every pending waiter so caller stacks
    // unwind. Snapshot first because `reject()` mutates the set via
    // its detach hook. Clear the Map up-front so reentrant
    // `confirmClient` / `waitForClient` calls during rejection don't
    // observe a stale entry; subsequent `detach()` calls become
    // no-ops once the Map is empty.
    const allWaiters: PendingClientWaiter[] = [];
    for (const waiters of this.pendingClients.values()) {
      for (const waiter of waiters) allWaiters.push(waiter);
    }
    this.pendingClients.clear();
    for (const waiter of allWaiters) {
      if (waiter.timer) {
        clearTimeout(waiter.timer);
        waiter.timer = undefined;
      }
      waiter.reject(new PairingDisconnectedError());
    }
  }

  get isConnected(): boolean {
    return this.connectionVerified;
  }
}
