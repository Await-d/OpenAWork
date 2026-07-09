import type { ChannelDescriptorLink } from './descriptors-types.js';

export const CHANNEL_QUICK_LINKS = {
  feishu: [
    {
      label: '开发者后台',
      url: 'https://open.feishu.cn/app',
      description: '创建或选择飞书应用，复制 App ID / App Secret。',
    },
    {
      label: '消息接口文档',
      url: 'https://open.feishu.cn/document/server-docs/im-v1/message/create',
      description: '核对机器人消息、回复和权限范围。',
    },
  ],
  dingtalk: [
    {
      label: '开放平台后台',
      url: 'https://open-dev.dingtalk.com/',
      description: '配置企业应用机器人、App Key、App Secret 与 Robot Code。',
    },
    {
      label: '机器人文档',
      url: 'https://open.dingtalk.com/document/orgapp/robot-overview',
      description: '查看机器人接入、Stream Mode 和互动卡片能力。',
    },
  ],
  weixin: [
    {
      label: '公众平台后台',
      url: 'https://mp.weixin.qq.com/',
      description: '登录公众号后台，确认账号与开发配置。',
    },
    {
      label: 'iLink Bot 入口',
      url: 'https://ilinkai.weixin.qq.com/',
      description: '微信公众平台 iLink Bot 的默认接入域名。',
    },
  ],
  wecom: [
    {
      label: '企业微信后台',
      url: 'https://work.weixin.qq.com/wework_admin/frame',
      description: '创建自建应用，获取 Corp ID、Secret 与 Agent ID。',
    },
    {
      label: '应用消息文档',
      url: 'https://developer.work.weixin.qq.com/document/path/90236',
      description: '核对企业微信应用消息发送接口。',
    },
  ],
  qq: [
    {
      label: 'QQ 机器人平台',
      url: 'https://q.qq.com/#/app/bot',
      description: '创建机器人并获取 App ID / Client Secret。',
    },
    {
      label: 'QQ Bot 文档',
      url: 'https://bot.q.qq.com/wiki/',
      description: '查看 Gateway、群聊、C2C 与频道消息接口。',
    },
  ],
  telegram: [
    {
      label: 'BotFather',
      url: 'https://t.me/BotFather',
      description: '创建 Telegram Bot 并复制 Bot Token。',
    },
    {
      label: 'Bot API 文档',
      url: 'https://core.telegram.org/bots/api',
      description: '核对 getUpdates、sendMessage 与消息格式。',
    },
  ],
  discord: [
    {
      label: 'Developer Portal',
      url: 'https://discord.com/developers/applications',
      description: '创建 Discord Application / Bot 并复制 Token。',
    },
    {
      label: 'Gateway 文档',
      url: 'https://discord.com/developers/docs/events/gateway',
      description: '核对 Gateway intents、Identify 与消息事件。',
    },
  ],
  whatsapp: [
    {
      label: 'Meta Apps',
      url: 'https://developers.facebook.com/apps/',
      description: '创建 Meta 应用并启用 WhatsApp Cloud API。',
    },
    {
      label: 'Cloud API 文档',
      url: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started',
      description: '获取 Phone Number ID、Access Token 与 Webhook 配置。',
    },
  ],
  slack: [
    {
      label: 'Slack Apps',
      url: 'https://api.slack.com/apps',
      description: '创建 Slack App，配置 Bot Token、Signing Secret 与 Socket Mode。',
    },
    {
      label: 'Bolt 文档',
      url: 'https://slack.dev/bolt-js/concepts',
      description: '核对 Socket Mode、事件订阅和命令处理。',
    },
  ],
} as const satisfies Record<string, readonly ChannelDescriptorLink[]>;
