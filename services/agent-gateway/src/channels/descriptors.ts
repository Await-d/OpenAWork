import type { ChannelPlatform } from './types.js';

export type ChannelDescriptorCategory = 'china' | 'international' | 'custom';
export type ChannelDescriptorFieldType = 'text' | 'secret';

export interface ChannelDescriptorField {
  key: string;
  label: string;
  type: ChannelDescriptorFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
}

export interface ChannelDescriptorTool {
  key: string;
  label: string;
  description: string;
  defaultEnabled?: boolean;
}

export interface ChannelDescriptor {
  type: ChannelPlatform;
  displayName: string;
  description: string;
  icon: string;
  category: ChannelDescriptorCategory;
  configSchema: ChannelDescriptorField[];
  tools: ChannelDescriptorTool[];
}

const DEFAULT_AGENT_TOOLS: ChannelDescriptorTool[] = [
  {
    key: 'web_search',
    label: '联网检索',
    description: '允许代理访问 Web 搜索与公开网页内容。',
    defaultEnabled: true,
  },
  {
    key: 'read',
    label: '读取文件',
    description: '允许代理读取工作区内的文件与目录内容。',
    defaultEnabled: true,
  },
  {
    key: 'edit',
    label: '编辑文件',
    description: '允许代理修改工作区中的源代码与配置文件。',
    defaultEnabled: true,
  },
  {
    key: 'bash',
    label: '命令行',
    description: '允许代理执行终端命令、脚本与构建流程。',
    defaultEnabled: true,
  },
  {
    key: 'mcp',
    label: 'MCP',
    description: '允许代理调用已安装的 MCP 服务能力。',
    defaultEnabled: true,
  },
  {
    key: 'task',
    label: '子代理',
    description: '允许代理发起并协调子任务与子代理执行。',
    defaultEnabled: true,
  },
];

export const CHANNEL_DESCRIPTORS: ChannelDescriptor[] = [
  {
    type: 'feishu',
    displayName: '飞书 Bot',
    description: '适用于飞书 / Lark 机器人接入，支持群聊列表拉取与卡片式回复。',
    icon: 'feishu',
    category: 'china',
    tools: DEFAULT_AGENT_TOOLS,
    configSchema: [
      {
        key: 'appId',
        label: 'App ID',
        type: 'text',
        required: true,
        placeholder: 'cli_xxxxx',
      },
      {
        key: 'appSecret',
        label: 'App Secret',
        type: 'secret',
        required: true,
      },
      {
        key: 'verificationToken',
        label: 'Verification Token',
        type: 'text',
        placeholder: '可选，用于回调校验',
      },
      {
        key: 'encryptKey',
        label: 'Encrypt Key',
        type: 'secret',
        placeholder: '可选，用于事件加密',
      },
    ],
  },
  {
    type: 'dingtalk',
    displayName: '钉钉 Bot',
    description: '支持机器人 Webhook 与企业应用两种接入方式。',
    icon: 'dingtalk',
    category: 'china',
    tools: DEFAULT_AGENT_TOOLS,
    configSchema: [
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://oapi.dingtalk.com/robot/send?...',
        description: '如使用自定义机器人，可仅填写 Webhook 配置。',
      },
      {
        key: 'secret',
        label: 'Webhook Secret',
        type: 'secret',
      },
      {
        key: 'appKey',
        label: 'App Key',
        type: 'text',
        description: '如使用企业应用机器人，请填写 App Key / App Secret / Robot Code。',
      },
      {
        key: 'appSecret',
        label: 'App Secret',
        type: 'secret',
      },
      {
        key: 'robotCode',
        label: 'Robot Code',
        type: 'text',
      },
    ],
  },
  {
    type: 'wecom',
    displayName: '企业微信 Bot',
    description: '支持企业微信应用消息与群机器人 Webhook 两种模式。',
    icon: 'wecom',
    category: 'china',
    tools: DEFAULT_AGENT_TOOLS,
    configSchema: [
      {
        key: 'corpId',
        label: 'Corp ID',
        type: 'text',
        description: '应用模式下需要 corpId / corpSecret / agentId。',
      },
      {
        key: 'corpSecret',
        label: 'Corp Secret',
        type: 'secret',
      },
      {
        key: 'agentId',
        label: 'Agent ID',
        type: 'text',
      },
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?...',
        description: '群机器人模式下可仅填写 Webhook URL。',
      },
    ],
  },
  {
    type: 'qq',
    displayName: 'QQ Bot',
    description: '腾讯 QQ 机器人接入，适合频道与群消息投递。',
    icon: 'qq',
    category: 'china',
    tools: DEFAULT_AGENT_TOOLS,
    configSchema: [
      {
        key: 'appId',
        label: 'App ID',
        type: 'text',
        required: true,
      },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        type: 'secret',
        required: true,
      },
      {
        key: 'webhookSecret',
        label: 'Webhook Secret',
        type: 'secret',
        placeholder: '可选，用于回调验签',
      },
    ],
  },
  {
    type: 'telegram',
    displayName: 'Telegram Bot',
    description: '基于 Bot Token 轮询 Telegram 更新并回写消息。',
    icon: 'telegram',
    category: 'international',
    tools: DEFAULT_AGENT_TOOLS,
    configSchema: [
      {
        key: 'token',
        label: 'Bot Token',
        type: 'secret',
        required: true,
        placeholder: '123456:ABC...',
      },
    ],
  },
  {
    type: 'discord',
    displayName: 'Discord Bot',
    description: '通过官方 Bot Token 发送频道消息并查询服务器列表。',
    icon: 'discord',
    category: 'international',
    tools: DEFAULT_AGENT_TOOLS,
    configSchema: [
      {
        key: 'token',
        label: 'Bot Token',
        type: 'secret',
        required: true,
      },
    ],
  },
  {
    type: 'whatsapp',
    displayName: 'WhatsApp Bot',
    description: '使用 WhatsApp Cloud API 发送消息并处理 Webhook 回调。',
    icon: 'whatsapp',
    category: 'international',
    tools: DEFAULT_AGENT_TOOLS,
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
    ],
  },
  {
    type: 'slack',
    displayName: 'Slack Bot',
    description: '支持 Slack Bolt Socket Mode 与频道会话列表。',
    icon: 'slack',
    category: 'international',
    tools: DEFAULT_AGENT_TOOLS,
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
    ],
  },
];
