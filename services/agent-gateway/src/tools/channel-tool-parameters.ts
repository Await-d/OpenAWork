type ToolParameters = {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  anyOf?: { required: string[] }[];
  additionalProperties: boolean;
};

export function buildChannelToolParameters(toolName: string): ToolParameters | null {
  switch (toolName) {
    case 'PluginSendMessage':
      return textMessageParameters();
    case 'PluginReplyMessage':
      return replyMessageParameters();
    case 'PluginGetGroupMessages':
    case 'PluginSummarizeGroup':
    case 'PluginGetCurrentChatMessages':
      return groupMessagesParameters();
    case 'PluginListGroups':
      return pluginOnlyParameters();
    case 'WeixinSendImage':
    case 'WeixinSendFile':
      return weixinMediaParameters();
    case 'FeishuSendImage':
    case 'FeishuSendFile':
      return feishuMediaParameters();
    case 'FeishuListChatMembers':
      return feishuMembersParameters();
    case 'FeishuAtMember':
      return feishuAtMemberParameters();
    case 'FeishuSendUrgent':
      return feishuUrgentParameters();
    case 'FeishuBitableListApps':
      return feishuBitableListAppsParameters();
    case 'FeishuBitableListTables':
      return feishuBitableListTablesParameters();
    case 'FeishuBitableListFields':
    case 'FeishuBitableGetRecords':
      return feishuBitableTableParameters();
    case 'FeishuBitableCreateRecords':
    case 'FeishuBitableUpdateRecords':
      return feishuBitableMutationParameters();
    case 'FeishuBitableDeleteRecords':
      return feishuBitableDeleteParameters();
    default:
      return null;
  }
}

function textMessageParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前 channel 实例' },
      chat_id: { type: 'string', description: '可选，默认当前 channel 会话' },
      content: { type: 'string', description: '要发送的文本内容' },
    },
    required: ['content'],
    additionalProperties: false,
  };
}

function replyMessageParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前 channel 实例' },
      message_id: { type: 'string', description: '要回复的消息 ID' },
      content: { type: 'string', description: '回复文本内容' },
    },
    required: ['message_id', 'content'],
    additionalProperties: false,
  };
}

function groupMessagesParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前 channel 实例' },
      chat_id: { type: 'string', description: '可选，默认当前 channel 会话' },
      count: { type: 'integer', minimum: 1, maximum: 200, description: '读取最近消息数量' },
    },
    required: [],
    additionalProperties: false,
  };
}

function pluginOnlyParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前 channel 实例' },
    },
    required: [],
    additionalProperties: false,
  };
}

function weixinMediaParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前微信公众号实例' },
      chat_id: { type: 'string', description: '可选，默认当前微信会话' },
      file_path: { type: 'string', description: '工作区内绝对路径，或 HTTP/HTTPS URL' },
      content: { type: 'string', description: '可选，发送媒体前附带的文本' },
    },
    required: ['file_path'],
    additionalProperties: false,
  };
}

function feishuMediaParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前飞书实例' },
      chat_id: { type: 'string', description: '可选，默认当前飞书会话' },
      file_path: { type: 'string', description: '工作区内绝对路径，或 HTTP/HTTPS URL' },
      file_type: {
        type: 'string',
        enum: ['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream'],
        description: '可选，FeishuSendFile 支持覆盖文件类型；省略则按扩展名识别',
      },
    },
    required: ['file_path'],
    additionalProperties: false,
  };
}

function feishuMembersParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前飞书实例' },
      chat_id: { type: 'string', description: '可选，默认当前飞书会话' },
      page_size: { type: 'integer', minimum: 1, maximum: 50 },
      page_token: { type: 'string' },
      member_id_type: { type: 'string', enum: ['open_id', 'user_id', 'union_id'] },
    },
    required: [],
    additionalProperties: false,
  };
}

function feishuAtMemberParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前飞书实例' },
      chat_id: { type: 'string', description: '可选，默认当前飞书会话' },
      user_ids: { type: 'array', items: { type: 'string' } },
      at_all: { type: 'boolean' },
      text: { type: 'string', description: '要发送的正文' },
    },
    required: ['text'],
    additionalProperties: false,
  };
}

function feishuUrgentParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前飞书实例' },
      message_id: { type: 'string', description: '要加急的飞书消息 ID' },
      user_ids: { type: 'array', items: { type: 'string' } },
      urgent_types: { type: 'array', items: { type: 'string', enum: ['app', 'sms'] } },
    },
    required: ['message_id', 'user_ids', 'urgent_types'],
    additionalProperties: false,
  };
}

function feishuBitableListAppsParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前飞书实例' },
      page_size: { type: 'integer', minimum: 1, maximum: 100 },
      page_token: { type: 'string' },
    },
    required: [],
    additionalProperties: false,
  };
}

function feishuBitableListTablesParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前飞书实例' },
      app_token: { type: 'string' },
      page_size: { type: 'integer', minimum: 1, maximum: 200 },
      page_token: { type: 'string' },
    },
    required: ['app_token'],
    additionalProperties: false,
  };
}

function feishuBitableTableParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前飞书实例' },
      app_token: { type: 'string' },
      table_id: { type: 'string' },
      filter: { type: 'string', description: 'FeishuBitableGetRecords 可选过滤公式' },
      page_size: { type: 'integer', minimum: 1, maximum: 200 },
      page_token: { type: 'string' },
    },
    required: ['app_token', 'table_id'],
    additionalProperties: false,
  };
}

function feishuBitableMutationParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前飞书实例' },
      app_token: { type: 'string' },
      table_id: { type: 'string' },
      records: { type: 'array', items: { type: 'object' } },
    },
    required: ['app_token', 'table_id', 'records'],
    additionalProperties: false,
  };
}

function feishuBitableDeleteParameters(): ToolParameters {
  return {
    type: 'object',
    properties: {
      plugin_id: { type: 'string', description: '可选，默认当前飞书实例' },
      app_token: { type: 'string' },
      table_id: { type: 'string' },
      record_ids: { type: 'array', items: { type: 'string' } },
    },
    required: ['app_token', 'table_id', 'record_ids'],
    additionalProperties: false,
  };
}
