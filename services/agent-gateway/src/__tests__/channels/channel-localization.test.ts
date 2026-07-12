import { describe, expect, it } from 'vitest';
import {
  buildAlreadyCompactMessage,
  buildBusyMessage,
  buildChannelCommandActionsUnavailableMessage,
  buildChannelHelpMessage,
  buildContextCompressedMessage,
  buildInitCommandAck,
  buildLocalizedErrorMessage,
  buildNoChannelConfigurationMessage,
  buildNoChannelOwnerMessage,
  buildNoTextReplyMessage,
  buildNoTokenUsageDataMessage,
  buildResetConversationMessage,
  buildStatusReply,
  buildTooFewMessagesToCompressMessage,
  buildUsageStatisticsMessage,
} from '../../channels/channel-localization.js';
import type { ChannelMessage } from '../../channels/types.js';

const SAMPLE_MESSAGE: ChannelMessage = {
  id: 'm1',
  senderId: 'u1',
  senderName: 'User',
  chatId: 'chat-1',
  content: 'hello',
  timestamp: 1,
};

describe('channel help message formatting', () => {
  it('中文帮助回复使用结构化 markdown 风格文案', () => {
    const content = buildChannelHelpMessage('telegram', 'zh-CN');

    expect(content).toContain('**快捷指令**');
    expect(content).toContain('**可用命令**');
    expect(content).toContain('`/help`');
    expect(content).toContain('`/init [补充说明]`');
    expect(content).toContain('关键词兜底：直接发送 `帮助`');
    expect(content).toContain('群聊示例：`@Bot /help`');
    expect(content).toContain('输入框里输入 `/`');
  });

  it('英文帮助回复保留相同结构并给出英文兜底提示', () => {
    const content = buildChannelHelpMessage('discord', 'en-US');

    expect(content).toContain('**Quick commands**');
    expect(content).toContain('**Available commands**');
    expect(content).toContain('`/init [notes]`');
    expect(content).toContain('Universal fallback: send `/help` as a normal message');
    expect(content).toContain('Keyword fallback: send `help`');
    expect(content).toContain('Group example: `@Bot /help`');
    expect(content).toContain('If no native command menu is available');
  });

  it('状态回复使用分段结构，便于在纯文本和 Markdown 环境里阅读', () => {
    const content = buildStatusReply({
      channel: {
        id: 'channel-1',
        type: 'telegram',
        name: '客服机器人',
        enabled: true,
        config: {},
        providerId: 'openai',
        model: 'gpt-5-mini',
        replyLanguage: 'zh-CN',
        features: { autoReply: true, streamingReply: true, autoStart: false },
        createdAt: 0,
        updatedAt: 0,
      },
      language: 'zh-CN',
      message: SAMPLE_MESSAGE,
      pluginId: 'channel-1',
      runtimeStatus: 'running',
      streamingEnabled: true,
    });

    expect(content).toContain('**通道状态**');
    expect(content).toContain('**概览**');
    expect(content).toContain('**模型与回复**');
    expect(content).toContain('- 名称：`客服机器人`');
    expect(content).toContain('- 运行状态：`running`');
    expect(content).toContain('- 回复语言：`中文（zh-CN）`');
  });

  it('用量回复使用总览和明细结构', () => {
    const content = buildUsageStatisticsMessage({
      assistantReplies: 3,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      formatNumber: (value) => String(value),
      inputTokens: 120,
      language: 'en-US',
      outputTokens: 45,
      reasoningTokens: 8,
      totalTokens: '165 tokens',
    });

    expect(content).toContain('**Usage statistics**');
    expect(content).toContain('**Overview**');
    expect(content).toContain('**Breakdown**');
    expect(content).toContain('- Total: `165 tokens`');
    expect(content).toContain('- Assistant replies: `3`');
    expect(content).toContain('- Cache write: `5`');
  });

  it('初始化与新对话确认也使用统一面板结构', () => {
    const initContent = buildInitCommandAck('zh-CN', 'AGENTS.md, SOUL.md');
    const resetContent = buildResetConversationMessage('en-US');

    expect(initContent).toContain('**初始化工作区记忆**');
    expect(initContent).toContain('**已开始**');
    expect(initContent).toContain('目标文件');
    expect(resetContent).toContain('**New session**');
    expect(resetContent).toContain('- Status: `session cleared`');
  });

  it('压缩相关的短回复也保持统一结构', () => {
    expect(buildTooFewMessagesToCompressMessage('zh-CN')).toContain('**上下文压缩**');
    expect(buildTooFewMessagesToCompressMessage('zh-CN')).toContain('暂不需要');
    expect(buildAlreadyCompactMessage('en-US')).toContain('**Context compression**');
    expect(buildAlreadyCompactMessage('en-US')).toContain('already compact');
    expect(buildContextCompressedMessage('zh-CN', 7)).toContain('- 整理消息：`7 条`');
  });

  it('异常、空态和繁忙提示都使用统一面板结构', () => {
    expect(buildNoTokenUsageDataMessage('zh-CN')).toContain('**用量统计**');
    expect(buildNoChannelOwnerMessage('en-US')).toContain('**Command unavailable**');
    expect(buildNoChannelConfigurationMessage('zh-CN')).toContain('没有找到当前通道配置');
    expect(buildChannelCommandActionsUnavailableMessage('en-US')).toContain('not configured');
    expect(buildLocalizedErrorMessage('zh-CN', 'boom')).toContain('**执行失败**');
    expect(buildNoTextReplyMessage('en-US')).toContain('**Reply result**');
    expect(buildBusyMessage('zh-CN')).toContain('**会话繁忙**');
  });
});
