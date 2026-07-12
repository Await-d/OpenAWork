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
import { normalizeChannelReplyLanguage } from './channel-reply-language.js';
import type { ChannelReplyLanguage } from './types.js';

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
      const pluginId = event.type === 'message' ? event.pluginId : 'unknown';
      console.error('[auto-reply] unhandled channel event failure', {
        pluginId,
        error: err instanceof Error ? err.message : String(err),
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
      channelLogWarn('auto-reply skipped: service not found', { pluginId });
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

    const commandResult = await tryHandleChannelCommand({
      actions: this.options.commandActions,
      channel,
      message,
      pluginId,
    });

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
      console.warn('[auto-reply] session queue is full; rejecting channel message', {
        pluginId,
        sessionKey,
        maxDepth: MAX_SESSION_TASK_QUEUE_DEPTH,
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
      console.error('[auto-reply] failed to deliver error notice to channel', {
        pluginId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
