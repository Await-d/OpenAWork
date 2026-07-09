import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

const feishuChannelToolOutputSchema = z.string();
const feishuFileTypeSchema = z.enum(['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream']);
const feishuMemberIdTypeSchema = z.enum(['open_id', 'user_id', 'union_id']);
const feishuUrgentTypeSchema = z.enum(['app', 'sms']);
const bitableRecordSchema = z.record(z.string(), z.unknown());

export const feishuMediaInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  chat_id: z.string().min(1).optional(),
  file_path: z.string().min(1),
  file_type: feishuFileTypeSchema.optional(),
});

export const feishuListMembersInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  chat_id: z.string().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(50).optional(),
  page_token: z.string().min(1).optional(),
  member_id_type: feishuMemberIdTypeSchema.optional(),
});

export const feishuAtMemberInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  chat_id: z.string().min(1).optional(),
  user_ids: z.array(z.string().min(1)).optional(),
  at_all: z.boolean().optional(),
  text: z.string().min(1),
});

export const feishuUrgentInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  message_id: z.string().min(1),
  user_ids: z.array(z.string().min(1)).min(1),
  urgent_types: z.array(feishuUrgentTypeSchema).min(1),
});

export const feishuBitableListAppsInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
  page_token: z.string().min(1).optional(),
});

export const feishuBitableAppInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  app_token: z.string().min(1),
  page_size: z.coerce.number().int().min(1).max(200).optional(),
  page_token: z.string().min(1).optional(),
});

export const feishuBitableTableInputSchema = feishuBitableAppInputSchema.extend({
  table_id: z.string().min(1),
});

export const feishuBitableGetRecordsInputSchema = feishuBitableTableInputSchema.extend({
  filter: z.string().min(1).optional(),
});

export const feishuBitableRecordsInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  app_token: z.string().min(1),
  table_id: z.string().min(1),
  records: z.array(bitableRecordSchema).min(1),
});

export const feishuBitableDeleteRecordsInputSchema = z.object({
  plugin_id: z.string().min(1).optional(),
  app_token: z.string().min(1),
  table_id: z.string().min(1),
  record_ids: z.array(z.string().min(1)).min(1),
});

export type FeishuMediaInput = z.infer<typeof feishuMediaInputSchema>;

function gatewayOnly(): Promise<string> {
  throw new Error('channel tools must execute through the gateway-managed sandbox path');
}

function defineFeishuTool<TInput extends z.ZodTypeAny>(
  name: string,
  description: string,
  inputSchema: TInput,
): ToolDefinition<TInput, typeof feishuChannelToolOutputSchema> {
  return {
    name,
    description,
    inputSchema,
    outputSchema: feishuChannelToolOutputSchema,
    execute: gatewayOnly,
  };
}

export const FEISHU_TOOL_DEFINITIONS = [
  defineFeishuTool(
    'FeishuSendImage',
    '向当前飞书会话发送图片。file_path 支持工作区内绝对路径或 HTTP/HTTPS URL。',
    feishuMediaInputSchema,
  ),
  defineFeishuTool(
    'FeishuSendFile',
    '向当前飞书会话发送文件。file_type 可省略并按扩展名自动识别。',
    feishuMediaInputSchema,
  ),
  defineFeishuTool(
    'FeishuListChatMembers',
    '列出当前飞书群成员，返回 JSON。',
    feishuListMembersInputSchema,
  ),
  defineFeishuTool('FeishuAtMember', '在当前飞书群中 @成员或 @所有人。', feishuAtMemberInputSchema),
  defineFeishuTool(
    'FeishuSendUrgent',
    '对指定飞书 message_id 发起 app/sms 加急。',
    feishuUrgentInputSchema,
  ),
  defineFeishuTool(
    'FeishuBitableListApps',
    '列出可访问的飞书多维表格 app。',
    feishuBitableListAppsInputSchema,
  ),
  defineFeishuTool(
    'FeishuBitableListTables',
    '列出飞书多维表格 app 内的数据表。',
    feishuBitableAppInputSchema,
  ),
  defineFeishuTool(
    'FeishuBitableListFields',
    '列出飞书多维表格数据表字段。',
    feishuBitableTableInputSchema,
  ),
  defineFeishuTool(
    'FeishuBitableGetRecords',
    '读取飞书多维表格记录。',
    feishuBitableGetRecordsInputSchema,
  ),
  defineFeishuTool(
    'FeishuBitableCreateRecords',
    '创建飞书多维表格记录。',
    feishuBitableRecordsInputSchema,
  ),
  defineFeishuTool(
    'FeishuBitableUpdateRecords',
    '更新飞书多维表格记录。',
    feishuBitableRecordsInputSchema,
  ),
  defineFeishuTool(
    'FeishuBitableDeleteRecords',
    '删除飞书多维表格记录。',
    feishuBitableDeleteRecordsInputSchema,
  ),
] as const;

export const FEISHU_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  FEISHU_TOOL_DEFINITIONS.map((tool) => tool.name),
);
