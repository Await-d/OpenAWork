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
  clearChannelHealthIssue,
  getChannelHealthRecord,
  recordChannelHealthIssue,
  persistChannelInboundDiagnostic,
} from './channel-error-store.js';
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
          // 启动成功即视为恢复：清掉上一次失败留下的快照，否则启动一次成功后
          // 配置页仍显示旧错误，排障时会把已解决的问题当成现存问题。
          clearChannelHealthIssue(instance.id);
          runtime.wrappedNotify({ type: 'status', pluginId: instance.id, status: 'running' });
        } catch (err) {
          this.stopRelay(instance.id);
          this.services.delete(instance.id);
          this.statuses.set(instance.id, 'error');
          channelLogWarn('channel service start failed', {
            ...summarizeChannelInstance(instance),
            error: err instanceof Error ? err.message : String(err),
          });
          // 启动失败此前只进日志与内存 statuses，进程重启后配置页看不出任何异常。
          // 落 channel_health 让「为什么这个频道连不上」跨重启可查。
          recordChannelHealthIssue({
            channelId: instance.id,
            channelType: instance.type,
            message: `频道服务启动失败：${err instanceof Error ? err.message : String(err)}`,
            source: 'channel_start',
            status: 'error',
            ...(instance.ownerUserId ? { ownerUserId: instance.ownerUserId } : {}),
            ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
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
      // 停止失败意味着连接/轮询可能还挂在后台继续跑，属于要人工介入的状态，
      // 必须留痕 —— 停不掉的服务会继续吞消息或重复投递。
      recordChannelHealthIssue({
        channelId: id,
        channelType: service.pluginType,
        message: `频道服务停止失败：${err instanceof Error ? err.message : String(err)}`,
        source: 'channel_stop',
        status: 'error',
        ...(runtime?.instance.ownerUserId ? { ownerUserId: runtime.instance.ownerUserId } : {}),
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
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
    // 内存快照优先（更新鲜），缺失的字段回落到 DB 快照 —— 进程刚重启时服务
    // 还没有任何内存诊断，此时只剩 DB 能回答「上次为什么坏」。
    const persisted = readPersistedChannelFields(id);
    const base: ChannelDiagnostics = {
      ...persisted,
      ...inbound,
      status,
      running: service?.isRunning() ?? false,
    };
    if (diagnostics) {
      return {
        ...base,
        ...diagnostics,
        status,
        running: service?.isRunning() ?? false,
      };
    }
    return {
      ...base,
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
    const at = Date.now();
    this.inboundDiagnostics.set(input.pluginId, {
      lastInboundAt: at,
      lastInboundAccepted: input.accepted,
      ...(input.eventType ? { lastInboundType: input.eventType } : {}),
      ...(input.error ? { lastInboundError: input.error } : {}),
      ...(input.message ? { lastMessageAt: at, lastMessageChatId: input.message.chatId } : {}),
    });

    // 内存 Map 活不过一次重启，而「这条消息到底有没有进来」恰恰是要在重启后
    // 回答的问题。成功也写：诊断的价值在于对照，而非只记故障。
    const runtime = this.runtimes.get(input.pluginId);
    persistChannelInboundDiagnostic({
      channelId: input.pluginId,
      accepted: input.accepted,
      occurredAt: at,
      ...(input.eventType ? { eventType: input.eventType } : {}),
      ...(input.error ? { error: input.error } : {}),
      ...(input.message ? { chatId: input.message.chatId } : {}),
      ...(runtime?.instance.type ? { channelType: runtime.instance.type } : {}),
      ...(runtime?.instance.ownerUserId ? { ownerUserId: runtime.instance.ownerUserId } : {}),
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
      // relay 形态现与 HTTP 入站一致地支持媒体 enrich：注入 service 的
      // enrichInboundMessage 实现（无实现时原样返回）。这里是第二层兜底——
      // service 抛错时告警并原样投递，绝不因媒体下载失败丢消息。
      enrich: async (message) => {
        const service = this.services.get(instance.id);
        if (!service?.enrichInboundMessage) {
          return message;
        }
        try {
          return await service.enrichInboundMessage(message);
        } catch (error) {
          channelLogWarn('relay inbound media enrich failed', {
            channelId: instance.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return message;
        }
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
    // 触发自动重启本身就是故障信号（连接掉了），留痕让「反复重启」可被追踪。
    recordChannelHealthIssue({
      channelId: id,
      channelType: runtime.instance.type,
      message: `频道连接异常，准备第 ${attempt} 次自动重启：${reason}`,
      source: 'channel_restart',
      status: 'error',
      ...(runtime.instance.ownerUserId ? { ownerUserId: runtime.instance.ownerUserId } : {}),
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
        recordChannelHealthIssue({
          channelId: id,
          channelType: current.instance.type,
          message: `第 ${current.restartAttempt} 次自动重启失败：${err instanceof Error ? err.message : String(err)}`,
          source: 'channel_restart',
          status: 'error',
          ...(current.instance.ownerUserId ? { ownerUserId: current.instance.ownerUserId } : {}),
          ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
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

/**
 * 从 `channel_health` 读回可并入 `ChannelDiagnostics` 的字段。
 *
 * 逐字段映射而非整行覆盖：内存快照的字段更新鲜、DB 的更持久，两者字段集不同，
 * 整行合并会丢掉运行时才知道的 transport / socket 细节。
 */
function readPersistedChannelFields(channelId: string): Partial<ChannelDiagnostics> {
  let record: ReturnType<typeof getChannelHealthRecord>;
  try {
    record = getChannelHealthRecord(channelId);
  } catch (error) {
    // 诊断是只读旁路，读失败不能连带影响配置页渲染。
    channelLogWarn('read persisted channel diagnostics failed', {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }

  if (!record) {
    return {};
  }

  return {
    ...(record.lastError ? { lastError: record.lastError } : {}),
    ...(record.lastErrorAt ? { lastErrorAt: record.lastErrorAt } : {}),
    ...(record.lastInboundAt ? { lastInboundAt: record.lastInboundAt } : {}),
    ...(record.lastInboundAccepted !== null
      ? { lastInboundAccepted: record.lastInboundAccepted }
      : {}),
    ...(record.lastInboundType ? { lastInboundType: record.lastInboundType } : {}),
    ...(record.lastInboundError ? { lastInboundError: record.lastInboundError } : {}),
    ...(record.lastMessageAt ? { lastMessageAt: record.lastMessageAt } : {}),
    ...(record.lastMessageChatId ? { lastMessageChatId: record.lastMessageChatId } : {}),
  };
}

export const channelManager = new ChannelManager();
