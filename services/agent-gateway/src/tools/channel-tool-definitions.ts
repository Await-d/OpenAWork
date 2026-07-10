import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { FEISHU_TOOL_DEFINITIONS } from './feishu-channel-tool-definitions.js';

export const channelToolOutputSchema = z.string();

function normalizeBlankString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.trim().length === 0) {
    return undefined;
  }
  return value;
}

function normalizeCurrentChannelId(value: unknown): unknown {
  const normalizedValue = normalizeBlankString(value);
  if (typeof normalizedValue !== 'string') {
    return normalizedValue;
  }
  const normalized = normalizedValue.trim().toLowerCase();
  if (
    normalized === 'default' ||
    normalized === 'current' ||
    normalized === '__default__' ||
    normalized === '__current_channel__'
  ) {
    return undefined;
  }
  return normalizedValue;
}

const currentChannelIdSchema = z.preprocess(
  normalizeCurrentChannelId,
  z.string().min(1).optional(),
);
const optionalMessageIdSchema = z.preprocess(normalizeBlankString, z.string().min(1).optional());

export const pluginMessageInputSchema = z.object({
  plugin_id: currentChannelIdSchema,
  chat_id: currentChannelIdSchema,
  content: z.string().min(1),
});

export const pluginReplyInputSchema = z.object({
  plugin_id: currentChannelIdSchema,
  message_id: z.string().min(1),
  content: z.string().min(1),
});

export const pluginMessagesInputSchema = z.object({
  plugin_id: currentChannelIdSchema,
  chat_id: currentChannelIdSchema,
  count: z.coerce.number().int().min(1).max(200).optional(),
});

export const pluginListGroupsInputSchema = z.object({
  plugin_id: currentChannelIdSchema,
});

export const pluginMediaInputSchema = z.object({
  file_path: z.string().min(1),
  content: z.preprocess(normalizeBlankString, z.string().min(1).optional()),
  message_id: optionalMessageIdSchema,
});

export const channelMediaInputSchema = pluginMediaInputSchema.extend({
  plugin_id: currentChannelIdSchema,
  chat_id: currentChannelIdSchema,
});

export const weixinMediaInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  chat_id: z.string().min(1).optional(),
  file_path: z.string().min(1),
  content: z.string().min(1).optional(),
});

export type ChannelMediaInput = z.infer<typeof channelMediaInputSchema>;
export type WeixinMediaInput = z.infer<typeof weixinMediaInputSchema>;

function gatewayOnly(): Promise<string> {
  throw new Error('channel tools must execute through the gateway-managed sandbox path');
}

export const pluginSendMessageToolDefinition: ToolDefinition<
  typeof pluginMessageInputSchema,
  typeof channelToolOutputSchema
> = {
  name: 'PluginSendMessage',
  description:
    '向当前消息渠道会话发送文本。plugin_id/chat_id 可省略，省略时使用当前 channel session。',
  inputSchema: pluginMessageInputSchema,
  outputSchema: channelToolOutputSchema,
  execute: gatewayOnly,
};

export const pluginReplyMessageToolDefinition: ToolDefinition<
  typeof pluginReplyInputSchema,
  typeof channelToolOutputSchema
> = {
  name: 'PluginReplyMessage',
  description: '通过当前消息渠道回复指定 message_id。plugin_id 可省略，省略时使用当前渠道。',
  inputSchema: pluginReplyInputSchema,
  outputSchema: channelToolOutputSchema,
  execute: gatewayOnly,
};

export const pluginGetGroupMessagesToolDefinition: ToolDefinition<
  typeof pluginMessagesInputSchema,
  typeof channelToolOutputSchema
> = {
  name: 'PluginGetGroupMessages',
  description:
    '读取当前消息渠道会话的最近消息，返回 JSON 数组；每条消息的 replyMessageId 可直接传给 PluginReplyMessage。',
  inputSchema: pluginMessagesInputSchema,
  outputSchema: channelToolOutputSchema,
  execute: gatewayOnly,
};

export const pluginListGroupsToolDefinition: ToolDefinition<
  typeof pluginListGroupsInputSchema,
  typeof channelToolOutputSchema
> = {
  name: 'PluginListGroups',
  description: '列出当前消息渠道可访问的群组/会话，返回 JSON 数组。',
  inputSchema: pluginListGroupsInputSchema,
  outputSchema: channelToolOutputSchema,
  execute: gatewayOnly,
};

export const pluginSummarizeGroupToolDefinition: ToolDefinition<
  typeof pluginMessagesInputSchema,
  typeof channelToolOutputSchema
> = {
  name: 'PluginSummarizeGroup',
  description:
    '读取当前消息渠道最近消息供模型总结，返回 JSON 数组；每条消息的 replyMessageId 可直接传给 PluginReplyMessage。',
  inputSchema: pluginMessagesInputSchema,
  outputSchema: channelToolOutputSchema,
  execute: gatewayOnly,
};

export const pluginGetCurrentChatMessagesToolDefinition = {
  ...pluginGetGroupMessagesToolDefinition,
  name: 'PluginGetCurrentChatMessages',
  description:
    '读取当前 channel chat session 的最近消息，返回 JSON 数组；每条消息的 replyMessageId 可直接传给 PluginReplyMessage。',
} satisfies ToolDefinition<typeof pluginMessagesInputSchema, typeof channelToolOutputSchema>;

export const weixinSendImageToolDefinition: ToolDefinition<
  typeof weixinMediaInputSchema,
  typeof channelToolOutputSchema
> = {
  name: 'WeixinSendImage',
  description:
    '向当前微信公众号会话发送图片。file_path 支持工作区内绝对路径或 HTTP/HTTPS URL，可附带 content 文本。',
  inputSchema: weixinMediaInputSchema,
  outputSchema: channelToolOutputSchema,
  execute: gatewayOnly,
};

export const pluginSendImageToolDefinition: ToolDefinition<
  typeof pluginMediaInputSchema,
  typeof channelToolOutputSchema
> = {
  name: 'PluginSendImage',
  description:
    '向当前消息渠道会话发送真实图片附件。只需要传 file_path、可选 content，以及需要回复历史消息时的 message_id；plugin_id/chat_id 已由当前 channel session 自动提供，不要传空字符串、default、current 或占位符。file_path 支持工作区内绝对路径或 HTTP/HTTPS URL。当前通道支持图片时，看到 WebFetch 返回图片 URL 应优先调用本工具，不要只发送 Markdown 图片链接。QQ 私聊/群聊自动回复会自动使用当前消息的被动回复上下文发送图片；回复历史消息时请使用 PluginGetCurrentChatMessages 返回的 replyMessageId 作为 message_id。',
  inputSchema: pluginMediaInputSchema,
  outputSchema: channelToolOutputSchema,
  execute: gatewayOnly,
};

export const weixinSendFileToolDefinition: ToolDefinition<
  typeof weixinMediaInputSchema,
  typeof channelToolOutputSchema
> = {
  name: 'WeixinSendFile',
  description:
    '向当前微信公众号会话发送文件。file_path 支持工作区内绝对路径或 HTTP/HTTPS URL，可附带 content 文本。',
  inputSchema: weixinMediaInputSchema,
  outputSchema: channelToolOutputSchema,
  execute: gatewayOnly,
};

export const CHANNEL_TOOL_DEFINITIONS = [
  pluginSendMessageToolDefinition,
  pluginReplyMessageToolDefinition,
  pluginSendImageToolDefinition,
  pluginGetGroupMessagesToolDefinition,
  pluginListGroupsToolDefinition,
  pluginSummarizeGroupToolDefinition,
  pluginGetCurrentChatMessagesToolDefinition,
  weixinSendImageToolDefinition,
  weixinSendFileToolDefinition,
  ...FEISHU_TOOL_DEFINITIONS,
] as const;

export const CHANNEL_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  CHANNEL_TOOL_DEFINITIONS.map((tool) => tool.name),
);
