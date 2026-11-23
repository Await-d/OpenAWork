/**
 * `GET /cron/events` — 用户级 Server-Sent Events 流，推送定时任务变更。
 *
 * 取代任务页的轮询：`/cron/jobs` 系列的 CRUD / 启停，以及调度器的执行生命周期
 * （run_started / run_finished）落库成功后，经 `cron/cron-events-bus.ts` 发布，
 * 由本端点转成 `cron.jobs.changed` 事件下发。**载荷刻意精简**（只发 reason + jobId），
 * 客户端收到即静默重拉 REST。
 *
 * 前端用法：
 *
 * ```ts
 * const es = new EventSource(`/cron/events?token=${jwt}`);
 * es.addEventListener('cron.jobs.changed', (evt) => {
 *   const { reason, jobId } = JSON.parse(evt.data);
 *   refreshCronJobs();
 * });
 * ```
 *
 * JWT 通过 `?token=` 查询串传递（EventSource 无法设自定义 header），与
 * `routes/mcp-events.ts` 完全同构：连接时校验一次，长连接不再刷新凭据。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { subscribeCronJobsChanged, type CronJobsChangedEvent } from '../cron/cron-events-bus.js';
import { createSseClientChannel } from './sse-client-channel.js';

const HEARTBEAT_INTERVAL_MS = 25_000;

export async function cronEventsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/cron/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawQuery = (request.query as Record<string, string | undefined>) ?? {};
    const sseToken = rawQuery['token'];

    let user: JwtPayload;
    try {
      user = request.server.jwt.verify<JwtPayload>(sseToken ?? '');
    } catch {
      return reply.status(401).send({ error: '未授权或登录已失效。' });
    }

    const requestOrigin = request.headers['origin'] ?? '*';
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': requestOrigin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    });
    reply.raw.write('retry: 1000\n\n');

    return new Promise<void>((resolve) => {
      // 三路拆除（TCP close / 写失败 / 主动 close）收敛为单一幂等 teardown，
      // 杜绝半开 socket 泄漏模块级订阅与僵尸心跳。与 `/mcp/events` 同构。
      const channel = createSseClientChannel({
        rawWrite: (chunk) => reply.raw.write(chunk),
        rawEnd: () => reply.raw.end(),
      });

      const onClose = (): void => {
        channel.close();
      };
      channel.addTeardown(() => request.raw.off('close', onClose));
      channel.addTeardown(resolve);

      // 用户级隔离：即便端点已 JWT 鉴权，也再按 userId 过滤一层，订阅者永远
      // 看不到别人的任务变更。
      const unsubscribe = subscribeCronJobsChanged((event: CronJobsChangedEvent) => {
        if (event.userId !== user.sub) return;
        channel.write(
          `event: cron.jobs.changed\ndata: ${JSON.stringify({
            reason: event.reason,
            jobId: event.jobId,
          })}\n\n`,
        );
      });
      channel.addTeardown(unsubscribe);

      const heartbeat = setInterval(() => {
        channel.write(': keepalive\n\n');
      }, HEARTBEAT_INTERVAL_MS);
      channel.addTeardown(() => clearInterval(heartbeat));

      request.raw.on('close', onClose);
    });
  });
}
