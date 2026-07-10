import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { extractMessageText } from '../session/session-message-store.js';
import { runSessionInBackground } from '../routes/stream-runtime.js';
import { AutoReplyPipeline } from './auto-reply.js';
import { recordChannelMessage } from './channel-message-cache.js';
import { buildChannelSessionKey, upsertChannelSession } from './channel-session-store.js';
import {
  compactChannelConversation,
  getChannelUsageStats,
  resetChannelConversation,
} from './channel-sessions.js';
import { listChannelConversations } from './channel-conversations.js';
import { createPartialTextQueue } from './partial-text-queue.js';
import { resolveSendableChannel } from './channel-access.js';
import { registerChannelInboundRoutes } from './channel-inbound-route.js';
import { CHANNEL_DESCRIPTORS } from './descriptors.js';
import { createDingTalkService } from './dingtalk.js';
import { discordFactory } from './discord.js';
import { createFeishuService } from './feishu.js';
import { channelManager } from './manager.js';
import { registerWeixinLoginRoutes } from './weixin-login-route.js';
import { slackFactory } from './slack.js';
import { telegramFactory } from './telegram.js';
import { weComFactory } from './wecom.js';
import { weixinFactory } from './weixin.js';
import { whatsAppFactory } from './whatsapp.js';
import { qqFactory } from './qq.js';
import { shouldHandleChannelEvent } from './subscription-filter.js';
import type { ChannelDiagnostics, ChannelEvent, ChannelInstance } from './types.js';
import { channelLogInfo, summarizeChannelEvent } from './channel-log.js';
import {
  parseDingTalkInboundMessage,
  parseDiscordInboundMessage,
  parseFeishuInboundMessage,
  parseQQInboundMessage,
  parseTelegramInboundMessage,
  parseWeComInboundMessage,
  parseWeixinInboundMessage,
  parseWhatsAppInboundMessage,
} from './inbound-parsers.js';
import {
  channelCreateSchema,
  channelUpdateSchema,
  createChannelInstance,
  materializeStoredChannels,
} from './channel-config.js';

interface UserSettingRow {
  user_id?: string;
  value: string;
}

const CHANNELS_SETTINGS_KEY = 'channels';
const channels = new Map<string, ChannelInstance>();
const channelSendBodySchema = z.object({
  chatId: z.string().min(1),
  content: z.string().min(1),
});
const channelConversationsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});
const channelRouteParamsSchema = z.object({
  id: z.string().min(1),
});

channelManager.registerFactory('telegram', telegramFactory);
channelManager.registerParser('telegram', parseTelegramInboundMessage);
channelManager.registerFactory('discord', discordFactory);
channelManager.registerParser('discord', parseDiscordInboundMessage);
channelManager.registerFactory('slack', slackFactory);
channelManager.registerFactory('wecom', weComFactory);
channelManager.registerParser('wecom', parseWeComInboundMessage);
channelManager.registerFactory('weixin', weixinFactory);
channelManager.registerParser('weixin', parseWeixinInboundMessage);
channelManager.registerFactory('whatsapp', whatsAppFactory);
channelManager.registerParser('whatsapp', parseWhatsAppInboundMessage);
channelManager.registerFactory('qq', qqFactory);
channelManager.registerParser('qq', parseQQInboundMessage);
channelManager.registerFactory('feishu', (instance, notify) =>
  createFeishuService(instance, notify),
);
channelManager.registerParser('feishu', parseFeishuInboundMessage);
channelManager.registerFactory('dingtalk', (instance, notify) =>
  createDingTalkService(instance, notify),
);
channelManager.registerParser('dingtalk', parseDingTalkInboundMessage);

const autoReply = new AutoReplyPipeline({
  resolveChannel: (pluginId: string) => channels.get(pluginId),
  commandActions: {
    compactConversation: compactChannelConversation,
    getUsageStats: getChannelUsageStats,
    resetConversation: resetChannelConversation,
  },
  onAgentRun: async ({ message, pluginId, chatId, messageId, onPartialText }) => {
    const channel = channels.get(pluginId);
    if (!channel?.ownerUserId) {
      throw new Error('Channel owner is missing for auto reply session');
    }

    const sessionId = upsertChannelSession({
      chatId,
      channel,
      currentMessageId: messageId,
      sessionKey: buildChannelSessionKey(pluginId, chatId),
      userId: channel.ownerUserId,
    });
    const clientRequestId = randomUUID();
    let partialText = '';
    // 部分更新是装饰性的流式中间态，失败绝不能回退一次已成功完成的运行。
    // 串行队列内部已吞掉单次失败，flush() 恒 resolve。详见 partial-text-queue.ts。
    const partialUpdates = createPartialTextQueue({
      onPartialText,
      onError: (err) => {
        console.warn('[channels] 部分流式更新发送失败（忽略，不影响最终回复）', {
          pluginId,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    });

    const result = await runSessionInBackground({
      sessionId,
      userId: channel.ownerUserId,
      requestData: {
        clientRequestId,
        displayMessage: message,
        message,
      },
      writeChunk: (chunk) => {
        if (chunk.type !== 'text_delta') {
          return;
        }

        partialText += chunk.delta;
        partialUpdates.push(partialText);
      },
    });

    await partialUpdates.flush();

    const latestAssistantMessage = listSessionMessagesV2({
      sessionId,
      userId: channel.ownerUserId,
    })
      .filter((entry) => entry.role === 'assistant')
      .at(-1);
    const assistantText = extractMessageText(latestAssistantMessage) || partialText.trim();

    if (assistantText.length > 0) {
      return assistantText;
    }

    if (result.statusCode >= 400) {
      throw new Error(`Channel session ${sessionId} failed with status ${result.statusCode}`);
    }

    return '已处理消息，但没有生成可发送的文本回复。';
  },
});

function notifyChannel(event: ChannelEvent): void {
  const channel = channels.get(event.pluginId);
  channelLogInfo('notify channel event', summarizeChannelEvent(event));
  if (event.type === 'message') {
    recordChannelMessage(event.pluginId, event.message);
  }

  if (!shouldHandleChannelEvent(channel, event)) {
    channelLogInfo('channel event filtered by subscription/settings', summarizeChannelEvent(event));
    return;
  }

  void autoReply.handle(event);
}

const parseStoredJson = (value: string | undefined): unknown => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const readStoredChannels = (userId: string): ChannelInstance[] => {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [userId, CHANNELS_SETTINGS_KEY],
  );
  return materializeStoredChannels(parseStoredJson(row?.value), userId);
};

const writeStoredChannels = (userId: string, nextChannels: ChannelInstance[]): void => {
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, CHANNELS_SETTINGS_KEY, JSON.stringify(nextChannels)],
  );
};

const syncChannelCache = (userId: string, nextChannels: ChannelInstance[]): void => {
  const nextIds = new Set(nextChannels.map((channel) => channel.id));
  for (const [id, channel] of channels.entries()) {
    if (channel.ownerUserId === userId && !nextIds.has(id)) {
      channels.delete(id);
    }
  }

  for (const channel of nextChannels) {
    channels.set(channel.id, channel);
  }
};

const resolveUserChannels = (userId: string): ChannelInstance[] => {
  const storedChannels = readStoredChannels(userId);
  syncChannelCache(userId, storedChannels);
  return storedChannels;
};

function resolveAnyChannel(channelId: string): ChannelInstance | null {
  const cached = channels.get(channelId);
  if (cached) {
    return cached;
  }

  const rows = sqliteAll<UserSettingRow>(`SELECT user_id, value FROM user_settings WHERE key = ?`, [
    CHANNELS_SETTINGS_KEY,
  ]);
  for (const row of rows) {
    if (!row.user_id) {
      continue;
    }
    const storedChannels = materializeStoredChannels(parseStoredJson(row.value), row.user_id);
    syncChannelCache(row.user_id, storedChannels);
    const found = storedChannels.find((channel) => channel.id === channelId);
    if (found) {
      return found;
    }
  }

  return null;
}

const toConnectionStatus = (channelId: string): 'connected' | 'disconnected' | 'error' => {
  const status = channelManager.getStatus(channelId);
  if (status === 'running') {
    return 'connected';
  }

  if (status === 'error') {
    return 'error';
  }

  return 'disconnected';
};

const serializeChannel = (
  instance: ChannelInstance,
  options?: {
    errorMessage?: string;
    statusOverride?: 'connected' | 'disconnected' | 'error';
  },
): ChannelInstance & {
  diagnostics: ChannelDiagnostics;
  errorMessage?: string;
  status: 'connected' | 'disconnected' | 'error';
} => ({
  ...instance,
  diagnostics: channelManager.getDiagnostics(instance.id),
  status: options?.statusOverride ?? toConnectionStatus(instance.id),
  ...(options?.errorMessage ? { errorMessage: options.errorMessage } : {}),
});

export async function autoStartConfiguredChannels(
  onError?: (channel: ChannelInstance, error: unknown) => void,
): Promise<void> {
  const rows = sqliteAll<UserSettingRow>(`SELECT user_id, value FROM user_settings WHERE key = ?`, [
    CHANNELS_SETTINGS_KEY,
  ]);

  for (const row of rows) {
    const userId = row.user_id;
    if (!userId) {
      continue;
    }

    const storedChannels = materializeStoredChannels(parseStoredJson(row.value), userId);
    syncChannelCache(userId, storedChannels);

    for (const channel of storedChannels) {
      if (!channel.enabled || !channel.features?.autoStart) {
        continue;
      }

      try {
        await channelManager.startPlugin(channel, notifyChannel);
      } catch (error) {
        onError?.(channel, error);
      }
    }
  }
}

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  await registerWeixinLoginRoutes(app);
  await registerChannelInboundRoutes(app, {
    resolveChannel: resolveAnyChannel,
    parseMessage: (type, raw) => channelManager.parseMessage(type, raw),
    notifyChannel,
    recordInboundDiagnostic: (input) => channelManager.recordInboundDiagnostic(input),
  });

  app.get(
    '/channels/descriptors',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'channel.list-descriptors');
      step.succeed(undefined, { count: CHANNEL_DESCRIPTORS.length });
      return reply.send({ descriptors: CHANNEL_DESCRIPTORS });
    },
  );

  app.get(
    '/channels',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'channel.list');
      const user = request.user as JwtPayload;
      const list = resolveUserChannels(user.sub).map((channel) => serializeChannel(channel));
      step.succeed(undefined, { count: list.length });
      return reply.send({ channels: list });
    },
  );

  app.post(
    '/channels',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'channel.create');
      const user = request.user as JwtPayload;
      const body = channelCreateSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: body.error.issues });
      }

      const stored = resolveUserChannels(user.sub);
      const instance = createChannelInstance({ ...body.data, id: undefined }, user.sub);
      const nextChannels = [...stored, instance];
      writeStoredChannels(user.sub, nextChannels);
      syncChannelCache(user.sub, nextChannels);

      let startErrorMessage: string | undefined;
      if (instance.enabled && instance.features?.autoStart) {
        try {
          await channelManager.startPlugin(instance, notifyChannel);
        } catch (error) {
          startErrorMessage = error instanceof Error ? error.message : String(error);
        }
      }

      step.succeed(undefined, { channelId: instance.id });
      return reply.status(201).send({
        channel: serializeChannel(instance, {
          errorMessage: startErrorMessage,
          statusOverride: startErrorMessage ? 'error' : undefined,
        }),
      });
    },
  );

  app.put(
    '/channels/:id',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step } = startRequestWorkflow(request, 'channel.update', undefined, {
        channelId: id,
      });
      const user = request.user as JwtPayload;
      const body = channelUpdateSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: body.error.issues });
      }

      const stored = resolveUserChannels(user.sub);
      const existing = stored.find((channel) => channel.id === id);
      if (!existing) {
        step.fail('channel not found');
        return reply.status(404).send({ error: 'Channel not found' });
      }

      const nextInstance = createChannelInstance({ ...body.data, id }, user.sub, existing);
      const nextChannels = stored.map((channel) => (channel.id === id ? nextInstance : channel));
      writeStoredChannels(user.sub, nextChannels);
      syncChannelCache(user.sub, nextChannels);

      const isRunning = channelManager.getStatus(id) === 'running';
      let updateErrorMessage: string | undefined;
      if (!nextInstance.enabled) {
        try {
          await channelManager.stopPlugin(id);
        } catch (error) {
          updateErrorMessage = error instanceof Error ? error.message : String(error);
        }
      } else if (isRunning) {
        try {
          await channelManager.restartPlugin(nextInstance, notifyChannel);
        } catch (error) {
          updateErrorMessage = error instanceof Error ? error.message : String(error);
        }
      }

      step.succeed(undefined, { channelId: id });
      return reply.send({
        channel: serializeChannel(nextInstance, {
          errorMessage: updateErrorMessage,
          statusOverride: updateErrorMessage ? 'error' : undefined,
        }),
      });
    },
  );

  app.post(
    '/channels/:id/start',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step } = startRequestWorkflow(request, 'channel.start', undefined, { channelId: id });
      const user = request.user as JwtPayload;
      const instance = resolveUserChannels(user.sub).find((channel) => channel.id === id);
      if (!instance) {
        step.fail('channel not found');
        return reply.status(404).send({ error: 'Channel not found' });
      }
      await channelManager.startPlugin(instance, notifyChannel);
      step.succeed(undefined, { channelId: id });
      return reply.send({ status: toConnectionStatus(instance.id) });
    },
  );

  app.get(
    '/channels/:id/diagnostics',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = channelRouteParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({ error: 'Invalid channel id' });
      }

      const { id } = parsedParams.data;
      const { step } = startRequestWorkflow(request, 'channel.diagnostics', undefined, {
        channelId: id,
      });
      const user = request.user as JwtPayload;
      const instance = resolveUserChannels(user.sub).find((channel) => channel.id === id);
      if (!instance) {
        step.fail('channel not found');
        return reply.status(404).send({ error: 'Channel not found' });
      }

      const diagnostics = channelManager.getDiagnostics(id);
      step.succeed(undefined, { channelId: id, status: diagnostics.status });
      return reply.send({ diagnostics });
    },
  );

  app.post(
    '/channels/:id/stop',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step } = startRequestWorkflow(request, 'channel.stop', undefined, { channelId: id });
      const user = request.user as JwtPayload;
      const instance = resolveUserChannels(user.sub).find((channel) => channel.id === id);
      if (!instance) {
        step.fail('channel not found');
        return reply.status(404).send({ error: 'Channel not found' });
      }

      await channelManager.stopPlugin(id);
      step.succeed(undefined, { channelId: id });
      return reply.send({ status: 'disconnected' });
    },
  );

  app.get(
    '/channels/:id/groups',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step } = startRequestWorkflow(request, 'channel.list-groups', undefined, {
        channelId: id,
      });
      const user = request.user as JwtPayload;
      const instance = resolveUserChannels(user.sub).find((channel) => channel.id === id);
      if (!instance) {
        step.fail('channel not found');
        return reply.status(404).send({ error: 'Channel not found' });
      }

      const service = channelManager.getService(id);
      const isRunning = channelManager.getStatus(id) === 'running' && Boolean(service?.isRunning());
      if (!isRunning || !service) {
        step.fail('channel service not running');
        return reply.status(409).send({ error: 'Channel service not running' });
      }

      const groups = await service.listGroups();
      step.succeed(undefined, { channelId: id, count: groups.length });
      return reply.send({ groups });
    },
  );

  app.get(
    '/channels/:id/conversations',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = channelRouteParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({ error: 'Invalid channel id' });
      }

      const { id } = parsedParams.data;
      const { step } = startRequestWorkflow(request, 'channel.list-conversations', undefined, {
        channelId: id,
      });
      const parsedQuery = channelConversationsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: parsedQuery.error.issues });
      }

      const user = request.user as JwtPayload;
      const instance = resolveUserChannels(user.sub).find((channel) => channel.id === id);
      if (!instance) {
        step.fail('channel not found');
        return reply.status(404).send({ error: 'Channel not found' });
      }

      const conversations = listChannelConversations({
        channel: instance,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        userId: user.sub,
      });
      step.succeed(undefined, { channelId: id, count: conversations.length });
      return reply.send({ conversations });
    },
  );

  app.delete(
    '/channels/:id',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step } = startRequestWorkflow(request, 'channel.delete', undefined, {
        channelId: id,
      });
      const user = request.user as JwtPayload;
      const stored = resolveUserChannels(user.sub);
      const existing = stored.find((channel) => channel.id === id);
      if (!existing) {
        step.fail('channel not found');
        return reply.status(404).send({ error: 'Channel not found' });
      }

      await channelManager.stopPlugin(id);
      const nextChannels = stored.filter((channel) => channel.id !== id);
      writeStoredChannels(user.sub, nextChannels);
      syncChannelCache(user.sub, nextChannels);
      step.succeed(undefined, { channelId: id });
      return reply.status(204).send();
    },
  );

  app.post(
    '/channels/:id/send',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step } = startRequestWorkflow(request, 'channel.send', undefined, { channelId: id });
      const user = request.user as JwtPayload;
      const parsedBody = channelSendBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: parsedBody.error.issues });
      }

      const stored = resolveUserChannels(user.sub);
      const service = channelManager.getService(id);
      const isRunning = channelManager.getStatus(id) === 'running' && Boolean(service?.isRunning());
      const resolved = resolveSendableChannel(stored, id, isRunning);
      if (!resolved.ok) {
        step.fail(resolved.error);
        return reply.status(resolved.statusCode).send({ error: resolved.error });
      }

      if (!service) {
        step.fail('channel service not running');
        return reply.status(409).send({ error: 'Channel service not running' });
      }

      channelLogInfo('manual channel send requested', {
        channelId: id,
        chatId: parsedBody.data.chatId,
        contentLength: parsedBody.data.content.length,
      });
      const result = await service.sendMessage(parsedBody.data.chatId, parsedBody.data.content);
      channelLogInfo('manual channel send completed', {
        channelId: id,
        chatId: parsedBody.data.chatId,
        messageId: result.messageId,
      });
      step.succeed(undefined, { channelId: id });
      return reply.send(result);
    },
  );
}
