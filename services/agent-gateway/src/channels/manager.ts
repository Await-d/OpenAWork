import type {
  ChannelInstance,
  ChannelEvent,
  ChannelStatus,
  ChannelServiceFactory,
  ChannelWsMessageParser,
  MessagingChannelService,
} from './types.js';
import { ChannelRelay } from './channel-relay.js';

export class ChannelManager {
  private factories = new Map<string, ChannelServiceFactory>();
  private parsers = new Map<string, ChannelWsMessageParser>();
  private services = new Map<string, MessagingChannelService>();
  private statuses = new Map<string, ChannelStatus>();
  private startQueues = new Map<string, Promise<void>>();
  private relays = new Map<string, ChannelRelay>();

  registerFactory(type: string, factory: ChannelServiceFactory): void {
    this.factories.set(type, factory);
  }

  registerParser(type: string, parser: ChannelWsMessageParser): void {
    this.parsers.set(type, parser);
  }

  async startPlugin(
    instance: ChannelInstance,
    notify: (event: ChannelEvent) => void,
  ): Promise<void> {
    const previous = this.startQueues.get(instance.id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const factory = this.factories.get(instance.type);
        if (!factory) {
          throw new Error(`No factory registered for channel type: ${instance.type}`);
        }

        const existing = this.services.get(instance.id);
        if (existing?.isRunning()) {
          try {
            this.stopRelay(instance.id);
            await existing.stop();
            this.statuses.set(instance.id, 'stopped');
          } catch (err) {
            this.statuses.set(instance.id, 'error');
            throw err;
          }
        }

        const service = factory(instance, notify);
        this.services.set(instance.id, service);
        this.statuses.set(instance.id, 'stopped');

        try {
          await service.start();
          this.startRelay(instance, notify);
          this.statuses.set(instance.id, 'running');
          notify({ type: 'status', pluginId: instance.id, status: 'running' });
        } catch (err) {
          this.stopRelay(instance.id);
          this.services.delete(instance.id);
          this.statuses.set(instance.id, 'error');
          notify({
            type: 'error',
            pluginId: instance.id,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      });

    this.startQueues.set(instance.id, next);
    try {
      await next;
    } finally {
      if (this.startQueues.get(instance.id) === next) {
        this.startQueues.delete(instance.id);
      }
    }
  }

  async stopPlugin(id: string): Promise<void> {
    const service = this.services.get(id);
    if (!service) {
      this.stopRelay(id);
      return;
    }
    try {
      this.stopRelay(id);
      await service.stop();
      this.services.delete(id);
      this.statuses.set(id, 'stopped');
    } catch (err) {
      this.statuses.set(id, 'error');
      throw err;
    }
  }

  async restartPlugin(
    instance: ChannelInstance,
    notify: (event: ChannelEvent) => void,
  ): Promise<void> {
    await this.stopPlugin(instance.id);
    await this.startPlugin(instance, notify);
  }

  getService(id: string): MessagingChannelService | undefined {
    return this.services.get(id);
  }

  getStatus(id: string): ChannelStatus {
    return this.statuses.get(id) ?? 'stopped';
  }

  parseMessage(type: string, raw: unknown) {
    const parser = this.parsers.get(type);
    return parser ? parser(raw) : null;
  }

  private startRelay(instance: ChannelInstance, notify: (event: ChannelEvent) => void): void {
    this.stopRelay(instance.id);
    if (!instance.config['wsUrl']) {
      return;
    }
    const parser = this.parsers.get(instance.type);
    if (!parser) {
      return;
    }
    const relay = new ChannelRelay({ channel: instance, parser, notify });
    this.relays.set(instance.id, relay);
    relay.start();
  }

  private stopRelay(id: string): void {
    const relay = this.relays.get(id);
    if (!relay) {
      return;
    }
    relay.stop();
    this.relays.delete(id);
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.services.keys()].map((id) => this.stopPlugin(id)));
  }

  listRunning(): string[] {
    return [...this.services.keys()].filter((id) => this.statuses.get(id) === 'running');
  }
}

export const channelManager = new ChannelManager();
