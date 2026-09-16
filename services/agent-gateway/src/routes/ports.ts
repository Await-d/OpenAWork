/**
 * Listening-port routes — read-only enumeration of the TCP listeners inside
 * the gateway's own network namespace. Powers the terminal panel "端口" tab.
 *
 * Mounted under `/sessions/` deliberately: `apps/web/nginx.conf` only forwards
 * `/api/`, `/auth/` and `/sessions/` to the gateway, so a bare `/ports/...`
 * path would be swallowed by the SPA fallback (`location /` → index.html).
 * The prefix is transport-only — the inventory is machine-wide, not
 * session-scoped, so this route intentionally takes no `sessionId`; auth is the
 * same JWT guard every other `/sessions/*` route uses.
 *
 * Routes:
 *   GET /sessions/ports/listening
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { listListeningPorts } from '../ports/listening-ports.js';

export async function portsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/sessions/ports/listening',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload | undefined;
      if (!user?.sub) {
        return reply.code(401).send({ error: 'unauthorized', message: '未授权或登录已失效。' });
      }
      const snapshot = await listListeningPorts();
      return reply.send(snapshot);
    },
  );
}
