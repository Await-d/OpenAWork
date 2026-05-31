import type { DiagnosticSummary } from './types.js';

export type LSPDiagnosticsHandler = (path: string, diagnostics: DiagnosticSummary[]) => void;

export interface LSPWebSocketClientOptions {
  gatewayUrl: string;
  token?: string;
  onDiagnostics?: LSPDiagnosticsHandler;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (err: string) => void;
  reconnectDelayMs?: number;
  /** Upper bound for the exponential reconnect backoff. Default 30s. */
  maxReconnectDelayMs?: number;
}

type WSEvent = {
  type: 'diagnostics';
  path: string;
  diagnostics: DiagnosticSummary[];
};

export class LSPWebSocketClient {
  private ws: WebSocket | null = null;
  private options: LSPWebSocketClientOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Consecutive failed/closed connections since the last successful open. */
  private reconnectAttempts = 0;

  constructor(options: LSPWebSocketClientOptions) {
    this.options = options;
  }

  connect(): void {
    this.stopped = false;
    this.reconnectAttempts = 0;
    this.openConnection();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.ws?.close();
    this.ws = null;
  }

  async touchFile(path: string, waitForDiagnostics = false): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.options.token) headers['Authorization'] = `Bearer ${this.options.token}`;
    const res = await fetch(`${this.options.gatewayUrl}/lsp/touch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path, waitForDiagnostics }),
      // §0.157: bound the gateway HTTP cal so a connects-but-hangs gateway
      // can't permanently pend the LSP touch (and the agent run that awaits
      // its diagnostics). `waitForDiagnostics=true` legitimately blocks until
      // the LSP server emits a diagnostics frame, so allow it more headroom.
      signal: AbortSignal.timeout(waitForDiagnostics ? 30_000 : 5_000),
    });
    if (!res.ok) throw new Error(`LSP touch failed: ${res.status}`);
  }

  async getDiagnostics(filePath?: string): Promise<Record<string, DiagnosticSummary[]>> {
    const headers: Record<string, string> = {};
    if (this.options.token) headers['Authorization'] = `Bearer ${this.options.token}`;
    const res = await fetch(`${this.options.gatewayUrl}/lsp/diagnostics`, {
      headers,
      // §0.157: same wall-clock bound as `touchFile`. Diagnostics is a pure
      // read so a tighter ceiling is fine; a hung gateway no longer permanently
      // pends the caller (and any tool run waiting on the result).
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`LSP diagnostics failed: ${res.status}`);
    const data = (await res.json()) as { diagnostics: Record<string, DiagnosticSummary[]> };
    if (filePath) {
      const key = Object.keys(data.diagnostics).find((k) => k.endsWith(filePath));
      return key ? { [key]: data.diagnostics[key]! } : {};
    }
    return data.diagnostics;
  }

  private openConnection(): void {
    if (this.stopped) return;

    const wsUrl =
      this.options.gatewayUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + '/lsp/events';

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // A healthy connection resets the backoff so a later transient
        // drop reconnects promptly instead of inheriting a long delay.
        this.reconnectAttempts = 0;
        this.options.onConnected?.();
      };

      this.ws.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data as string) as WSEvent;
          if (event.type === 'diagnostics') {
            try {
              this.options.onDiagnostics?.(event.path, event.diagnostics);
            } catch (handlerErr) {
              // A throwing consumer callback must not bubble into the WS
              // event loop and tear down the connection.
              this.options.onError?.(
                handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
              );
            }
          }
        } catch (_e) {
          void _e;
        }
      };

      this.ws.onerror = () => {
        this.options.onError?.('WebSocket connection error');
      };

      this.ws.onclose = () => {
        this.options.onDisconnected?.();
        if (!this.stopped) {
          this.reconnectAttempts += 1;
          this.reconnectTimer = setTimeout(
            () => this.openConnection(),
            this.computeReconnectDelayMs(),
          );
        }
      };
    } catch (err) {
      this.options.onError?.(err instanceof Error ? err.message : String(err));
      // `new WebSocket` threw synchronously (e.g. malformed URL / blocked
      // scheme) — `onclose` will never fire, so schedule the retry here so
      // a transient construction failure still recovers.
      if (!this.stopped) {
        this.reconnectAttempts += 1;
        this.reconnectTimer = setTimeout(
          () => this.openConnection(),
          this.computeReconnectDelayMs(),
        );
      }
    }
  }

  /**
   * Exponential backoff with jitter, capped at `maxReconnectDelayMs`.
   * The previous fixed 3s retry hammered a down gateway every 3s
   * indefinitely; backing off spreads reconnect load and avoids a
   * thundering herd when many clients reconnect at once.
   */
  private computeReconnectDelayMs(): number {
    const base = this.options.reconnectDelayMs ?? 3000;
    const cap = this.options.maxReconnectDelayMs ?? 30_000;
    const exponential = base * Math.pow(2, Math.max(0, this.reconnectAttempts - 1));
    const bounded = Math.min(exponential, cap);
    // Full jitter in [bounded/2, bounded] keeps retries de-synchronised.
    return Math.round(bounded / 2 + Math.random() * (bounded / 2));
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
