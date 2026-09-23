import type { Buffer } from 'node:buffer';
import type {
  MessagingChannelService,
  ChannelImageAttachment,
  ChannelInstance,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelReplyLanguage,
  ChannelStreamingHandle,
  ChannelServiceFactory,
  FeishuFileType,
} from './types.js';
import { channelFetch, computeChannelRetryDelayMs } from './channel-http.js';
import {
  parseTelegramInboundMessage,
  resolveTelegramImageCandidate,
} from './inbound-parsers/telegram.js';
import {
  downloadTelegramInboundImage,
  sendTelegramDocument,
  sendTelegramPhoto,
} from './telegram-media.js';
import { listTelegramBotCommands } from './channel-localization.js';
import { listRecentChannelGroups, listRecentChannelMessages } from './channel-message-cache.js';
import { normalizeChannelReplyLanguage } from './channel-reply-language.js';

/**
 * Telegram long-poll uses `timeout=25`, so the upstream intentionally
 * holds the connection up to 25s. Allow generous headroom on top before
 * our client-side timeout fires, otherwise we would abort healthy long
 * polls.
 */
const TELEGRAM_POLL_TIMEOUT_MS = 35_000;
const TELEGRAM_STARTUP_TIMEOUT_MS = 15_000;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; last_name?: string; username?: string };
    chat: { id: number; title?: string; type: string };
    text?: string;
    date: number;
    entities?: Array<{ type?: string; offset?: number; length?: number }>;
  };
}

/** 出站图片入参，与 `MessagingChannelService.sendImage` / `replyImage` 的契约一致。 */
interface TelegramImageSendInput {
  readonly buffer: Buffer;
  readonly fileName?: string;
  readonly signal?: AbortSignal;
  readonly sourceUrl?: string;
  readonly text?: string;
}

export class TelegramChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'telegram';
  readonly supportsStreaming = true;

  private readonly instance: ChannelInstance;
  private token: string;
  private running = false;
  private pollOffset = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private notify: (event: ChannelEvent) => void;
  private pollFailureCount = 0;
  private pollAbort: AbortController | null = null;
  private readonly replyLanguage: ChannelReplyLanguage;
  private botUsername: string | undefined;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.instance = instance;
    this.pluginId = instance.id;
    this.token = instance.config['token'] ?? '';
    this.notify = notify;
    this.replyLanguage = normalizeChannelReplyLanguage(instance.replyLanguage);
  }

  private get apiBase(): string {
    return `https://api.telegram.org/bot${this.token}`;
  }

  /**
   * 图片下载专用基址（内嵌 bot token，禁止外泄）。**必须无尾斜杠**：
   * `telegram-media` 按字面 `${fileBaseUrl}/${file_path}` 拼接。
   */
  private get fileBaseUrl(): string {
    return `https://api.telegram.org/file/bot${this.token}`;
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
    if (this.running) {
      return;
    }
    this.botUsername = await this.verifyBotToken();
    await this.registerBuiltinCommands();
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
              // 图片消息文本可能为空：用纯函数判定候选，避免把无文本的
              // photo/document 更新整批丢掉。
              if (update.message?.text || resolveTelegramImageCandidate(update.message)) {
                // 不 await：图片下载可能耗时数秒，等待会拖慢长轮询节奏。
                this.dispatchUpdate(update);
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

  private async verifyBotToken(): Promise<string | undefined> {
    const res = await channelFetch(`${this.apiBase}/getMe`, {
      timeoutMs: TELEGRAM_STARTUP_TIMEOUT_MS,
    });
    if (!res.ok) {
      throw new Error(`Telegram getMe failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      ok?: boolean;
      description?: string;
      result?: { username?: string };
    };
    if (data.ok !== true) {
      throw new Error(`Telegram getMe failed: ${data.description ?? 'invalid response'}`);
    }
    const username = data.result?.username?.trim();
    return username || this.instance.config['botUsername']?.trim() || undefined;
  }

  private async registerBuiltinCommands(): Promise<void> {
    try {
      const res = await channelFetch(`${this.apiBase}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: listTelegramBotCommands(this.replyLanguage),
        }),
        timeoutMs: TELEGRAM_STARTUP_TIMEOUT_MS,
      });
      if (!res.ok) {
        console.warn(`[telegram] setMyCommands failed: HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(
        `[telegram] setMyCommands failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private parseUpdate(update: TelegramUpdate): ChannelMessage | null {
    return parseTelegramInboundMessage(update, {
      channel: this.instance,
      botUsername: this.botUsername,
    });
  }

  /**
   * 入站更新派发必须 fire-and-forget：图片下载（getFile → 取回文件）可能耗时
   * 数秒，await 会拖慢长轮询节奏。这里统一吞掉 rejection 并 warn，保证派发
   * 失败既不中断轮询循环，也不会产生 unhandled rejection。
   */
  private dispatchUpdate(update: TelegramUpdate): void {
    void this.handleUpdate(update).catch((err) => {
      console.warn('[telegram] update dispatch failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = this.parseUpdate(update);
    if (!message) {
      return;
    }
    const images = await this.downloadInboundImages(update);
    this.safeNotify({
      type: 'message',
      pluginId: this.pluginId,
      message: images.length > 0 ? { ...message, images } : message,
    });
  }

  /**
   * 下载入站图片并转为 base64 附件。故意不传 AbortSignal：`pollAbort` 会在每轮
   * 长轮询结束（含 `finally`）时置空，派生下载会拿到竞态中的信号；下载本身由
   * `telegram-media` 内部的 30s 超时兜底，失败时返回 `null`，消息按占位符投递。
   */
  private async downloadInboundImages(update: TelegramUpdate): Promise<ChannelImageAttachment[]> {
    const candidate = resolveTelegramImageCandidate(update);
    if (!candidate) {
      return [];
    }
    const image = await downloadTelegramInboundImage({
      apiBase: this.apiBase,
      fileBaseUrl: this.fileBaseUrl,
      fileId: candidate.fileId,
      ...(candidate.fileName ? { fileName: candidate.fileName } : {}),
      ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}),
      ...(candidate.fileSize !== undefined ? { fileSize: candidate.fileSize } : {}),
    });
    return image ? [image] : [];
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

  /**
   * 出站发图：Telegram 的 `sendPhoto` 只接受二进制 multipart，故 `sourceUrl`
   * 按接口保留但不使用（调用方需先取成 buffer）。
   */
  async sendImage(chatId: string, input: TelegramImageSendInput): Promise<{ messageId: string }> {
    return sendTelegramPhoto({
      apiBase: this.apiBase,
      chatId,
      buffer: input.buffer,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      ...(input.text ? { caption: input.text } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  /**
   * 回复图片：`messageId` 约定与 `replyMessage` 一致，为 `<chatId>:<msgId>`；
   * 引用消息 id 通过 `reply_to_message_id` 传给 `sendPhoto`。
   */
  async replyImage(
    messageId: string,
    input: TelegramImageSendInput,
  ): Promise<{ messageId: string }> {
    const [chatId, msgId] = messageId.split(':');
    if (!chatId || !msgId) {
      throw new Error('Telegram image reply requires "<chatId>:<messageId>" reference');
    }
    return sendTelegramPhoto({
      apiBase: this.apiBase,
      chatId,
      buffer: input.buffer,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      ...(input.text ? { caption: input.text } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      replyToMessageId: msgId,
    });
  }

  /**
   * 出站发文件：走 `sendDocument` multipart。`fileType` 按接口保留但不使用——
   * Telegram 由文件名 / 内容自行推断文档类型，无需调用方声明。
   */
  async sendFile(
    chatId: string,
    input: {
      readonly buffer: Buffer;
      readonly fileName: string;
      readonly fileType?: FeishuFileType;
      readonly signal?: AbortSignal;
      readonly text?: string;
    },
  ): Promise<{ messageId: string }> {
    return sendTelegramDocument({
      apiBase: this.apiBase,
      chatId,
      buffer: input.buffer,
      fileName: input.fileName,
      ...(input.text ? { caption: input.text } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  async getGroupMessages(chatId: string, count?: number): Promise<ChannelMessage[]> {
    return listRecentChannelMessages(this.pluginId, chatId, count);
  }

  async listGroups(): Promise<ChannelGroup[]> {
    return listRecentChannelGroups(this.pluginId);
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
