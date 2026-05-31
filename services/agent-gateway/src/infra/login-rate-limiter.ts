/**
 * In-memory brute-force throttle for the credential login paths.
 *
 * `/auth/login` (and the admin-set-password verify) compare a SHA-256 of the
 * submitted password against the stored hash with NO attempt limiting, so a
 * LAN/remote attacker can hammer the endpoint at full speed — the gateway is
 * explicitly designed to be reachable over the local network (see the desktop
 * "LAN Web access" toggle), which makes an online password-guessing attack a
 * real exposure. This adds a per-key (email+ip) failure counter that locks the
 * key out for a cooldown once a threshold of recent failures is reached.
 *
 * Deliberately in-memory (no Redis dependency — the repo's `redis` is itself a
 * process-local Map shim): the gateway is single-process, and a throttle that
 * resets on restart is still vastly better than none. State is bounded by an
 * opportunistic sweep of expired entries so it can't grow without limit under
 * a distributed guessing attack that varies the key.
 */

export interface LoginRateLimiterOptions {
  /** Failures allowed within the window before lockout. Default 5. */
  maxFailures?: number;
  /** Sliding window over which failures accumulate (ms). Default 15 min. */
  windowMs?: number;
  /** Lockout duration once maxFailures is hit (ms). Default 15 min. */
  lockoutMs?: number;
  /** Injectable clock for deterministic tests. Default Date.now. */
  now?: () => number;
  /** Hard cap on tracked keys (anti-leak under key-varying floods). */
  maxEntries?: number;
}

interface Attempt {
  /** Failure timestamps within the current window. */
  failures: number[];
  /** When > now, the key is locked out until this timestamp. */
  lockedUntil: number;
}

export interface LoginAttemptStatus {
  allowed: boolean;
  /** Seconds until the lockout lifts (only meaningful when !allowed). */
  retryAfterSeconds: number;
}

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;

export class LoginRateLimiter {
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly lockoutMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly attempts = new Map<string, Attempt>();

  constructor(options: LoginRateLimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.lockoutMs = options.lockoutMs ?? DEFAULT_LOCKOUT_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Check whether a login attempt for `key` is currently allowed. Does NOT
   * mutate failure state — call `recordFailure` / `recordSuccess` after the
   * credential check resolves.
   */
  check(key: string): LoginAttemptStatus {
    const entry = this.attempts.get(key);
    if (!entry) return { allowed: true, retryAfterSeconds: 0 };
    const now = this.now();
    if (entry.lockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Record a failed credential check; may trip the lockout. */
  recordFailure(key: string): void {
    const now = this.now();
    const entry = this.attempts.get(key) ?? { failures: [], lockedUntil: 0 };
    // Drop failures outside the sliding window.
    entry.failures = entry.failures.filter((ts) => now - ts < this.windowMs);
    entry.failures.push(now);
    if (entry.failures.length >= this.maxFailures) {
      entry.lockedUntil = now + this.lockoutMs;
      entry.failures = [];
    }
    this.attempts.set(key, entry);
    // Sweep AFTER the insert so the post-condition is a true hard ceiling
    // (`size <= maxEntries`). The key just touched carries the newest activity
    // timestamp, so the oldest-first eviction below never drops it.
    this.sweep(now);
  }

  /** Clear all failure state for `key` after a successful login. */
  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }

  /** Test-only: current tracked-key count. */
  size(): number {
    return this.attempts.size;
  }

  /**
   * Drop entries that are neither locked nor carrying in-window failures, and
   * if still over the cap evict oldest-activity first. Keeps the map bounded
   * under a key-varying flood.
   */
  private sweep(now: number): void {
    for (const [key, entry] of this.attempts) {
      const live = entry.lockedUntil > now || entry.failures.some((ts) => now - ts < this.windowMs);
      if (!live) this.attempts.delete(key);
    }
    if (this.attempts.size <= this.maxEntries) return;
    const byActivity = [...this.attempts.entries()].sort((a, b) => {
      const aLast = Math.max(a[1].lockedUntil, a[1].failures[a[1].failures.length - 1] ?? 0);
      const bLast = Math.max(b[1].lockedUntil, b[1].failures[b[1].failures.length - 1] ?? 0);
      return aLast - bLast;
    });
    const excess = this.attempts.size - this.maxEntries;
    for (let i = 0; i < excess; i += 1) {
      const victim = byActivity[i];
      if (victim) this.attempts.delete(victim[0]);
    }
  }
}

/** Build the per-attempt key. Email is lower-cased; ip scopes the counter. */
export function buildLoginRateLimitKey(email: string, ip: string): string {
  return `${email.trim().toLowerCase()}::${ip}`;
}
