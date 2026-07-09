import { parseDiscordInboundMessage } from './inbound-parsers/discord.js';
import type { ChannelEvent } from './types.js';

const DEFAULT_DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const DISCORD_GATEWAY_INTENTS = (1 << 9) | (1 << 12) | (1 << 15);
const RECONNECT_DELAY_MS = 1_000;
const STARTUP_TIMEOUT_MS = 15_000;

interface DiscordGatewayOptions {
  readonly pluginId: string;
  readonly token: string;
  readonly gatewayUrl?: string;
  readonly notify: (event: ChannelEvent) => void;
}

interface DiscordGatewayFrame {
  readonly op?: number;
  readonly t?: string;
  readonly s?: number | null;
  readonly d?: unknown;
}

export class DiscordGatewayClient {
  private readonly pluginId: string;
  private readonly token: string;
  private readonly gatewayUrl: string;
  private readonly notify: (event: ChannelEvent) => void;
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveStartup: (() => void) | null = null;
  private rejectStartup: ((error: Error) => void) | null = null;
  private lastSeq: number | null = null;
  private running = false;

  constructor(options: DiscordGatewayOptions) {
    this.pluginId = options.pluginId;
    this.token = options.token;
    this.gatewayUrl = options.gatewayUrl ?? DEFAULT_DISCORD_GATEWAY_URL;
    this.notify = options.notify;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.connect();
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop(): void {
    this.running = false;
    this.clearStartupWaiter();
    this.clearReconnectTimer();
    this.stopHeartbeat();
    const current = this.socket;
    this.socket = null;
    if (
      current &&
      current.readyState !== WebSocket.CLOSED &&
      current.readyState !== WebSocket.CLOSING
    ) {
      current.close();
    }
  }

  private async connect(): Promise<void> {
    if (!this.running) {
      return;
    }
    const socket = new WebSocket(this.gatewayUrl);
    this.socket = socket;
    const startupPromise = this.createStartupWaiter();

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) {
        return;
      }
      void this.handleMessage(event.data).catch((error: unknown) => {
        this.failStartup(error);
        this.safeNotify({
          type: 'error',
          pluginId: this.pluginId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.stopHeartbeat();
      this.failStartup(new Error('Discord Gateway closed before startup completed'));
      if (this.running) {
        this.scheduleReconnect();
      }
    });

    socket.addEventListener('error', () => {
      this.failStartup(new Error('Discord Gateway connection error'));
      this.safeNotify({
        type: 'error',
        pluginId: this.pluginId,
        error: 'Discord Gateway connection error',
      });
    });

    await startupPromise;
  }

  private async handleMessage(data: unknown): Promise<void> {
    const raw = await this.normalizeMessageData(data);
    const frame = this.parseFrame(raw);
    if (!frame) {
      return;
    }

    if (typeof frame.s === 'number') {
      this.lastSeq = frame.s;
    }

    if (frame.op === 10) {
      this.startHeartbeat(frame.d);
      this.identify();
      return;
    }

    if (frame.op !== 0) {
      return;
    }

    const message = parseDiscordInboundMessage(frame);
    if (message) {
      this.safeNotify({ type: 'message', pluginId: this.pluginId, message });
    }
  }

  private async normalizeMessageData(data: unknown): Promise<unknown> {
    if (typeof data === 'string') {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(data);
    }
    if (data instanceof Blob) {
      return data.text();
    }
    return data;
  }

  private parseFrame(raw: unknown): DiscordGatewayFrame | null {
    if (typeof raw !== 'string') {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return this.isGatewayFrame(parsed) ? parsed : null;
    } catch (error) {
      if (error instanceof SyntaxError) {
        return null;
      }
      throw error;
    }
  }

  private isGatewayFrame(value: unknown): value is DiscordGatewayFrame {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private startHeartbeat(data: unknown): void {
    this.stopHeartbeat();
    const intervalMs = this.readHeartbeatInterval(data);
    if (!intervalMs) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      this.sendFrame({ op: 1, d: this.lastSeq });
    }, intervalMs);
  }

  private readHeartbeatInterval(data: unknown): number | null {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return null;
    }
    const value = (data as Record<string, unknown>)['heartbeat_interval'];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  private identify(): void {
    const sent = this.sendFrame({
      op: 2,
      d: {
        token: this.token,
        intents: DISCORD_GATEWAY_INTENTS,
        properties: {
          os: process.platform,
          browser: 'OpenAWork',
          device: 'OpenAWork',
        },
      },
    });
    if (sent) {
      this.completeStartup();
      return;
    }
    this.failStartup(new Error('Discord Gateway identify was not sent because socket is not open'));
  }

  private sendFrame(frame: unknown): boolean {
    const current = this.socket;
    if (!current || current.readyState !== WebSocket.OPEN) {
      return false;
    }
    current.send(JSON.stringify(frame));
    return true;
  }

  private createStartupWaiter(): Promise<void> {
    this.clearStartupWaiter();
    return new Promise<void>((resolve, reject) => {
      this.resolveStartup = resolve;
      this.rejectStartup = reject;
      this.startupTimer = setTimeout(() => {
        this.failStartup(new Error('Discord Gateway startup timed out before hello/identify'));
      }, STARTUP_TIMEOUT_MS);
    });
  }

  private completeStartup(): void {
    const resolve = this.resolveStartup;
    this.clearStartupWaiter();
    resolve?.();
  }

  private failStartup(error: unknown): void {
    const reject = this.rejectStartup;
    if (!reject) {
      return;
    }
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.clearStartupWaiter();
    reject(normalized);
  }

  private clearStartupWaiter(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    this.resolveStartup = null;
    this.rejectStartup = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error: unknown) => {
        this.safeNotify({
          type: 'error',
          pluginId: this.pluginId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, RECONNECT_DELAY_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (error) {
      console.warn('[discord] gateway notify handler threw', {
        pluginId: this.pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
