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
}
