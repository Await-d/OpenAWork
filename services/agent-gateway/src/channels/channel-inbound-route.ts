import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ChannelEvent, ChannelInstance, ChannelMessage } from './types.js';
import {
  getQQBotSecret,
  isAuthorizedQQWebhookRequest,
  readQQWebhookValidation,
  signQQWebhookValidation,
} from './qq-webhook.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const channelInboundParamsSchema = z.object({
  id: z.string().min(1),
});

const channelInboundQuerySchema = z.object({
  secret: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().optional(),
});

type ChannelInboundQuery = z.infer<typeof channelInboundQuerySchema>;

interface ChannelInboundRouteDeps {
  readonly resolveChannel: (channelId: string) => ChannelInstance | null;
  readonly parseMessage: (
    type: ChannelInstance['type'],
    raw: unknown,
    channel: ChannelInstance,
  ) => ChannelMessage | null;
  readonly notifyChannel: (event: ChannelEvent) => void;
  readonly recordInboundDiagnostic?: (input: {
    readonly pluginId: string;
    readonly accepted: boolean;
    readonly eventType?: string;
    readonly error?: string;
    readonly message?: { readonly chatId: string };
  }) => void;
}

function readHeaderValue(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' ? value : null;
}

function parseJsonBodyPreservingRawBody(body: Buffer): unknown {
  if (body.length === 0) {
    return null;
  }
  return JSON.parse(body.toString('utf-8')) as unknown;
}

function getChannelInboundSecret(channel: ChannelInstance): string | null {
  return (
    channel.config['inboundSecret'] ||
    channel.config['webhookSecret'] ||
    channel.config['verifyToken'] ||
    channel.config['verificationToken'] ||
    channel.config['secret'] ||
    null
  );
}

function isSameSecret(expected: string, provided: string | null | undefined): boolean {
  if (!provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function isAuthorizedInboundRequest(input: {
  readonly channel: ChannelInstance;
  readonly request: FastifyRequest;
  readonly query: ChannelInboundQuery;
}): boolean {
  const expected = getChannelInboundSecret(input.channel);
  if (!expected) {
    return false;
  }

  return (
    isSameSecret(expected, readHeaderValue(input.request, 'x-openawork-channel-secret')) ||
    isSameSecret(expected, input.query.secret) ||
    isSameSecret(expected, input.query.token)
  );
}

function readInboundEventType(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  const eventType = Object.entries(body).find(([key]) => key === 't')?.[1];
  return typeof eventType === 'string' && eventType.length > 0 ? eventType : undefined;
}

function parseInboundParams(
  request: FastifyRequest,
  reply: FastifyReply,
): z.infer<typeof channelInboundParamsSchema> | null {
  const parsedParams = channelInboundParamsSchema.safeParse(request.params);
  if (!parsedParams.success) {
    void reply.status(400).send({ error: 'Invalid channel id' });
    return null;
  }
  return parsedParams.data;
}

function parseInboundQuery(
  request: FastifyRequest,
  reply: FastifyReply,
): ChannelInboundQuery | null {
  const parsedQuery = channelInboundQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    void reply.status(400).send({ error: 'Invalid input', issues: parsedQuery.error.issues });
    return null;
  }
  return parsedQuery.data;
}

export async function registerChannelInboundRoutes(
  app: FastifyInstance,
  deps: ChannelInboundRouteDeps,
): Promise<void> {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request: FastifyRequest, body: Buffer, done) => {
      request.rawBody = body;

      try {
        done(null, parseJsonBodyPreservingRawBody(body));
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)), undefined);
      }
    },
  );

  app.get('/channels/:id/inbound', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = parseInboundParams(request, reply);
    if (!params) {
      return reply;
    }

    const query = parseInboundQuery(request, reply);
    if (!query) {
      return reply;
    }

    const channel = deps.resolveChannel(params.id);
    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    const challenge = query['hub.challenge'];
    const isMetaVerification =
      query['hub.mode'] === 'subscribe' &&
      isSameSecret(getChannelInboundSecret(channel) ?? '', query['hub.verify_token']);
    const isGenericVerification = isAuthorizedInboundRequest({ channel, request, query });

    if (!isMetaVerification && !isGenericVerification) {
      return reply.status(403).send({ error: 'Invalid channel inbound secret' });
    }

    if (challenge) {
      return reply.type('text/plain').send(challenge);
    }

    return reply.send({ ok: true });
  });

  app.post('/channels/:id/inbound', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = parseInboundParams(request, reply);
    if (!params) {
      return reply;
    }

    const query = parseInboundQuery(request, reply);
    if (!query) {
      return reply;
    }

    const channel = deps.resolveChannel(params.id);
    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    if (!channel.enabled) {
      return reply.status(409).send({ error: 'Channel is disabled' });
    }

    if (channel.type === 'qq') {
      const rawBody = request.rawBody ?? null;
      const appIdHeader = readHeaderValue(request, 'x-bot-appid');
      const isAuthorized = isAuthorizedQQWebhookRequest({
        appIdHeader,
        body: request.body,
        channel,
        rawBody,
        signature: readHeaderValue(request, 'x-signature-ed25519'),
        timestamp: readHeaderValue(request, 'x-signature-timestamp'),
      });
      if (!isAuthorized) {
        deps.recordInboundDiagnostic?.({
          pluginId: channel.id,
          accepted: false,
          eventType: readInboundEventType(request.body),
          error: 'Invalid QQ webhook signature',
        });
        return reply.status(403).send({ error: 'Invalid QQ webhook signature' });
      }

      const validation = readQQWebhookValidation(request.body);
      if (validation) {
        deps.recordInboundDiagnostic?.({
          pluginId: channel.id,
          accepted: true,
          eventType: 'QQ_WEBHOOK_VALIDATION',
        });
        return reply.send({
          plain_token: validation.plainToken,
          signature: signQQWebhookValidation({
            botSecret: getQQBotSecret(channel),
            eventTimestamp: validation.eventTimestamp,
            plainToken: validation.plainToken,
          }),
        });
      }

      const message = deps.parseMessage(channel.type, request.body, channel);
      if (message) {
        deps.recordInboundDiagnostic?.({
          pluginId: channel.id,
          accepted: true,
          eventType: readInboundEventType(request.body),
          message,
        });
        deps.notifyChannel({ type: 'message', pluginId: channel.id, message });
      } else {
        deps.recordInboundDiagnostic?.({
          pluginId: channel.id,
          accepted: false,
          eventType: readInboundEventType(request.body),
          error: 'Ignored QQ webhook event',
        });
      }
      return reply.status(202).send({ op: 12 });
    }

    if (!isAuthorizedInboundRequest({ channel, request, query })) {
      deps.recordInboundDiagnostic?.({
        pluginId: channel.id,
        accepted: false,
        error: 'Invalid channel inbound secret',
      });
      return reply.status(403).send({ error: 'Invalid channel inbound secret' });
    }

    const message = deps.parseMessage(channel.type, request.body, channel);
    if (!message) {
      deps.recordInboundDiagnostic?.({
        pluginId: channel.id,
        accepted: false,
        error: 'Ignored inbound event',
      });
      return reply.status(202).send({ accepted: false, reason: 'ignored' });
    }

    deps.recordInboundDiagnostic?.({
      pluginId: channel.id,
      accepted: true,
      message,
    });
    deps.notifyChannel({ type: 'message', pluginId: channel.id, message });
    return reply.status(202).send({ accepted: true });
  });
}
