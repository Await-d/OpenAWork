import { describe, expect, it } from 'vitest';
import { CHANNEL_DESCRIPTORS } from '../../channels/descriptors.js';
import type { ChannelPlatform } from '../../channels/types.js';

function configKeysFor(type: ChannelPlatform): string[] {
  return (
    CHANNEL_DESCRIPTORS.find((descriptor) => descriptor.type === type)?.configSchema.map(
      (field) => field.key,
    ) ?? []
  );
}

function toolKeysFor(type: ChannelPlatform): string[] {
  return (
    CHANNEL_DESCRIPTORS.find((descriptor) => descriptor.type === type)?.tools.map(
      (tool) => tool.key,
    ) ?? []
  );
}

function quickLinksFor(type: ChannelPlatform): string[] {
  return (
    CHANNEL_DESCRIPTORS.find((descriptor) => descriptor.type === type)?.quickLinks?.map(
      (link) => link.url,
    ) ?? []
  );
}

function requiredConfigKeysFor(type: ChannelPlatform): string[] {
  return (
    CHANNEL_DESCRIPTORS.find((descriptor) => descriptor.type === type)
      ?.configSchema.filter((field) => field.required)
      .map((field) => field.key) ?? []
  );
}

describe('channel descriptors', () => {
  it('暴露 QQ 官方 Gateway 和发送模式配置字段', () => {
    expect(configKeysFor('qq')).toEqual(
      expect.arrayContaining(['gatewayUrl', 'useSandbox', 'markdownSupport']),
    );
  });

  it('暴露 Discord Gateway URL 覆盖字段', () => {
    expect(configKeysFor('discord')).toEqual(expect.arrayContaining(['gatewayUrl']));
  });

  it('暴露钉钉 AI Card 流式回复模板字段', () => {
    expect(configKeysFor('dingtalk')).toEqual(expect.arrayContaining(['cardTemplateId']));
  });

  it('暴露微信公众平台长轮询接入字段', () => {
    expect(configKeysFor('weixin')).toEqual(
      expect.arrayContaining(['token', 'accountId', 'baseUrl', 'routeTag']),
    );
  });

  it('允许微信公众平台先创建实例再扫码绑定凭证', () => {
    expect(requiredConfigKeysFor('weixin')).not.toContain('token');
    expect(requiredConfigKeysFor('weixin')).not.toContain('accountId');
  });

  it('暴露通用 channel 工具给所有平台', () => {
    expect(toolKeysFor('telegram')).toEqual(
      expect.arrayContaining([
        'PluginSendMessage',
        'PluginReplyMessage',
        'PluginGetGroupMessages',
        'PluginListGroups',
        'PluginSummarizeGroup',
        'PluginGetCurrentChatMessages',
      ]),
    );
  });

  it('暴露飞书专项 channel 工具', () => {
    expect(toolKeysFor('feishu')).toEqual(
      expect.arrayContaining([
        'FeishuSendImage',
        'FeishuSendFile',
        'FeishuListChatMembers',
        'FeishuAtMember',
        'FeishuSendUrgent',
        'FeishuBitableListApps',
        'FeishuBitableListTables',
        'FeishuBitableListFields',
        'FeishuBitableGetRecords',
        'FeishuBitableCreateRecords',
        'FeishuBitableUpdateRecords',
        'FeishuBitableDeleteRecords',
      ]),
    );
  });

  it('暴露微信媒体 channel 工具', () => {
    expect(toolKeysFor('weixin')).toEqual(
      expect.arrayContaining(['WeixinSendImage', 'WeixinSendFile']),
    );
  });

  it('每个平台都暴露快捷配置跳转入口', () => {
    for (const descriptor of CHANNEL_DESCRIPTORS) {
      expect(quickLinksFor(descriptor.type).length).toBeGreaterThan(0);
      expect(quickLinksFor(descriptor.type).every((url) => url.startsWith('https://'))).toBe(true);
    }
  });
});
