/**
 * 260515-team-phase-b · T-07
 *
 * 独立的 `/team-events` WS 通道。
 */

import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { subscribeToTeamEvents } from '../handoff/bus/team-events-bus.js';

export async function teamEventsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/team-events',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      const queryToken = (request.query as Record<string, string>)['token'];
      const authHeaderValue = request.headers['authorization'];
      const headerToken =
        typeof authHeaderValue === 'string' && authHeaderValue.startsWith('Bearer ')
          ? authHeaderValue.slice('Bearer '.length).trim()
          : undefined;
      const authToken = headerToken || queryToken;

      let user: JwtPayload | null = null;
      if (authToken) {
        try {
          user = request.server.jwt.verify<JwtPayload>(authToken);
        } catch (_verifyErr) {
          void _verifyErr;
          safeSend(socket, { type: 'error', code: 'UNAUTHORIZED' });
          socket.close(1008);
          return;
        }
      } else {
        safeSend(socket, { type: 'error', code: 'UNAUTHORIZED' });
        socket.close(1008);
        return;
      }

      const userId = user.sub;
      safeSend(socket, { type: 'connected', userId });

      const unsubscribe = subscribeToTeamEvents((event) => {
        if (event.userId !== userId) return;
        safeSend(socket, event);
      });

      socket.on('message', (data: Buffer) => {
        const text = data.toString().trim();
        if (text.length === 0) return;
        try {
          const parsed = JSON.parse(text) as { type?: string };
          if (parsed.type === 'ping') {
            safeSend(socket, { type: 'pong', timestamp: Date.now() });
          }
        } catch (_parseErr) {
          // 非法 JSON，静默忽略（客户端不应通过此通道发非 JSON）
          void _parseErr;
        }
      });

      socket.on('close', () => {
        unsubscribe();
      });
      socket.on('error', () => {
        unsubscribe();
      });
    },
  );
}

function safeSend(socket: WebSocket, payload: unknown): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch (_sendErr) {
    // socket 已关闭，静默忽略
    void _sendErr;
  }
}
