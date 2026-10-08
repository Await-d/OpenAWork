/**
 * `POST /sessions/:sessionId/client-errors`
 *
 * 客户端侧传输失败（SSE/WS 断连、载荷解析失败）的落库入口。写入由网关执行，
 * 客户端只能上报「观察到的错误」，因此不存在伪造 assistant 消息的通道。
 * 幂等与 prompt 隔离语义见 `session/client-error-report.ts`。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { ApiError } from '../infra/error-response.js';
import { parseBody } from '../infra/parse-request.js';
import { sqliteGet } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  clientStreamErrorReportSchema,
  persistClientStreamErrorMessage,
} from '../session/client-error-report.js';

export async function registerSessionClientErrorRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/sessions/:sessionId/client-errors',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.client_error.report', undefined, {
        sessionId,
      });
      const report = parseBody(clientStreamErrorReportSchema, request.body);

      // 归属校验：未拥有该会话一律 404，绝不代写他人历史。
      const session = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const result = persistClientStreamErrorMessage({
        sessionId,
        userId: user.sub,
        report,
      });
      step.succeed(undefined, { outcome: result.outcome });
      return reply.send({
        ok: true,
        outcome: result.outcome,
        messageId: result.messageId ?? null,
      });
    },
  );
}
