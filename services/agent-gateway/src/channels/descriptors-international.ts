import type { ChannelDescriptor } from './descriptors-types.js';
import {
  COMMON_CHANNEL_TOOLS,
  DEFAULT_AGENT_TOOLS,
  INBOUND_SECRET_FIELD,
  WS_RELAY_FIELD,
} from './descriptors-shared.js';
import { CHANNEL_QUICK_LINKS } from './descriptors-links.js';

export const INTERNATIONAL_CHANNEL_DESCRIPTORS: ChannelDescriptor[] = [
  {
    type: 'telegram',
    displayName: 'Telegram Bot',
    description: '基于 Bot Token 轮询 Telegram 更新并回写消息。',
    icon: 'telegram',
    category: 'international',
    tools: [...DEFAULT_AGENT_TOOLS, ...COMMON_CHANNEL_TOOLS],
    quickLinks: CHANNEL_QUICK_LINKS.telegram,
    configSchema: [
      {
        key: 'token',
        label: 'Bot Token',
        type: 'secret',
        required: true,
        placeholder: '123456:ABC...',
      },
      INBOUND_SECRET_FIELD,
      WS_RELAY_FIELD,
    ],
  },
  {
    type: 'discord',
    displayName: 'Discord Bot',
    description: '通过官方 Bot Token 发送频道消息并查询服务器列表。',
    icon: 'discord',
    category: 'international',
    tools: [...DEFAULT_AGENT_TOOLS, ...COMMON_CHANNEL_TOOLS],
    quickLinks: CHANNEL_QUICK_LINKS.discord,
    configSchema: [
      {
        key: 'token',
        label: 'Bot Token',
        type: 'secret',
        required: true,
      },
      {
        key: 'gatewayUrl',
        label: 'Gateway URL',
        type: 'text',
        placeholder: 'wss://gateway.discord.gg/?v=10&encoding=json',
        description: '可选；留空时使用 Discord 官方 Gateway。',
      },
      INBOUND_SECRET_FIELD,
      WS_RELAY_FIELD,
    ],
  },
  {
    type: 'whatsapp',
    displayName: 'WhatsApp Bot',
    description: '使用 WhatsApp Cloud API 发送消息并处理 Webhook 回调。',
    icon: 'whatsapp',
    category: 'international',
    tools: [...DEFAULT_AGENT_TOOLS, ...COMMON_CHANNEL_TOOLS],
    quickLinks: CHANNEL_QUICK_LINKS.whatsapp,
    configSchema: [
      {
        key: 'phoneNumberId',
        label: 'Phone Number ID',
        type: 'text',
        required: true,
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        type: 'secret',
        required: true,
      },
      {
        key: 'verifyToken',
        label: 'Verify Token',
        type: 'secret',
        placeholder: '可选，用于校验 Meta Webhook',
      },
      INBOUND_SECRET_FIELD,
      WS_RELAY_FIELD,
    ],
  },
  {
    type: 'slack',
    displayName: 'Slack Bot',
    description: '支持 Slack Bolt Socket Mode 与频道会话列表。',
    icon: 'slack',
    category: 'international',
    tools: [...DEFAULT_AGENT_TOOLS, ...COMMON_CHANNEL_TOOLS],
    quickLinks: CHANNEL_QUICK_LINKS.slack,
    configSchema: [
      {
        key: 'botToken',
        label: 'Bot Token',
        type: 'secret',
        required: true,
        placeholder: 'xoxb-...',
      },
      {
        key: 'signingSecret',
        label: 'Signing Secret',
        type: 'secret',
        required: true,
      },
      {
        key: 'appToken',
        label: 'App Token',
        type: 'secret',
        placeholder: 'xapp-...',
      },
      {
        key: 'port',
        label: 'Port',
        type: 'text',
        placeholder: '3000',
      },
      INBOUND_SECRET_FIELD,
      WS_RELAY_FIELD,
    ],
  },
];
