import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import {
  archiveNotification,
  archiveNotifications,
  countPendingActionableNotifications,
  listNotificationPreferences,
  listNotifications,
  listUnreadBroadcastNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_PREFERENCE_CHANNELS,
  NOTIFICATION_PREFERENCE_EVENT_TYPES,
  NOTIFICATION_STATUSES,
  NOTIFICATION_VIEWS,
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
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  view: z.enum(NOTIFICATION_VIEWS).optional(),
});

const archiveNotificationsBodySchema = z.object({
  eventTypes: z.array(z.string().min(1).max(64)).max(8).optional(),
  sessionId: z.string().min(1).max(256).optional(),
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

      const view = query.view ?? 'pending';
      // `view=pending` 只含 actionable 待办 —— rows 与 pendingActionableCount 口径一致，
      // 结果播报不在铃铛里占位。
      const notifications = listNotifications({
        kind: view === 'pending' ? 'actionable' : undefined,
        limit: query.limit,
        status: query.status,
        userId: user.sub,
        view,
      });
      // 红点只被「真的需要用户动手」的 actionable 待办点亮；结果播报不该抢注意力。
      const pendingActionableCount = countPendingActionableNotifications(user.sub);
      // 结果播报仅在待处理视图额外交付：客户端页面隐藏时据此弹系统通知，
      // 让「不进铃铛」不等于「不告知」。
      const browserBroadcasts =
        view === 'pending'
          ? listUnreadBroadcastNotifications({ limit: query.limit, userId: user.sub })
          : [];
      step.succeed(undefined, {
        count: notifications.length,
        pendingActionableCount,
        broadcastCount: browserBroadcasts.length,
        view,
      });
      return reply.send({
        browserBroadcasts,
        notifications,
        pendingActionableCount,
      });
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

  /**
   * 归档（忽略）而非删除：这是「用户不处理 ⇒ 通知永远赖着」的人工出口。
   * 保留行是为了可回溯——用户忽略后仍能在归档视图里找回上下文。
   */
  app.post(
    '/notifications/:notificationId/archive',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { notificationId } = request.params as { notificationId: string };
      const { step } = startRequestWorkflow(request, 'notifications.archive', undefined, {
        notificationId,
      });
      archiveNotification({ id: notificationId, userId: user.sub });
      step.succeed();
      return reply.status(204).send();
    },
  );

  /** 批量归档，最常用的是「忽略此会话的全部通知」。 */
  app.post(
    '/notifications/archive',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const parsed = parseBody(archiveNotificationsBodySchema, request.body ?? {});
      const { step } = startRequestWorkflow(request, 'notifications.archive-many', undefined, {
        sessionId: parsed.sessionId ?? '(all)',
        eventTypeCount: parsed.eventTypes?.length ?? 0,
      });
      archiveNotifications({
        eventTypes: parsed.eventTypes,
        sessionId: parsed.sessionId ?? null,
        userId: user.sub,
      });
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
