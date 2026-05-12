import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  mapPermissionRequestRow,
  parseApprovedPermissionResumePayload,
  parsePermissionAlwaysJson,
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
  always: z.array(z.string().min(1)).optional(),
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
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, always_json, created_at
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
      const alwaysPatterns =
        body.data.always && body.data.always.length > 0 ? body.data.always : null;
      sqliteRun(
        `INSERT INTO permission_requests
         (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
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
          alwaysPatterns ? JSON.stringify(alwaysPatterns) : null,
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
          ...(alwaysPatterns ? { always: alwaysPatterns } : {}),
        }),
        { clientRequestId },
      );

      const createdRequest = sqliteGet<PermissionRequestRow>(
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, always_json, created_at
         FROM permission_requests
         WHERE id = ? AND session_id = ?
         LIMIT 1`,
        [requestId, sessionId],
      );

      const fallback = {
        requestId,
        sessionId,
        toolName: body.data.toolName,
        scope: body.data.scope,
        reason: body.data.reason,
        riskLevel: body.data.riskLevel,
        previewAction: body.data.previewAction,
        ...(alwaysPatterns ? { always: alwaysPatterns } : {}),
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };

      step.succeed(undefined, { requestId });
      return reply.status(201).send({
        request: createdRequest ? (mapPermissionRequestRow(createdRequest) ?? fallback) : fallback,
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
        // Legacy rows without an `always_json` (column added later) fall back
        // to the original request scope so we never silently broaden a
        // permanent grant to "*" just because the column was missing.
        const category = resolvePermissionCategory(permissionRequest.tool_name);
        const parsedAlways = parsePermissionAlwaysJson(permissionRequest.always_json);
        const alwaysPatterns = parsedAlways.length > 0 ? parsedAlways : [permissionRequest.scope];
        for (const pattern of alwaysPatterns) {
          persistWorkspacePermanentPermission({
            sessionId,
            toolName: category,
            scope: pattern,
          });
        }
      } else if (body.data.decision === 'session') {
        // Mirror opencode's `permission.ask reply='always'` semantics: when
        // the user picks 本会话允许, push every `always` pattern into the set
        // of approved scopes for this session so subsequent requests in the
        // same category whose scope matches one of those patterns auto-resolve
        // without re-prompting (e.g. approving `ls -la` covers `ls /tmp`,
        // `ls -a` etc. via the arity pattern `ls *`).
        //
        // We persist as synthetic `permission_requests` rows (status='approved',
        // decision='session', scope=<pattern>) — `findApprovedPermission` then
        // matches via wildcard. Synthetic rows are keyed by (tool_name, scope)
        // to stay idempotent if the same broad approval is granted twice.
        const category = resolvePermissionCategory(permissionRequest.tool_name);
        const parsedAlways = parsePermissionAlwaysJson(permissionRequest.always_json);
        const alwaysPatterns = parsedAlways.length > 0 ? parsedAlways : [permissionRequest.scope];
        for (const pattern of alwaysPatterns) {
          const existing = sqliteGet<{ id: string }>(
            `SELECT id FROM permission_requests
             WHERE session_id = ? AND tool_name = ? AND scope = ?
               AND status = 'approved' AND decision = 'session'
             LIMIT 1`,
            [sessionId, category, pattern],
          );
          if (existing) continue;
          // Avoid clashing with the original row that has scope = literal command.
          if (category === permissionRequest.tool_name && pattern === permissionRequest.scope) {
            continue;
          }
          sqliteRun(
            `INSERT INTO permission_requests
             (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status, decision)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'approved', 'session')`,
            [
              randomUUID(),
              sessionId,
              category,
              pattern,
              permissionRequest.reason,
              permissionRequest.risk_level,
              permissionRequest.preview_action,
              JSON.stringify([pattern]),
            ],
          );
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
