import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ChannelEvent, ChannelInstance, ChannelMessage } from './types.js';

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
  ) => ChannelMessage | null;
  readonly notifyChannel: (event: ChannelEvent) => void;
}

function readHeaderValue(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' ? value : null;
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

function parseInboundQuery(request: FastifyRequest, reply: FastifyReply): ChannelInboundQuery | null {
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

    if (!isAuthorizedInboundRequest({ channel, request, query })) {
      return reply.status(403).send({ error: 'Invalid channel inbound secret' });
    }

    const message = deps.parseMessage(channel.type, request.body);
    if (!message) {
      return reply.status(202).send({ accepted: false, reason: 'ignored' });
    }

    deps.notifyChannel({ type: 'message', pluginId: channel.id, message });
    return reply.status(202).send({ accepted: true });
  });
}
