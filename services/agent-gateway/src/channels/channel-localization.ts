import {
  listBuiltinChannelCommands,
  resolveChannelCommandExperience,
} from './channel-command-experience.js';
import {
  isEnglishChannelReplyLanguage,
  type ChannelReplyLanguage,
} from './channel-reply-language.js';
import type { BuiltinChannelCommandId } from './channel-command-experience.js';
import type { ChannelInstance, ChannelMessage, ChannelPlatform } from './types.js';

function platformLabel(
  platform: ChannelPlatform | 'unknown',
  language: ChannelReplyLanguage,
): string {
  if (platform === 'unknown') {
    return isEnglishChannelReplyLanguage(language) ? 'Current platform' : '当前平台';
  }
  return {
    telegram: 'Telegram',
    discord: 'Discord',
    slack: 'Slack',
    feishu: '飞书',
    dingtalk: '钉钉',
    weixin: '微信公众平台',
    wecom: '企业微信',
    whatsapp: 'WhatsApp',
    qq: 'QQ',
  }[platform];
}

function commandMenuDescription(
  commandId: BuiltinChannelCommandId,
  language: ChannelReplyLanguage,
): string {
  if (isEnglishChannelReplyLanguage(language)) {
    return {
      help: 'Show commands',
      new: 'New session',
      status: 'Show status',
      stats: 'Usage stats',
      compress: 'Compress context',
      init: 'Init workspace memory',
    }[commandId];
  }
  return {
    help: '查看命令列表',
    new: '新建会话',
    status: '查看状态',
    stats: '查看用量',
    compress: '压缩上下文',
    init: '初始化记忆',
  }[commandId];
}

function commandHelpDescription(
  commandId: BuiltinChannelCommandId,
  language: ChannelReplyLanguage,
): string {
  if (isEnglishChannelReplyLanguage(language)) {
    return {
      help: 'Show the available quick commands for this channel',
      new: 'Clear the current channel session and start fresh',
      status: 'Show the current channel, model, and runtime state',
      stats: 'Show token usage for the current channel session',
      compress: 'Compress the current channel session context',
      init: 'Initialize workspace memory files, optionally with extra notes',
    }[commandId];
  }
  return {
    help: '查看当前平台可用的快捷命令',
    new: '清空当前通道会话并重新开始',
    status: '查看当前通道、模型和自动回复状态',
    stats: '查看当前通道会话的 token 用量',
    compress: '压缩当前通道会话上下文',
    init: '初始化工作区记忆模板，可附带补充说明',
  }[commandId];
}

function nativeEntryHint(
  platform: ChannelPlatform | 'unknown',
  language: ChannelReplyLanguage,
): string {
  if (isEnglishChannelReplyLanguage(language)) {
    if (platform === 'telegram') {
      return 'This platform registers a native "/" command menu. Type / in the input box to open it, or send /help directly.';
    }
    if (platform === 'slack') {
      return 'This integration currently relies on message triggers. If no native slash command is visible in your workspace, send /help as a normal message.';
    }
    if (platform === 'discord') {
      return 'This integration currently falls back to message triggers. If no native command menu is available, send /help as a normal message.';
    }
    return 'If no native command menu is available on this platform, send /help as a normal message.';
  }
  if (platform === 'telegram') {
    return '当前平台已接入原生 "/" 命令菜单，直接在输入框输入 / 即可看到常用命令，也可以直接发送 /help。';
  }
  if (platform === 'slack') {
    return '当前接入以消息触发为准；若工作区里没有看到原生命令菜单，把 /help 当普通消息直接发出即可。';
  }
  if (platform === 'discord') {
    return '当前接入仍以普通消息触发为主；如果没有原生命令菜单，把 /help 当普通消息直接发出即可。';
  }
  return '当前平台没有统一的原生命令菜单时，把 /help 当普通消息直接发出即可获得同样入口。';
}

function formatToggle(value: boolean, language: ChannelReplyLanguage): string {
  if (isEnglishChannelReplyLanguage(language)) {
    return value ? 'on' : 'off';
  }
  return value ? '开启' : '关闭';
}

function formatInlineValue(value: string): string {
  return `\`${value.replaceAll('`', "'")}\``;
}

function formatLabeledItem(label: string, value: string): string {
  return `- ${label}：${formatInlineValue(value)}`;
}

function formatEnglishLabeledItem(label: string, value: string): string {
  return `- ${label}: ${formatInlineValue(value)}`;
}

interface MessagePanelSection {
  readonly heading?: string;
  readonly items: readonly string[];
}

function buildMessagePanel(title: string, sections: readonly MessagePanelSection[]): string {
  const lines = [`**${title}**`];
  for (const section of sections) {
    if (section.items.length === 0) {
      continue;
    }
    lines.push('');
    if (section.heading) {
      lines.push(`**${section.heading}**`);
    }
    lines.push(...section.items);
  }
  return lines.join('\n');
}

function replyLanguageDisplay(language: ChannelReplyLanguage): string {
  if (isEnglishChannelReplyLanguage(language)) {
    return language === 'en-US' ? 'English (en-US)' : language;
  }
  return language === 'en-US' ? '英文（en-US）' : '中文（zh-CN）';
}

export function buildChannelHelpMessage(
  platform: ChannelPlatform | null | undefined,
  language: ChannelReplyLanguage,
): string {
  const experience = resolveChannelCommandExperience(platform);
  const commandLines = listBuiltinChannelCommands().map((command) => {
    const trigger =
      command.id === 'init'
        ? isEnglishChannelReplyLanguage(language)
          ? '/init [notes]'
          : '/init [补充说明]'
        : command.canonicalTrigger;
    return `- \`${trigger}\`  ${commandHelpDescription(command.id, language)}`;
  });
  if (isEnglishChannelReplyLanguage(language)) {
    return [
      '**Quick commands**',
      'Send any of the following messages directly. On supported platforms, you can also type `/` to open the native command picker.',
      '',
      '**Available commands**',
      ...commandLines,
      '',
      '**How to trigger**',
      `- Platform: ${platformLabel(experience.platform, language)}`,
      `- Native menu: ${nativeEntryHint(experience.platform, language)}`,
      '- Universal fallback: send `/help` as a normal message',
      '- Keyword fallback: send `help`',
      '- Group example: `@Bot /help`',
    ].join('\n');
  }
  return [
    '**快捷指令**',
    '下面这些内容都可以直接发送。支持的平台也可以在输入框里输入 `/`，从原生命令菜单里直接选择。',
    '',
    '**可用命令**',
    ...commandLines,
    '',
    '**怎么触发**',
    `- 当前平台：${platformLabel(experience.platform, language)}`,
    `- 原生命令：${nativeEntryHint(experience.platform, language)}`,
    '- 统一兜底：把 `/help` 当普通消息直接发出',
    '- 关键词兜底：直接发送 `帮助`',
    '- 群聊示例：`@Bot /help`',
  ].join('\n');
}

export function buildChannelCommandPrompt(
  platform: ChannelPlatform | null | undefined,
  language: ChannelReplyLanguage,
): string {
  const experience = resolveChannelCommandExperience(platform);
  const visibleTriggers = listBuiltinChannelCommands()
    .map((command) => command.canonicalTrigger)
    .join(isEnglishChannelReplyLanguage(language) ? ', ' : '、');
  if (isEnglishChannelReplyLanguage(language)) {
    return [
      '<channel-command-experience>',
      'This channel provides a set of deterministic local commands that are handled by the gateway before the request reaches the LLM.',
      `Local command entry points: ${visibleTriggers}.`,
      'Fallback help trigger: /help.',
      nativeEntryHint(experience.platform, language),
      'When users ask what they can do, how to start a new conversation, or how to inspect channel state, prefer pointing them to these local entries.',
      'Do not present these local commands as if they require model reasoning, and do not dump a long manual unless the user explicitly asks for it.',
      '</channel-command-experience>',
    ].join('\n');
  }
  return [
    '<channel-command-experience>',
    '当前通道内置了一组本地确定性快捷命令，它们会在进入 LLM 之前优先由网关直接处理。',
    `本地命令入口：${visibleTriggers}。`,
    '统一帮助触发词：/help。',
    nativeEntryHint(experience.platform, language),
    '当用户询问“有哪些命令、怎么新建对话、怎么查看状态”时，优先提醒这些本地入口。',
    '不要把这些本地命令说成必须依赖模型理解后才能完成，也不要主动展开冗长的命令手册。',
    '</channel-command-experience>',
  ].join('\n');
}

export function listTelegramBotCommands(language: ChannelReplyLanguage): ReadonlyArray<{
  readonly command: string;
  readonly description: string;
}> {
  return listBuiltinChannelCommands().map((command) => ({
    command: command.canonicalTrigger.slice(1),
    description: commandMenuDescription(command.id, language),
  }));
}

export function buildStatusReply(input: {
  readonly channel?: ChannelInstance;
  readonly language: ChannelReplyLanguage;
  readonly message: ChannelMessage;
  readonly pluginId: string;
  readonly runtimeStatus: string;
  readonly streamingEnabled: boolean;
}): string {
  const { channel, language, message, pluginId, runtimeStatus, streamingEnabled } = input;
  if (isEnglishChannelReplyLanguage(language)) {
    if (!channel) {
      return [
        '**Channel status**',
        '',
        '**Overview**',
        formatEnglishLabeledItem('ID', pluginId),
        formatEnglishLabeledItem('Runtime', runtimeStatus),
        formatEnglishLabeledItem('Current chat', message.chatId),
        '- Configuration: `missing`',
      ].join('\n');
    }
    return [
      '**Channel status**',
      '',
      '**Overview**',
      formatEnglishLabeledItem('Name', channel.name),
      formatEnglishLabeledItem('Type', channel.type),
      formatEnglishLabeledItem('ID', channel.id),
      formatEnglishLabeledItem('Runtime', runtimeStatus),
      formatEnglishLabeledItem('Current chat', message.chatId),
      '',
      '**Model & reply**',
      formatEnglishLabeledItem('Provider', channel.providerId ?? 'global default'),
      formatEnglishLabeledItem('Model', channel.model ?? 'global default'),
      formatEnglishLabeledItem(
        'Auto reply',
        formatToggle(channel.features?.autoReply ?? false, language),
      ),
      formatEnglishLabeledItem('Streaming reply', formatToggle(streamingEnabled, language)),
      formatEnglishLabeledItem(
        'Auto start',
        formatToggle(channel.features?.autoStart ?? false, language),
      ),
      formatEnglishLabeledItem('Reply language', replyLanguageDisplay(language)),
    ].join('\n');
  }
  if (!channel) {
    return [
      '**通道状态**',
      '',
      '**概览**',
      formatLabeledItem('ID', pluginId),
      formatLabeledItem('运行状态', runtimeStatus),
      formatLabeledItem('当前会话', message.chatId),
      '- 配置：`缺失`',
    ].join('\n');
  }
  return [
    '**通道状态**',
    '',
    '**概览**',
    formatLabeledItem('名称', channel.name),
    formatLabeledItem('类型', channel.type),
    formatLabeledItem('ID', channel.id),
    formatLabeledItem('运行状态', runtimeStatus),
    formatLabeledItem('当前会话', message.chatId),
    '',
    '**模型与回复**',
    formatLabeledItem('Provider', channel.providerId ?? '全局默认'),
    formatLabeledItem('Model', channel.model ?? '全局默认'),
    formatLabeledItem('自动回复', formatToggle(channel.features?.autoReply ?? false, language)),
    formatLabeledItem('流式回复', formatToggle(streamingEnabled, language)),
    formatLabeledItem('自动启动', formatToggle(channel.features?.autoStart ?? false, language)),
    formatLabeledItem('回复语言', replyLanguageDisplay(language)),
  ].join('\n');
}

export function buildInitCommandAck(language: ChannelReplyLanguage, targetFiles: string): string {
  if (isEnglishChannelReplyLanguage(language)) {
    return buildMessagePanel('Workspace memory init', [
      {
        heading: 'Started',
        items: [
          formatEnglishLabeledItem('Target files', targetFiles),
          '- Status: `running`',
          '- Next step: analyze this project and update the workspace memory files when needed.',
        ],
      },
    ]);
  }
  return buildMessagePanel('初始化工作区记忆', [
    {
      heading: '已开始',
      items: [
        formatLabeledItem('目标文件', targetFiles),
        '- 状态：`执行中`',
        '- 下一步：分析当前项目，并在需要时更新这些工作区记忆文件。',
      ],
    },
  ]);
}

export function buildResetConversationMessage(language: ChannelReplyLanguage): string {
  return isEnglishChannelReplyLanguage(language)
    ? buildMessagePanel('New session', [
        {
          heading: 'Result',
          items: [
            '- Status: `session cleared`',
            '- Next step: the conversation will continue with a fresh context.',
          ],
        },
      ])
    : buildMessagePanel('新对话', [
        {
          heading: '结果',
          items: ['- 状态：`已清空当前会话`', '- 下一步：接下来会从新上下文开始。'],
        },
      ]);
}

export function buildUsageStatisticsMessage(input: {
  readonly assistantReplies: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly inputTokens: number;
  readonly language: ChannelReplyLanguage;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: string;
  readonly formatNumber: (value: number) => string;
}): string {
  if (isEnglishChannelReplyLanguage(input.language)) {
    return [
      '**Usage statistics**',
      '',
      '**Overview**',
      formatEnglishLabeledItem('Total', input.totalTokens),
      formatEnglishLabeledItem('Assistant replies', String(input.assistantReplies)),
      '',
      '**Breakdown**',
      formatEnglishLabeledItem('Input', input.formatNumber(input.inputTokens)),
      formatEnglishLabeledItem('Output', input.formatNumber(input.outputTokens)),
      formatEnglishLabeledItem('Reasoning', input.formatNumber(input.reasoningTokens)),
      formatEnglishLabeledItem('Cache read', input.formatNumber(input.cacheReadTokens)),
      formatEnglishLabeledItem('Cache write', input.formatNumber(input.cacheWriteTokens)),
    ].join('\n');
  }
  return [
    '**用量统计**',
    '',
    '**总览**',
    formatLabeledItem('总计', input.totalTokens),
    formatLabeledItem('助手回复数', String(input.assistantReplies)),
    '',
    '**明细**',
    formatLabeledItem('输入', input.formatNumber(input.inputTokens)),
    formatLabeledItem('输出', input.formatNumber(input.outputTokens)),
    formatLabeledItem('推理', input.formatNumber(input.reasoningTokens)),
    formatLabeledItem('缓存读取', input.formatNumber(input.cacheReadTokens)),
    formatLabeledItem('缓存写入', input.formatNumber(input.cacheWriteTokens)),
  ].join('\n');
}

export function buildNoTokenUsageDataMessage(language: ChannelReplyLanguage): string {
  return isEnglishChannelReplyLanguage(language)
    ? buildMessagePanel('Usage statistics', [
        {
          heading: 'Result',
          items: [
            '- Status: `no data yet`',
            '- Note: no token usage data is available for this conversation yet.',
          ],
        },
      ])
    : buildMessagePanel('用量统计', [
        {
          heading: '结果',
          items: ['- 状态：`暂无数据`', '- 说明：当前还没有可统计的 token 用量数据。'],
        },
      ]);
}

export function buildNoChannelOwnerMessage(language: ChannelReplyLanguage): string {
  return isEnglishChannelReplyLanguage(language)
    ? buildMessagePanel('Command unavailable', [
        {
          heading: 'Reason',
          items: [
            '- Status: `cannot continue`',
            '- Detail: this conversation has no channel owner, so the action cannot be executed.',
          ],
        },
      ])
    : buildMessagePanel('命令暂不可用', [
        {
          heading: '原因',
          items: ['- 状态：`无法执行`', '- 详情：当前会话缺少通道归属用户，无法执行该操作。'],
        },
      ]);
}

export function buildTooFewMessagesToCompressMessage(language: ChannelReplyLanguage): string {
  return isEnglishChannelReplyLanguage(language)
    ? buildMessagePanel('Context compression', [
        {
          heading: 'Result',
          items: [
            '- Status: `not needed yet`',
            '- Note: there are too few messages in this conversation to compress.',
          ],
        },
      ])
    : buildMessagePanel('上下文压缩', [
        {
          heading: '结果',
          items: ['- 状态：`暂不需要`', '- 说明：当前消息太少，还不需要压缩上下文。'],
        },
      ]);
}

export function buildAlreadyCompactMessage(language: ChannelReplyLanguage): string {
  return isEnglishChannelReplyLanguage(language)
    ? buildMessagePanel('Context compression', [
        {
          heading: 'Result',
          items: [
            '- Status: `already compact`',
            '- Note: the current conversation context is already compact enough.',
          ],
        },
      ])
    : buildMessagePanel('上下文压缩', [
        {
          heading: '结果',
          items: ['- 状态：`已经精简`', '- 说明：当前上下文已经足够精简，无需继续压缩。'],
        },
      ]);
}

export function buildContextCompressedMessage(
  language: ChannelReplyLanguage,
  compactedCount: number,
): string {
  return isEnglishChannelReplyLanguage(language)
    ? buildMessagePanel('Context compression', [
        {
          heading: 'Completed',
          items: [
            '- Status: `done`',
            formatEnglishLabeledItem('Messages cleaned', String(compactedCount)),
          ],
        },
      ])
    : buildMessagePanel('上下文压缩', [
        {
          heading: '已完成',
          items: ['- 状态：`完成`', formatLabeledItem('整理消息', `${compactedCount} 条`)],
        },
      ]);
}

export function buildNoChannelConfigurationMessage(language: ChannelReplyLanguage): string {
  return isEnglishChannelReplyLanguage(language)
    ? buildMessagePanel('Command unavailable', [
        {
          heading: 'Reason',
          items: [
            '- Status: `missing configuration`',
            '- Detail: no channel configuration was found for the current conversation.',
          ],
        },
      ])
    : buildMessagePanel('命令暂不可用', [
        {
          heading: '原因',
          items: ['- 状态：`缺少配置`', '- 详情：没有找到当前通道配置。'],
        },
      ]);
}

export function buildChannelCommandActionsUnavailableMessage(
  language: ChannelReplyLanguage,
): string {
  return isEnglishChannelReplyLanguage(language)
    ? buildMessagePanel('Command unavailable', [
        {
          heading: 'Reason',
          items: [
            '- Status: `not configured`',
            '- Detail: channel command actions are not configured for this integration yet.',
          ],
        },
      ])
    : buildMessagePanel('命令暂不可用', [
        {
          heading: '原因',
          items: ['- 状态：`尚未配置`', '- 详情：当前通道命令动作尚未配置完成。'],
        },
      ]);
}

export function buildLocalizedErrorMessage(language: ChannelReplyLanguage, detail: string): string {
  return isEnglishChannelReplyLanguage(language)
    ? buildMessagePanel('Execution failed', [
        {
          heading: 'Error',
          items: [`- Detail: ${formatInlineValue(detail)}`],
        },
      ])
    : buildMessagePanel('执行失败', [
        {
          heading: '错误详情',
          items: [`- 详情：${formatInlineValue(detail)}`],
        },
      ]);
}

export function buildNoTextReplyMessage(language: ChannelReplyLanguage): string {
  return isEnglishChannelReplyLanguage(language)
    ? buildMessagePanel('Reply result', [
        {
          heading: 'Result',
          items: [
            '- Status: `no text generated`',
            '- Note: the message was processed, but no sendable text reply was generated this time.',
          ],
        },
      ])
    : buildMessagePanel('回复结果', [
        {
          heading: '结果',
          items: ['- 状态：`未生成文本`', '- 说明：消息已处理，但这次没有生成可发送的文本回复。'],
        },
      ]);
}

export function buildBusyMessage(language: ChannelReplyLanguage): string {
  return isEnglishChannelReplyLanguage(language)
    ? buildMessagePanel('Conversation busy', [
        {
          heading: 'Queue status',
          items: [
            '- Status: `please retry later`',
            '- Note: this conversation is already processing several messages.',
          ],
        },
      ])
    : buildMessagePanel('会话繁忙', [
        {
          heading: '队列状态',
          items: ['- 状态：`请稍后重试`', '- 说明：当前会话正在处理较多消息。'],
        },
      ]);
}
