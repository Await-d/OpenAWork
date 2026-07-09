import { parseQQInboundMessage } from './inbound-parsers/qq.js';
import type { QQApiClient } from './qq-api.js';
import {
  clearQQGatewaySession,
  loadQQGatewaySession,
  saveQQGatewaySession,
} from './qq-gateway-session-store.js';
import type { ChannelDiagnostics, ChannelEvent } from './types.js';

const QQ_GATEWAY_INTENTS = {
  GUILD_MEMBERS: 1 << 1,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C: 1 << 25,
  PUBLIC_GUILD_MESSAGES: 1 << 30,
} as const;
const QQ_GATEWAY_INTENT_LEVEL_FULL = {
  name: 'full',
  description: 'Group + C2C + Channel DM + Channel Messages',
  intents:
    QQ_GATEWAY_INTENTS.PUBLIC_GUILD_MESSAGES |
    QQ_GATEWAY_INTENTS.DIRECT_MESSAGE |
    QQ_GATEWAY_INTENTS.GROUP_AND_C2C,
} as const;
const QQ_GATEWAY_INTENT_LEVELS = [
  QQ_GATEWAY_INTENT_LEVEL_FULL,
  {
    name: 'group-channel',
    description: 'Group + C2C + Channel Messages',
    intents: QQ_GATEWAY_INTENTS.PUBLIC_GUILD_MESSAGES | QQ_GATEWAY_INTENTS.GROUP_AND_C2C,
  },
  {
    name: 'channel-only',
    description: 'Channel Messages Only',
    intents: QQ_GATEWAY_INTENTS.PUBLIC_GUILD_MESSAGES | QQ_GATEWAY_INTENTS.GUILD_MEMBERS,
  },
] as const;
type QQGatewayIntentLevel = (typeof QQ_GATEWAY_INTENT_LEVELS)[number];
export type QQGatewayDiagnostics = Omit<ChannelDiagnostics, 'status'>;

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
const INVALID_SESSION_RECONNECT_DELAY_MS = 3_000;
const STARTUP_TIMEOUT_MS = 15_000;

interface QQGatewayOptions {
  readonly pluginId: string;
  readonly ownerUserId?: string;
  readonly api: QQApiClient;
  readonly notify: (event: ChannelEvent) => void;
  readonly gatewayUrl?: string;
}

interface QQGatewayFrame {
  readonly op?: number;
  readonly t?: string;
  readonly s?: number;
  readonly d?: unknown;
}

export class QQGatewayClient {
  private readonly pluginId: string;
  private readonly ownerUserId: string | undefined;
  private readonly api: QQApiClient;
  private readonly notify: (event: ChannelEvent) => void;
  private readonly configuredGatewayUrl: string | undefined;
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private startupPromise: Promise<void> | null = null;
  private resolveStartup: (() => void) | null = null;
  private rejectStartup: ((error: Error) => void) | null = null;
  private running = false;
  private intentionalClose = false;
  private isConnecting = false;
  private reconnectAttempt = 0;
  private shouldRefreshToken = false;
  private sessionId: string | null = null;
  private lastSeq: number | null = null;
  private intentLevelIndex = 0;
  private lastSuccessfulIntentLevel = -1;
  private identified = false;
  private lastReadyAt: number | undefined;
  private lastHeartbeatAckAt: number | undefined;
  private lastDispatchAt: number | undefined;
  private lastDispatchType: string | undefined;
  private lastMessageAt: number | undefined;
  private lastMessageChatId: string | undefined;
  private lastIgnoredDispatchAt: number | undefined;
  private lastIgnoredDispatchType: string | undefined;
  private lastSocketCloseAt: number | undefined;
  private lastSocketCloseCode: number | undefined;
  private lastSocketCloseReason: string | undefined;
  private lastErrorAt: number | undefined;
  private lastError: string | undefined;

  constructor(options: QQGatewayOptions) {
    this.pluginId = options.pluginId;
    this.ownerUserId = options.ownerUserId;
    this.api = options.api;
    this.notify = options.notify;
    this.configuredGatewayUrl = options.gatewayUrl;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.restoreSession();
    this.intentionalClose = false;
    this.running = true;
    try {
      await this.connect();
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop(): void {
    this.intentionalClose = true;
    this.running = false;
    this.isConnecting = false;
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

  getDiagnostics(): QQGatewayDiagnostics {
    const intentLevel = resolveQQGatewayIntentLevel(this.intentLevelIndex);
    return {
      running: this.running,
      transport: 'gateway',
      currentIntent: intentLevel.name,
      currentIntentDescription: intentLevel.description,
      identified: this.identified,
      ...(this.lastReadyAt !== undefined ? { lastReadyAt: this.lastReadyAt } : {}),
      ...(this.lastHeartbeatAckAt !== undefined
        ? { lastHeartbeatAckAt: this.lastHeartbeatAckAt }
        : {}),
      ...(this.lastDispatchAt !== undefined ? { lastDispatchAt: this.lastDispatchAt } : {}),
      ...(this.lastDispatchType !== undefined ? { lastDispatchType: this.lastDispatchType } : {}),
      ...(this.lastMessageAt !== undefined ? { lastMessageAt: this.lastMessageAt } : {}),
      ...(this.lastMessageChatId !== undefined
        ? { lastMessageChatId: this.lastMessageChatId }
        : {}),
      ...(this.lastIgnoredDispatchAt !== undefined
        ? { lastIgnoredDispatchAt: this.lastIgnoredDispatchAt }
        : {}),
      ...(this.lastIgnoredDispatchType !== undefined
        ? { lastIgnoredDispatchType: this.lastIgnoredDispatchType }
        : {}),
      ...(this.lastSocketCloseAt !== undefined
        ? { lastSocketCloseAt: this.lastSocketCloseAt }
        : {}),
      ...(this.lastSocketCloseCode !== undefined
        ? { lastSocketCloseCode: this.lastSocketCloseCode }
        : {}),
      ...(this.lastSocketCloseReason !== undefined
        ? { lastSocketCloseReason: this.lastSocketCloseReason }
        : {}),
      ...(this.lastErrorAt !== undefined ? { lastErrorAt: this.lastErrorAt } : {}),
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
    };
  }

  private async connect(): Promise<void> {
    if (!this.running || this.isConnecting) {
      return;
    }
    this.isConnecting = true;
    const startupPromise = this.createStartupWaiter();

    try {
      if (this.shouldRefreshToken) {
        this.api.clearTokenCache();
        this.shouldRefreshToken = false;
      }

      const gatewayUrl = this.configuredGatewayUrl ?? (await this.api.getGatewayUrl());
      const socket = new WebSocket(gatewayUrl);
      this.socket = socket;
      this.identified = false;

      socket.addEventListener('open', () => {
        if (this.socket !== socket) {
          return;
        }
        this.reconnectAttempt = 0;
      });

      socket.addEventListener('message', (event) => {
        if (this.socket !== socket) {
          return;
        }
        void this.handleMessage(event.data).catch((error: unknown) => {
          this.recordError(error);
          this.failStartup(error);
          this.safeNotify({
            type: 'error',
            pluginId: this.pluginId,
            error: error instanceof Error ? error.message : String(error),
          });
          this.forceReconnect(false);
        });
      });

      socket.addEventListener('close', (event) => {
        if (this.socket === socket) {
          this.socket = null;
        }
        this.lastSocketCloseAt = Date.now();
        this.lastSocketCloseCode = event.code;
        this.lastSocketCloseReason = event.reason;
        console.warn('[qq] gateway socket closed', {
          pluginId: this.pluginId,
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
        this.stopHeartbeat();
        if (this.running && !this.intentionalClose) {
          this.scheduleReconnect();
          return;
        }
        this.failStartup(new Error('QQ Gateway closed before startup completed'));
      });

      socket.addEventListener('error', () => {
        this.recordError('QQ Gateway connection error');
        console.warn('[qq] gateway socket error', {
          pluginId: this.pluginId,
        });
        this.failStartup(new Error('QQ Gateway connection error'));
        this.safeNotify({
          type: 'error',
          pluginId: this.pluginId,
          error: 'QQ Gateway connection error',
        });
      });
    } finally {
      this.isConnecting = false;
    }

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
      this.persistSession();
    }

    if (frame.op === 10) {
      await this.handleHello(frame.d);
      return;
    }

    if (frame.op === 11) {
      this.lastHeartbeatAckAt = Date.now();
      this.logGatewayFrame('heartbeat ack');
      return;
    }

    if (frame.op === 7) {
      this.forceReconnect();
      return;
    }

    if (frame.op === 9) {
      this.handleInvalidSession(frame.d);
      return;
    }

    if (frame.op !== 0) {
      return;
    }

    if (frame.t === 'READY') {
      const sessionId = this.readSessionId(frame.d);
      if (sessionId) {
        this.sessionId = sessionId;
      }
      this.lastSuccessfulIntentLevel = this.intentLevelIndex;
      this.persistSession();
      this.lastReadyAt = Date.now();
      this.logGatewayFrame('ready');
      this.completeStartup();
      return;
    }

    if (frame.t === 'RESUMED') {
      this.persistSession();
      this.logGatewayFrame('resumed');
      this.completeStartup();
      return;
    }

    this.logGatewayFrame(`dispatch ${frame.t ?? 'unknown'}`);
    this.lastDispatchAt = Date.now();
    this.lastDispatchType = frame.t ?? 'unknown';
    const message = parseQQInboundMessage(frame);
    if (message) {
      this.lastMessageAt = Date.now();
      this.lastMessageChatId = message.chatId;
      this.safeNotify({ type: 'message', pluginId: this.pluginId, message });
      return;
    }

    if (frame.t) {
      this.lastIgnoredDispatchAt = Date.now();
      this.lastIgnoredDispatchType = frame.t;
      console.warn('[qq] ignored gateway dispatch event', {
        pluginId: this.pluginId,
        eventType: frame.t,
      });
    }
  }

  private async handleHello(data: unknown): Promise<void> {
    const heartbeatInterval = this.readHeartbeatInterval(data);
    if (!heartbeatInterval) {
      this.safeNotify({
        type: 'error',
        pluginId: this.pluginId,
        error: 'QQ Gateway hello missing heartbeat_interval',
      });
      this.recordError('QQ Gateway hello missing heartbeat_interval');
      this.failStartup(new Error('QQ Gateway hello missing heartbeat_interval'));
      return;
    }

    this.startHeartbeat(heartbeatInterval);
    const accessToken = await this.api.getGatewayAccessToken();
    if (this.sessionId && this.lastSeq !== null) {
      console.info('[qq] sending gateway resume', {
        pluginId: this.pluginId,
        sessionId: this.sessionId,
        seq: this.lastSeq,
      });
      const sent = this.sendFrame({
        op: 6,
        d: {
          token: `QQBot ${accessToken}`,
          session_id: this.sessionId,
          seq: this.lastSeq,
        },
      });
      if (sent) {
        this.identified = true;
        return;
      }
      const error = new Error('QQ Gateway resume was not sent because socket is not open');
      this.recordError(error);
      this.failStartup(error);
      return;
    }

    const levelToUse =
      this.lastSuccessfulIntentLevel >= 0 ? this.lastSuccessfulIntentLevel : this.intentLevelIndex;
    const intentLevel = resolveQQGatewayIntentLevel(levelToUse);
    console.info('[qq] sending gateway identify', {
      pluginId: this.pluginId,
      intents: intentLevel.name,
      description: intentLevel.description,
    });
    const sent = this.sendFrame({
      op: 2,
      d: {
        token: `QQBot ${accessToken}`,
        intents: intentLevel.intents,
        shard: [0, 1],
      },
    });
    if (sent) {
      this.identified = true;
      return;
    }
    const error = new Error('QQ Gateway identify was not sent because socket is not open');
    this.recordError(error);
    this.failStartup(error);
  }

  private createStartupWaiter(): Promise<void> {
    if (this.startupPromise) {
      return this.startupPromise;
    }
    this.startupPromise = new Promise<void>((resolve, reject) => {
      this.resolveStartup = resolve;
      this.rejectStartup = reject;
      this.startupTimer = setTimeout(() => {
        this.failStartup(
          new Error(
            this.identified
              ? 'QQ Gateway startup timed out before READY'
              : 'QQ Gateway startup timed out before hello/identify',
          ),
        );
      }, STARTUP_TIMEOUT_MS);
    });
    return this.startupPromise;
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
    this.recordError(normalized);
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
    this.startupPromise = null;
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

  private parseFrame(raw: unknown): QQGatewayFrame | null {
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

  private isGatewayFrame(value: unknown): value is QQGatewayFrame {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private readHeartbeatInterval(data: unknown): number | null {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return null;
    }
    const value = Object.fromEntries(Object.entries(data))['heartbeat_interval'];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  private readSessionId(data: unknown): string | null {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return null;
    }
    const value = Object.fromEntries(Object.entries(data))['session_id'];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendFrame({ op: 1, d: this.lastSeq });
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendFrame(frame: unknown): boolean {
    const current = this.socket;
    if (!current || current.readyState !== WebSocket.OPEN) {
      return false;
    }
    current.send(JSON.stringify(frame));
    return true;
  }

  private handleInvalidSession(data: unknown): void {
    const currentLevel = resolveQQGatewayIntentLevel(this.intentLevelIndex);
    const canResume = data === true;
    const error = `QQ Gateway invalid session at intent level ${currentLevel.name} (${currentLevel.description})`;
    this.safeNotify({
      type: 'error',
      pluginId: this.pluginId,
      error,
    });
    this.recordError(error);

    if (!canResume) {
      this.sessionId = null;
      this.lastSeq = null;
      this.clearSession();

      if (this.intentLevelIndex < QQ_GATEWAY_INTENT_LEVELS.length - 1) {
        this.intentLevelIndex += 1;
        const nextLevel = resolveQQGatewayIntentLevel(this.intentLevelIndex);
        console.warn('[qq] gateway invalid session; downgrading intents', {
          pluginId: this.pluginId,
          current: currentLevel.name,
          next: nextLevel.name,
        });
      } else {
        this.shouldRefreshToken = true;
        console.warn('[qq] gateway invalid session; all intents failed, refreshing token', {
          pluginId: this.pluginId,
          current: currentLevel.name,
        });
      }
    } else {
      console.warn('[qq] gateway invalid session; reconnecting with current intents', {
        pluginId: this.pluginId,
        current: currentLevel.name,
        canResume,
      });
    }

    this.forceReconnect(!canResume, INVALID_SESSION_RECONNECT_DELAY_MS);
  }

  private forceReconnect(resetSession = false, delayMs?: number): void {
    if (resetSession) {
      this.sessionId = null;
      this.lastSeq = null;
    }
    this.stopHeartbeat();
    const current = this.socket;
    if (delayMs !== undefined) {
      this.scheduleReconnect(delayMs);
    }
    if (
      current &&
      current.readyState !== WebSocket.CLOSED &&
      current.readyState !== WebSocket.CLOSING
    ) {
      current.close();
      return;
    }
    if (delayMs === undefined && this.running && !this.intentionalClose) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.reconnectTimer || !this.running || this.intentionalClose) {
      return;
    }
    const reconnectDelay =
      delayMs ??
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error: unknown) => {
        this.recordError(error);
        this.safeNotify({
          type: 'error',
          pluginId: this.pluginId,
          error: error instanceof Error ? error.message : String(error),
        });
        this.scheduleReconnect();
      });
    }, reconnectDelay);
  }

  private restoreSession(): void {
    const session = loadQQGatewaySession(this.ownerUserId, this.pluginId);
    if (!session) {
      return;
    }
    this.sessionId = session.sessionId;
    this.lastSeq = session.lastSeq;
    this.intentLevelIndex = session.intentLevelIndex;
    this.lastSuccessfulIntentLevel = session.intentLevelIndex;
  }

  private persistSession(): void {
    if (!this.sessionId || this.lastSeq === null) {
      return;
    }
    const intentLevelIndex =
      this.lastSuccessfulIntentLevel >= 0 ? this.lastSuccessfulIntentLevel : this.intentLevelIndex;
    saveQQGatewaySession(this.ownerUserId, this.pluginId, {
      sessionId: this.sessionId,
      lastSeq: this.lastSeq,
      lastConnectedAt: Date.now(),
      intentLevelIndex,
      savedAt: Date.now(),
    });
  }

  private clearSession(): void {
    clearQQGatewaySession(this.ownerUserId, this.pluginId);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (error) {
      console.warn('[qq] gateway notify handler threw', {
        pluginId: this.pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private recordError(error: unknown): void {
    this.lastErrorAt = Date.now();
    this.lastError = error instanceof Error ? error.message : String(error);
  }

  private logGatewayFrame(message: string): void {
    console.info('[qq] gateway frame', {
      pluginId: this.pluginId,
      message,
    });
  }
}

function resolveQQGatewayIntentLevel(index: number): QQGatewayIntentLevel {
  return QQ_GATEWAY_INTENT_LEVELS[index] ?? QQ_GATEWAY_INTENT_LEVEL_FULL;
}
