/**
 * 会话待发队列（composer queue）的 REST 入口。
 *
 * ```
 * GET    /sessions/:sessionId/composer-queue          列出待发条目（FIFO）
 * POST   /sessions/:sessionId/composer-queue          入队一条（按 itemId 幂等）
 * DELETE /sessions/:sessionId/composer-queue/:itemId  移出单条
 * DELETE /sessions/:sessionId/composer-queue          清空
 * POST   /sessions/:sessionId/composer-queue/:itemId/claim   独占发送权（多端互斥）
 * DELETE /sessions/:sessionId/composer-queue/:itemId/claim   交还发送权（发送失败）
 * ```
 *
 * 归属校验与会话子域保持一致：未拥有该会话一律 404 而非 403，避免会话 id 可探测。
 * 入队不触碰 `message_v2`——待发条目在真正发出前对模型不可见，这与
 * `task/task-job-delivery.ts` 的「先落库、消费时再唤醒」是同一套语义。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { ApiError } from '../infra/error-response.js';
import { parseBody, parseParams } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { getAnyInFlightStreamRequestForSession } from './stream-cancellation.js';
import {
  claimComposerQueueItem,
  claimComposerQueueItems,
  clearComposerQueue,
  COMPOSER_QUEUE_ATTACHMENT_MAX_COUNT,
  COMPOSER_QUEUE_CLAIM_LEASE_MS,
  COMPOSER_QUEUE_TEXT_MAX_LENGTH,
  enqueueComposerQueueItem,
  listComposerQueueItems,
  releaseComposerQueueItem,
  removeComposerQueueItem,
  type ComposerQueueAttachment,
} from '../session/composer-queue-store.js';

const attachmentItemSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  type: z.enum(['audio', 'file', 'image', 'video']),
});

const enqueueBodySchema = z.object({
  attachmentItems: z
    .array(attachmentItemSchema)
    .max(COMPOSER_QUEUE_ATTACHMENT_MAX_COUNT)
    .default([]),
  // 客户端用 crypto.randomUUID() 生成；留足余量但拒绝明显非法的 id，避免污染主键。
  itemId: z.string().min(1).max(200),
  requiresAttachmentRebind: z.boolean().default(false),
  text: z.string().max(COMPOSER_QUEUE_TEXT_MAX_LENGTH),
});

const sessionParamsSchema = z.object({
  sessionId: z.string().min(1).max(200),
});

const queueItemParamsSchema = z.object({
  itemId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
});

/**
 * claim / release 的请求体。
 *
 * `clientId` 由客户端生成并持久化在 sessionStorage——**每标签页一个**，这样同机多标签页
 * 也会被当作两个独立端互斥。租约时长可选，缺省走服务端常量。
 */
const claimBodySchema = z.object({
  clientId: z.string().min(1).max(200),
  leaseMs: z
    .number()
    .int()
    .positive()
    .max(5 * 60_000)
    .optional(),
});

const claimManyBodySchema = z.object({
  clientId: z.string().min(1).max(200),
  itemIds: z.array(z.string().min(1).max(200)).min(1).max(32),
  leaseMs: z
    .number()
    .int()
    .positive()
    .max(5 * 60_000)
    .optional(),
});

const releaseBodySchema = z.object({
  clientId: z.string().min(1).max(200),
});

/**
 * 校验会话归属。返回 false 时调用方一律 404。
 *
 * 队列表自身也带 `user_id` 过滤，这里是路由层的第一道闸——与
 * `session-client-error-routes.ts` 完全同构。
 */
function assertSessionOwnership(sessionId: string, userId: string): void {
  const session = sqliteGet<{ id: string }>(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  if (!session) {
    throw ApiError.notFound('目标会话不存在。');
  }
}

function toAttachmentPayload(attachments: ComposerQueueAttachment[]): unknown[] {
  return attachments.map((attachment) => ({ ...attachment }));
}

export async function registerSessionComposerQueueRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/sessions/:sessionId/composer-queue',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = parseParams(sessionParamsSchema, request.params);
      const { step } = startRequestWorkflow(request, 'session.composer_queue.list', undefined, {
        sessionId,
      });

      assertSessionOwnership(sessionId, user.sub);
      const items = listComposerQueueItems({ sessionId, userId: user.sub });
      step.succeed(undefined, { count: items.length });
      return reply.send({
        ok: true,
        items: items.map((item) => ({
          attachmentItems: toAttachmentPayload(item.attachmentItems),
          enqueuedAt: item.enqueuedAt,
          id: item.id,
          requiresAttachmentRebind: item.requiresAttachmentRebind,
          text: item.text,
        })),
      });
    },
  );

  app.post(
    '/sessions/:sessionId/composer-queue',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = parseParams(sessionParamsSchema, request.params);
      const { step } = startRequestWorkflow(request, 'session.composer_queue.enqueue', undefined, {
        sessionId,
      });
      const body = parseBody(enqueueBodySchema, request.body);

      assertSessionOwnership(sessionId, user.sub);
      const result = enqueueComposerQueueItem({
        attachmentItems: body.attachmentItems,
        // 服务端兜底时间戳：客户端时钟不可信，但只在客户端未提供时兜底。
        enqueuedAt: Date.now(),
        itemId: body.itemId,
        requiresAttachmentRebind: body.requiresAttachmentRebind,
        sessionId,
        text: body.text,
        userId: user.sub,
      });
      step.succeed(undefined, { created: result.created });
      return reply.send({
        ok: true,
        created: result.created,
        item: {
          attachmentItems: toAttachmentPayload(result.item.attachmentItems),
          enqueuedAt: result.item.enqueuedAt,
          id: result.item.id,
          requiresAttachmentRebind: result.item.requiresAttachmentRebind,
          text: result.item.text,
        },
      });
    },
  );

  app.delete(
    '/sessions/:sessionId/composer-queue/:itemId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { itemId, sessionId } = parseParams(queueItemParamsSchema, request.params);
      const { step } = startRequestWorkflow(request, 'session.composer_queue.remove', undefined, {
        itemId,
        sessionId,
      });

      assertSessionOwnership(sessionId, user.sub);
      const removed = removeComposerQueueItem({ itemId, sessionId, userId: user.sub });
      // 条目已不在（可能刚被本会话的另一个标签页消费掉）不算失败：
      // 删除是幂等语义，调用方拿到 ok:true 即可继续。
      step.succeed(undefined, { removed });
      return reply.send({ ok: true, removed });
    },
  );

  app.delete(
    '/sessions/:sessionId/composer-queue',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = parseParams(sessionParamsSchema, request.params);
      const { step } = startRequestWorkflow(request, 'session.composer_queue.clear', undefined, {
        sessionId,
      });

      assertSessionOwnership(sessionId, user.sub);
      const removedCount = clearComposerQueue({ sessionId, userId: user.sub });
      step.succeed(undefined, { removedCount });
      return reply.send({ ok: true, removedCount });
    },
  );

  app.post(
    '/sessions/:sessionId/composer-queue/claim',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = parseParams(sessionParamsSchema, request.params);
      const { step } = startRequestWorkflow(
        request,
        'session.composer_queue.claim_many',
        undefined,
        {
          sessionId,
        },
      );
      const body = parseBody(claimManyBodySchema, request.body);
      const itemIds = [...new Set(body.itemIds)];

      assertSessionOwnership(sessionId, user.sub);
      if (getAnyInFlightStreamRequestForSession({ sessionId, userId: user.sub })) {
        const claims = itemIds.map((itemId) => ({
          claimed: false,
          itemId,
          reason: 'session_running' as const,
        }));
        step.succeed(undefined, { count: claims.length, claimedCount: 0 });
        return reply.send({ ok: true, claims });
      }

      const results = claimComposerQueueItems({
        clientId: body.clientId,
        itemIds,
        leaseMs: body.leaseMs ?? COMPOSER_QUEUE_CLAIM_LEASE_MS,
        now: Date.now(),
        sessionId,
        userId: user.sub,
      });
      const claims = results.map((result) =>
        result.claimed ? result : { ...result, reason: 'held_by_other' as const },
      );
      step.succeed(undefined, {
        count: claims.length,
        claimedCount: claims.filter((claim) => claim.claimed).length,
      });
      return reply.send({ ok: true, claims });
    },
  );

  // 发送权独占。`claimed: false` 是正常结果（另一端正在发，或会话仍在跑），不是错误——HTTP 仍回 200，
  // 由调用方决定跳过，不要让客户端把它当失败去重试，那会加剧竞争。
  app.post(
    '/sessions/:sessionId/composer-queue/:itemId/claim',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { itemId, sessionId } = parseParams(queueItemParamsSchema, request.params);
      const { step } = startRequestWorkflow(request, 'session.composer_queue.claim', undefined, {
        itemId,
        sessionId,
      });
      const body = parseBody(claimBodySchema, request.body);

      assertSessionOwnership(sessionId, user.sub);
      // 会话仍在跑(单飞锁被占)时不发放租约,并用 reason 与「另一端正在发这条消息」区分:
      // 后者是条目级的互斥,调用方应跳过;前者是会话级的占用,调用方应保留条目退避重试。
      // 判据与 stream.ts 的 409 SESSION_ALREADY_RUNNING 完全同源(同一张 in-flight 注册表),
      // 让「能不能发」在网关处一次问清,客户端无需再单独探测 /stream/active。
      if (getAnyInFlightStreamRequestForSession({ sessionId, userId: user.sub })) {
        step.succeed(undefined, { claimed: false, reason: 'session_running' });
        return reply.send({ ok: true, claimed: false, reason: 'session_running' });
      }
      const claimed = claimComposerQueueItem({
        clientId: body.clientId,
        itemId,
        leaseMs: body.leaseMs ?? COMPOSER_QUEUE_CLAIM_LEASE_MS,
        now: Date.now(),
        sessionId,
        userId: user.sub,
      });
      step.succeed(undefined, { claimed });
      return reply.send({ ok: true, claimed });
    },
  );

  // 发送失败时交还发送权，否则条目要等租约过期才能被接手。
  app.delete(
    '/sessions/:sessionId/composer-queue/:itemId/claim',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { itemId, sessionId } = parseParams(queueItemParamsSchema, request.params);
      const { step } = startRequestWorkflow(request, 'session.composer_queue.release', undefined, {
        itemId,
        sessionId,
      });
      const body = parseBody(releaseBodySchema, request.body);

      assertSessionOwnership(sessionId, user.sub);
      const released = releaseComposerQueueItem({
        clientId: body.clientId,
        itemId,
        sessionId,
        userId: user.sub,
      });
      step.succeed(undefined, { released });
      return reply.send({ ok: true, released });
    },
  );
}
