/**
 * Session terminal routes — REST surface for the
 * `session_terminals` registry. Powers the chat-page "running terminals"
 * drawer and exposes a kill button so a user can stop an individual
 * bash invocation without aborting the whole LLM run.
 *
 * Routes:
 *   GET    /sessions/:sessionId/terminals?status=running|all&limit=50
 *   GET    /sessions/:sessionId/terminals/:terminalId
 *   POST   /sessions/:sessionId/terminals/:terminalId/kill
 *   DELETE /sessions/:sessionId/terminals/:terminalId  (only closed rows)
 *
 * Access control: all endpoints require auth; we also verify the
 * terminal row belongs to both the calling user AND the path session,
 * so a session-id swap can't expose another user's terminals.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteGet } from '../db.js';
import {
  closePersistentTerminal,
  isPersistentTerminal,
  resizeTerminal,
  spawnPersistentTerminal,
  writeStdinToTerminal,
} from '../persistent-terminals.js';
import { subscribeSessionRunEvents } from '../session-run-events.js';
import {
  deleteTerminalRecord,
  getTerminal,
  killTerminal,
  listSessionTerminals,
} from '../session-terminal-registry.js';

interface SessionOwnerRow {
  user_id: string;
}

function ensureSessionOwnedByUser(sessionId: string, userId: string): boolean {
  const row = sqliteGet<SessionOwnerRow>('SELECT user_id FROM sessions WHERE id = ? LIMIT 1', [
    sessionId,
  ]);
  return row?.user_id === userId;
}

/** Strip server-only fields before returning a terminal to the client. */
function toPublicTerminal(record: ReturnType<typeof getTerminal> & object) {
  return {
    terminalId: record.terminalId,
    sessionId: record.sessionId,
    ...(record.clientRequestId ? { clientRequestId: record.clientRequestId } : {}),
    toolName: record.toolName,
    kind: record.kind,
    command: record.command,
    ...(record.description ? { description: record.description } : {}),
    cwd: record.cwd,
    ...(record.pid !== undefined ? { pid: record.pid } : {}),
    status: record.status,
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    startedAtMs: record.startedAtMs,
    ...(record.endedAtMs !== undefined ? { endedAtMs: record.endedAtMs } : {}),
    lastActivityMs: record.lastActivityMs,
    outputBytesTotal: record.outputBytesTotal,
    outputTail: record.outputTail,
    ...(record.outputPath ? { outputPath: record.outputPath } : {}),
  };
}

export async function sessionTerminalsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/sessions/:sessionId/terminals',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload | undefined;
      if (!user?.sub) return reply.code(401).send({ error: 'unauthorized' });
      const { sessionId } = request.params as { sessionId: string };
      if (!ensureSessionOwnedByUser(sessionId, user.sub)) {
        return reply.code(404).send({ error: 'session_not_found' });
      }
      const query = request.query as { status?: string; limit?: string };
      const includeClosed = query.status !== 'running';
      const parsedLimit = query.limit !== undefined ? Number.parseInt(String(query.limit), 10) : 50;
      const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;
      const terminals = listSessionTerminals({
        sessionId,
        userId: user.sub,
        includeClosed,
        limit,
      });
      return reply.send({ terminals: terminals.map(toPublicTerminal) });
    },
  );

  app.get(
    '/sessions/:sessionId/terminals/:terminalId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload | undefined;
      if (!user?.sub) return reply.code(401).send({ error: 'unauthorized' });
      const { sessionId, terminalId } = request.params as {
        sessionId: string;
        terminalId: string;
      };
      if (!ensureSessionOwnedByUser(sessionId, user.sub)) {
        return reply.code(404).send({ error: 'session_not_found' });
      }
      const record = getTerminal(terminalId, user.sub);
      if (!record || record.sessionId !== sessionId) {
        return reply.code(404).send({ error: 'terminal_not_found' });
      }
      return reply.send({ terminal: toPublicTerminal(record) });
    },
  );

  app.post(
    '/sessions/:sessionId/terminals/:terminalId/kill',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload | undefined;
      if (!user?.sub) return reply.code(401).send({ error: 'unauthorized' });
      const { sessionId, terminalId } = request.params as {
        sessionId: string;
        terminalId: string;
      };
      if (!ensureSessionOwnedByUser(sessionId, user.sub)) {
        return reply.code(404).send({ error: 'session_not_found' });
      }
      const record = getTerminal(terminalId, user.sub);
      if (!record || record.sessionId !== sessionId) {
        return reply.code(404).send({ error: 'terminal_not_found' });
      }
      const result = killTerminal({ terminalId, userId: user.sub });
      // Re-read so the response reflects whatever final status the
      // registry settled on (e.g. running → killed or aborted).
      const updated = getTerminal(terminalId, user.sub);
      return reply.send({
        result,
        terminal: updated ? toPublicTerminal(updated) : null,
      });
    },
  );

  app.delete(
    '/sessions/:sessionId/terminals/:terminalId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload | undefined;
      if (!user?.sub) return reply.code(401).send({ error: 'unauthorized' });
      const { sessionId, terminalId } = request.params as {
        sessionId: string;
        terminalId: string;
      };
      if (!ensureSessionOwnedByUser(sessionId, user.sub)) {
        return reply.code(404).send({ error: 'session_not_found' });
      }
      const record = getTerminal(terminalId, user.sub);
      if (!record || record.sessionId !== sessionId) {
        return reply.code(404).send({ error: 'terminal_not_found' });
      }
      const result = deleteTerminalRecord({ terminalId, userId: user.sub });
      if (result.refusedRunning) {
        return reply.code(409).send({
          error: 'terminal_running',
          message: 'Kill the terminal before deleting the record.',
        });
      }
      return reply.send({ deleted: result.deleted });
    },
  );

  /**
   * POST /sessions/:sessionId/terminals
   * Create a new user-driven persistent terminal. The terminal stays
   * open across requests; the user's keystrokes go through the stdin
   * endpoint below and output is streamed via the SSE endpoint.
   */
  app.post(
    '/sessions/:sessionId/terminals',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload | undefined;
      if (!user?.sub) return reply.code(401).send({ error: 'unauthorized' });
      const { sessionId } = request.params as { sessionId: string };
      if (!ensureSessionOwnedByUser(sessionId, user.sub)) {
        return reply.code(404).send({ error: 'session_not_found' });
      }
      const body = (request.body ?? {}) as {
        cwd?: string;
        initialCommand?: string;
        description?: string;
      };
      const cwd =
        typeof body.cwd === 'string' && body.cwd.trim().length > 0 ? body.cwd : process.cwd();
      try {
        const result = spawnPersistentTerminal({
          sessionId,
          userId: user.sub,
          cwd,
          source: 'user',
          ...(body.initialCommand ? { initialCommand: body.initialCommand } : {}),
          ...(body.description ? { description: body.description } : {}),
        });
        return reply.send({ terminal: toPublicTerminal(result.terminal) });
      } catch (error) {
        return reply.code(500).send({
          error: 'spawn_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  /**
   * POST /sessions/:sessionId/terminals/:terminalId/stdin
   * Write user-typed bytes into a persistent shell's stdin. The frontend
   * sends raw key sequences (including '\r' for Enter); the shell does
   * its own line editing.
   */
  app.post(
    '/sessions/:sessionId/terminals/:terminalId/stdin',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload | undefined;
      if (!user?.sub) return reply.code(401).send({ error: 'unauthorized' });
      const { sessionId, terminalId } = request.params as {
        sessionId: string;
        terminalId: string;
      };
      if (!ensureSessionOwnedByUser(sessionId, user.sub)) {
        return reply.code(404).send({ error: 'session_not_found' });
      }
      const record = getTerminal(terminalId, user.sub);
      if (!record || record.sessionId !== sessionId) {
        return reply.code(404).send({ error: 'terminal_not_found' });
      }
      if (!isPersistentTerminal(terminalId)) {
        return reply.code(409).send({
          error: 'terminal_not_persistent',
          message: '该终端是 agent 的一次性命令，不支持继续输入。',
        });
      }
      const body = (request.body ?? {}) as { data?: string };
      if (typeof body.data !== 'string') {
        return reply.code(400).send({ error: 'invalid_body' });
      }
      const result = writeStdinToTerminal(terminalId, body.data);
      if (!result.ok) return reply.code(409).send(result);
      return reply.send({ ok: true });
    },
  );

  /**
   * POST /sessions/:sessionId/terminals/:terminalId/resize
   * No-op stub for xterm fit-addon resize events; kept stable so we
   * can swap in a real PTY later without touching the frontend.
   */
  app.post(
    '/sessions/:sessionId/terminals/:terminalId/resize',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload | undefined;
      if (!user?.sub) return reply.code(401).send({ error: 'unauthorized' });
      const { sessionId, terminalId } = request.params as {
        sessionId: string;
        terminalId: string;
      };
      if (!ensureSessionOwnedByUser(sessionId, user.sub)) {
        return reply.code(404).send({ error: 'session_not_found' });
      }
      const record = getTerminal(terminalId, user.sub);
      if (!record || record.sessionId !== sessionId) {
        return reply.code(404).send({ error: 'terminal_not_found' });
      }
      const body = (request.body ?? {}) as { cols?: number; rows?: number };
      const cols = Number.isFinite(body.cols) ? Math.max(1, Math.floor(body.cols ?? 80)) : 80;
      const rows = Number.isFinite(body.rows) ? Math.max(1, Math.floor(body.rows ?? 24)) : 24;
      resizeTerminal({ terminalId, cols, rows });
      return reply.send({ ok: true });
    },
  );

  /**
   * POST /sessions/:sessionId/terminals/:terminalId/close
   * User-initiated close of a persistent terminal — equivalent to
   * "I'm done with this tab". For non-persistent terminals this falls
   * back to the kill path.
   */
  app.post(
    '/sessions/:sessionId/terminals/:terminalId/close',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload | undefined;
      if (!user?.sub) return reply.code(401).send({ error: 'unauthorized' });
      const { sessionId, terminalId } = request.params as {
        sessionId: string;
        terminalId: string;
      };
      if (!ensureSessionOwnedByUser(sessionId, user.sub)) {
        return reply.code(404).send({ error: 'session_not_found' });
      }
      const record = getTerminal(terminalId, user.sub);
      if (!record || record.sessionId !== sessionId) {
        return reply.code(404).send({ error: 'terminal_not_found' });
      }
      if (isPersistentTerminal(terminalId)) {
        closePersistentTerminal(terminalId);
      } else {
        killTerminal({ terminalId, userId: user.sub });
      }
      return reply.send({ ok: true });
    },
  );

  /**
   * GET /sessions/:sessionId/terminals/:terminalId/stream
   * Server-Sent Events stream filtered to a single terminal. SSE can't
   * send Authorization headers so we accept `?token=<jwt>`, mirroring
   * `/mcp/events`.
   */
  app.get(
    '/sessions/:sessionId/terminals/:terminalId/stream',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawQuery = (request.query as Record<string, string | undefined>) ?? {};
      const sseToken = rawQuery['token'];
      let user: JwtPayload;
      try {
        user = request.server.jwt.verify<JwtPayload>(sseToken ?? '');
      } catch {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const { sessionId, terminalId } = request.params as {
        sessionId: string;
        terminalId: string;
      };
      if (!ensureSessionOwnedByUser(sessionId, user.sub)) {
        return reply.code(404).send({ error: 'session_not_found' });
      }
      const record = getTerminal(terminalId, user.sub);
      if (!record || record.sessionId !== sessionId) {
        return reply.code(404).send({ error: 'terminal_not_found' });
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
      const safeWrite = (eventName: string, data: unknown): void => {
        if (clientClosed) return;
        try {
          reply.raw.write(`event: ${eventName}\n`);
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          clientClosed = true;
        }
      };

      // Initial snapshot so xterm has output to render immediately.
      safeWrite('snapshot', {
        terminalId: record.terminalId,
        outputTail: record.outputTail,
        outputBytesTotal: record.outputBytesTotal,
        status: record.status,
      });

      const unsubscribe = subscribeSessionRunEvents(sessionId, (event) => {
        if (event.type === 'terminal_output' && event.terminalId === terminalId) {
          safeWrite('output', event);
          return;
        }
        if (event.type === 'terminal_exited' && event.terminalId === terminalId) {
          safeWrite('exited', event);
          return;
        }
      });

      const heartbeat = setInterval(() => {
        if (clientClosed) return;
        try {
          reply.raw.write(': keepalive\n\n');
        } catch {
          clientClosed = true;
        }
      }, 25_000);

      return new Promise<void>((resolve) => {
        const finish = (): void => {
          clientClosed = true;
          clearInterval(heartbeat);
          try {
            unsubscribe();
          } catch {
            /* ignore */
          }
          request.raw.off('close', finish);
          try {
            reply.raw.end();
          } catch {
            /* ignore */
          }
          resolve();
        };
        request.raw.on('close', finish);
      });
    },
  );
}
