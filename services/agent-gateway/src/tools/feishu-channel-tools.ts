import { normalizeFeishuFileType } from '../channels/feishu-media.js';
import { readChannelMedia } from './channel-tool-runtime.js';
import {
  feishuAtMemberInputSchema,
  feishuBitableAppInputSchema,
  feishuBitableDeleteRecordsInputSchema,
  feishuBitableGetRecordsInputSchema,
  feishuBitableListAppsInputSchema,
  feishuBitableRecordsInputSchema,
  feishuBitableTableInputSchema,
  feishuListMembersInputSchema,
  feishuMediaInputSchema,
  feishuUrgentInputSchema,
} from './feishu-channel-tool-definitions.js';
import { requireFeishuToolService } from './feishu-channel-runtime.js';

interface FeishuToolExecutionInput {
  readonly rawInput: unknown;
  readonly sessionId: string;
  readonly signal: AbortSignal;
}

export async function executeFeishuChannelTool(
  input: FeishuToolExecutionInput & {
    readonly toolName: string;
  },
): Promise<string> {
  switch (input.toolName) {
    case 'FeishuSendImage':
      return executeFeishuMediaTool(input, 'image');
    case 'FeishuSendFile':
      return executeFeishuMediaTool(input, 'file');
    case 'FeishuListChatMembers':
      return executeListMembers(input);
    case 'FeishuAtMember':
      return executeAtMember(input);
    case 'FeishuSendUrgent':
      return executeUrgent(input);
    case 'FeishuBitableListApps':
      return executeBitableListApps(input);
    case 'FeishuBitableListTables':
      return executeBitableListTables(input);
    case 'FeishuBitableListFields':
      return executeBitableListFields(input);
    case 'FeishuBitableGetRecords':
      return executeBitableGetRecords(input);
    case 'FeishuBitableCreateRecords':
      return executeBitableCreateRecords(input);
    case 'FeishuBitableUpdateRecords':
      return executeBitableUpdateRecords(input);
    case 'FeishuBitableDeleteRecords':
      return executeBitableDeleteRecords(input);
    default:
      throw new Error(`Unsupported Feishu channel tool: ${input.toolName}`);
  }
}

async function executeFeishuMediaTool(
  input: FeishuToolExecutionInput,
  kind: 'file' | 'image',
): Promise<string> {
  const parsed = feishuMediaInputSchema.parse(input.rawInput);
  const { ctx, service } = requireFeishuToolService(input.sessionId, parsed);
  const media = await readChannelMedia({
    filePath: parsed.file_path,
    sessionId: input.sessionId,
    signal: input.signal,
  });
  if (kind === 'image') {
    if (!service.sendImage) throw new Error('Current Feishu channel does not support images.');
    return JSON.stringify(await service.sendImage(ctx.chatId, { ...media, signal: input.signal }));
  }
  if (!service.sendFile) throw new Error('Current Feishu channel does not support files.');
  return JSON.stringify(
    await service.sendFile(ctx.chatId, {
      ...media,
      fileType: normalizeFeishuFileType(parsed.file_type, media.fileName),
      signal: input.signal,
    }),
  );
}

async function executeListMembers(input: FeishuToolExecutionInput): Promise<string> {
  const parsed = feishuListMembersInputSchema.parse(input.rawInput);
  const { ctx, service } = requireFeishuToolService(input.sessionId, parsed);
  if (!service.listChatMembers) {
    throw new Error('Current Feishu channel does not support member listing.');
  }
  return JSON.stringify(
    await service.listChatMembers(ctx.chatId, {
      pageSize: parsed.page_size,
      pageToken: parsed.page_token,
      memberIdType: parsed.member_id_type,
      signal: input.signal,
    }),
  );
}

async function executeAtMember(input: FeishuToolExecutionInput): Promise<string> {
  const parsed = feishuAtMemberInputSchema.parse(input.rawInput);
  const { ctx, service } = requireFeishuToolService(input.sessionId, parsed);
  if (!service.sendMention) {
    throw new Error('Current Feishu channel does not support mentions.');
  }
  return JSON.stringify(
    await service.sendMention(ctx.chatId, {
      userIds: parsed.user_ids ?? [],
      atAll: parsed.at_all,
      text: parsed.text,
      signal: input.signal,
    }),
  );
}

async function executeUrgent(input: FeishuToolExecutionInput): Promise<string> {
  const parsed = feishuUrgentInputSchema.parse(input.rawInput);
  const { service } = requireFeishuToolService(input.sessionId, parsed);
  if (!service.sendUrgent) {
    throw new Error('Current Feishu channel does not support urgent messages.');
  }
  return JSON.stringify(
    await service.sendUrgent(parsed.message_id, {
      userIds: parsed.user_ids,
      urgentTypes: parsed.urgent_types,
      userIdType: 'user_id',
      signal: input.signal,
    }),
  );
}

async function executeBitableListApps(input: FeishuToolExecutionInput): Promise<string> {
  const parsed = feishuBitableListAppsInputSchema.parse(input.rawInput);
  const { service } = requireFeishuToolService(input.sessionId, parsed);
  if (!service.listBitableApps) throw new Error('Current Feishu channel does not support Bitable.');
  return JSON.stringify(
    await service.listBitableApps({
      pageSize: parsed.page_size,
      pageToken: parsed.page_token,
      signal: input.signal,
    }),
  );
}

async function executeBitableListTables(input: FeishuToolExecutionInput): Promise<string> {
  const parsed = feishuBitableAppInputSchema.parse(input.rawInput);
  const { service } = requireFeishuToolService(input.sessionId, parsed);
  if (!service.listBitableTables)
    throw new Error('Current Feishu channel does not support Bitable.');
  return JSON.stringify(
    await service.listBitableTables({
      appToken: parsed.app_token,
      pageSize: parsed.page_size,
      pageToken: parsed.page_token,
      signal: input.signal,
    }),
  );
}

async function executeBitableListFields(input: FeishuToolExecutionInput): Promise<string> {
  const parsed = feishuBitableTableInputSchema.parse(input.rawInput);
  const { service } = requireFeishuToolService(input.sessionId, parsed);
  if (!service.listBitableFields)
    throw new Error('Current Feishu channel does not support Bitable.');
  return JSON.stringify(
    await service.listBitableFields({
      appToken: parsed.app_token,
      tableId: parsed.table_id,
      pageSize: parsed.page_size,
      pageToken: parsed.page_token,
      signal: input.signal,
    }),
  );
}

async function executeBitableGetRecords(input: FeishuToolExecutionInput): Promise<string> {
  const parsed = feishuBitableGetRecordsInputSchema.parse(input.rawInput);
  const { service } = requireFeishuToolService(input.sessionId, parsed);
  if (!service.getBitableRecords)
    throw new Error('Current Feishu channel does not support Bitable.');
  return JSON.stringify(
    await service.getBitableRecords({
      appToken: parsed.app_token,
      tableId: parsed.table_id,
      filter: parsed.filter,
      pageSize: parsed.page_size,
      pageToken: parsed.page_token,
      signal: input.signal,
    }),
  );
}

async function executeBitableCreateRecords(input: FeishuToolExecutionInput): Promise<string> {
  const parsed = feishuBitableRecordsInputSchema.parse(input.rawInput);
  const { service } = requireFeishuToolService(input.sessionId, parsed);
  if (!service.createBitableRecords)
    throw new Error('Current Feishu channel does not support Bitable.');
  return JSON.stringify(
    await service.createBitableRecords({
      appToken: parsed.app_token,
      tableId: parsed.table_id,
      records: parsed.records,
      signal: input.signal,
    }),
  );
}

async function executeBitableUpdateRecords(input: FeishuToolExecutionInput): Promise<string> {
  const parsed = feishuBitableRecordsInputSchema.parse(input.rawInput);
  const { service } = requireFeishuToolService(input.sessionId, parsed);
  if (!service.updateBitableRecords)
    throw new Error('Current Feishu channel does not support Bitable.');
  return JSON.stringify(
    await service.updateBitableRecords({
      appToken: parsed.app_token,
      tableId: parsed.table_id,
      records: parsed.records,
      signal: input.signal,
    }),
  );
}

async function executeBitableDeleteRecords(input: FeishuToolExecutionInput): Promise<string> {
  const parsed = feishuBitableDeleteRecordsInputSchema.parse(input.rawInput);
  const { service } = requireFeishuToolService(input.sessionId, parsed);
  if (!service.deleteBitableRecords)
    throw new Error('Current Feishu channel does not support Bitable.');
  return JSON.stringify(
    await service.deleteBitableRecords({
      appToken: parsed.app_token,
      tableId: parsed.table_id,
      recordIds: parsed.record_ids,
      signal: input.signal,
    }),
  );
}
