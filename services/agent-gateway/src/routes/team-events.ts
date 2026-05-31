/**
 * 260515-team-phase-b · T-07
 *
 * 独立的 `/team-events` WS 通道。
 */

import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { recordLatency } from '../handoff/bus/latency-monitor.js';
import { subscribeToTeamEvents } from '../handoff/bus/team-events-bus.js';
import { recordTeamRuntimeIncident } from '../team/team-runtime-diagnostics-store.js';

const TEAM_EVENTS_HEARTBEAT_INTERVAL_MS = 10_000;
const TEAM_EVENTS_IDLE_TIMEOUT_MS = 45_000;

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
          safeClose(socket, 1008, 'UNAUTHORIZED');
          return;
        }
      } else {
        safeSend(socket, { type: 'error', code: 'UNAUTHORIZED' });
        safeClose(socket, 1008, 'UNAUTHORIZED');
        return;
      }

      const userId = user.sub;
      if (!safeSend(socket, { type: 'connected', userId })) {
        recordTeamRuntimeIncident({
          category: 'team_events_connection',
          code: 'team-events:CONNECT_SEND_FAILED',
          context: {
            closeCode: 1011,
            userId,
          },
          message: 'TEAM_EVENTS_CONNECT_SEND_FAILED',
          severity: 'error',
          timestamp: Date.now(),
          userId,
        });
        safeClose(socket, 1011, 'TEAM_EVENTS_CONNECT_SEND_FAILED');
        return;
      }

      let closed = false;
      let lastActivityAt = Date.now();
      let heartbeat: NodeJS.Timeout | null = null;

      const touchActivity = () => {
        lastActivityAt = Date.now();
      };

      const unsubscribe = subscribeToTeamEvents((event) => {
        if (event.userId !== userId) return;
        if (event.type === 'session.substate.changed') {
          recordLatency('substate_push', Math.max(0, Date.now() - event.timestamp), userId);
        }
        if (!safeSend(socket, event)) {
          closeSocket(1011, 'TEAM_EVENTS_SEND_FAILED', 'SEND_FAILED');
          return;
        }
        touchActivity();
      });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };

      const closeSocket = (code: number, reason: string, errorCode?: string) => {
        if (closed) return;
        if (errorCode) {
          recordTeamRuntimeIncident({
            category: 'team_events_connection',
            code: `team-events:${errorCode}`,
            context: {
              closeCode: code,
              userId,
            },
            message: reason,
            severity: errorCode === 'IDLE_TIMEOUT' ? 'warning' : 'error',
            timestamp: Date.now(),
            userId,
          });
        }
        if (errorCode) {
          safeSend(socket, { type: 'error', code: errorCode });
        }
        cleanup();
        safeClose(socket, code, reason);
      };

      heartbeat = setInterval(() => {
        if (closed) return;
        if (Date.now() - lastActivityAt > TEAM_EVENTS_IDLE_TIMEOUT_MS) {
          closeSocket(1001, 'TEAM_EVENTS_IDLE_TIMEOUT', 'IDLE_TIMEOUT');
          return;
        }
        try {
          socket.ping();
        } catch {
          closeSocket(1011, 'TEAM_EVENTS_PING_FAILED', 'PING_FAILED');
        }
      }, TEAM_EVENTS_HEARTBEAT_INTERVAL_MS);

      socket.on('message', (data: Buffer) => {
        touchActivity();
        const text = data.toString().trim();
        if (text.length === 0) return;
        try {
          const parsed = JSON.parse(text) as { type?: string };
          if (parsed.type === 'ping') {
            if (!safeSend(socket, { type: 'pong', timestamp: Date.now() })) {
              closeSocket(1011, 'TEAM_EVENTS_PONG_FAILED', 'SEND_FAILED');
            }
            return;
          }
          if (parsed.type === 'pong') return;
          safeSend(socket, { type: 'error', code: 'UNSUPPORTED_MESSAGE' });
        } catch (_parseErr) {
          void _parseErr;
          safeSend(socket, { type: 'error', code: 'INVALID_JSON' });
        }
      });

      socket.on('pong', () => {
        touchActivity();
      });

      socket.on('close', () => {
        cleanup();
      });
      socket.on('error', () => {
        cleanup();
      });
    },
  );
}

function safeSend(socket: WebSocket, payload: unknown): boolean {
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch (_sendErr) {
    void _sendErr;
    return false;
  }
}

function safeClose(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch (_closeErr) {
    void _closeErr;
  }
}
