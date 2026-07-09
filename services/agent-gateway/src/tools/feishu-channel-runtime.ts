import type { MessagingChannelService } from '../channels/types.js';
import { assertChannelContext, requireChannelService } from './channel-tool-runtime.js';

export interface FeishuToolServiceContext {
  readonly ctx: { readonly chatId: string; readonly pluginId: string };
  readonly service: MessagingChannelService;
}

export interface FeishuToolInput {
  readonly chat_id?: string;
  readonly plugin_id?: string;
}

export function requireFeishuToolService(
  sessionId: string,
  requested: FeishuToolInput,
): FeishuToolServiceContext {
  const ctx = assertChannelContext(sessionId, requested);
  const service = requireChannelService(ctx.pluginId);
  if (service.pluginType !== 'feishu') {
    throw new Error('This tool can only run inside a Feishu channel session.');
  }
  return { ctx, service };
}
