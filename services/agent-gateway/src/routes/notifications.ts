import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import {
  listNotificationPreferences,
  listNotifications,
  markNotificationRead,
  NOTIFICATION_PREFERENCE_CHANNELS,
  NOTIFICATION_PREFERENCE_EVENT_TYPES,
  upsertNotificationPreferences,
} from '../notification-store.js';
import { startRequestWorkflow } from '../request-workflow.js';

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
      const query = notificationsQuerySchema.safeParse(
        (request as FastifyRequest & { query: unknown }).query,
      );
      const { step } = startRequestWorkflow(request, 'notifications.list');
      if (!query.success) {
        step.fail('invalid query params');
        return reply
          .status(400)
          .send({ error: 'Invalid query params', issues: query.error.issues });
      }

      const notifications = listNotifications({
        limit: query.data.limit,
        status: query.data.status,
        userId: user.sub,
      });
      step.succeed(undefined, { count: notifications.length });
      return reply.send({ notifications });
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
      const query = notificationPreferencesQuerySchema.safeParse(
        (request as FastifyRequest & { query: unknown }).query,
      );
      const { step } = startRequestWorkflow(request, 'notifications.preferences.list');
      if (!query.success) {
        step.fail('invalid notification preference query');
        return reply.status(400).send({
          error: 'Invalid notification preference query',
          issues: query.error.issues,
        });
      }

      const preferences = listNotificationPreferences({
        channel: query.data.channel,
        userId: user.sub,
      });
      step.succeed(undefined, {
        channel: query.data.channel,
        count: preferences.length,
      });
      return reply.send({ preferences });
    },
  );

  app.put(
    '/notifications/preferences',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const parsed = notificationPreferencesBodySchema.safeParse(request.body);
      const { step } = startRequestWorkflow(request, 'notifications.preferences.update');
      if (!parsed.success) {
        step.fail('invalid notification preference body');
        return reply.status(400).send({
          error: 'Invalid notification preference payload',
          issues: parsed.error.issues,
        });
      }

      const preferences = upsertNotificationPreferences({
        channel: parsed.data.channel,
        preferences: parsed.data.preferences,
        userId: user.sub,
      });
      step.succeed(undefined, {
        channel: parsed.data.channel,
        count: preferences.length,
      });
      return reply.send({ preferences });
    },
  );
}
