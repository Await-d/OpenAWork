import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import {
  listNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_PREFERENCE_CHANNELS,
  NOTIFICATION_PREFERENCE_EVENT_TYPES,
  upsertNotificationPreferences,
} from '../session/notification-store.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';

const notificationsQuerySchema = z.object({
  limit: z
    .preprocess((value) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        return Number(value);
      }
      return value;
    }, z.number().int().min(1).max(50).optional())
    .default(20),
  status: z.enum(['read', 'unread']).optional(),
});

const notificationPreferencesQuerySchema = z.object({
  channel: z.enum(NOTIFICATION_PREFERENCE_CHANNELS).optional().default('web'),
});

const notificationPreferencesBodySchema = z.object({
  channel: z.enum(NOTIFICATION_PREFERENCE_CHANNELS).optional().default('web'),
  preferences: z
    .array(
      z.object({
        enabled: z.boolean(),
        eventType: z.enum(NOTIFICATION_PREFERENCE_EVENT_TYPES),
      }),
    )
    .min(1),
});

export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/notifications',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const query = parseQuery(
        notificationsQuerySchema,
        (request as FastifyRequest & { query: unknown }).query,
      );
      const { step } = startRequestWorkflow(request, 'notifications.list');

      const notifications = listNotifications({
        limit: query.limit,
        status: query.status,
        userId: user.sub,
      });
      step.succeed(undefined, { count: notifications.length });
      return reply.send({ notifications });
    },
  );

  app.post(
    '/notifications/read-all',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { step } = startRequestWorkflow(request, 'notifications.read-all');
      markAllNotificationsRead({ userId: user.sub });
      step.succeed();
      return reply.status(204).send();
    },
  );

  app.post(
    '/notifications/:notificationId/read',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { notificationId } = request.params as { notificationId: string };
      const { step } = startRequestWorkflow(request, 'notifications.read', undefined, {
        notificationId,
      });
      markNotificationRead({ id: notificationId, userId: user.sub });
      step.succeed();
      return reply.status(204).send();
    },
  );

  app.get(
    '/notifications/preferences',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const query = parseQuery(
        notificationPreferencesQuerySchema,
        (request as FastifyRequest & { query: unknown }).query,
      );
      const { step } = startRequestWorkflow(request, 'notifications.preferences.list');

      const preferences = listNotificationPreferences({
        channel: query.channel,
        userId: user.sub,
      });
      step.succeed(undefined, { channel: query.channel, count: preferences.length });
      return reply.send({ preferences });
    },
  );

  app.put(
    '/notifications/preferences',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const parsed = parseBody(notificationPreferencesBodySchema, request.body);
      const { step } = startRequestWorkflow(request, 'notifications.preferences.update');

      const preferences = upsertNotificationPreferences({
        channel: parsed.channel,
        preferences: parsed.preferences,
        userId: user.sub,
      });
      step.succeed(undefined, { channel: parsed.channel, count: preferences.length });
      return reply.send({ preferences });
    },
  );
}
