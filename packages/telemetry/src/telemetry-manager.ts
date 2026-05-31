import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

/** Cap on a single telemetry batch upload so a hung endpoint can't stall flush. */
const TELEMETRY_SEND_TIMEOUT_MS = 10_000;

export type TelemetryEventName =
  | 'app_start'
  | 'team_runtime_alert_transition'
  | 'team_runtime_health'
  | 'team_runtime_incident'
  | 'session_created'
  | 'tool_call'
  | 'skill_installed'
  | 'error_boundary';

export interface TelemetryEvent {
  name: TelemetryEventName;
  timestamp: number;
  installId: string;
  properties: Record<string, string | number | boolean>;
}

export interface TelemetryConfig {
  endpoint?: string;
  flushIntervalMs?: number;
  installIdPath?: string;
  enabled?: boolean;
}

function isOptedOut(config: TelemetryConfig): boolean {
  if (config.enabled === false) return true;
  if (config.enabled === true) return false;

  const envVal = process.env['OPENWORK_TELEMETRY'];
  if (envVal === 'off' || envVal === '0' || envVal === 'false') return true;
  if (process.env['DO_NOT_TRACK'] === '1') return true;
  if (process.env['DISABLE_METRICS'] === '1') return true;

  return false;
}

function loadOrCreateInstallId(idPath: string): string {
  try {
    const dir = path.dirname(idPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(idPath)) {
      const id = fs.readFileSync(idPath, 'utf8').trim();
      if (id.length > 0) return id;
    }
    const id = crypto.randomUUID();
    fs.writeFileSync(idPath, id, { encoding: 'utf8', mode: 0o600 });
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export class TelemetryManager {
  private readonly optedOut: boolean;
  private readonly installId: string;
  private readonly flushIntervalMs: number;
  private readonly endpoint: string;
  private queue: TelemetryEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  // Single-flight guard for `flush()`. Without this, a slow telemetry
  // endpoint (network blip, regional outage, ECONNRESET retried by the
  // socket layer) lets a second `setInterval` tick fire before the previous
  // flush finishes; both calls then `splice(0, queue.length)` from the
  // *same* queue. The race is destructive: the second splicer gets an
  // empty array and uploads nothing, while the first splicer's events are
  // already detached from the queue and will be dropped if its in-flight
  // send eventually fails. By sharing one promise per in-flight flush we
  // keep concurrent callers (timer ticks, manual `flush()`, `shutdown()`)
  // observing the same outcome without overlapping the splice/send pair.
  private pendingFlush: Promise<void> | null = null;

  constructor(config: TelemetryConfig = {}) {
    this.optedOut = isOptedOut(config);
    this.flushIntervalMs = config.flushIntervalMs ?? 60_000;
    this.endpoint = config.endpoint ?? 'https://telemetry.openwork.dev/v1/events';

    const idPath = config.installIdPath ?? path.join(os.tmpdir(), '.openwork_install_id');

    this.installId = this.optedOut ? 'opted-out' : loadOrCreateInstallId(idPath);

    if (!this.optedOut) {
      this.timer = setInterval(() => {
        this.flush().catch(() => undefined);
      }, this.flushIntervalMs);
      if (this.timer.unref) this.timer.unref();
    }
  }

  track(
    name: TelemetryEventName,
    properties: Record<string, string | number | boolean> = {},
  ): void {
    if (this.optedOut) return;

    const event: TelemetryEvent = {
      name,
      timestamp: Date.now(),
      installId: this.installId,
      properties,
    };
    this.queue.push(event);
  }

  async flush(): Promise<void> {
    if (this.optedOut) return;

    // If a flush is already in flight, return that promise so concurrent
    // callers share the outcome rather than racing a second splice/send
    // pair against it. Timer ticks intentionally drop overlapping flushes
    // (no requeue) — the next tick will re-fire naturally once the in-flight
    // send resolves, and the queue contract is "best effort, drop on failure"
    // (see the existing failure-path test).
    if (this.pendingFlush) {
      return this.pendingFlush;
    }

    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    this.pendingFlush = this.send(batch).finally(() => {
      this.pendingFlush = null;
    });
    return this.pendingFlush;
  }

  async shutdown(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // First await any in-flight flush so we don't race the timer-driven
    // send. Then call `flush()` again to drain anything that was tracked
    // *during* the in-flight send (those events landed back in `queue`
    // after we splice'd, so the second call picks them up).
    if (this.pendingFlush) {
      await this.pendingFlush;
    }
    await this.flush();
  }

  isEnabled(): boolean {
    return !this.optedOut;
  }

  getInstallId(): string {
    return this.installId;
  }

  private async send(events: TelemetryEvent[]): Promise<void> {
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
        // Without a timeout a hung telemetry endpoint leaves this fetch
        // pending forever: pending sockets accumulate across flush ticks
        // and `shutdown()` (which awaits flush) would block graceful exit.
        signal: AbortSignal.timeout(TELEMETRY_SEND_TIMEOUT_MS),
      });
    } catch {
      // network errors are silently ignored to avoid disrupting the app
    }
  }
}
