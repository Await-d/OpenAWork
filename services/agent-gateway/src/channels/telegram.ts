import type {
  MessagingChannelService,
  ChannelInstance,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelStreamingHandle,
  ChannelServiceFactory,
} from './types.js';

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

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.token = instance.config['token'] ?? '';
    this.notify = notify;
  }

  private get apiBase(): string {
    return `https://api.telegram.org/bot${this.token}`;
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
  }

  isRunning(): boolean {
    return this.running;
  }

  private poll(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `${this.apiBase}/getUpdates?offset=${this.pollOffset}&timeout=25`,
          );
          const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
          if (data.ok) {
            for (const update of data.result) {
              this.pollOffset = update.update_id + 1;
              if (update.message?.text) {
                const msg = this.parseUpdate(update);
                if (msg) this.notify({ type: 'message', pluginId: this.pluginId, message: msg });
              }
            }
          }
        } catch (err) {
          this.notify({
            type: 'error',
            pluginId: this.pluginId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        this.poll();
      })();
    }, 1000);
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
    const res = await fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: content }),
    });
    const data = (await res.json()) as { result?: { message_id: number } };
    return { messageId: String(data.result?.message_id ?? '') };
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const [chatId, msgId] = messageId.split(':');
    const res = await fetch(`${this.apiBase}/sendMessage`, {
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
        await fetch(`${this.apiBase}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: Number(messageId), text: content }),
        });
      },
      finish: async (finalContent: string) => {
        await fetch(`${this.apiBase}/editMessageText`, {
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
