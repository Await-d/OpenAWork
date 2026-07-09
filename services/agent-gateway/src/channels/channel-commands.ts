import { stripLeadingMentions } from './inbound-utils.js';
import { channelManager } from './manager.js';
import type { ChannelInstance, ChannelMessage } from './types.js';

export interface ChannelCommandContext {
  readonly channel: ChannelInstance;
  readonly chatId: string;
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

const BUILTIN_COMMANDS: Record<string, CommandHandler> = {
  '/help': async () => ({
    kind: 'reply',
    content:
      'Available commands: /help, /new, /status, /init, /stats, /compress\n' +
      'Use @bot + command in group chats, for example: @Bot /help',
  }),
  '/status': async (context) => ({
    kind: 'reply',
    content: buildStatusReply(context),
  }),
  '/new': async () => ({
    kind: 'action',
    action: 'resetConversation',
  }),
  '/init': async (context) => buildInitCommandResult(context),
  '/stats': async () => ({
    kind: 'action',
    action: 'getUsageStats',
  }),
  '/compress': async () => ({
    kind: 'action',
    action: 'compactConversation',
  }),
};

function buildInitCommandResult(context: BuiltinCommandContext): CommandResult {
  const raw = stripLeadingMentions(context.message.content);
  const args = raw.replace(/^\/init\b/i, '').trim();
  const targetFiles = ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md'].join(', ');
  const userRequest = args ? `\n\nUser-provided /init arguments:\n${args}` : '';

  return {
    kind: 'rewrite',
    reply:
      `Initializing workspace memory templates (${targetFiles}) and analyzing this project. ` +
      'I will update AGENTS.md when needed.',
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
  const cmd = text.split(' ')[0]?.toLowerCase();
  if (!cmd?.startsWith('/')) {
    return { kind: 'none' };
  }
  const handler = BUILTIN_COMMANDS[cmd];
  if (!handler) {
    return { kind: 'none' };
  }
  return handler(context);
}

function buildStatusReply(context: BuiltinCommandContext): string {
  const { channel, message, pluginId } = context;
  const status = channelManager.getStatus(pluginId);
  if (!channel) {
    return [
      'Channel status',
      `ID: ${pluginId}`,
      `Runtime: ${status}`,
      `Current chat: ${message.chatId}`,
      'Configuration: missing',
    ].join('\n');
  }

  const service = channelManager.getService(pluginId);
  const streamingEnabled =
    Boolean(channel.features?.streamingReply) && Boolean(service?.supportsStreaming);

  return [
    'Channel status',
    `Name: ${channel.name}`,
    `Type: ${channel.type}`,
    `ID: ${channel.id}`,
    `Runtime: ${status}`,
    `Current chat: ${message.chatId}`,
    `Provider: ${channel.providerId ?? 'global default'}`,
    `Model: ${channel.model ?? 'global default'}`,
    `Auto reply: ${formatToggle(channel.features?.autoReply ?? false)}`,
    `Streaming reply: ${formatToggle(streamingEnabled)}`,
    `Auto start: ${formatToggle(channel.features?.autoStart ?? false)}`,
  ].join('\n');
}

function formatToggle(value: boolean): string {
  return value ? 'on' : 'off';
}
