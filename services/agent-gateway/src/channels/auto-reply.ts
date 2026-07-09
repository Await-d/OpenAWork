import type { ChannelEvent, ChannelInstance, MessagingChannelService } from './types.js';
import { channelManager } from './manager.js';
import {
  tryHandleChannelCommand,
  type ChannelCommandAction,
  type ChannelCommandActions,
  type ChannelCommandContext,
} from './channel-commands.js';

export type { ChannelCommandActions, ChannelCommandContext } from './channel-commands.js';

export interface AutoReplyOptions {
  commandActions?: ChannelCommandActions;
  resolveChannel?: (pluginId: string) => ChannelInstance | undefined;
  onAgentRun: (params: {
    sessionKey: string;
    message: string;
    pluginId: string;
    chatId: string;
    onPartialText?: (text: string) => Promise<void> | void;
  }) => Promise<string>;
}

interface AutoReplySendContext {
  readonly channel?: ChannelInstance;
  readonly content: string;
  readonly message: ChannelEvent & { readonly type: 'message' };
  readonly service: MessagingChannelService;
}

export class AutoReplyPipeline {
  private options: AutoReplyOptions;

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
    const service = channelManager.getService(pluginId);
    if (!service) return;

    const channel = this.options.resolveChannel?.(pluginId);
    if (channel && (!channel.enabled || channel.features?.autoReply === false)) {
      return;
    }

    const commandResult = await tryHandleChannelCommand({
      actions: this.options.commandActions,
      channel,
      message,
      pluginId,
    });

    if (commandResult.kind === 'skip') {
      return;
    }

    if (commandResult.kind === 'action') {
      if (!channel) {
        await this.sendChannelReply({
          channel,
          content: 'No channel configuration found.',
          message: event,
          service,
        });
        return;
      }
      const result = await this.handleCommandAction(commandResult.action, {
        channel,
        chatId: message.chatId,
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

    const sessionKey = `channel:${pluginId}:chat:${message.chatId}`;

    const supportsStreaming =
      (channel?.features?.streamingReply ?? false) &&
      service.supportsStreaming &&
      !!service.sendStreamingMessage;

    if (supportsStreaming && service.sendStreamingMessage) {
      const handle = await service.sendStreamingMessage(message.chatId, '…', message.id);

      try {
        const response = await this.options.onAgentRun({
          sessionKey,
          message: effectiveMessage,
          pluginId,
          chatId: message.chatId,
          onPartialText: async (text) => {
            await handle.update(text);
          },
        });
        await handle.finish(response);
      } catch (err) {
        // The recovery `finish` reuses the same (possibly broken) upstream
        // connection, so it can itself throw — guard it so the failure is
        // logged rather than re-thrown into `handle`'s wrapper.
        await this.safeSend(pluginId, () =>
          handle.finish(`Error: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    } else {
      try {
        const response = await this.options.onAgentRun({
          sessionKey,
          message: effectiveMessage,
          pluginId,
          chatId: message.chatId,
        });
        await this.sendChannelReply({ channel, content: response, message: event, service });
      } catch (err) {
        await this.safeSend(pluginId, () =>
          this.sendChannelReply({
            channel,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            message: event,
            service,
          }),
        );
      }
    }
  }

  private async handleCommandAction(
    action: ChannelCommandAction,
    context: ChannelCommandContext,
  ): Promise<{ readonly content: string }> {
    const actions = this.options.commandActions;
    if (!actions) {
      return { content: 'Channel command actions are not configured.' };
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
    if (shouldReplyToQQReferencedMessage(context.channel, message.id)) {
      return context.service.replyMessage(message.id, context.content);
    }
    return context.service.sendMessage(message.chatId, context.content);
  }
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
