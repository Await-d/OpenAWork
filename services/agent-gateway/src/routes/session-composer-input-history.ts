/**
 * 输入框历史（composer input history）的 REST 入口。
 *
 * ```
 * GET  /sessions/:sessionId/composer-input-history   按旧 → 新列出（最多 50 条）
 * POST /sessions/:sessionId/composer-input-history   追加若干条（去重并裁剪到 50）
 * ```
 *
 * 用途单一：输入框按 ↑ / ↓ 时的历史回填。历史不作为消息落库、对模型不可见，
 * 也不参与发送状态机——它只是一份每会话最多 50 条的文本快照。
 *
 * 归属校验与会话子域保持一致：未拥有该会话一律 404 而非 403，避免会话 id 可探测。
 * POST 返回落库后的全量列表：客户端据此覆盖本地缓存，天然对齐 50 条上限与相邻
 * 去重结果，不需要在两端各维护一份裁剪逻辑。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { ApiError } from '../infra/error-response.js';
import { parseBody, parseParams } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  appendComposerInputHistory,
  COMPOSER_INPUT_HISTORY_APPEND_MAX_ENTRIES,
  COMPOSER_INPUT_HISTORY_TEXT_MAX_LENGTH,
  listComposerInputHistory,
} from '../session/composer-input-history-store.js';

const sessionParamsSchema = z.object({
  sessionId: z.string().min(1).max(200),
});

/**
 * 追加请求。
 *
 * 批量而非单条：新会话建立后要把 pending（尚未有 sessionId）期间的历史一次性
 * 迁进真实会话，逐条请求既慢又可能只成功一半。单条提交就是长度为 1 的批量。
 */
const appendBodySchema = z.object({
  entries: z
    .array(z.string().max(COMPOSER_INPUT_HISTORY_TEXT_MAX_LENGTH))
    .min(1)
    .max(COMPOSER_INPUT_HISTORY_APPEND_MAX_ENTRIES),
});

/** 校验会话归属。返回 false 时调用方一律 404。 */
function assertSessionOwnership(sessionId: string, userId: string): void {
  const session = sqliteGet<{ id: string }>(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  if (!session) {
    throw ApiError.notFound('目标会话不存在。');
  }
}

export async function registerSessionComposerInputHistoryRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/sessions/:sessionId/composer-input-history',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = parseParams(sessionParamsSchema, request.params);
      const { step } = startRequestWorkflow(
        request,
        'session.composer_input_history.list',
        undefined,
        { sessionId },
      );

      assertSessionOwnership(sessionId, user.sub);
      const entries = listComposerInputHistory({ sessionId, userId: user.sub });
      step.succeed(undefined, { count: entries.length });
      return reply.send({ ok: true, entries });
    },
  );

  app.post(
    '/sessions/:sessionId/composer-input-history',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = parseParams(sessionParamsSchema, request.params);
      const { step } = startRequestWorkflow(
        request,
        'session.composer_input_history.append',
        undefined,
        { sessionId },
      );
      const body = parseBody(appendBodySchema, request.body);

      assertSessionOwnership(sessionId, user.sub);
      const entries = appendComposerInputHistory({
        entries: body.entries,
        sessionId,
        userId: user.sub,
      });
      step.succeed(undefined, { count: entries.length });
      return reply.send({ ok: true, entries });
    },
  );
}
