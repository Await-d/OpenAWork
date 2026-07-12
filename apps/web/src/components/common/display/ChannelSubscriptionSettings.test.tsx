// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelSubscriptionSettings,
  type ChannelDraft,
  type ChannelSettingsEntry,
  type ChannelTypeDescriptor,
} from './ChannelSubscriptionSettings.js';

const FEISHU_DESCRIPTOR: ChannelTypeDescriptor = {
  type: 'feishu',
  displayName: '飞书 Bot',
  description: '飞书渠道',
  icon: 'feishu',
  category: 'china',
  quickLinks: [
    {
      label: '开发者后台',
      url: 'https://open.feishu.cn/app',
      description: '创建或选择飞书应用。',
    },
  ],
  configSchema: [
    { key: 'appId', label: 'App ID', type: 'text', required: true },
    { key: 'appSecret', label: 'App Secret', type: 'secret', required: true },
  ],
  tools: [
    { key: 'read', label: '读取文件', description: '读取工作区文件' },
    { key: 'bash', label: '命令行', description: '执行命令' },
    { key: 'PluginSendMessage', label: '发送渠道消息', description: '允许发送渠道消息' },
    { key: 'FeishuSendImage', label: '飞书发送图片', description: '发送图片' },
    { key: 'FeishuSendUrgent', label: '飞书加急', description: '发送加急' },
  ],
};

const WEIXIN_DESCRIPTOR: ChannelTypeDescriptor = {
  type: 'weixin',
  displayName: '微信公众平台',
  description: '微信公众平台 iLink Bot 接入',
  icon: 'weixin',
  category: 'china',
  configSchema: [
    {
      key: 'token',
      label: 'Bot Token',
      type: 'secret',
      description: '可通过扫码绑定自动填入。',
    },
    {
      key: 'accountId',
      label: 'Account ID',
      type: 'text',
      description: '可通过扫码绑定自动填入。',
    },
    { key: 'baseUrl', label: 'Base URL', type: 'text' },
    { key: 'routeTag', label: 'Route Tag', type: 'text' },
  ],
  tools: [{ key: 'PluginSendMessage', label: '发送渠道消息', description: '允许发送渠道消息' }],
};

const TELEGRAM_DESCRIPTOR: ChannelTypeDescriptor = {
  type: 'telegram',
  displayName: 'Telegram Bot',
  description: 'Telegram 渠道',
  icon: 'telegram',
  category: 'international',
  configSchema: [
    { key: 'botToken', label: 'Bot Token', type: 'secret', required: true },
    {
      key: 'requireMentionInGroup',
      label: 'Require Mention In Group',
      type: 'text',
      description: '群聊中仅在明确 @ 机器人时触发自动回复。',
    },
    {
      key: 'memberAclJson',
      label: 'Member ACL JSON',
      type: 'text',
      description: '按 senderId 控制群成员的工具和权限。',
    },
  ],
  tools: [
    {
      key: 'PluginReplyMessage',
      label: '回复消息',
      description: '允许命中的成员把文本回复回传到 Telegram。',
    },
    {
      key: 'web_search',
      label: '网页搜索',
      description: '允许命中的成员调用网页搜索能力。',
    },
    {
      key: 'read',
      label: '读取文件',
      description: '允许命中的成员读取工作区文件。',
    },
    {
      key: 'bash',
      label: '命令行',
      description: '允许命中的成员调用 Shell。',
    },
  ],
};

function makeChannel(): ChannelSettingsEntry {
  return {
    id: 'feishu-1',
    type: 'feishu',
    name: '研发飞书',
    enabled: true,
    status: 'disconnected',
    config: { appId: 'cli_test', appSecret: 'secret_test' },
    subscriptions: [],
    features: { autoReply: true, streamingReply: true, autoStart: true },
    channelLlmToolsEnabled: false,
    providerId: null,
    model: null,
    tools: {
      read: true,
      FeishuSendUrgent: false,
    },
    permissions: {
      allowReadHome: false,
      readablePathPrefixes: [],
      allowWriteOutside: false,
      allowShell: false,
      allowSubAgents: true,
    },
  };
}

function makeTelegramChannel(
  config: Record<string, string> = {
    botToken: 'telegram_token',
  },
): ChannelSettingsEntry {
  return {
    id: 'telegram-1',
    type: 'telegram',
    name: 'Telegram 群助手',
    enabled: true,
    status: 'disconnected',
    config,
    replyLanguage: 'zh-CN',
    subscriptions: [],
    features: { autoReply: true, streamingReply: true, autoStart: true },
    channelLlmToolsEnabled: true,
    providerId: null,
    model: null,
    tools: {
      PluginReplyMessage: true,
      web_search: true,
      read: true,
      bash: true,
    },
    permissions: {
      allowReadHome: false,
      readablePathPrefixes: [],
      allowWriteOutside: false,
      allowShell: true,
      allowSubAgents: false,
    },
  };
}

function checkboxFor(label: string): HTMLInputElement {
  const text = screen.getByText(label);
  const input = text.closest('label')?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing checkbox for ${label}`);
  }
  return input;
}

function selectFor(label: string): HTMLSelectElement {
  const text = screen.getByText(label);
  const select = text.parentElement?.querySelector('select');
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Missing select for ${label}`);
  }
  return select;
}

function panelByTitle(title: string): HTMLElement {
  const heading = screen.getByText(title);
  const panel = heading.closest('.channel-inline-panel');
  if (!(panel instanceof HTMLElement)) {
    throw new Error(`Missing panel for ${title}`);
  }
  return panel;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChannelSubscriptionSettings · 工具白名单保存语义', () => {
  it('Given 平台描述符包含快捷链接 When 打开配置面板 Then 渲染新窗口跳转入口', async () => {
    render(
      <ChannelSubscriptionSettings
        channels={[makeChannel()]}
        descriptors={[FEISHU_DESCRIPTOR]}
        onSave={vi.fn()}
      />,
    );

    const link = await screen.findByRole('link', { name: /开发者后台/ });
    expect(link.getAttribute('href')).toBe('https://open.feishu.cn/app');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('Given 旧飞书配置 When 保存工具白名单 Then 保留旧禁用项并补齐 channel runtime 默认工具', async () => {
    const channel = makeChannel();
    const onSave = vi.fn(
      async (channelId: string | null, draft: ChannelDraft): Promise<ChannelSettingsEntry> => ({
        ...channel,
        id: channelId ?? channel.id,
        tools: draft.tools,
      }),
    );

    render(
      <ChannelSubscriptionSettings
        channels={[channel]}
        descriptors={[FEISHU_DESCRIPTOR]}
        onSave={onSave}
      />,
    );

    await screen.findByText('Agent 工具白名单');
    expect(checkboxFor('命令行').checked).toBe(false);
    expect(checkboxFor('发送渠道消息').checked).toBe(true);
    expect(checkboxFor('飞书发送图片').checked).toBe(true);
    expect(checkboxFor('飞书加急').checked).toBe(false);

    fireEvent.click(checkboxFor('飞书发送图片'));
    fireEvent.click(screen.getByRole('button', { name: '保存改动' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const firstCall = onSave.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onSave to be called');
    }
    const savedDraft = firstCall[1];
    expect(savedDraft.tools['read']).toBe(true);
    expect(savedDraft.tools['bash']).toBeUndefined();
    expect(savedDraft.tools['PluginSendMessage']).toBe(true);
    expect(savedDraft.tools['FeishuSendImage']).toBe(false);
    expect(savedDraft.tools['FeishuSendUrgent']).toBe(false);
  });

  it('Given 工具白名单全勾选 When 打开模型工具总开关并保存 Then payload 写入 LLM 工具声明开关', async () => {
    const channel = makeChannel();
    const onSave = vi.fn(
      async (channelId: string | null, draft: ChannelDraft): Promise<ChannelSettingsEntry> => ({
        ...channel,
        id: channelId ?? channel.id,
        channelLlmToolsEnabled: draft.channelLlmToolsEnabled,
        tools: draft.tools,
      }),
    );

    render(
      <ChannelSubscriptionSettings
        channels={[channel]}
        descriptors={[FEISHU_DESCRIPTOR]}
        onSave={onSave}
      />,
    );

    const gate = checkboxFor('允许模型调用工作台工具');
    expect(gate.checked).toBe(false);

    fireEvent.click(gate);
    fireEvent.click(screen.getByRole('button', { name: '保存改动' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const firstCall = onSave.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onSave to be called');
    }
    expect(firstCall[1].channelLlmToolsEnabled).toBe(true);
  });

  it('Given 已允许模型工具的通道 When 打开配置面板 Then 总开关保持选中', async () => {
    render(
      <ChannelSubscriptionSettings
        channels={[{ ...makeChannel(), channelLlmToolsEnabled: true }]}
        descriptors={[FEISHU_DESCRIPTOR]}
        onSave={vi.fn()}
      />,
    );

    expect(checkboxFor('允许模型调用工作台工具').checked).toBe(true);
  });

  it('Given 旧通道缺少提示词注入配置 When 打开配置面板 Then capability 注入默认全开启', async () => {
    render(
      <ChannelSubscriptionSettings
        channels={[makeChannel()]}
        descriptors={[FEISHU_DESCRIPTOR]}
        capabilityCatalogCounts={{
          agents: 30,
          skills: 28,
          mcps: 6,
          tools: 12,
          toolGroups: {
            web: 3,
            lsp: 10,
            files: 12,
            shell: 8,
            orchestration: 11,
            session: 8,
            mcp: 3,
            desktop: 4,
            repo: 10,
            channel: 21,
            other: 0,
          },
          commands: 18,
        }}
        onSave={vi.fn()}
      />,
    );

    expect(await screen.findByText('提示词注入')).toBeTruthy();
    expect(checkboxFor('注入 Agents 目录').checked).toBe(true);
    expect(checkboxFor('注入 Skills 目录').checked).toBe(true);
    expect(checkboxFor('注入 MCP 目录').checked).toBe(true);
    expect(checkboxFor('注入 Tools 目录').checked).toBe(true);
    expect(checkboxFor('注入 Commands 目录').checked).toBe(true);
    expect(screen.getByText('当前共 30 个')).toBeTruthy();
    expect(screen.getByText('当前共 28 个')).toBeTruthy();
    expect(screen.getByText('当前共 6 个')).toBeTruthy();
  });

  it('Given 调整 capability 注入开关 When 保存 Then payload 写入 promptInjections', async () => {
    const channel = makeChannel();
    const onSave = vi.fn(
      async (channelId: string | null, draft: ChannelDraft): Promise<ChannelSettingsEntry> => ({
        ...channel,
        id: channelId ?? channel.id,
        promptInjections: draft.promptInjections,
      }),
    );

    render(
      <ChannelSubscriptionSettings
        channels={[channel]}
        descriptors={[FEISHU_DESCRIPTOR]}
        onSave={onSave}
      />,
    );

    fireEvent.click(checkboxFor('注入 Agents 目录'));
    fireEvent.click(checkboxFor('注入 MCP 目录'));
    fireEvent.click(checkboxFor('注入 Commands 目录'));
    fireEvent.click(screen.getByRole('button', { name: '保存改动' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const firstCall = onSave.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onSave to be called');
    }
    expect(firstCall[1].promptInjections).toEqual({
      capabilityContext: {
        agents: false,
        skills: true,
        mcps: false,
        tools: true,
        toolGroups: {
          web: true,
          lsp: true,
          files: true,
          shell: true,
          orchestration: true,
          session: true,
          mcp: true,
          desktop: true,
          repo: true,
          channel: true,
          other: true,
        },
        commands: false,
      },
    });
  });

  it('Given Tools 注入已开启 When 关闭 LSP 细分目录 Then payload 写入 toolGroups', async () => {
    const channel = makeChannel();
    const onSave = vi.fn(
      async (channelId: string | null, draft: ChannelDraft): Promise<ChannelSettingsEntry> => ({
        ...channel,
        id: channelId ?? channel.id,
        promptInjections: draft.promptInjections,
      }),
    );

    render(
      <ChannelSubscriptionSettings
        channels={[channel]}
        descriptors={[FEISHU_DESCRIPTOR]}
        capabilityCatalogCounts={{
          agents: 30,
          skills: 28,
          mcps: 6,
          tools: 90,
          toolGroups: {
            web: 3,
            lsp: 10,
            files: 12,
            shell: 8,
            orchestration: 11,
            session: 8,
            mcp: 3,
            desktop: 4,
            repo: 10,
            channel: 21,
            other: 0,
          },
          commands: 18,
        }}
        onSave={onSave}
      />,
    );

    expect(screen.queryByText('LSP')).toBeNull();
    fireEvent.click(checkboxFor('允许模型调用工作台工具'));
    expect(await screen.findByText('LSP')).toBeTruthy();
    fireEvent.click(checkboxFor('LSP'));
    fireEvent.click(screen.getByRole('button', { name: '保存改动' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[1].promptInjections.capabilityContext.toolGroups.lsp).toBe(false);
  });

  it('Given preview counts are narrower than global catalog When rendering tool groups Then it follows preview counts', async () => {
    render(
      <ChannelSubscriptionSettings
        channels={[{ ...makeChannel(), channelLlmToolsEnabled: true }]}
        descriptors={[FEISHU_DESCRIPTOR]}
        capabilityCatalogCounts={{
          agents: 30,
          skills: 28,
          mcps: 6,
          tools: 90,
          toolGroups: {
            web: 3,
            lsp: 10,
            files: 12,
            shell: 8,
            orchestration: 11,
            session: 8,
            mcp: 3,
            desktop: 4,
            repo: 10,
            channel: 21,
            other: 0,
          },
          commands: 18,
        }}
        onResolveCapabilityCatalogCounts={vi.fn(async () => ({
          agents: 30,
          skills: 28,
          mcps: 6,
          tools: 1,
          toolGroups: {
            web: 0,
            lsp: 1,
            files: 0,
            shell: 0,
            orchestration: 0,
            session: 0,
            mcp: 0,
            desktop: 0,
            repo: 0,
            channel: 0,
            other: 0,
          },
          commands: 18,
        }))}
        onSave={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText('文件与工作区')).toBeNull();
    });
    expect(screen.getByText('LSP')).toBeTruthy();
    expect(screen.getAllByText('当前共 1 个').length).toBeGreaterThan(0);
  });

  it('Given 切换回复语言 When 保存 Then payload 写入 replyLanguage', async () => {
    const channel = makeChannel();
    const onSave = vi.fn(
      async (channelId: string | null, draft: ChannelDraft): Promise<ChannelSettingsEntry> => ({
        ...channel,
        id: channelId ?? channel.id,
        replyLanguage: draft.replyLanguage,
      }),
    );

    render(
      <ChannelSubscriptionSettings
        channels={[channel]}
        descriptors={[FEISHU_DESCRIPTOR]}
        onSave={onSave}
      />,
    );

    expect(selectFor('回复语言').value).toBe('zh-CN');

    fireEvent.change(selectFor('回复语言'), { target: { value: 'en-US' } });
    fireEvent.click(screen.getByRole('button', { name: '保存改动' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[1].replyLanguage).toBe('en-US');
  });

  it('Given 群聊要求显式提及 When 关闭触发限制并保存 Then payload 移除 requireMentionInGroup', async () => {
    const channel = makeTelegramChannel({
      botToken: 'telegram_token',
      requireMentionInGroup: '1',
    });
    const onSave = vi.fn(
      async (channelId: string | null, draft: ChannelDraft): Promise<ChannelSettingsEntry> => ({
        ...channel,
        id: channelId ?? channel.id,
        config: draft.config,
      }),
    );

    render(
      <ChannelSubscriptionSettings
        channels={[channel]}
        descriptors={[TELEGRAM_DESCRIPTOR]}
        onSave={onSave}
      />,
    );

    const mentionToggle = checkboxFor('仅在明确 @ 机器人时触发');
    expect(mentionToggle.checked).toBe(true);

    fireEvent.click(mentionToggle);
    fireEvent.click(screen.getByRole('button', { name: '保存改动' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[1].config['requireMentionInGroup']).toBeUndefined();
  });

  it('Given 空白的群成员 ACL When 新增成员规则 Then 结构化面板保留未完成规则', async () => {
    render(
      <ChannelSubscriptionSettings
        channels={[makeTelegramChannel()]}
        descriptors={[TELEGRAM_DESCRIPTOR]}
        onSave={vi.fn()}
      />,
    );

    const aclPanel = panelByTitle('群成员访问控制');
    fireEvent.click(within(aclPanel).getByRole('button', { name: '新增成员规则' }));

    expect(await within(aclPanel).findByText('成员规则 1')).toBeTruthy();
    expect(within(aclPanel).getByLabelText('成员规则 1 的平台 senderId')).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存改动' }).hasAttribute('disabled')).toBe(true);
  });

  it('Given 已配置的群成员 ACL When 调整备注与工具 Then payload 回写结构化 memberAclJson', async () => {
    const channel = makeTelegramChannel({
      botToken: 'telegram_token',
      memberAclJson: JSON.stringify(
        [
          {
            platformUserId: '123456',
            senderName: 'Alice',
            toolAllowlist: ['PluginReplyMessage'],
            permissions: {
              allowShell: true,
            },
          },
        ],
        null,
        2,
      ),
    });
    const onSave = vi.fn(
      async (channelId: string | null, draft: ChannelDraft): Promise<ChannelSettingsEntry> => ({
        ...channel,
        id: channelId ?? channel.id,
        config: draft.config,
      }),
    );

    render(
      <ChannelSubscriptionSettings
        channels={[channel]}
        descriptors={[TELEGRAM_DESCRIPTOR]}
        onSave={onSave}
      />,
    );

    const aclPanel = panelByTitle('群成员访问控制');
    fireEvent.change(within(aclPanel).getByDisplayValue('Alice'), {
      target: { value: 'Alice Ops' },
    });
    fireEvent.click(within(aclPanel).getByText('网页搜索'));
    fireEvent.click(screen.getByRole('button', { name: '保存改动' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const serializedAcl = onSave.mock.calls[0]?.[1].config['memberAclJson'];
    expect(serializedAcl).toBeTruthy();
    const parsedAcl = JSON.parse(serializedAcl ?? '[]') as Array<{
      platformUserId: string;
      senderName?: string;
      toolAllowlist?: string[];
      permissions?: { allowShell?: boolean };
    }>;
    expect(parsedAcl).toEqual([
      {
        platformUserId: '123456',
        senderName: 'Alice Ops',
        toolAllowlist: ['PluginReplyMessage', 'web_search'],
        permissions: {
          allowShell: true,
        },
      },
    ]);
  });

  it('Given 非法的群成员 ACL JSON When 打开面板 Then 回退到原始 JSON 修复模式', async () => {
    render(
      <ChannelSubscriptionSettings
        channels={[
          makeTelegramChannel({
            botToken: 'telegram_token',
            memberAclJson: '{"broken":',
          }),
        ]}
        descriptors={[TELEGRAM_DESCRIPTOR]}
        onSave={vi.fn()}
      />,
    );

    const aclPanel = panelByTitle('群成员访问控制');
    expect(within(aclPanel).getByText(/结构化面板暂时不可用/)).toBeTruthy();
    expect(within(aclPanel).getByLabelText('群成员 ACL 原始 JSON')).toBeTruthy();
  });

  it('Given 结构错误的群成员 ACL JSON When 打开面板 Then 回退到原始 JSON 修复模式', async () => {
    render(
      <ChannelSubscriptionSettings
        channels={[
          makeTelegramChannel({
            botToken: 'telegram_token',
            memberAclJson: JSON.stringify(['broken-shape']),
          }),
        ]}
        descriptors={[TELEGRAM_DESCRIPTOR]}
        onSave={vi.fn()}
      />,
    );

    const aclPanel = panelByTitle('群成员访问控制');
    expect(within(aclPanel).getByText(/结构化面板暂时不可用/)).toBeTruthy();
    expect(within(aclPanel).getByLabelText('群成员 ACL 原始 JSON')).toBeTruthy();
  });

  it('Given 微信模板尚未扫码绑定 When 创建实例 Then 允许空凭证先保存', async () => {
    const onSave = vi.fn(
      async (_channelId: string | null, draft: ChannelDraft): Promise<ChannelSettingsEntry> => ({
        id: 'weixin-1',
        status: 'disconnected',
        ...draft,
      }),
    );

    render(
      <ChannelSubscriptionSettings
        channels={[]}
        descriptors={[WEIXIN_DESCRIPTOR]}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /微信公众平台/ }));
    fireEvent.click(screen.getByRole('button', { name: '创建并保存' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const firstCall = onSave.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onSave to be called');
    }
    const savedDraft = firstCall[1];
    expect(savedDraft.type).toBe('weixin');
    expect(savedDraft.config['token']).toBeUndefined();
    expect(savedDraft.config['accountId']).toBeUndefined();
  });

  it('Given 自动启动失败 When 保存实例 Then 提示配置已保存但通道未启动', async () => {
    const channel = makeChannel();
    const onSave = vi.fn(
      async (channelId: string | null, draft: ChannelDraft): Promise<ChannelSettingsEntry> => ({
        ...channel,
        ...draft,
        id: channelId ?? channel.id,
        status: 'error',
        errorMessage: 'QQ Gateway startup timed out before hello/identify',
      }),
    );

    render(
      <ChannelSubscriptionSettings
        channels={[channel]}
        descriptors={[FEISHU_DESCRIPTOR]}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('研发飞书'), {
      target: { value: '研发飞书自动启动检查' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存改动' }));

    expect(
      await screen.findByText(
        '已保存配置，但自动启动失败：QQ Gateway startup timed out before hello/identify',
      ),
    ).toBeTruthy();
  });

  it('Given 网关返回详细诊断 When 打开配置面板 Then 展示分发入站和断开原因', async () => {
    render(
      <ChannelSubscriptionSettings
        channels={[
          {
            ...makeChannel(),
            diagnostics: {
              status: 'connected',
              running: true,
              transport: 'qq-gateway',
              currentIntent: 'full',
              currentIntentDescription: 'Group + C2C + Channel DM + Channel Messages',
              identified: true,
              lastDispatchType: 'C2C_MESSAGE_CREATE',
              lastInboundAccepted: false,
              lastInboundType: 'c2c',
              lastInboundError: 'missing author id',
              lastIgnoredDispatchType: 'GUILD_MEMBER_UPDATE',
              lastSocketCloseCode: 4001,
              lastSocketCloseReason: 'gateway reconnect',
              lastError: 'send failed',
            },
          },
        ]}
        descriptors={[FEISHU_DESCRIPTOR]}
        onSave={vi.fn()}
      />,
    );

    expect(await screen.findByText('意图说明')).toBeTruthy();
    expect(screen.getByText('Group + C2C + Channel DM + Channel Messages')).toBeTruthy();
    expect(screen.getByText('分发类型')).toBeTruthy();
    expect(screen.getByText('C2C_MESSAGE_CREATE')).toBeTruthy();
    expect(screen.getByText('入站接受')).toBeTruthy();
    expect(screen.getByText('已拒绝')).toBeTruthy();
    expect(screen.getByText('忽略类型')).toBeTruthy();
    expect(screen.getByText('GUILD_MEMBER_UPDATE')).toBeTruthy();
    expect(screen.getByText('Socket 代码')).toBeTruthy();
    expect(screen.getByText('4001')).toBeTruthy();
    expect(screen.getAllByText('gateway reconnect').length).toBeGreaterThan(0);
    expect(screen.getAllByText('missing author id').length).toBeGreaterThan(0);
    expect(screen.getAllByText('send failed').length).toBeGreaterThan(0);
  });

  it('Given channel persona options When selecting a persona Then save persists the resource selection', async () => {
    const channel = makeChannel();
    const onSave = vi.fn(
      async (channelId: string | null, draft: ChannelDraft): Promise<ChannelSettingsEntry> => ({
        ...channel,
        id: channelId ?? channel.id,
        persona: draft.persona,
      }),
    );

    render(
      <ChannelSubscriptionSettings
        channels={[channel]}
        descriptors={[FEISHU_DESCRIPTOR]}
        personas={[
          {
            resourceId: 'resource-soul-balanced-collaborator',
            title: '稳健协作者',
            description: '稳健协作人设',
            source: 'reference',
          },
        ]}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('不绑定，使用默认助手人格'), {
      target: { value: 'resource-soul-balanced-collaborator' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存改动' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const firstCall = onSave.mock.calls[0];
    if (!firstCall) {
      throw new Error('Expected onSave to be called');
    }
    expect(firstCall[1].persona).toEqual({
      resourceId: 'resource-soul-balanced-collaborator',
      title: '稳健协作者',
    });
  });
});
