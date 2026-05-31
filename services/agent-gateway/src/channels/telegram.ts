import type {
  MessagingChannelService,
  ChannelInstance,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelStreamingHandle,
  ChannelServiceFactory,
} from './types.js';
import { channelFetch, computeChannelRetryDelayMs } from './channel-http.js';

/**
 * Telegram long-poll uses `timeout=25`, so the upstream intentionally
 * holds the connection up to 25s. Allow generous headroom on top before
 * our client-side timeout fires, otherwise we would abort healthy long
 * polls.
 */
const TELEGRAM_POLL_TIMEOUT_MS = 35_000;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; username?: string };
    chat: { id: number; title?: string; type: string };
    text?: string;
    date: number;
  };
}

export class TelegramChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'telegram';
  readonly supportsStreaming = true;

  private token: string;
  private running = false;
  private pollOffset = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private notify: (event: ChannelEvent) => void;
  private pollFailureCount = 0;
  private pollAbort: AbortController | null = null;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.token = instance.config['token'] ?? '';
    this.notify = notify;
  }

  private get apiBase(): string {
    return `https://api.telegram.org/bot${this.token}`;
  }

  /**
   * The `notify` callback is an external subscriber (router → auto-reply). If it
   * throws synchronously it must never break the long-poll loop: on the message
   * path a throw would skip the rest of the batch and spuriously trip the failure
   * backoff (the network was fine); on the error path a throw would escape the
   * fire-and-forget IIFE as an unhandled rejection and prevent re-arming, killing
   * polling until restart. Isolating every dispatch keeps the loop alive.
   */
  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (err) {
      console.warn(
        `[telegram] channel notify handler threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async start(): Promise<void> {
    if (!this.token) throw new Error('Telegram bot token is required');
    this.running = true;
    this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    // Cancel any in-flight long poll so a hung connection can't keep the
    // service alive after stop().
    if (this.pollAbort) {
      this.pollAbort.abort();
      this.pollAbort = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private poll(): void {
    if (!this.running) return;
    const delay =
      this.pollFailureCount > 0 ? computeChannelRetryDelayMs(this.pollFailureCount) : 1000;
    this.pollTimer = setTimeout(() => {
      void (async () => {
        try {
          this.pollAbort = new AbortController();
          const res = await channelFetch(
            `${this.apiBase}/getUpdates?offset=${this.pollOffset}&timeout=25`,
            { timeoutMs: TELEGRAM_POLL_TIMEOUT_MS, signal: this.pollAbort.signal },
          );
          if (!res.ok) {
            throw new Error(`Telegram getUpdates failed: HTTP ${res.status}`);
          }
          const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
          if (data.ok) {
            for (const update of data.result) {
              this.pollOffset = update.update_id + 1;
              if (update.message?.text) {
                const msg = this.parseUpdate(update);
                if (msg)
                  this.safeNotify({ type: 'message', pluginId: this.pluginId, message: msg });
              }
            }
          }
          // Recovered — reset backoff so the next poll resumes the fast cadence.
          this.pollFailureCount = 0;
        } catch (err) {
          // A stop()-triggered abort is expected shutdown, not a fault.
          if (!this.running) return;
          this.pollFailureCount += 1;
          this.safeNotify({
            type: 'error',
            pluginId: this.pluginId,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          this.pollAbort = null;
          // Re-arm from finally so an unexpected throw on any path can never
          // leave the loop dead. poll() no-ops when running === false (stop()).
          this.poll();
        }
      })();
    }, delay);
  }

  private parseUpdate(update: TelegramUpdate): ChannelMessage | null {
    const msg = update.message;
    if (!msg) return null;
    return {
      id: String(msg.message_id),
      senderId: String(msg.from?.id ?? 'unknown'),
      senderName: msg.from?.first_name ?? 'Unknown',
      chatId: String(msg.chat.id),
      chatName: msg.chat.title,
      content: msg.text ?? '',
      timestamp: msg.date * 1000,
      raw: update,
    };
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    const res = await channelFetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: content }),
    });
    const data = (await res.json()) as { result?: { message_id: number } };
    return { messageId: String(data.result?.message_id ?? '') };
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const [chatId, msgId] = messageId.split(':');
    const res = await channelFetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: content, reply_to_message_id: msgId }),
    });
    const data = (await res.json()) as { result?: { message_id: number } };
    return { messageId: String(data.result?.message_id ?? '') };
  }

  async getGroupMessages(chatId: string, count?: number): Promise<ChannelMessage[]> {
    void chatId;
    void count;
    return [];
  }

  async listGroups(): Promise<ChannelGroup[]> {
    return [];
  }

  async sendStreamingMessage(
    chatId: string,
    initialContent: string,
    replyToMessageId?: string,
  ): Promise<ChannelStreamingHandle> {
    void replyToMessageId;
    const sent = await this.sendMessage(chatId, initialContent);
    const messageId = sent.messageId;

    return {
      update: async (content: string) => {
        await channelFetch(`${this.apiBase}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: Number(messageId), text: content }),
        });
      },
      finish: async (finalContent: string) => {
        await channelFetch(`${this.apiBase}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: Number(messageId),
            text: finalContent,
          }),
        });
      },
    };
  }
}

export const telegramFactory: ChannelServiceFactory = (instance, notify) =>
  new TelegramChannelService(instance, notify);
