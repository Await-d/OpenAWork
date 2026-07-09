export const FEISHU_CHANNEL_TOOL_NAMES: ReadonlySet<string> = new Set([
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
]);

export const WEIXIN_CHANNEL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'WeixinSendImage',
  'WeixinSendFile',
]);

export const CHANNEL_SEND_TOOL_NAMES: ReadonlySet<string> = new Set([
  'PluginSendMessage',
  'PluginReplyMessage',
  'PluginGetGroupMessages',
  'PluginListGroups',
  'PluginSummarizeGroup',
  'PluginGetCurrentChatMessages',
  ...WEIXIN_CHANNEL_TOOL_NAMES,
  ...FEISHU_CHANNEL_TOOL_NAMES,
]);
