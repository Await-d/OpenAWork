import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

export type TelemetryEventName =
  | 'app_start'
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
    if (this.optedOut || this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    await this.send(batch);
  }

  async shutdown(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
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
      });
    } catch {
      // network errors are silently ignored to avoid disrupting the app
    }
  }
}
