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
  buildLocalizedErrorMessage,
  buildNoChannelConfigurationMessage,
} from './channel-localization.js';
import { channelLogInfo, channelLogWarn, summarizeChannelMessage } from './channel-log.js';
import { recordChannelHealthIssue, type ChannelErrorSource } from './channel-error-store.js';
import { normalizeChannelReplyLanguage } from './channel-reply-language.js';
import type { ChannelReplyLanguage } from './types.js';
import { logGatewayError } from '../infra/gateway-logger.js';

export type { ChannelCommandActions, ChannelCommandContext } from './channel-commands.js';

export interface AutoReplyOptions {
  commandActions?: ChannelCommandActions;
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
  }) => Promise<string>;
}

interface AutoReplySendContext {
  readonly channel?: ChannelInstance;
  readonly content: string;
  readonly message: ChannelEvent & { readonly type: 'message' };
  readonly service: MessagingChannelService;
}

interface SessionTaskChain {
  readonly promise: Promise<void>;
  readonly queuedCount: number;
}

const MAX_SESSION_TASK_QUEUE_DEPTH = 8;

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

    const enqueued = await this.enqueueSessionTask(sessionKey, async () => {
      const startedAt = Date.now();
      channelLogInfo('auto-reply agent run started', {
        pluginId,
        chatId: message.chatId,
        sessionKey,
        supportsStreaming,
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
            onPartialText: async (text) => {
              await handle.update(text);
            },
          });
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
          });
          channelLogInfo('auto-reply agent response ready', {
            pluginId,
            chatId: message.chatId,
            sessionKey,
            durationMs: Date.now() - startedAt,
            responseLength: response.length,
          });
          await this.sendChannelReply({ channel, content: response, message: event, service });
        } catch (err) {
          channelLogWarn('auto-reply agent run failed', {
            pluginId,
            chatId: message.chatId,
            sessionKey,
            durationMs: Date.now() - startedAt,
            error: err instanceof Error ? err.message : String(err),
          });
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

  private async enqueueSessionTask(
    sessionKey: string,
    task: () => Promise<void>,
  ): Promise<boolean> {
    const existing = this.sessionTaskChains.get(sessionKey);
    const queuedCount = existing?.queuedCount ?? 0;
    if (queuedCount >= MAX_SESSION_TASK_QUEUE_DEPTH) {
      return false;
    }

    const previous = existing?.promise ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.sessionTaskChains.set(sessionKey, { promise: current, queuedCount: queuedCount + 1 });

    try {
      await current;
      return true;
    } finally {
      const latest = this.sessionTaskChains.get(sessionKey);
      if (latest) {
        const nextQueuedCount = latest.queuedCount - 1;
        if (nextQueuedCount <= 0) {
          this.sessionTaskChains.delete(sessionKey);
        } else {
          this.sessionTaskChains.set(sessionKey, {
            promise: latest.promise,
            queuedCount: nextQueuedCount,
          });
        }
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
      // agent 已经跑完、结果也已落库，但回复发不出去 —— 消息在会话里可见、在 IM 里
      // 不可见。不记这一笔的话排查会得出「什么都没发生」的错误结论。
      this.recordIssue({
        channelId: context.message.pluginId,
        message: `回复投递失败：${err instanceof Error ? err.message : String(err)}`,
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
