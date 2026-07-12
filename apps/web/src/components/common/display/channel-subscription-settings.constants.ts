import type {
  ChannelDescriptorCategory,
  ChannelFeaturesEntry,
} from './channel-subscription-settings.types.js';

export const CATEGORY_ORDER: ChannelDescriptorCategory[] = ['china', 'international', 'custom'];

export const CATEGORY_LABEL: Record<ChannelDescriptorCategory, string> = {
  china: '国内渠道',
  international: '国际渠道',
  custom: '自定义',
};

export const CHANNEL_ICON: Record<string, string> = {
  telegram: '✈',
  discord: '◈',
  slack: '#',
  feishu: '飞',
  dingtalk: '钉',
  weixin: '微',
  wecom: '企',
  whatsapp: '◎',
  qq: 'Q',
};

export const FEATURE_OPTIONS: Array<{
  key: keyof ChannelFeaturesEntry;
  label: string;
  description: string;
}> = [
  {
    key: 'autoReply',
    label: '自动回复',
    description: '收到新消息后自动创建会话并生成回复。',
  },
  {
    key: 'streamingReply',
    label: '流式回复',
    description: '渠道支持时优先使用逐步更新的流式输出。',
  },
  {
    key: 'autoStart',
    label: '自动启动',
    description: 'Gateway 重启后自动拉起当前通道实例。',
  },
];
