import type {
  ChannelEvent,
  ChannelInstance,
  ChannelMessage,
  ChannelWsMessageParser,
} from './types.js';

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_STALE_MESSAGE_WINDOW_MS = 15 * 60 * 1000;

type RelayStatus = 'connected' | 'disconnected' | 'reconnecting';

export interface ChannelRelayOptions {
  readonly channel: ChannelInstance;
  readonly parser: ChannelWsMessageParser;
  readonly notify: (event: ChannelEvent) => void;
  readonly staleMessageWindowMs?: number;
}

export class ChannelRelay {
  private readonly channel: ChannelInstance;
  private readonly parser: ChannelWsMessageParser;
  private readonly notify: (event: ChannelEvent) => void;
  private readonly staleMessageWindowMs: number;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private intentionallyClosed = false;

  constructor(options: ChannelRelayOptions) {
    this.channel = options.channel;
    this.parser = options.parser;
    this.notify = options.notify;
    this.staleMessageWindowMs = options.staleMessageWindowMs ?? DEFAULT_STALE_MESSAGE_WINDOW_MS;
  }

  start(): void {
    const url = this.channel.config['wsUrl'];
    if (!url) {
      return;
    }
    this.intentionallyClosed = false;
    this.connect(url);
  }

  stop(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const current = this.ws;
    this.ws = null;
    if (
      current &&
      current.readyState !== WebSocket.CLOSED &&
      current.readyState !== WebSocket.CLOSING
    ) {
      current.close();
    }
  }

  private connect(url: string): void {
    try {
      const socket = new WebSocket(url);
      this.ws = socket;

      socket.addEventListener('open', () => {
        if (this.ws !== socket) {
          return;
        }
        this.reconnectAttempt = 0;
        this.emitStatus('connected');
      });

      socket.addEventListener('message', (event) => {
        if (this.ws !== socket) {
          return;
        }
        void this.handleMessage(event.data);
      });

      socket.addEventListener('close', () => {
        if (this.ws === socket) {
          this.ws = null;
        }
        if (this.intentionallyClosed) {
          this.emitStatus('disconnected');
          return;
        }
        this.scheduleReconnect(url);
      });

      socket.addEventListener('error', () => {
        if (this.ws !== socket) {
          return;
        }
        this.notify({
          type: 'error',
          pluginId: this.channel.id,
          error: `Channel relay error for ${this.channel.name}`,
        });
      });
    } catch (error) {
      this.notify({
        type: 'error',
        pluginId: this.channel.id,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!this.intentionallyClosed) {
        this.scheduleReconnect(url);
      }
    }
  }

  private async handleMessage(data: unknown): Promise<void> {
    const raw = await this.normalizeMessageData(data);
    const message = this.parser(raw);
    if (!message || this.isStale(message)) {
      return;
    }
    this.safeNotify({ type: 'message', pluginId: this.channel.id, message });
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

  private isStale(message: ChannelMessage): boolean {
    if (!message.timestamp) {
      return false;
    }
    return message.timestamp < Date.now() - this.staleMessageWindowMs;
  }

  private scheduleReconnect(url: string): void {
    if (this.reconnectTimer) {
      return;
    }
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    this.emitStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(url);
    }, delay);
  }

  private emitStatus(status: RelayStatus): void {
    if (status === 'reconnecting') {
      return;
    }
    this.safeNotify({
      type: 'status',
      pluginId: this.channel.id,
      status: status === 'connected' ? 'running' : 'stopped',
    });
  }

  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (error) {
      console.warn('[channels] relay notify handler threw', {
        channelId: this.channel.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
