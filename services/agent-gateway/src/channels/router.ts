import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { extractMessageText, listSessionMessages } from '../session-message-store.js';
import { parseSessionMetadataJson } from '../session-workspace-metadata.js';
import { runSessionInBackground } from '../routes/stream.js';
import { AutoReplyPipeline } from './auto-reply.js';
import { resolveSendableChannel } from './channel-access.js';
import { CHANNEL_DESCRIPTORS } from './descriptors.js';
import { createDingTalkService } from './dingtalk.js';
import { discordFactory } from './discord.js';
import { createFeishuService } from './feishu.js';
import { channelManager } from './manager.js';
import { slackFactory } from './slack.js';
import { telegramFactory } from './telegram.js';
import { weComFactory } from './wecom.js';
import { whatsAppFactory } from './whatsapp.js';
import { qqFactory } from './qq.js';
import { shouldHandleChannelEvent } from './subscription-filter.js';
import type { ChannelEvent, ChannelInstance } from './types.js';
import {
  channelCreateSchema,
  channelUpdateSchema,
  createChannelInstance,
  materializeStoredChannels,
} from '../channel-config.js';

interface UserSettingRow {
  user_id?: string;
  value: string;
}

interface ReusableSessionRow {
  id: string;
  metadata_json: string;
}

const CHANNELS_SETTINGS_KEY = 'channels';
const channels = new Map<string, ChannelInstance>();
const channelSendBodySchema = z.object({
  chatId: z.string().min(1),
  content: z.string().min(1),
});

function buildChannelSessionMetadata(
  channel: ChannelInstance,
  currentMetadata: Record<string, unknown> = {},
): Record<string, unknown> {
  const nextMetadata: Record<string, unknown> = {
    ...currentMetadata,
    source: 'channel',
    webSearchEnabled: channel.tools?.['web_search'] === true,
    taskToolEnabled:
      channel.tools?.['task'] === true && (channel.permissions?.allowSubAgents ?? true),
    questionToolEnabled: false,
    channel: {
      id: channel.id,
      type: channel.type,
      name: channel.name,
      providerId: channel.providerId ?? null,
      model: channel.model ?? null,
      permissions: channel.permissions ?? null,
      tools: channel.tools ?? {},
    },
  };

  if (channel.providerId) {
    nextMetadata['providerId'] = channel.providerId;
  } else {
    delete nextMetadata['providerId'];
  }

  if (channel.model) {
    nextMetadata['modelId'] = channel.model;
  } else {
    delete nextMetadata['modelId'];
  }

  return nextMetadata;
}

function findReusableChannelSession(userId: string, sessionKey: string): ReusableSessionRow | null {
  const idleSession = sqliteGet<ReusableSessionRow>(
    `SELECT id, metadata_json
     FROM sessions
     WHERE user_id = ? AND title = ? AND state_status = 'idle'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, sessionKey],
  );
  if (idleSession) {
    return idleSession;
  }

  return (
    sqliteGet<ReusableSessionRow>(
      `SELECT id, metadata_json
     FROM sessions
     WHERE user_id = ? AND title = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
      [userId, sessionKey],
    ) ?? null
  );
}

function upsertChannelSession(input: {
  channel: ChannelInstance;
  sessionKey: string;
  userId: string;
}): string {
  const existingSession = findReusableChannelSession(input.userId, input.sessionKey);
  const nextMetadata = buildChannelSessionMetadata(
    input.channel,
    parseSessionMetadataJson(existingSession?.metadata_json ?? '{}'),
  );

  if (existingSession) {
    sqliteRun(
      "UPDATE sessions SET title = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [input.sessionKey, JSON.stringify(nextMetadata), existingSession.id, input.userId],
    );
    return existingSession.id;
  }

  const sessionId = randomUUID();
  sqliteRun(
    'INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, input.userId, input.sessionKey, '[]', 'idle', JSON.stringify(nextMetadata)],
  );
  return sessionId;
}

channelManager.registerFactory('telegram', telegramFactory);
channelManager.registerFactory('discord', discordFactory);
channelManager.registerFactory('slack', slackFactory);
channelManager.registerFactory('wecom', weComFactory);
channelManager.registerFactory('whatsapp', whatsAppFactory);
channelManager.registerFactory('qq', qqFactory);
channelManager.registerFactory('feishu', (instance, notify) =>
  createFeishuService(instance, notify),
);
channelManager.registerFactory('dingtalk', (instance, notify) =>
  createDingTalkService(instance, notify),
);

const autoReply = new AutoReplyPipeline({
  resolveChannel: (pluginId: string) => channels.get(pluginId),
  onAgentRun: async ({ sessionKey, message, pluginId, onPartialText }) => {
    const channel = channels.get(pluginId);
    if (!channel?.ownerUserId) {
      throw new Error('Channel owner is missing for auto reply session');
    }

    const sessionId = upsertChannelSession({
      channel,
      sessionKey,
      userId: channel.ownerUserId,
    });
    const clientRequestId = randomUUID();
    let partialText = '';
    let partialUpdateQueue = Promise.resolve();

    const pushPartialText = (text: string): void => {
      if (!onPartialText || text.trim().length === 0) {
        return;
      }

      partialUpdateQueue = partialUpdateQueue
        .catch(() => undefined)
        .then(async () => {
          await onPartialText(text);
        });
    };

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
        pushPartialText(partialText);
      },
    });

    await partialUpdateQueue;

    const latestAssistantMessage = listSessionMessages({
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
  if (!shouldHandleChannelEvent(channel, event)) {
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
  errorMessage?: string;
  status: 'connected' | 'disconnected' | 'error';
} => ({
  ...instance,
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

      const result = await service.sendMessage(parsedBody.data.chatId, parsedBody.data.content);
      step.succeed(undefined, { channelId: id });
      return reply.send(result);
    },
  );
}
