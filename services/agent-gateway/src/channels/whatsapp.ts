import type {
  MessagingChannelService,
  ChannelInstance,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelServiceFactory,
} from './types.js';
import { channelFetch } from './channel-http.js';
import { parseWhatsAppInboundMessage } from './inbound-parsers/whatsapp.js';
import { listRecentChannelGroups, listRecentChannelMessages } from './channel-message-cache.js';

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

  /**
   * Dispatch a channel event without letting a throwing subscriber break the
   * webhook batch loop. `handleWebhookEvent` fans every message in a single
   * WhatsApp webhook payload (entry[] → changes[] → messages[]) out via
   * `notify`; a synchronous throw from one dispatch (router lookup / filter)
   * would otherwise skip every remaining message in the same payload. Mirrors
   * the Telegram channel's `safeNotify` invariant.
   */
  private safeNotify(event: ChannelEvent): void {
    try {
      this.notify(event);
    } catch (err) {
      console.warn(
        `[whatsapp] channel notify handler threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async start(): Promise<void> {
    if (!this.phoneNumberId || !this.accessToken) {
      throw new Error('WhatsApp channel requires phoneNumberId and accessToken');
    }
    await this.verifyCredentials();
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async verifyCredentials(): Promise<void> {
    const response = await channelFetch(
      `https://graph.facebook.com/v19.0/${this.phoneNumberId}?fields=id,display_phone_number`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      },
    );
    const data = (await response.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (!response.ok || data.error || !data.id) {
      throw new Error(
        `WhatsApp credential check failed: ${data.error?.message ?? response.status}`,
      );
    }
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    const response = await channelFetch(
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
          const contact = value.contacts?.find((contact) => contact.wa_id === message.from);
          const parsed = parseWhatsAppInboundMessage({
            entry: [
              {
                changes: [
                  {
                    value: {
                      ...value,
                      messages: [message],
                      contacts: contact ? [contact] : value.contacts,
                    },
                  },
                ],
              },
            ],
          });
          if (!parsed) continue;
          this.safeNotify({ type: 'message', pluginId: this.pluginId, message: parsed });
        }
      }
    }
  }

  async getGroupMessages(_chatId: string, _count?: number): Promise<ChannelMessage[]> {
    return listRecentChannelMessages(this.pluginId, _chatId, _count);
  }

  async listGroups(): Promise<ChannelGroup[]> {
    return listRecentChannelGroups(this.pluginId);
  }
}

export const whatsAppFactory: ChannelServiceFactory = (instance, notify) =>
  new WhatsAppChannelService(instance, notify);
