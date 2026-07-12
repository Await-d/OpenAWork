import { stripLeadingMentions } from './inbound-utils.js';
import { channelManager } from './manager.js';
import {
  buildChannelHelpMessage,
  buildInitCommandAck,
  buildStatusReply as buildLocalizedStatusReply,
} from './channel-localization.js';
import {
  matchBuiltinChannelCommand,
  type BuiltinChannelCommandId,
} from './channel-command-experience.js';
import { normalizeChannelReplyLanguage } from './channel-reply-language.js';
import type { ChannelInstance, ChannelMessage, ChannelReplyLanguage } from './types.js';

export interface ChannelCommandContext {
  readonly channel: ChannelInstance;
  readonly chatId: string;
  readonly replyLanguage: ChannelReplyLanguage;
}

export interface ChannelCommandActions {
  readonly compactConversation: (
    input: ChannelCommandContext,
  ) => Promise<{ readonly content: string }>;
  readonly getUsageStats: (input: ChannelCommandContext) => { readonly content: string };
  readonly resetConversation: (input: ChannelCommandContext) => { readonly content: string };
}

export type ChannelCommandAction = 'compactConversation' | 'getUsageStats' | 'resetConversation';

export type CommandResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'skip' }
  | { readonly kind: 'action'; readonly action: ChannelCommandAction }
  | { readonly kind: 'reply'; readonly content: string }
  | { readonly kind: 'rewrite'; readonly content: string; readonly reply?: string };

export interface BuiltinCommandContext {
  readonly actions?: ChannelCommandActions;
  readonly channel?: ChannelInstance;
  readonly message: ChannelMessage;
  readonly pluginId: string;
}

type CommandHandler = (context: BuiltinCommandContext) => Promise<CommandResult>;

const BUILTIN_COMMANDS: Record<BuiltinChannelCommandId, CommandHandler> = {
  help: async (context) => ({
    kind: 'reply',
    content: buildChannelHelpMessage(context.channel?.type, resolveReplyLanguage(context.channel)),
  }),
  status: async (context) => ({
    kind: 'reply',
    content: buildStatusReplyContent(context),
  }),
  new: async () => ({
    kind: 'action',
    action: 'resetConversation',
  }),
  init: async (context) => buildInitCommandResult(context),
  stats: async () => ({
    kind: 'action',
    action: 'getUsageStats',
  }),
  compress: async () => ({
    kind: 'action',
    action: 'compactConversation',
  }),
};

function buildInitCommandResult(context: BuiltinCommandContext): CommandResult {
  const raw = stripLeadingMentions(context.message.content);
  const matched = matchBuiltinChannelCommand(raw);
  const args = matched?.command.id === 'init' ? matched.args : '';
  const targetFiles = ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md'].join(', ');
  const userRequest = args ? `\n\nUser-provided /init arguments:\n${args}` : '';
  const replyLanguage = resolveReplyLanguage(context.channel);

  return {
    kind: 'rewrite',
    reply: buildInitCommandAck(replyLanguage, targetFiles),
    content:
      `Initialize this workspace for agent work. Ensure workspace memory files exist where appropriate: ${targetFiles}. ` +
      'Analyze the project structure and update AGENTS.md with durable, accurate guidance for future agents. ' +
      'Preserve existing useful guidance, do not overwrite user-authored content blindly, and report what changed.' +
      userRequest,
  };
}

export async function tryHandleChannelCommand(
  context: BuiltinCommandContext,
): Promise<CommandResult> {
  const text = stripLeadingMentions(context.message.content);
  const matched = matchBuiltinChannelCommand(text);
  if (!matched) {
    return { kind: 'none' };
  }
  const handler = BUILTIN_COMMANDS[matched.command.id];
  if (!handler) {
    return { kind: 'none' };
  }
  return handler(context);
}

function buildStatusReplyContent(context: BuiltinCommandContext): string {
  const { channel, message, pluginId } = context;
  const status = channelManager.getStatus(pluginId);
  const service = channelManager.getService(pluginId);
  const streamingEnabled =
    Boolean(channel?.features?.streamingReply) && Boolean(service?.supportsStreaming);
  return buildLocalizedStatusReply({
    channel,
    language: resolveReplyLanguage(channel),
    message,
    pluginId,
    runtimeStatus: status,
    streamingEnabled,
  });
}

function resolveReplyLanguage(channel: ChannelInstance | undefined): ChannelReplyLanguage {
  return normalizeChannelReplyLanguage(channel?.replyLanguage);
}
