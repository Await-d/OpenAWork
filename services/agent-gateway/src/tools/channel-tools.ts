import { FEISHU_TOOL_NAME_SET } from './feishu-channel-tool-definitions.js';
import { executeFeishuChannelTool } from './feishu-channel-tools.js';
import {
  assertChannelContext,
  buildChannelReplyReference,
  readChannelMedia,
  requireChannelService,
  serializeChannelMessages,
} from './channel-tool-runtime.js';
import {
  pluginListGroupsInputSchema,
  pluginMessageInputSchema,
  pluginMessagesInputSchema,
  pluginReplyInputSchema,
  weixinMediaInputSchema,
  type WeixinMediaInput,
} from './channel-tool-definitions.js';

export { CHANNEL_TOOL_DEFINITIONS, CHANNEL_TOOL_NAME_SET } from './channel-tool-definitions.js';

export async function executeChannelTool(input: {
  readonly rawInput: unknown;
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly toolName: string;
}): Promise<string> {
  switch (input.toolName) {
    case 'PluginSendMessage': {
      const parsed = pluginMessageInputSchema.parse(input.rawInput);
      const ctx = assertChannelContext(input.sessionId, parsed);
      const service = requireChannelService(ctx.pluginId);
      return JSON.stringify(await service.sendMessage(ctx.chatId, parsed.content));
    }
    case 'PluginReplyMessage': {
      const parsed = pluginReplyInputSchema.parse(input.rawInput);
      const ctx = assertChannelContext(input.sessionId, parsed);
      const service = requireChannelService(ctx.pluginId);
      return JSON.stringify(
        await service.replyMessage(
          buildChannelReplyReference(ctx, parsed.message_id),
          parsed.content,
        ),
      );
    }
    case 'PluginSendImage':
      return executeChannelMediaTool(input, weixinMediaInputSchema.parse(input.rawInput), 'image');
    case 'PluginGetGroupMessages':
    case 'PluginSummarizeGroup':
    case 'PluginGetCurrentChatMessages': {
      const parsed = pluginMessagesInputSchema.parse(input.rawInput);
      const ctx = assertChannelContext(input.sessionId, parsed);
      const service = requireChannelService(ctx.pluginId);
      return serializeChannelMessages(
        await service.getGroupMessages(ctx.chatId, parsed.count),
        ctx,
      );
    }
    case 'PluginListGroups': {
      const parsed = pluginListGroupsInputSchema.parse(input.rawInput);
      const ctx = assertChannelContext(input.sessionId, parsed);
      const service = requireChannelService(ctx.pluginId);
      return JSON.stringify(await service.listGroups());
    }
    case 'WeixinSendImage':
      return executeChannelMediaTool(input, weixinMediaInputSchema.parse(input.rawInput), 'image');
    case 'WeixinSendFile':
      return executeChannelMediaTool(input, weixinMediaInputSchema.parse(input.rawInput), 'file');
    default:
      if (FEISHU_TOOL_NAME_SET.has(input.toolName)) {
        return executeFeishuChannelTool(input);
      }
      throw new Error(`Unsupported channel tool: ${input.toolName}`);
  }
}

async function executeChannelMediaTool(
  input: { readonly sessionId: string; readonly signal: AbortSignal },
  parsed: WeixinMediaInput,
  kind: 'file' | 'image',
): Promise<string> {
  const ctx = assertChannelContext(input.sessionId, parsed);
  const service = requireChannelService(ctx.pluginId);
  const media = await readChannelMedia({
    filePath: parsed.file_path,
    sessionId: input.sessionId,
    signal: input.signal,
  });
  const textInput = parsed.content ? { text: parsed.content } : {};
  if (kind === 'image') {
    if (!service?.sendImage) throw new Error('Current channel does not support image sending.');
    if (service.replyImage && ctx.pluginType === 'qq' && ctx.currentMessageId) {
      return JSON.stringify(
        await service.replyImage(ctx.currentMessageId, {
          ...media,
          ...textInput,
          signal: input.signal,
        }),
      );
    }
    return JSON.stringify(
      await service.sendImage(ctx.chatId, { ...media, ...textInput, signal: input.signal }),
    );
  }
  if (!service?.sendFile) throw new Error('Current channel does not support file sending.');
  return JSON.stringify(
    await service.sendFile(ctx.chatId, { ...media, ...textInput, signal: input.signal }),
  );
}
