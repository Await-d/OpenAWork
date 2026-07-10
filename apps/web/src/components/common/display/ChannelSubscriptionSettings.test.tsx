// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function checkboxFor(label: string): HTMLInputElement {
  const text = screen.getByText(label);
  const input = text.closest('label')?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing checkbox for ${label}`);
  }
  return input;
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
