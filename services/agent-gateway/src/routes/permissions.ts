import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  mapPermissionRequestRow,
  parseApprovedPermissionResumePayload,
  parsePermissionRequestClientRequestId,
  permissionDecisionSchema,
  permissionRiskLevelSchema,
  type PermissionDecision,
  type PermissionRequestStatus,
  type PermissionRiskLevel,
} from '../permission-contract.js';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import {
  createPermissionAskedEvent,
  createPermissionRepliedEvent,
} from '../session-permission-events.js';
import { publishSessionRunEvent } from '../session-run-events.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { setPersistedSessionStateStatus } from './stream.js';
import {
  resumeApprovedPermissionRequest,
  resumeRejectedPermissionRequest,
} from './stream-runtime.js';
import { persistWorkspacePermanentPermission } from '../workspace-safety.js';
import { resolvePermissionCategory } from '@openAwork/agent-core';

const createPermissionRequestSchema = z.object({
  toolName: z.string().min(1),
  scope: z.string().min(1),
  reason: z.string().min(1),
  riskLevel: permissionRiskLevelSchema,
  previewAction: z.string().optional(),
  clientRequestId: z.string().min(1).max(128).optional(),
});

const replyPermissionSchema = z.object({
  requestId: z.string().min(1),
  decision: permissionDecisionSchema,
  feedback: z.string().max(2000).optional(),
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
  risk_level: PermissionRiskLevel;
  preview_action: string | null;
  status: PermissionRequestStatus | 'consumed';
  decision: PermissionDecision | null;
  request_payload_json: string | null;
  expires_at: number | null;
  always_json: string | null;
  created_at: string;
}

function parseAlwaysJson(raw: string | null): string[] {
  if (!raw) return ['*'];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
    }
  } catch {
    // fall through
  }
  return ['*'];
}

export function expirePendingPermissionRequests(input: {
  nowMs?: number;
  sessionId: string;
}): number {
  const nowMs = input.nowMs ?? Date.now();
  const requests = sqliteAll<PermissionRequestRow>(
    `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, created_at
     FROM permission_requests
     WHERE session_id = ? AND status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?
     ORDER BY created_at ASC`,
    [input.sessionId, nowMs],
  );

  for (const request of requests) {
    sqliteRun(
      `UPDATE permission_requests
       SET status = 'rejected', decision = 'reject', updated_at = datetime('now')
       WHERE id = ? AND session_id = ? AND status = 'pending'`,
      [request.id, input.sessionId],
    );
    const requestClientRequestId = parsePermissionRequestClientRequestId(
      request.request_payload_json,
    );
    publishSessionRunEvent(
      input.sessionId,
      createPermissionRepliedEvent({ requestId: request.id, decision: 'reject' }),
      requestClientRequestId ? { clientRequestId: requestClientRequestId } : undefined,
    );
  }

  return requests.length;
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
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, created_at
         FROM permission_requests
         WHERE session_id = ? AND status = 'pending'
         ORDER BY created_at ASC`,
        [sessionId],
      ).flatMap((row) => {
        const mapped = mapPermissionRequestRow(row);
        return mapped ? [mapped] : [];
      });

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
      const clientRequestId = body.data.clientRequestId ?? `permission:${requestId}`;
      sqliteRun(
        `INSERT INTO permission_requests
         (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          requestId,
          sessionId,
          body.data.toolName,
          body.data.scope,
          body.data.reason,
          body.data.riskLevel,
          body.data.previewAction ?? null,
          JSON.stringify({ clientRequestId }),
          null,
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
        { clientRequestId },
      );

      const createdRequest = sqliteGet<PermissionRequestRow>(
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, created_at
         FROM permission_requests
         WHERE id = ? AND session_id = ?
         LIMIT 1`,
        [requestId, sessionId],
      );

      step.succeed(undefined, { requestId });
      return reply.status(201).send({
        request: createdRequest
          ? (mapPermissionRequestRow(createdRequest) ?? {
              requestId,
              sessionId,
              toolName: body.data.toolName,
              scope: body.data.scope,
              reason: body.data.reason,
              riskLevel: body.data.riskLevel,
              previewAction: body.data.previewAction,
              status: 'pending',
              createdAt: new Date().toISOString(),
            })
          : {
              requestId,
              sessionId,
              toolName: body.data.toolName,
              scope: body.data.scope,
              reason: body.data.reason,
              riskLevel: body.data.riskLevel,
              previewAction: body.data.previewAction,
              status: 'pending',
              createdAt: new Date().toISOString(),
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
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, always_json, created_at
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

      sqliteRun(
        `INSERT INTO permission_decision_logs
         (request_id, session_id, tool_name, scope, decision, workspace_root, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, datetime('now'))`,
        [
          body.data.requestId,
          sessionId,
          permissionRequest.tool_name,
          permissionRequest.scope,
          body.data.decision,
        ],
      );

      if (body.data.decision === 'permanent') {
        // Use always patterns (from opencode ctx.ask always) for broad approval.
        // e.g. approving edit with always:["*"] → write rule { permission: "edit", pattern: "*" }
        const category = resolvePermissionCategory(permissionRequest.tool_name);
        const alwaysPatterns = parseAlwaysJson(permissionRequest.always_json);
        for (const pattern of alwaysPatterns) {
          persistWorkspacePermanentPermission({
            sessionId,
            toolName: category,
            scope: pattern,
          });
        }
      }

      // Cascade reject: when rejecting, also reject all other pending requests in the same session.
      // This mirrors opencode's behavior where rejecting one permission cascades to all pending.
      const cascadedRequestIds: string[] = [];
      if (body.data.decision === 'reject') {
        const otherPending = sqliteAll<PermissionRequestRow>(
          `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, created_at
           FROM permission_requests
           WHERE session_id = ? AND status = 'pending' AND id != ?
           ORDER BY created_at ASC`,
          [sessionId, body.data.requestId],
        );
        for (const pending of otherPending) {
          sqliteRun(
            `UPDATE permission_requests
             SET status = 'rejected', decision = 'reject', updated_at = datetime('now')
             WHERE id = ? AND session_id = ? AND status = 'pending'`,
            [pending.id, sessionId],
          );
          const pendingClientRequestId = parsePermissionRequestClientRequestId(
            pending.request_payload_json,
          );
          publishSessionRunEvent(
            sessionId,
            createPermissionRepliedEvent({ requestId: pending.id, decision: 'reject' }),
            pendingClientRequestId ? { clientRequestId: pendingClientRequestId } : undefined,
          );
          cascadedRequestIds.push(pending.id);
        }
      }

      const requestClientRequestId = parsePermissionRequestClientRequestId(
        permissionRequest.request_payload_json,
      );
      const resumePayload = parseApprovedPermissionResumePayload(
        permissionRequest.request_payload_json,
      );
      publishSessionRunEvent(
        sessionId,
        createPermissionRepliedEvent({
          requestId: body.data.requestId,
          decision: body.data.decision,
          ...(body.data.decision === 'reject' && body.data.feedback
            ? { feedback: body.data.feedback }
            : {}),
        }),
        requestClientRequestId ? { clientRequestId: requestClientRequestId } : undefined,
      );

      // Continue-on-deny: when enabled, feed the rejection as a tool error and
      // resume the LLM loop so it can try a different approach.
      const continueOnDeny =
        body.data.decision === 'reject' &&
        resumePayload &&
        process.env['OPENAWORK_CONTINUE_ON_DENY'] === 'true';

      setPersistedSessionStateStatus({
        sessionId,
        status: body.data.decision === 'reject' && !continueOnDeny ? 'idle' : 'running',
        userId: user.sub,
      });

      if (body.data.decision !== 'reject' && resumePayload) {
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
      } else if (continueOnDeny && resumePayload) {
        void resumeRejectedPermissionRequest({
          payload: {
            ...resumePayload,
            toolName: permissionRequest.tool_name,
          },
          feedback: body.data.feedback,
          sessionId,
          userId: user.sub,
        }).catch((error) => {
          request.log.error(
            { err: error, requestId: body.data.requestId, sessionId },
            'failed to resume after rejected permission (continue-on-deny)',
          );
        });
      }

      step.succeed(undefined, {
        requestId: body.data.requestId,
        decision: body.data.decision,
        ...(cascadedRequestIds.length > 0 ? { cascadedCount: cascadedRequestIds.length } : {}),
      });
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
