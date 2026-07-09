import type { ChannelDescriptorField, ChannelDescriptorTool } from './descriptors-types.js';

export const DEFAULT_AGENT_TOOLS: ChannelDescriptorTool[] = [
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

export const COMMON_CHANNEL_TOOLS: ChannelDescriptorTool[] = [
  {
    key: 'PluginSendMessage',
    label: '发送渠道消息',
    description: '允许 Agent 向当前消息渠道会话发送文本。',
    defaultEnabled: true,
  },
  {
    key: 'PluginReplyMessage',
    label: '回复渠道消息',
    description: '允许 Agent 回复指定的渠道消息。',
    defaultEnabled: true,
  },
  {
    key: 'PluginGetGroupMessages',
    label: '读取群消息',
    description: '允许 Agent 读取当前渠道群聊或会话的近期消息。',
    defaultEnabled: true,
  },
  {
    key: 'PluginListGroups',
    label: '列出渠道会话',
    description: '允许 Agent 列出当前渠道可访问的群组或会话。',
    defaultEnabled: true,
  },
  {
    key: 'PluginSummarizeGroup',
    label: '总结群消息',
    description: '允许 Agent 获取近期群消息并用于摘要。',
    defaultEnabled: true,
  },
  {
    key: 'PluginGetCurrentChatMessages',
    label: '读取当前会话',
    description: '允许 Agent 读取当前 channel chat session 的近期消息。',
    defaultEnabled: true,
  },
];

export const FEISHU_CHANNEL_TOOLS: ChannelDescriptorTool[] = [
  ...COMMON_CHANNEL_TOOLS,
  {
    key: 'FeishuSendImage',
    label: '飞书发送图片',
    description: '允许 Agent 向当前飞书会话发送图片。',
    defaultEnabled: true,
  },
  {
    key: 'FeishuSendFile',
    label: '飞书发送文件',
    description: '允许 Agent 向当前飞书会话发送文件。',
    defaultEnabled: true,
  },
  {
    key: 'FeishuListChatMembers',
    label: '飞书成员列表',
    description: '允许 Agent 列出当前飞书群成员。',
    defaultEnabled: true,
  },
  {
    key: 'FeishuAtMember',
    label: '飞书 @ 成员',
    description: '允许 Agent 在飞书群聊中 @成员或 @所有人。',
    defaultEnabled: true,
  },
  {
    key: 'FeishuSendUrgent',
    label: '飞书加急',
    description: '允许 Agent 对指定飞书消息发起 app 或 sms 加急。',
    defaultEnabled: true,
  },
  {
    key: 'FeishuBitableListApps',
    label: '多维表格应用',
    description: '允许 Agent 列出可访问的飞书多维表格 app。',
    defaultEnabled: true,
  },
  {
    key: 'FeishuBitableListTables',
    label: '多维表格数据表',
    description: '允许 Agent 列出飞书多维表格中的数据表。',
    defaultEnabled: true,
  },
  {
    key: 'FeishuBitableListFields',
    label: '多维表格字段',
    description: '允许 Agent 列出飞书多维表格字段。',
    defaultEnabled: true,
  },
  {
    key: 'FeishuBitableGetRecords',
    label: '读取多维表格',
    description: '允许 Agent 读取飞书多维表格记录。',
    defaultEnabled: true,
  },
  {
    key: 'FeishuBitableCreateRecords',
    label: '创建多维表格记录',
    description: '允许 Agent 创建飞书多维表格记录。',
    defaultEnabled: true,
  },
  {
    key: 'FeishuBitableUpdateRecords',
    label: '更新多维表格记录',
    description: '允许 Agent 更新飞书多维表格记录。',
    defaultEnabled: true,
  },
  {
    key: 'FeishuBitableDeleteRecords',
    label: '删除多维表格记录',
    description: '允许 Agent 删除飞书多维表格记录。',
    defaultEnabled: true,
  },
];

export const WEIXIN_CHANNEL_TOOLS: ChannelDescriptorTool[] = [
  ...COMMON_CHANNEL_TOOLS,
  {
    key: 'WeixinSendImage',
    label: '微信发送图片',
    description: '允许 Agent 向当前微信公众平台会话发送图片。',
    defaultEnabled: true,
  },
  {
    key: 'WeixinSendFile',
    label: '微信发送文件',
    description: '允许 Agent 向当前微信公众平台会话发送文件。',
    defaultEnabled: true,
  },
];

export const INBOUND_SECRET_FIELD: ChannelDescriptorField = {
  key: 'inboundSecret',
  label: 'Inbound Secret',
  type: 'secret',
  placeholder: '用于 /channels/<id>/inbound 回调鉴权',
  description: '外部 Webhook 或中转服务推送消息时需要携带的共享密钥。',
};

export const WS_RELAY_FIELD: ChannelDescriptorField = {
  key: 'wsUrl',
  label: 'WebSocket Relay URL',
  type: 'text',
  placeholder: 'wss://your-relay-server/ws',
  description: '可选，用于接入外部消息中转服务的实时入站消息。',
};
