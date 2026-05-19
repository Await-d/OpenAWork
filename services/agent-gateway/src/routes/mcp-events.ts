/**
 * `GET /mcp/events` — user-level Server-Sent Events stream for MCP
 * tool-catalog change notifications.
 *
 * Wired in PR-B.3. The agent-gateway already publishes `RunEvent`s per
 * session through `subscribeSessionRunEvents`, but MCP catalog
 * changes are inherently user-scoped (a tools/list_changed push
 * affects every session of that user, not a single one). Rather than
 * fan-out into N parallel session streams we expose a dedicated
 * lightweight stream here.
 *
 * Frontend usage:
 *
 * ```ts
 * const es = new EventSource(`/mcp/events?token=${jwt}`);
 * es.addEventListener('mcp.tools.changed', (evt) => {
 *   const payload = JSON.parse(evt.data);
 *   refreshMcpToolList(payload.serverId);
 * });
 * ```
 *
 * The endpoint accepts the JWT through a `?token=` query string (same
 * pattern as `/sessions/:id/stream/sse`) because EventSource cannot
 * set custom Authorization headers. The token is verified once on
 * connect; long-running streams don't refresh credentials.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import {
  subscribeOAuthRedirects,
  subscribeToolCatalogChanges,
  type OAuthRedirectEvent,
  type ToolCatalogChangeEvent,
} from '../mcp/mcp-tool-catalog.js';

const HEARTBEAT_INTERVAL_MS = 25_000;

export async function mcpEventsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/mcp/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawQuery = (request.query as Record<string, string | undefined>) ?? {};
    const sseToken = rawQuery['token'];

    let user: JwtPayload;
    try {
      user = request.server.jwt.verify<JwtPayload>(sseToken ?? '');
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
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

    let clientClosed = false;
    const onClientClose = (): void => {
      clientClosed = true;
    };
    request.raw.on('close', onClientClose);

    const safeWrite = (eventName: string, data: unknown): void => {
      if (clientClosed) return;
      try {
        reply.raw.write(`event: ${eventName}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Socket already half-closed — flag and let cleanup run.
        clientClosed = true;
      }
    };

    // Filter the user-level catalog stream to this subscriber's userId
    // so users never observe each other's MCP changes (defence-in-depth
    // even though the endpoint is JWT-gated).
    const unsubscribeCatalog = subscribeToolCatalogChanges((event: ToolCatalogChangeEvent) => {
      if (event.userId !== user.sub) return;
      safeWrite('mcp.tools.changed', {
        serverId: event.serverId,
        mcpPoolKey: event.mcpPoolKey,
        toolCount: event.tools.length,
        // Tool names are cheap; full schemas are not. Send names for UI
        // diff display, let clients re-fetch full catalogs via the
        // existing REST endpoint when they need parameter shapes.
        toolNames: event.tools.map((t) => t.name),
      });
    });

    // PR-D-OAuth: forward `mcp.auth.required` events to the same
    // subscriber. The frontend listens for this event and pops the
    // authorization URL in a new tab; once the user completes the
    // upstream consent flow, the OAuth provider's `saveTokens`
    // persists the tokens and the next pool operation reconnects
    // transparently.
    const unsubscribeOAuth = subscribeOAuthRedirects((event: OAuthRedirectEvent) => {
      if (event.userId !== user.sub) return;
      safeWrite('mcp.auth.required', {
        mcpId: event.mcpId,
        authorizationUrl: event.authorizationUrl,
      });
    });

    const unsubscribe = (): void => {
      unsubscribeCatalog();
      unsubscribeOAuth();
    };

    const heartbeat = setInterval(() => {
      if (clientClosed) return;
      try {
        reply.raw.write(': keepalive\n\n');
      } catch {
        clientClosed = true;
      }
    }, HEARTBEAT_INTERVAL_MS);

    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearInterval(heartbeat);
        unsubscribe();
        request.raw.off('close', finish);
        try {
          reply.raw.end();
        } catch {
          // already closed
        }
        resolve();
      };
      request.raw.on('close', finish);
    });
  });
}
