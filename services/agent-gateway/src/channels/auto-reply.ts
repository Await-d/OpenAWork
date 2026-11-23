import type { InputImageContent } from '@openAwork/shared';
import type {
  ChannelEvent,
  ChannelImageAttachment,
  ChannelInstance,
  MessagingChannelService,
} from './types.js';
import { channelManager } from './manager.js';
import {
  tryHandleChannelCommand,
  type ChannelCommandAction,
  type ChannelCommandActions,
  type ChannelCommandContext,
} from './channel-commands.js';
import {
  buildBusyMessage,
  buildChannelCommandActionsUnavailableMessage,
  buildInterruptedMessage,
  buildLocalizedErrorMessage,
  buildNoChannelConfigurationMessage,
  buildPendingMessage,
  buildQueuedMessage,
} from './channel-localization.js';
import { channelLogInfo, channelLogWarn, summarizeChannelMessage } from './channel-log.js';
import { recordChannelHealthIssue, type ChannelErrorSource } from './channel-error-store.js';
import { normalizeChannelReplyLanguage } from './channel-reply-language.js';
import type { ChannelReplyLanguage } from './types.js';
import { logGatewayError } from '../infra/gateway-logger.js';

export type { ChannelCommandActions, ChannelCommandContext } from './channel-commands.js';

export interface AutoReplyOptions {
  commandActions?: ChannelCommandActions;
  /**
   * 非流式渠道「仍在处理」回执的延迟（毫秒）；`0` 表示关闭。
   *
   * 默认 `CHANNEL_PENDING_NOTICE_DELAY_MS`（10s）。抽成选项是为了可测：验证这条
   * 回执必须能推进到阈值，而不必在单测里真等 10 秒。
   */
  pendingNoticeDelayMs?: number;
  /**
   * 收到新消息时是否打断同一通道会话正在执行（含仍在排队）的轮次，默认开启。
   *
   * 渠道的插话语义是「最新意图优先」：IM 里用户连发几条时，前一轮往往已经不再
   * 是他想说的话，却会让后面每条都只能收到「仍在处理中 / 已排队」回执。开启后
   * 新消息会中断前一轮并立刻开跑。
   *
   * 抽成选项有两个目的：可测（单测要断言旧排队语义），以及在「不希望被打断」的
   * 部署里回退到纯排队行为。
   */
  interruptOnNewMessage?: boolean;
  resolveChannel?: (pluginId: string) => ChannelInstance | undefined;
  onAgentRun: (params: {
    sessionKey: string;
    message: string;
    pluginId: string;
    chatId: string;
    senderId: string;
    senderName: string;
    inputParts?: InputImageContent[];
    messageId: string;
    onPartialText?: (text: string) => Promise<void> | void;
    /**
     * 本轮被更新的入站消息抢占时 abort。实现方必须据此真正停下本轮
     * （渠道走 `stopAnyInFlightStreamRequestForSession`），否则会话运行锁不释放，
     * 新一轮会撞 `SESSION_ALREADY_RUNNING`。
     */
    signal?: AbortSignal;
  }) => Promise<string>;
}

interface AutoReplySendContext {
  readonly channel?: ChannelInstance;
  readonly content: string;
  readonly message: ChannelEvent & { readonly type: 'message' };
  readonly service: MessagingChannelService;
}

/**
 * 一个通道会话（pluginId + chatId）上的串行执行链。
 *
 * 串行是必须的：同一会话两个轮次并发会撞内核的 `SESSION_ALREADY_RUNNING`。在此之上
 * 叠加「最新意图优先」——每条入站消息自己持一个 `AbortController`：`active` 是正在
 * 跑的那一轮，`waiting` 是已入队但还没轮到的那些。抢占时把两者一起 abort，于是
 * 正在跑的那轮停下、排队的那些在轮到时直接跳过，最新这条立刻接上。
 */
interface SessionTaskChain {
  promise: Promise<void>;
  /** 当前正在执行的轮次控制器；没有轮次在跑时为 `undefined`。 */
  active?: AbortController;
  /** 已入队、尚未开始执行的轮次控制器。 */
  readonly waiting: Set<AbortController>;
}

const MAX_SESSION_TASK_QUEUE_DEPTH = 8;

/**
 * 非流式渠道的「本轮仍在执行」回执延迟阈值。
 *
 * 短任务（普通问答）在这个阈值内就结束了，不会多发消息；超过它仍没结果，才补一条
 * 回执让等待可见。设为 10s 的取舍：小于它用户通常还能接受，大于它「是不是没收到」
 * 的疑虑显著上升；再小会明显刷屏（每次问答都多一条）。
 *
 * QQ 这类被动回复限制：同一 `msg_id` 允许的回复次数有限（实现里按 `msg_seq` 递增，
 * 上限 5 条），所以「回执 + 最终结果」= 2 条是安全的，但不能无限追加。
 */
const CHANNEL_PENDING_NOTICE_DELAY_MS = 10_000;

export class AutoReplyPipeline {
  private options: AutoReplyOptions;
  private readonly sessionTaskChains = new Map<string, SessionTaskChain>();

  constructor(options: AutoReplyOptions) {
    this.options = options;
  }

  async handle(event: ChannelEvent): Promise<void> {
    // `handle` is invoked fire-and-forget (`void autoReply.handle(event)`)
    // from the channel notify hook. Any rejection that escapes here becomes
    // an unhandled promise rejection, so the entire body is wrapped to
    // guarantee the pipeline absorbs and logs faults instead of crashing the
    // process.
    try {
      await this.handleInternal(event);
    } catch (err) {
      // `handleInternal` 首行即 `if (event.type !== 'message') return`，所以能到
      // 这里的事件必然是 message，`pluginId` 不会是占位值。
      const pluginId = event.type === 'message' ? event.pluginId : 'unknown';
      logGatewayError('[auto-reply] unhandled channel event failure', {
        pluginId,
        error: err instanceof Error ? err.message : String(err),
      });
      // 兜底分支吞掉的是「所有内层处理都没接住」的故障，原本只留一行日志。
      // 这里补一次落库。注意归属：内层若已创建会话则 sessionId 为 null
      // （渠道层拿不到 userId 就无法关联），此时该行仅供数据库层排查，
      // 用户排障页看不到 —— 这是刻意的，见 `listChannelErrorAuditLogs` 的说明。
      recordChannelHealthIssue({
        channelId: pluginId,
        message: `渠道事件处理兜底失败：${err instanceof Error ? err.message : String(err)}`,
        source: 'channel_dispatch',
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      });
    }
  }

  private async handleInternal(event: ChannelEvent): Promise<void> {
    if (event.type !== 'message') return;

    const { pluginId, message } = event;
    channelLogInfo('auto-reply received message', {
      pluginId,
      ...summarizeChannelMessage(message),
    });
    const service = channelManager.getService(pluginId);
    if (!service) {
      // 消息已经进来了却没有服务接管（启动中 / 重启窗口 / 服务已崩溃）。
      // 原实现只 warn 后 return，用户看到的是「发了没回」，且重启后无从查证。
      channelLogWarn('auto-reply skipped: service not found', { pluginId });
      this.recordIssue({
        channelId: pluginId,
        message: '收到入站消息但频道服务未在运行，消息未被处理（service not found）',
        source: 'channel_dispatch',
      });
      return;
    }

    const channel = this.options.resolveChannel?.(pluginId);
    const replyLanguage = resolveReplyLanguage(channel);
    if (channel && (!channel.enabled || channel.features?.autoReply === false)) {
      channelLogInfo('auto-reply skipped: channel disabled or autoReply off', {
        pluginId,
        enabled: channel.enabled,
        autoReply: channel.features?.autoReply ?? true,
      });
      return;
    }

    let commandResult: Awaited<ReturnType<typeof tryHandleChannelCommand>>;
    try {
      commandResult = await tryHandleChannelCommand({
        actions: this.options.commandActions,
        channel,
        message,
        pluginId,
      });
    } catch (err) {
      // 指令解析（重写、命令匹配）抛错时原实现直接冒泡到 `handle()`，错误信息与
      // 触发它的原始消息都不留痕。这里补落库并原样抛出，保持控制流不变。
      this.recordIssue({
        channelId: pluginId,
        message: `频道指令处理失败：${err instanceof Error ? err.message : String(err)}`,
        source: 'channel_inbound',
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      });
      throw err;
    }

    if (commandResult.kind === 'skip') {
      channelLogInfo('auto-reply command skipped normal handling', { pluginId });
      return;
    }

    if (commandResult.kind === 'action') {
      if (!channel) {
        await this.sendChannelReply({
          channel,
          content: buildNoChannelConfigurationMessage(replyLanguage),
          message: event,
          service,
        });
        return;
      }
      const result = await this.handleCommandAction(commandResult.action, {
        channel,
        chatId: message.chatId,
        replyLanguage,
      });
      await this.sendChannelReply({ channel, content: result.content, message: event, service });
      return;
    }

    if (commandResult.kind === 'reply') {
      await this.sendChannelReply({
        channel,
        content: commandResult.content,
        message: event,
        service,
      });
      return;
    }

    if (commandResult.kind === 'rewrite' && commandResult.reply) {
      await this.sendChannelReply({
        channel,
        content: commandResult.reply,
        message: event,
        service,
      });
    }

    const effectiveMessage =
      commandResult.kind === 'rewrite' ? commandResult.content : message.content;
    const inputParts = buildInputImageParts(message.images);

    const sessionKey = `channel:${pluginId}:chat:${message.chatId}`;

    const supportsStreaming =
      (channel?.features?.streamingReply ?? false) &&
      service.supportsStreaming &&
      !!service.sendStreamingMessage;

    // 同一通道会话上一轮还没跑完时，这条消息怎么处理取决于插话开关：
    //  - 开启（默认）：「最新意图优先」——打断正在执行与仍在排队的轮次，立刻开跑。
    //    等待期原本没有任何用户可见反馈，用户侧与「机器人挂了」无法区分；这里补一条
    //    回执说明「上一轮已被打断」，让「新消息真的换掉了旧轮」可观测。
    //  - 关闭：保持旧的纯排队语义，回一条「已排队」。队列已满（接下来会被拒绝并回
    //    busy）时不发，避免同一轮收到两条相互矛盾的提示。
    const queuedAhead = this.pendingSessionTaskCount(sessionKey);
    const interruptEnabled = this.options.interruptOnNewMessage !== false;
    if (queuedAhead > 0) {
      if (interruptEnabled) {
        const interrupted = this.interruptSessionTasks(sessionKey);
        if (interrupted > 0) {
          channelLogInfo('auto-reply interrupted running session task', {
            pluginId,
            chatId: message.chatId,
            sessionKey,
            interrupted,
          });
          // 不 await：回执自身的发送耗时不能推迟入队时刻，否则后到的消息会抢先。
          void this.safeSend(pluginId, () =>
            this.sendChannelReply({
              channel,
              content: buildInterruptedMessage(replyLanguage),
              message: event,
              service,
            }),
          );
        }
      } else if (queuedAhead < MAX_SESSION_TASK_QUEUE_DEPTH) {
        channelLogInfo('auto-reply queued behind running session task', {
          pluginId,
          chatId: message.chatId,
          sessionKey,
          queuedAhead,
        });
        void this.safeSend(pluginId, () =>
          this.sendChannelReply({
            channel,
            content: buildQueuedMessage(replyLanguage),
            message: event,
            service,
          }),
        );
      }
    }

    const enqueuedAt = Date.now();
    const enqueued = await this.enqueueSessionTask(sessionKey, async (signal) => {
      const startedAt = Date.now();
      channelLogInfo('auto-reply agent run started', {
        pluginId,
        chatId: message.chatId,
        sessionKey,
        supportsStreaming,
        queuedAhead,
        waitMs: startedAt - enqueuedAt,
        imageCount: inputParts.length,
        hasAudio: Boolean(message.audio),
        messageLength: effectiveMessage.length,
      });
      if (supportsStreaming && service.sendStreamingMessage) {
        const handle = await service.sendStreamingMessage(message.chatId, '…', message.id);

        try {
          const response = await this.options.onAgentRun({
            sessionKey,
            message: effectiveMessage,
            pluginId,
            chatId: message.chatId,
            senderId: message.senderId,
            senderName: message.senderName,
            ...(inputParts.length > 0 ? { inputParts } : {}),
            messageId: message.id,
            signal,
            onPartialText: async (text) => {
              // 已被更新的消息抢占：这一轮的文本作废，继续推中间态只会把用户
              // 刚发来的新消息挤下去。
              if (signal.aborted) {
                return;
              }
              await handle.update(text);
            },
          });
          if (signal.aborted) {
            // 本轮被更新的入站消息抢占：结果作废，且不得再发任何内容 —— 否则
            // 用户会同时收到「被打断那轮的答复」和「新消息的答复」。
            channelLogInfo('auto-reply streaming response discarded after interruption', {
              pluginId,
              chatId: message.chatId,
              sessionKey,
              durationMs: Date.now() - startedAt,
            });
            return;
          }
          await handle.finish(response);
          channelLogInfo('auto-reply streaming response finished', {
            pluginId,
            chatId: message.chatId,
            sessionKey,
            durationMs: Date.now() - startedAt,
            responseLength: response.length,
          });
        } catch (err) {
          channelLogWarn('auto-reply streaming response failed', {
            pluginId,
            chatId: message.chatId,
            sessionKey,
            durationMs: Date.now() - startedAt,
            error: err instanceof Error ? err.message : String(err),
          });
          if (signal.aborted) {
            // 被抢占的中断不向用户回任何内容：他刚发的那条正在处理。
            return;
          }
          // The recovery `finish` reuses the same (possibly broken) upstream
          // connection, so it can itself throw — guard it so the failure is
          // logged rather than re-thrown into `handle`'s wrapper.
          await this.safeSend(pluginId, () =>
            handle.finish(
              buildLocalizedErrorMessage(
                replyLanguage,
                err instanceof Error ? err.message : String(err),
              ),
            ),
          );
        }
      } else {
        // 非流式渠道（QQ 官方 API 不支持编辑已发送消息）：整轮跑完才有一条回复，
        // 含工具链的长任务期间用户侧完全静默。超时仍未结束时先补一条「仍在处理」，
        // 让等待可见；任务结束（成功或失败）即取消，短任务不会多发消息。
        const pendingNotice = this.schedulePendingNotice({
          channel,
          message: event,
          service,
          replyLanguage,
          pluginId,
        });
        try {
          const response = await this.options.onAgentRun({
            sessionKey,
            message: effectiveMessage,
            pluginId,
            chatId: message.chatId,
            senderId: message.senderId,
            senderName: message.senderName,
            ...(inputParts.length > 0 ? { inputParts } : {}),
            messageId: message.id,
            signal,
          });
          pendingNotice.cancel();
          if (signal.aborted) {
            // 被抢占：这一轮的结果作废，一条都不发（新消息的答复紧随其后）。
            channelLogInfo('auto-reply response discarded after interruption', {
              pluginId,
              chatId: message.chatId,
              sessionKey,
              durationMs: Date.now() - startedAt,
            });
            return;
          }
          channelLogInfo('auto-reply agent response ready', {
            pluginId,
            chatId: message.chatId,
            sessionKey,
            durationMs: Date.now() - startedAt,
            responseLength: response.length,
          });
          await this.sendChannelReply({ channel, content: response, message: event, service });
        } catch (err) {
          pendingNotice.cancel();
          channelLogWarn('auto-reply agent run failed', {
            pluginId,
            chatId: message.chatId,
            sessionKey,
            durationMs: Date.now() - startedAt,
            error: err instanceof Error ? err.message : String(err),
          });
          if (signal.aborted) {
            // 主动打断不是故障：不回错误文案（用户刚发的那条正在处理）。
            return;
          }
          await this.safeSend(pluginId, () =>
            this.sendChannelReply({
              channel,
              content: buildLocalizedErrorMessage(
                replyLanguage,
                err instanceof Error ? err.message : String(err),
              ),
              message: event,
              service,
            }),
          );
        }
      }
    });
    if (!enqueued) {
      // 队列满意味着这条入站消息**不会被处理**，是「消息彻底消失」的一类。
      // 原实现只有一行 console.warn：没有会话、没有消息、没有任何持久化痕迹。
      // 落 channel_health 让「为什么这条没回」在重启后仍可回答。
      console.warn('[auto-reply] session queue is full; rejecting channel message', {
        pluginId,
        sessionKey,
        maxDepth: MAX_SESSION_TASK_QUEUE_DEPTH,
      });
      this.recordIssue({
        channelId: pluginId,
        message: `会话串行队列已满（深度 ${MAX_SESSION_TASK_QUEUE_DEPTH}），入站消息被拒绝（chatId=${message.chatId}）`,
        source: 'channel_queue',
      });
      await this.safeSend(pluginId, () =>
        this.sendChannelReply({
          channel,
          content: buildBusyMessage(replyLanguage),
          message: event,
          service,
        }),
      );
    }
  }

  /** 该通道会话当前仍未跑完的轮次数（正在执行的 1 + 排队的 N）。 */
  private pendingSessionTaskCount(sessionKey: string): number {
    const chain = this.sessionTaskChains.get(sessionKey);
    if (!chain) {
      return 0;
    }

    return (chain.active ? 1 : 0) + chain.waiting.size;
  }

  /**
   * 打断该通道会话上正在执行与仍在排队的轮次，返回被打断的轮次数。
   *
   * abort 只是让实现方停下（渠道侧会真正取消内核轮次并等它 settle）；正在执行的那
   * 一轮此时从 `active` 摘掉，避免同一条消息在 settle 前被重复计数/重复 abort。
   * 排队的那些直接清空集合 —— 它们各自持有的 controller 已被 abort，轮到执行时会
   * 自查并跳过，不做任何回复。
   */
  private interruptSessionTasks(sessionKey: string): number {
    const chain = this.sessionTaskChains.get(sessionKey);
    if (!chain) {
      return 0;
    }

    let interrupted = 0;
    if (chain.active) {
      chain.active.abort();
      chain.active = undefined;
      interrupted += 1;
    }
    for (const controller of chain.waiting) {
      controller.abort();
      interrupted += 1;
    }
    chain.waiting.clear();

    return interrupted;
  }

  /**
   * 把一轮排进该通道会话的串行链。返回 `false` 表示队列已满、这条消息不会被处理。
   *
   * `task` 收到本轮专属的 `AbortSignal`：被更新的入站消息抢占时 abort，实现方须据此
   * 停下本轮（否则会话运行锁不释放，新一轮会撞 `SESSION_ALREADY_RUNNING`）。
   */
  private async enqueueSessionTask(
    sessionKey: string,
    task: (signal: AbortSignal) => Promise<void>,
  ): Promise<boolean> {
    if (this.pendingSessionTaskCount(sessionKey) >= MAX_SESSION_TASK_QUEUE_DEPTH) {
      return false;
    }

    const chain: SessionTaskChain = this.sessionTaskChains.get(sessionKey) ?? {
      promise: Promise.resolve(),
      waiting: new Set<AbortController>(),
    };
    this.sessionTaskChains.set(sessionKey, chain);

    const controller = new AbortController();
    chain.waiting.add(controller);
    const current = chain.promise
      .catch(() => undefined)
      .then(async () => {
        chain.waiting.delete(controller);
        if (controller.signal.aborted) {
          // 入队后被更新的消息抢占：整轮跳过，一条回复都不发。
          channelLogInfo('auto-reply superseded queued message skipped', {
            sessionKey,
          });
          return;
        }

        chain.active = controller;
        try {
          await task(controller.signal);
        } finally {
          // 只清理自己登记的那一轮：抢占可能已经把它摘掉并让位给新轮。
          if (chain.active === controller) {
            chain.active = undefined;
          }
        }
      });
    chain.promise = current;

    try {
      await current;
      return true;
    } finally {
      if (chain.promise === current && !chain.active && chain.waiting.size === 0) {
        this.sessionTaskChains.delete(sessionKey);
      }
    }
  }

  private async handleCommandAction(
    action: ChannelCommandAction,
    context: ChannelCommandContext,
  ): Promise<{ readonly content: string }> {
    const actions = this.options.commandActions;
    if (!actions) {
      return { content: buildChannelCommandActionsUnavailableMessage(context.replyLanguage) };
    }

    switch (action) {
      case 'compactConversation':
        return actions.compactConversation(context);
      case 'getUsageStats':
        return actions.getUsageStats(context);
      case 'resetConversation':
        return actions.resetConversation(context);
      default:
        return assertNever(action);
    }
  }

  /**
   * Run an error-notification send without letting its own transport
   * failure escape. The catch path already lost the primary response; a
   * second failure (e.g. the channel API is still unreachable) must not
   * turn into an unhandled rejection.
   */
  private async safeSend(pluginId: string, send: () => Promise<unknown>): Promise<void> {
    try {
      await send();
    } catch (err) {
      // 错误通知自己发不出去是最难排查的一类故障：用户侧完全没有反馈，
      // 而这里原实现只有一行日志。落 `channel_health` 让它跨重启可查。
      logGatewayError('[auto-reply] failed to deliver error notice to channel', {
        pluginId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.recordIssue({
        channelId: pluginId,
        message: `错误通知投递失败：${err instanceof Error ? err.message : String(err)}`,
        source: 'channel_delivery',
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      });
    }
  }

  /**
   * 频道级故障的统一上报入口。
   *
   * 取 `ownerUserId` / `type` 是为了让 `channel_health.owner_user_id` 落到正确
   * 归属下 —— 否则排障列表按用户过滤时，这些行永远查不出来。
   */
  private recordIssue(input: {
    readonly channelId: string;
    readonly message: string;
    readonly source: ChannelErrorSource;
    readonly sessionId?: string | null | undefined;
    readonly stack?: string | undefined;
  }): void {
    const channel = this.options.resolveChannel?.(input.channelId);
    recordChannelHealthIssue({
      channelId: input.channelId,
      message: input.message,
      source: input.source,
      ...(channel ? { channelType: channel.type } : {}),
      ...(channel?.ownerUserId ? { ownerUserId: channel.ownerUserId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.stack ? { stack: input.stack } : {}),
    });
  }

  /**
   * 非流式渠道的「仍在处理」回执：超时仍未结束才发，只发一次，任务结束即取消。
   *
   * 回执是装饰性中间态，发送失败只记日志（走 `safeSend`），绝不影响最终回复；这也
   * 保证「回执把 QQ 被动回复次数用光导致正式回复发不出」不会发生 —— 同一条
   * `msg_id` 的 `msg_seq` 上限是 5，本路径最多消耗 1 次。
   */
  private schedulePendingNotice(context: {
    readonly channel: ChannelInstance | undefined;
    readonly message: ChannelEvent & { readonly type: 'message' };
    readonly service: MessagingChannelService;
    readonly replyLanguage: ChannelReplyLanguage;
    readonly pluginId: string;
  }): { cancel: () => void } {
    const delayMs = this.options.pendingNoticeDelayMs ?? CHANNEL_PENDING_NOTICE_DELAY_MS;
    if (delayMs <= 0) {
      return { cancel: () => undefined };
    }

    const timer = setTimeout(() => {
      channelLogInfo('auto-reply pending notice sent', {
        pluginId: context.pluginId,
        pluginType: context.channel?.type,
        chatId: context.message.message.chatId,
        delayMs,
      });
      void this.safeSend(context.pluginId, () =>
        this.sendChannelReply({
          channel: context.channel,
          content: buildPendingMessage(context.replyLanguage),
          message: context.message,
          service: context.service,
        }),
      );
    }, delayMs);

    return {
      cancel: () => {
        clearTimeout(timer);
      },
    };
  }

  private async sendChannelReply(context: AutoReplySendContext): Promise<{ messageId: string }> {
    const message = context.message.message;
    channelLogInfo('sending channel reply', {
      pluginId: context.message.pluginId,
      pluginType: context.channel?.type,
      chatId: message.chatId,
      replyToMessageId: message.id,
      contentLength: context.content.length,
      replyMode: shouldReplyToQQReferencedMessage(context.channel, message.id) ? 'reply' : 'send',
    });
    try {
      if (shouldReplyToQQReferencedMessage(context.channel, message.id)) {
        const result = await context.service.replyMessage(message.id, context.content);
        channelLogInfo('channel reply sent', {
          pluginId: context.message.pluginId,
          pluginType: context.channel?.type,
          chatId: message.chatId,
          messageId: result.messageId,
        });
        return result;
      }
      const result = await context.service.sendMessage(message.chatId, context.content);
      channelLogInfo('channel message sent', {
        pluginId: context.message.pluginId,
        pluginType: context.channel?.type,
        chatId: message.chatId,
        messageId: result.messageId,
      });
      return result;
    } catch (err) {
      const replyError = err instanceof Error ? err.message : String(err);

      // QQ 的回复是「被动回复」（带 `msg_id`），平台侧有时效；agent 跑几分钟时这次
      // 回复会被拒绝。此时改走主动消息兜底 —— 否则结果只在会话里可见、在 IM 里永远
      // 收不到，用户看到的就是「回了一条『仍在处理中』然后再无下文」。
      // 只在原路径**失败之后**才触发，正常发送完全不受影响；主动消息受配额限制，
      // 兜底自身也可能失败，那时仍按原错误抛出并落库。
      if (
        shouldReplyToQQReferencedMessage(context.channel, message.id) &&
        context.service.sendWakeupMessage
      ) {
        try {
          const fallback = await context.service.sendWakeupMessage(message.chatId, context.content);
          channelLogInfo('channel reply delivered via wakeup fallback', {
            pluginId: context.message.pluginId,
            pluginType: context.channel?.type,
            chatId: message.chatId,
            messageId: fallback.messageId,
            replyError,
          });
          return fallback;
        } catch (fallbackErr) {
          const fallbackError =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          this.recordIssue({
            channelId: context.message.pluginId,
            message: `回复投递失败：被动回复（${replyError}）；主动消息兜底也失败（${fallbackError}）`,
            source: 'channel_delivery',
            ...(fallbackErr instanceof Error && fallbackErr.stack
              ? { stack: fallbackErr.stack }
              : {}),
          });
          throw err;
        }
      }

      // agent 已经跑完、结果也已落库，但回复发不出去 —— 消息在会话里可见、在 IM 里
      // 不可见。不记这一笔的话排查会得出「什么都没发生」的错误结论。
      this.recordIssue({
        channelId: context.message.pluginId,
        message: `回复投递失败：${replyError}`,
        source: 'channel_delivery',
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      });
      throw err;
    }
  }
}

function resolveReplyLanguage(channel: ChannelInstance | undefined): ChannelReplyLanguage {
  return normalizeChannelReplyLanguage(channel?.replyLanguage);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled channel command action: ${String(value)}`);
}

function shouldReplyToQQReferencedMessage(
  channel: ChannelInstance | undefined,
  messageId: string,
): boolean {
  return channel?.type === 'qq' && messageId.includes('|');
}

function buildInputImageParts(
  images: readonly ChannelImageAttachment[] | undefined,
): InputImageContent[] {
  if (!images || images.length === 0) {
    return [];
  }

  return images.flatMap((image) => {
    const imageUrl = image.imageUrl || buildDataImageUrl(image);
    if (!imageUrl) {
      return [];
    }
    return [
      {
        type: 'input_image',
        imageUrl,
        mimeType: image.mediaType,
        detail: 'auto',
        ...(image.fileName ? { fileName: image.fileName } : {}),
      } satisfies InputImageContent,
    ];
  });
}

function buildDataImageUrl(image: ChannelImageAttachment): string {
  if (!image.base64) {
    return '';
  }
  return `data:${image.mediaType};base64,${image.base64}`;
}
