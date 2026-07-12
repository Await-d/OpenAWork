import type {
  ChannelInstance,
  ChannelEvent,
  ChannelDiagnostics,
  ChannelParseContext,
  ChannelStatus,
  ChannelServiceFactory,
  ChannelWsMessageParser,
  MessagingChannelService,
} from './types.js';
import { computeChannelRetryDelayMs } from './channel-http.js';
import { ChannelRelay } from './channel-relay.js';
import {
  channelLogInfo,
  channelLogWarn,
  summarizeChannelEvent,
  summarizeChannelInstance,
} from './channel-log.js';

interface ManagedChannelRuntime {
  instance: ChannelInstance;
  notify: (event: ChannelEvent) => void;
  readonly wrappedNotify: (event: ChannelEvent) => void;
  restartAttempt: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  stopping: boolean;
}

export class ChannelManager {
  private factories = new Map<string, ChannelServiceFactory>();
  private parsers = new Map<string, ChannelWsMessageParser>();
  private services = new Map<string, MessagingChannelService>();
  private statuses = new Map<string, ChannelStatus>();
  private inboundDiagnostics = new Map<
    string,
    Pick<
      ChannelDiagnostics,
      'lastInboundAt' | 'lastInboundAccepted' | 'lastInboundType' | 'lastInboundError'
    > &
      Pick<ChannelDiagnostics, 'lastMessageAt' | 'lastMessageChatId'>
  >();
  private startQueues = new Map<string, Promise<void>>();
  private relays = new Map<string, ChannelRelay>();
  private runtimes = new Map<string, ManagedChannelRuntime>();

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
    const runtime = this.ensureRuntime(instance, notify);
    runtime.stopping = false;
    this.clearRestartTimer(instance.id);

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
            channelLogInfo(
              'restarting existing channel service',
              summarizeChannelInstance(instance),
            );
            runtime.stopping = true;
            this.stopRelay(instance.id);
            await existing.stop();
            this.statuses.set(instance.id, 'stopped');
          } catch (err) {
            this.statuses.set(instance.id, 'error');
            throw err;
          } finally {
            runtime.stopping = false;
          }
        }

        const service = factory(instance, runtime.wrappedNotify);
        this.services.set(instance.id, service);
        this.statuses.set(instance.id, 'stopped');

        try {
          channelLogInfo('starting channel service', summarizeChannelInstance(instance));
          await service.start();
          this.startRelay(instance, runtime.wrappedNotify);
          this.statuses.set(instance.id, 'running');
          runtime.restartAttempt = 0;
          channelLogInfo('channel service started', summarizeChannelInstance(instance));
          runtime.wrappedNotify({ type: 'status', pluginId: instance.id, status: 'running' });
        } catch (err) {
          this.stopRelay(instance.id);
          this.services.delete(instance.id);
          this.statuses.set(instance.id, 'error');
          channelLogWarn('channel service start failed', {
            ...summarizeChannelInstance(instance),
            error: err instanceof Error ? err.message : String(err),
          });
          runtime.wrappedNotify({
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
    const runtime = this.runtimes.get(id);
    if (runtime) {
      runtime.stopping = true;
      this.clearRestartTimer(id);
    }
    const service = this.services.get(id);
    if (!service) {
      this.stopRelay(id);
      this.statuses.set(id, 'stopped');
      this.runtimes.delete(id);
      return;
    }
    try {
      channelLogInfo('stopping channel service', { pluginId: id, pluginType: service.pluginType });
      this.stopRelay(id);
      await service.stop();
      this.services.delete(id);
      this.statuses.set(id, 'stopped');
      channelLogInfo('channel service stopped', { pluginId: id, pluginType: service.pluginType });
      this.runtimes.delete(id);
    } catch (err) {
      this.statuses.set(id, 'error');
      channelLogWarn('channel service stop failed', {
        pluginId: id,
        pluginType: service.pluginType,
        error: err instanceof Error ? err.message : String(err),
      });
      if (runtime) {
        runtime.stopping = false;
      }
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

  getDiagnostics(id: string): ChannelDiagnostics {
    const status = this.getStatus(id);
    const service = this.services.get(id);
    const inbound = this.inboundDiagnostics.get(id);
    const diagnostics = service?.getDiagnostics?.();
    if (diagnostics) {
      return {
        ...diagnostics,
        ...inbound,
        status,
        running: service?.isRunning() ?? false,
      };
    }
    return {
      ...inbound,
      status,
      running: service?.isRunning() ?? false,
      note:
        status === 'running'
          ? 'Channel service has no diagnostics provider.'
          : 'Channel service is not running.',
    };
  }

  recordInboundDiagnostic(input: {
    readonly pluginId: string;
    readonly accepted: boolean;
    readonly eventType?: string;
    readonly error?: string;
    readonly message?: { readonly chatId: string };
  }): void {
    this.inboundDiagnostics.set(input.pluginId, {
      lastInboundAt: Date.now(),
      lastInboundAccepted: input.accepted,
      ...(input.eventType ? { lastInboundType: input.eventType } : {}),
      ...(input.error ? { lastInboundError: input.error } : {}),
      ...(input.message
        ? { lastMessageAt: Date.now(), lastMessageChatId: input.message.chatId }
        : {}),
    });
  }

  parseMessage(type: string, raw: unknown, context?: ChannelParseContext) {
    const parser = this.parsers.get(type);
    return parser ? parser(raw, context) : null;
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
    const relay = new ChannelRelay({
      channel: instance,
      parser,
      notify: (event) => {
        channelLogInfo('relay received channel event', summarizeChannelEvent(event));
        notify(event);
      },
    });
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
    const ids = new Set<string>([...this.services.keys(), ...this.runtimes.keys()]);
    await Promise.allSettled([...ids].map((id) => this.stopPlugin(id)));
  }

  listRunning(): string[] {
    return [...this.services.keys()].filter((id) => this.statuses.get(id) === 'running');
  }

  private ensureRuntime(
    instance: ChannelInstance,
    notify: (event: ChannelEvent) => void,
  ): ManagedChannelRuntime {
    const existing = this.runtimes.get(instance.id);
    if (existing) {
      existing.instance = instance;
      existing.notify = notify;
      return existing;
    }

    const runtime: ManagedChannelRuntime = {
      instance,
      notify,
      restartAttempt: 0,
      restartTimer: null,
      stopping: false,
      wrappedNotify: (event) => this.handleRuntimeEvent(instance.id, event),
    };
    this.runtimes.set(instance.id, runtime);
    return runtime;
  }

  private handleRuntimeEvent(id: string, event: ChannelEvent): void {
    const runtime = this.runtimes.get(id);
    if (!runtime) {
      return;
    }

    if (event.type === 'status') {
      this.statuses.set(id, event.status);
      if (event.status === 'running') {
        runtime.restartAttempt = 0;
        this.clearRestartTimer(id);
      } else if (!runtime.stopping && (event.status === 'stopped' || event.status === 'error')) {
        this.scheduleRestart(id, `channel reported status ${event.status}`);
      }
    } else if (event.type === 'error' && !runtime.stopping) {
      const service = this.services.get(id);
      const stillRunning = service?.isRunning() ?? false;
      if (!stillRunning) {
        this.statuses.set(id, 'error');
        this.scheduleRestart(id, event.error);
      }
    }

    runtime.notify(event);
  }

  private scheduleRestart(id: string, reason: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime || !this.shouldAutoRestart(runtime.instance) || runtime.restartTimer) {
      return;
    }

    const attempt = runtime.restartAttempt + 1;
    const delayMs = computeChannelRetryDelayMs(attempt);
    runtime.restartAttempt = attempt;
    this.statuses.set(id, 'error');
    channelLogWarn('scheduling channel auto-restart', {
      ...summarizeChannelInstance(runtime.instance),
      attempt,
      delayMs,
      reason,
    });
    runtime.restartTimer = setTimeout(() => {
      const current = this.runtimes.get(id);
      if (!current) {
        return;
      }
      current.restartTimer = null;
      if (current.stopping || !this.shouldAutoRestart(current.instance)) {
        return;
      }
      void this.startPlugin(current.instance, current.notify).catch((err) => {
        channelLogWarn('channel auto-restart attempt failed', {
          ...summarizeChannelInstance(current.instance),
          attempt: current.restartAttempt,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, delayMs);
  }

  private clearRestartTimer(id: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime?.restartTimer) {
      return;
    }
    clearTimeout(runtime.restartTimer);
    runtime.restartTimer = null;
  }

  private shouldAutoRestart(instance: ChannelInstance): boolean {
    return instance.enabled && instance.features?.autoStart === true;
  }
}

export const channelManager = new ChannelManager();
