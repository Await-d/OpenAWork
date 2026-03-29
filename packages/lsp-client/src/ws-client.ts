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

  constructor(options: LSPWebSocketClientOptions) {
    this.options = options;
  }

  connect(): void {
    this.stopped = false;
    this.openConnection();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    });
    if (!res.ok) throw new Error(`LSP touch failed: ${res.status}`);
  }

  async getDiagnostics(filePath?: string): Promise<Record<string, DiagnosticSummary[]>> {
    const headers: Record<string, string> = {};
    if (this.options.token) headers['Authorization'] = `Bearer ${this.options.token}`;
    const res = await fetch(`${this.options.gatewayUrl}/lsp/diagnostics`, { headers });
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
        this.options.onConnected?.();
      };

      this.ws.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data as string) as WSEvent;
          if (event.type === 'diagnostics') {
            this.options.onDiagnostics?.(event.path, event.diagnostics);
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
          const delay = this.options.reconnectDelayMs ?? 3000;
          this.reconnectTimer = setTimeout(() => this.openConnection(), delay);
        }
      };
    } catch (err) {
      this.options.onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
