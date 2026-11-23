import { describe, expect, it } from 'vitest';
import {
  buildAlreadyCompactMessage,
  buildBusyMessage,
  buildChannelCommandActionsUnavailableMessage,
  buildChannelHelpMessage,
  buildContextCompressedMessage,
  buildInitCommandAck,
  buildInterruptedMessage,
  buildLocalizedErrorMessage,
  buildNoChannelConfigurationMessage,
  buildNoChannelOwnerMessage,
  buildNoTextReplyMessage,
  buildNoTokenUsageDataMessage,
  buildPermissionExpiredMessage,
  buildPermissionPendingMessage,
  buildPermissionResolvedMessage,
  buildPermissionResumedNoTextMessage,
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

  it('插话打断回执说明上一轮已停止、最新这条正在处理', () => {
    const zh = buildInterruptedMessage('zh-CN');

    expect(zh).toContain('**已打断上一轮**');
    expect(zh).toContain('- 状态：`已切换到你最新发来的消息`');
    // 「上一轮可能拿不到完整答复」是用户判断自己是否要重发的前提，不能省。
    expect(zh).toContain('上一轮执行已停止');

    const en = buildInterruptedMessage('en-US');

    expect(en).toContain('**Previous turn interrupted**');
    expect(en).toContain('was stopped');
  });

  it('等待授权提示包含待授权操作与「群里的同意不算授权」', () => {
    const content = buildPermissionPendingMessage('zh-CN', { toolNames: ['bash', 'write'] });

    expect(content).toContain('**等待授权**');
    expect(content).toContain('- 状态：`待审批`');
    expect(content).toContain('- `bash`');
    expect(content).toContain('- `write`');
    expect(content).toContain('不构成授权');
  });

  it('无工具名时也给出可操作指引，且英文版结构一致', () => {
    const zh = buildPermissionPendingMessage('zh-CN');
    const en = buildPermissionPendingMessage('en-US', { toolNames: ['bash'] });

    expect(zh).not.toContain('待授权操作');
    expect(zh).toContain('权限提示');
    expect(en).toContain('**Waiting for approval**');
    expect(en).toContain('NOT an authorization');
  });

  it('审批结果文案区分批准与拒绝，并如实反映是否在续跑', () => {
    const approved = buildPermissionResolvedMessage('zh-CN', {
      toolName: 'bash',
      decision: 'session',
      resumed: true,
    });
    const approvedNoResume = buildPermissionResolvedMessage('zh-CN', {
      toolName: 'bash',
      decision: 'once',
      resumed: false,
    });
    const rejected = buildPermissionResolvedMessage('zh-CN', {
      toolName: 'bash',
      decision: 'reject',
      resumed: false,
    });

    expect(approved).toContain('**权限已批准**');
    expect(approved).toContain('- 范围：`本会话`');
    expect(approved).toContain('正在继续执行');
    expect(rejected).toContain('**权限已拒绝**');
    expect(rejected).toContain('不会**执行');

    // 「仅本次」不能因为没续跑就被说成长期规则。
    expect(approvedNoResume).toContain('- 范围：`仅本次`');
    expect(approvedNoResume).toContain('仅本次允许');
    expect(approvedNoResume).not.toContain('无需再次询问');
    expect(approvedNoResume).not.toContain('正在继续执行');
  });

  it('未续跑时按批准范围给准确结论：本会话 / 永久', () => {
    const session = buildPermissionResolvedMessage('zh-CN', {
      toolName: 'bash',
      decision: 'session',
      resumed: false,
    });
    const permanent = buildPermissionResolvedMessage('en-US', {
      toolName: 'bash',
      decision: 'permanent',
      resumed: false,
    });

    expect(session).toContain('本会话内同类操作不会再询问');
    expect(permanent).toContain('recorded as a permanent grant');
  });

  it('有时间限制时标出「有效至」，没有时不编造时间', () => {
    const expiresAt = new Date('2026-11-01T10:00:00Z').getTime();
    const withExpiry = buildPermissionPendingMessage('zh-CN', { toolNames: ['bash'], expiresAt });
    const withoutExpiry = buildPermissionPendingMessage('zh-CN', {
      toolNames: ['bash'],
      expiresAt: null,
    });
    const english = buildPermissionPendingMessage('en-US', { toolNames: ['bash'], expiresAt });

    expect(withExpiry).toContain('有效至：');
    expect(withoutExpiry).not.toContain('有效至：');
    expect(english).toContain('Valid until:');
  });

  it('超时失效与「已拒绝」区分开，并指向重新发起', () => {
    const zh = buildPermissionExpiredMessage('zh-CN', { toolNames: ['bash', 'bash', 'write'] });
    const en = buildPermissionExpiredMessage('en-US');

    expect(zh).toContain('**授权已超时**');
    expect(zh).toContain('已失效');
    expect(zh).toContain('没有执行');
    expect(zh).toContain('重新发起');
    // 去重：bash 只出现一次
    expect(zh.split('`bash`').length - 1).toBe(1);
    expect(zh).not.toContain('已拒绝');
    expect(en).toContain('**Approval expired**');
    expect(en).toContain('expired');
  });

  it('授权后续跑无文本时给出明确状态而非沉默', () => {
    expect(buildPermissionResumedNoTextMessage('zh-CN')).toContain('授权后已继续执行');
    expect(buildPermissionResumedNoTextMessage('en-US')).toContain('Resumed after approval');
  });
});
