import type { ChannelPlatform } from './types.js';

export type BuiltinChannelCommandId = 'help' | 'new' | 'status' | 'stats' | 'compress' | 'init';

export interface BuiltinChannelCommandDescriptor {
  readonly id: BuiltinChannelCommandId;
  readonly canonicalTrigger: `/${string}`;
  readonly slashAliases: readonly string[];
  readonly keywordAliases: readonly string[];
}

export interface ChannelCommandExperience {
  readonly platform: ChannelPlatform | 'unknown';
  readonly supportsNativeSlashMenu: boolean;
}

const BUILTIN_CHANNEL_COMMANDS: readonly BuiltinChannelCommandDescriptor[] = [
  {
    id: 'help',
    canonicalTrigger: '/help',
    slashAliases: ['/help', '/?', '/帮助', '/菜单', '/命令'],
    keywordAliases: ['help', '帮助', '菜单', '命令', '命令列表', '快捷命令'],
  },
  {
    id: 'new',
    canonicalTrigger: '/new',
    slashAliases: ['/new', '/reset', '/新对话', '/新会话'],
    keywordAliases: ['新对话', '新会话', '创建新对话', '开始新对话'],
  },
  {
    id: 'status',
    canonicalTrigger: '/status',
    slashAliases: ['/status', '/状态'],
    keywordAliases: [],
  },
  {
    id: 'stats',
    canonicalTrigger: '/stats',
    slashAliases: ['/stats', '/统计'],
    keywordAliases: [],
  },
  {
    id: 'compress',
    canonicalTrigger: '/compress',
    slashAliases: ['/compress', '/compact', '/压缩'],
    keywordAliases: [],
  },
  {
    id: 'init',
    canonicalTrigger: '/init',
    slashAliases: ['/init', '/初始化'],
    keywordAliases: [],
  },
] as const;

const COMMAND_BY_SLASH_ALIAS = new Map<string, BuiltinChannelCommandDescriptor>();
const COMMAND_BY_KEYWORD_ALIAS = new Map<string, BuiltinChannelCommandDescriptor>();

for (const command of BUILTIN_CHANNEL_COMMANDS) {
  for (const alias of command.slashAliases) {
    COMMAND_BY_SLASH_ALIAS.set(alias.toLowerCase(), command);
  }
  for (const alias of command.keywordAliases) {
    COMMAND_BY_KEYWORD_ALIAS.set(alias.toLowerCase(), command);
  }
}

const PLATFORM_EXPERIENCE: Readonly<Partial<Record<ChannelPlatform, ChannelCommandExperience>>> = {
  telegram: { platform: 'telegram', supportsNativeSlashMenu: true },
  discord: { platform: 'discord', supportsNativeSlashMenu: false },
  slack: { platform: 'slack', supportsNativeSlashMenu: false },
  feishu: { platform: 'feishu', supportsNativeSlashMenu: false },
  dingtalk: { platform: 'dingtalk', supportsNativeSlashMenu: false },
  weixin: { platform: 'weixin', supportsNativeSlashMenu: false },
  wecom: { platform: 'wecom', supportsNativeSlashMenu: false },
  whatsapp: { platform: 'whatsapp', supportsNativeSlashMenu: false },
  qq: { platform: 'qq', supportsNativeSlashMenu: false },
};

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSlashToken(rawToken: string): string {
  if (!rawToken.startsWith('/')) {
    return rawToken;
  }
  const mentionIndex = rawToken.indexOf('@');
  return mentionIndex > 0 ? rawToken.slice(0, mentionIndex) : rawToken;
}

export function listBuiltinChannelCommands(): readonly BuiltinChannelCommandDescriptor[] {
  return BUILTIN_CHANNEL_COMMANDS;
}

export function resolveChannelCommandExperience(
  platform?: ChannelPlatform | null,
): ChannelCommandExperience {
  if (platform) {
    const experience = PLATFORM_EXPERIENCE[platform];
    if (experience) {
      return experience;
    }
  }

  return {
    platform: 'unknown',
    supportsNativeSlashMenu: false,
  };
}

export function matchBuiltinChannelCommand(text: string): {
  readonly command: BuiltinChannelCommandDescriptor;
  readonly args: string;
} | null {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return null;
  }

  const firstWhitespace = normalized.search(/\s/);
  const rawToken = firstWhitespace === -1 ? normalized : normalized.slice(0, firstWhitespace);
  const args = firstWhitespace === -1 ? '' : normalized.slice(firstWhitespace + 1).trim();

  if (rawToken.startsWith('/')) {
    const command =
      COMMAND_BY_SLASH_ALIAS.get(normalizeAlias(rawToken)) ??
      COMMAND_BY_SLASH_ALIAS.get(normalizeAlias(normalizeSlashToken(rawToken)));
    return command ? { command, args } : null;
  }

  if (args.length > 0) {
    return null;
  }

  const command = COMMAND_BY_KEYWORD_ALIAS.get(normalizeAlias(rawToken));
  return command ? { command, args: '' } : null;
}
