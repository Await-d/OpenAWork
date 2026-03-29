import type {
  MessagingChannelService,
  ChannelInstance,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelServiceFactory,
} from './types.js';

export class WhatsAppChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'whatsapp';

  private phoneNumberId: string;
  private accessToken: string;
  private verifyToken: string;
  private running = false;
  private notify: (event: ChannelEvent) => void;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.phoneNumberId = instance.config['phoneNumberId'] ?? '';
    this.accessToken = instance.config['accessToken'] ?? '';
    this.verifyToken = instance.config['verifyToken'] ?? '';
    this.notify = notify;
  }

  async start(): Promise<void> {
    if (!this.phoneNumberId || !this.accessToken) {
      throw new Error('WhatsApp channel requires phoneNumberId and accessToken');
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    const response = await fetch(
      `https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: chatId,
          type: 'text',
          text: { body: content },
        }),
      },
    );
    const data = (await response.json()) as {
      messages?: Array<{ id: string }>;
      error?: { message: string };
    };
    if (data.error) {
      throw new Error(`WhatsApp error: ${data.error.message}`);
    }
    return { messageId: data.messages?.[0]?.id ?? `${Date.now()}` };
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const chatId = messageId.split(':')[0] ?? '';
    return this.sendMessage(chatId, content);
  }

  handleWebhookVerification(mode: string, verifyToken: string, challenge: string): string | null {
    if (mode === 'subscribe' && verifyToken === this.verifyToken) {
      return challenge;
    }
    return null;
  }

  handleWebhookEvent(body: unknown): void {
    const payload = body as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              id: string;
              from: string;
              text?: { body: string };
              timestamp: string;
            }>;
            contacts?: Array<{ profile: { name: string }; wa_id: string }>;
          };
        }>;
      }>;
    };

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages) continue;
        for (const message of value.messages) {
          if (!message.text?.body) continue;
          const contact = value.contacts?.find((contact) => contact.wa_id === message.from);
          const channelMessage: ChannelMessage = {
            id: message.id,
            senderId: message.from,
            senderName: contact?.profile.name ?? message.from,
            chatId: message.from,
            content: message.text.body,
            timestamp: Number(message.timestamp) * 1000,
            raw: message,
          };
          this.notify({ type: 'message', pluginId: this.pluginId, message: channelMessage });
        }
      }
    }
  }

  async getGroupMessages(_chatId: string, _count?: number): Promise<ChannelMessage[]> {
    return [];
  }

  async listGroups(): Promise<ChannelGroup[]> {
    return [];
  }
}

export const whatsAppFactory: ChannelServiceFactory = (instance, notify) =>
  new WhatsAppChannelService(instance, notify);
