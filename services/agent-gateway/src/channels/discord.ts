import type {
  MessagingChannelService,
  ChannelInstance,
  ChannelEvent,
  ChannelMessage,
  ChannelGroup,
  ChannelServiceFactory,
} from './types.js';
import { channelFetch } from './channel-http.js';

const DISCORD_API = 'https://discord.com/api/v10';

export class DiscordChannelService implements MessagingChannelService {
  readonly pluginId: string;
  readonly pluginType = 'discord';

  private token: string;
  private running = false;
  private notify: (event: ChannelEvent) => void;

  constructor(instance: ChannelInstance, notify: (event: ChannelEvent) => void) {
    this.pluginId = instance.id;
    this.token = instance.config['token'] ?? '';
    this.notify = notify;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bot ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  async start(): Promise<void> {
    if (!this.token) throw new Error('Discord bot token is required');
    this.running = true;
    this.notify({ type: 'status', pluginId: this.pluginId, status: 'running' });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.notify({ type: 'status', pluginId: this.pluginId, status: 'stopped' });
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(channelId: string, content: string): Promise<{ messageId: string }> {
    const res = await channelFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ content }),
    });
    const data = (await res.json()) as { id?: string };
    return { messageId: data.id ?? '' };
  }

  async replyMessage(messageId: string, content: string): Promise<{ messageId: string }> {
    const [channelId, msgId] = messageId.split(':');
    const res = await channelFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ content, message_reference: { message_id: msgId } }),
    });
    const data = (await res.json()) as { id?: string };
    return { messageId: data.id ?? '' };
  }

  async getGroupMessages(channelId: string, count = 20): Promise<ChannelMessage[]> {
    const res = await channelFetch(`${DISCORD_API}/channels/${channelId}/messages?limit=${count}`, {
      headers: this.headers,
    });
    const body = (await res.json()) as unknown;
    // Discord returns a JSON object (e.g. `{ message, code }`) on error,
    // not an array — guard so `.map` can't throw, and read each field
    // defensively in case an entry omits author/content.
    if (!Array.isArray(body)) {
      return [];
    }
    const msgs = body as Array<{
      id?: string;
      author?: { id?: string; username?: string };
      content?: string;
      timestamp?: string;
    }>;
    return msgs.map((m) => ({
      id: m.id ?? '',
      senderId: m.author?.id ?? 'unknown',
      senderName: m.author?.username ?? m.author?.id ?? 'unknown',
      chatId: channelId,
      content: m.content ?? '',
      timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
      raw: m,
    }));
  }

  async listGroups(): Promise<ChannelGroup[]> {
    const res = await channelFetch(`${DISCORD_API}/users/@me/guilds`, { headers: this.headers });
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) {
      return [];
    }
    const guilds = body as Array<{ id?: string; name?: string }>;
    return guilds.map((g) => ({ id: g.id ?? '', name: g.name ?? '' }));
  }
}

export const discordFactory: ChannelServiceFactory = (instance, notify) =>
  new DiscordChannelService(instance, notify);
