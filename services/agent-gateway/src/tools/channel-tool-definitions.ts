import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { FEISHU_TOOL_DEFINITIONS } from './feishu-channel-tool-definitions.js';

export const channelToolOutputSchema = z.string();

export const pluginMessageInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  chat_id: z.string().min(1).optional(),
  content: z.string().min(1),
});

export const pluginReplyInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  message_id: z.string().min(1),
  content: z.string().min(1),
});

export const pluginMessagesInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  chat_id: z.string().min(1).optional(),
  count: z.coerce.number().int().min(1).max(200).optional(),
});

export const pluginListGroupsInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
});

export const weixinMediaInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  chat_id: z.string().min(1).optional(),
  file_path: z.string().min(1),
  content: z.string().min(1).optional(),
});

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
  typeof weixinMediaInputSchema,
  typeof channelToolOutputSchema
> = {
  name: 'PluginSendImage',
  description:
    '向当前消息渠道会话发送真实图片附件。file_path 支持工作区内绝对路径或 HTTP/HTTPS URL，可附带 content 文本。当前通道支持图片时，看到 WebFetch 返回图片 URL 应优先调用本工具，不要只发送 Markdown 图片链接。',
  inputSchema: weixinMediaInputSchema,
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
