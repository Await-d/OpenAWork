import type { ChannelEvent, ChannelInstance, ChannelMessage } from './types.js';
import { channelManager } from './manager.js';

export type CommandHandler = (
  message: ChannelMessage,
  pluginId: string,
) => Promise<string | true | false>;

const BUILTIN_COMMANDS: Record<string, CommandHandler> = {
  '/help': async () => 'Available commands: /help, /new, /status, /init',
  '/status': async () => `Channels running: ${channelManager.listRunning().join(', ') || 'none'}`,
  '/new': async () => true,
  '/init': async () => 'Workspace initialized. Send me a task to get started.',
};

async function tryHandleCommand(
  message: ChannelMessage,
  pluginId: string,
): Promise<string | true | false> {
  const text = message.content.trim();
  const cmd = text.split(' ')[0]?.toLowerCase();
  if (!cmd?.startsWith('/')) return false;
  const handler = BUILTIN_COMMANDS[cmd];
  if (!handler) return false;
  return handler(message, pluginId);
}

export interface AutoReplyOptions {
  resolveChannel?: (pluginId: string) => ChannelInstance | undefined;
  onAgentRun: (params: {
    sessionKey: string;
    message: string;
    pluginId: string;
    chatId: string;
    onPartialText?: (text: string) => Promise<void> | void;
  }) => Promise<string>;
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

    const commandResult = await tryHandleCommand(message, pluginId);

    if (commandResult === true) {
      return;
    }

    const effectiveMessage = typeof commandResult === 'string' ? commandResult : message.content;

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
        await service.sendMessage(message.chatId, response);
      } catch (err) {
        await this.safeSend(pluginId, () =>
          service.sendMessage(
            message.chatId,
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
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
}
