import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import { modelRequestSchema } from '../model-router.js';
import {
  createPermissionAskedEvent,
  createPermissionRepliedEvent,
} from '../session-permission-events.js';
import { publishSessionRunEvent } from '../session-run-events.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { resumeApprovedPermissionRequest, type ApprovedPermissionResumePayload } from './stream.js';

const permissionResumeRequestSchema = modelRequestSchema.extend({
  displayMessage: z.string().min(1).max(32768).optional(),
  message: z.string().min(1).max(32768),
  providerId: z.string().min(1).max(200).optional(),
  clientRequestId: z.string().min(1).max(128),
  webSearchEnabled: z.boolean().optional(),
});

const createPermissionRequestSchema = z.object({
  toolName: z.string().min(1),
  scope: z.string().min(1),
  reason: z.string().min(1),
  riskLevel: z.enum(['low', 'medium', 'high']),
  previewAction: z.string().optional(),
});

const replyPermissionSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(['once', 'session', 'permanent', 'reject']),
});

interface SessionOwnershipRow {
  id: string;
  user_id: string;
}

interface PermissionRequestRow {
  id: string;
  session_id: string;
  tool_name: string;
  scope: string;
  reason: string;
  risk_level: 'low' | 'medium' | 'high';
  preview_action: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  decision: 'once' | 'session' | 'permanent' | 'reject' | null;
  request_payload_json: string | null;
  created_at: string;
}

export async function permissionsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/sessions/:sessionId/permissions/pending',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'permission.pending.list', undefined, {
        sessionId,
      });

      if (!ownsSession(sessionId, user.sub)) {
        step.fail('session not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const requests = sqliteAll<PermissionRequestRow>(
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, created_at
         FROM permission_requests
         WHERE session_id = ? AND status = 'pending'
         ORDER BY created_at ASC`,
        [sessionId],
      ).map(mapPermissionRequestRow);

      step.succeed(undefined, { count: requests.length });
      return reply.send({ requests });
    },
  );

  app.post(
    '/sessions/:sessionId/permissions/requests',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'permission.request.create', undefined, {
        sessionId,
      });
      const body = createPermissionRequestSchema.safeParse(request.body);

      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      if (!ownsSession(sessionId, user.sub)) {
        step.fail('session not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const requestId = randomUUID();
      sqliteRun(
        `INSERT INTO permission_requests
         (id, session_id, tool_name, scope, reason, risk_level, preview_action, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          requestId,
          sessionId,
          body.data.toolName,
          body.data.scope,
          body.data.reason,
          body.data.riskLevel,
          body.data.previewAction ?? null,
        ],
      );

      publishSessionRunEvent(
        sessionId,
        createPermissionAskedEvent({
          requestId,
          toolName: body.data.toolName,
          scope: body.data.scope,
          reason: body.data.reason,
          riskLevel: body.data.riskLevel,
          previewAction: body.data.previewAction,
        }),
      );

      step.succeed(undefined, { requestId });
      return reply.status(201).send({
        request: {
          requestId,
          sessionId,
          toolName: body.data.toolName,
          scope: body.data.scope,
          reason: body.data.reason,
          riskLevel: body.data.riskLevel,
          previewAction: body.data.previewAction,
        },
      });
    },
  );

  app.post(
    '/sessions/:sessionId/permissions/reply',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'permission.request.reply', undefined, {
        sessionId,
      });
      const body = replyPermissionSchema.safeParse(request.body);

      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      if (!ownsSession(sessionId, user.sub)) {
        step.fail('session not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const permissionRequest = sqliteGet<PermissionRequestRow>(
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, created_at
         FROM permission_requests
         WHERE id = ? AND session_id = ?
         LIMIT 1`,
        [body.data.requestId, sessionId],
      );
      if (!permissionRequest) {
        step.fail('permission request not found');
        return reply.status(404).send({ error: 'Permission request not found' });
      }
      if (permissionRequest.status !== 'pending') {
        step.fail('permission request already resolved');
        return reply.status(409).send({ error: 'Permission request already resolved' });
      }

      sqliteRun(
        `UPDATE permission_requests
         SET status = ?, decision = ?, updated_at = datetime('now')
         WHERE id = ? AND session_id = ?`,
        [
          body.data.decision === 'reject' ? 'rejected' : 'approved',
          body.data.decision,
          body.data.requestId,
          sessionId,
        ],
      );

      publishSessionRunEvent(
        sessionId,
        createPermissionRepliedEvent({
          requestId: body.data.requestId,
          decision: body.data.decision,
        }),
      );

      const resumePayload =
        body.data.decision === 'reject'
          ? null
          : parseApprovedPermissionResumePayload(permissionRequest.request_payload_json);
      if (resumePayload) {
        void resumeApprovedPermissionRequest({
          payload: {
            ...resumePayload,
            toolName: permissionRequest.tool_name,
          },
          sessionId,
          userId: user.sub,
        }).catch((error) => {
          request.log.error(
            { err: error, requestId: body.data.requestId, sessionId },
            'failed to auto-resume approved permission request',
          );
        });
      }

      step.succeed(undefined, { requestId: body.data.requestId, decision: body.data.decision });
      return reply.send({ ok: true });
    },
  );
}

function ownsSession(sessionId: string, userId: string): boolean {
  const session = sqliteGet<SessionOwnershipRow>(
    'SELECT id, user_id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  return session !== undefined;
}

function mapPermissionRequestRow(row: PermissionRequestRow) {
  return {
    requestId: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    scope: row.scope,
    reason: row.reason,
    riskLevel: row.risk_level,
    previewAction: row.preview_action ?? undefined,
    status: row.status,
    decision: row.decision ?? undefined,
    createdAt: row.created_at,
  };
}

function parseApprovedPermissionResumePayload(
  payloadJson: string | null,
): Omit<ApprovedPermissionResumePayload, 'toolName'> | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    const clientRequestId =
      typeof parsed['clientRequestId'] === 'string' ? parsed['clientRequestId'] : null;
    const toolCallId = typeof parsed['toolCallId'] === 'string' ? parsed['toolCallId'] : null;
    const nextRound = typeof parsed['nextRound'] === 'number' ? parsed['nextRound'] : null;
    const rawInput =
      parsed['rawInput'] && typeof parsed['rawInput'] === 'object'
        ? (parsed['rawInput'] as Record<string, unknown>)
        : null;
    const requestDataCandidate =
      parsed['requestData'] && typeof parsed['requestData'] === 'object'
        ? (parsed['requestData'] as Record<string, unknown>)
        : null;

    if (
      !clientRequestId ||
      !toolCallId ||
      nextRound === null ||
      !rawInput ||
      !requestDataCandidate
    ) {
      return null;
    }

    const requestData = permissionResumeRequestSchema.parse(requestDataCandidate);
    return {
      clientRequestId,
      nextRound,
      requestData,
      toolCallId,
      rawInput,
    };
  } catch {
    return null;
  }
}
