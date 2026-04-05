import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import { createPermissionRepliedEvent } from '../session-permission-events.js';
import { createQuestionRepliedEvent } from '../session-question-events.js';
import {
  createSharedSessionComment,
  listSharedSessionComments,
} from '../session-shared-comment-store.js';
import {
  listSharedSessionPresence,
  touchSharedSessionPresence,
} from '../session-shared-presence-store.js';
import { filterVisibleSessionMessages, listSessionMessages } from '../session-message-store.js';
import {
  getSharedSessionForRecipient,
  listSharedSessionsForRecipient,
} from '../session-shared-access.js';
import { buildSessionFileChangesProjection } from '../session-file-changes-projection.js';
import { listSessionFileDiffs } from '../session-file-diff-store.js';
import { listSessionRunEvents } from '../session-run-events.js';
import { listSessionSnapshots } from '../session-snapshot-store.js';
import { reconcileSessionRuntime } from '../session-runtime-reconciler.js';
import { startRequestWorkflow } from '../request-workflow.js';
import {
  parseSessionMetadataJson,
  sanitizeSessionMetadataJson,
} from '../session-workspace-metadata.js';
import { listSessionTodos } from '../todo-tools.js';
import { formatAnsweredQuestionOutput, type QuestionToolInput } from '../question-tools.js';
import { shouldExitPlanModeFromAnswers } from '../plan-mode-tools.js';
import { publishSessionRunEvent } from '../session-run-events.js';
import { expirePendingPermissionRequests } from './permissions.js';
import { expirePendingQuestionRequests } from './questions.js';
import {
  resumeAnsweredQuestionRequest,
  resumeApprovedPermissionRequest,
} from './stream-runtime.js';
import {
  type ApprovedPermissionResumePayload,
  streamRequestSchema as permissionResumeRequestSchema,
} from './stream.js';
import { persistWorkspacePermanentPermission } from '../workspace-safety.js';
import { logTeamAudit } from '../team-audit-store.js';
import { terminateTaskChildSessionAsTimeout } from '../tool-sandbox.js';
import { toPublicSessionResponse } from './session-route-helpers.js';

interface SessionRow {
  created_at: string;
  id: string;
  messages_json: string;
  metadata_json: string;
  state_status: string;
  title: string | null;
  updated_at: string;
  user_id: string;
}

interface PermissionRequestRow {
  created_at: string;
  decision: 'once' | 'session' | 'permanent' | 'reject' | null;
  expires_at: number | null;
  id: string;
  preview_action: string | null;
  reason: string;
  request_payload_json: string | null;
  risk_level: 'low' | 'medium' | 'high';
  scope: string;
  session_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  tool_name: string;
}

interface QuestionRequestRow {
  answer_json: string | null;
  created_at: string;
  expires_at: number | null;
  id: string;
  questions_json: string;
  request_payload_json: string | null;
  session_id: string;
  status: 'pending' | 'answered' | 'dismissed';
  title: string;
  tool_name: string;
  user_id: string;
}

const sharedSessionsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

const sharedSessionCommentSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

const replyPermissionSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(['once', 'session', 'permanent', 'reject']),
});

const replyQuestionSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum(['answered', 'dismissed']),
  answers: z.array(z.array(z.string())).optional().default([]),
});

function canWriteSharedComment(permission: 'view' | 'comment' | 'operate'): boolean {
  return permission === 'comment' || permission === 'operate';
}

function canOperateSharedSession(permission: 'view' | 'comment' | 'operate'): boolean {
  return permission === 'operate';
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

function mapQuestionRequestRow(row: QuestionRequestRow) {
  return {
    requestId: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    title: row.title,
    questions: JSON.parse(row.questions_json) as QuestionToolInput['questions'],
    status: row.status,
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
    const observabilityCandidate =
      parsed['observability'] && typeof parsed['observability'] === 'object'
        ? (parsed['observability'] as Record<string, unknown>)
        : null;
    return {
      clientRequestId,
      nextRound,
      requestData,
      toolCallId,
      rawInput,
      ...(observabilityCandidate
        ? {
            observability: {
              presentedToolName:
                typeof observabilityCandidate['presentedToolName'] === 'string'
                  ? observabilityCandidate['presentedToolName']
                  : 'unknown',
              canonicalToolName:
                typeof observabilityCandidate['canonicalToolName'] === 'string'
                  ? observabilityCandidate['canonicalToolName']
                  : 'unknown',
              toolSurfaceProfile:
                observabilityCandidate['toolSurfaceProfile'] === 'claude_code_simple' ||
                observabilityCandidate['toolSurfaceProfile'] === 'claude_code_default'
                  ? observabilityCandidate['toolSurfaceProfile']
                  : 'openawork',
              adapterVersion:
                typeof observabilityCandidate['adapterVersion'] === 'string'
                  ? observabilityCandidate['adapterVersion']
                  : '1.0.0',
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

function parseQuestionResumePayload(
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

    return {
      clientRequestId,
      nextRound,
      toolCallId,
      rawInput,
      requestData: requestDataCandidate,
      ...(parsed['observability'] && typeof parsed['observability'] === 'object'
        ? {
            observability: {
              presentedToolName:
                typeof (parsed['observability'] as Record<string, unknown>)['presentedToolName'] ===
                'string'
                  ? ((parsed['observability'] as Record<string, unknown>)[
                      'presentedToolName'
                    ] as string)
                  : 'unknown',
              canonicalToolName:
                typeof (parsed['observability'] as Record<string, unknown>)['canonicalToolName'] ===
                'string'
                  ? ((parsed['observability'] as Record<string, unknown>)[
                      'canonicalToolName'
                    ] as string)
                  : 'unknown',
              toolSurfaceProfile:
                (parsed['observability'] as Record<string, unknown>)['toolSurfaceProfile'] ===
                  'claude_code_simple' ||
                (parsed['observability'] as Record<string, unknown>)['toolSurfaceProfile'] ===
                  'claude_code_default'
                  ? ((parsed['observability'] as Record<string, unknown>)['toolSurfaceProfile'] as
                      | 'claude_code_default'
                      | 'claude_code_simple')
                  : 'openawork',
              adapterVersion:
                typeof (parsed['observability'] as Record<string, unknown>)['adapterVersion'] ===
                'string'
                  ? ((parsed['observability'] as Record<string, unknown>)[
                      'adapterVersion'
                    ] as string)
                  : '1.0.0',
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

function updateSessionPlanModeForExitDecision(input: {
  answers: string[][];
  sessionId: string;
}): void {
  const session = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [input.sessionId],
  );
  if (!session) {
    return;
  }

  const metadata = parseSessionMetadataJson(session.metadata_json);
  const shouldExit = shouldExitPlanModeFromAnswers(input.answers);
  const nextMetadata = { ...metadata, planMode: !shouldExit };
  sqliteRun("UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify(nextMetadata),
    input.sessionId,
  ]);
}

function listSharedPendingPermissionRequests(input: { sessionId: string }) {
  return sqliteAll<PermissionRequestRow>(
    `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, created_at
     FROM permission_requests
     WHERE session_id = ? AND status = 'pending'
     ORDER BY created_at ASC`,
    [input.sessionId],
  ).map(mapPermissionRequestRow);
}

function listSharedPendingQuestionRequests(input: { sessionId: string }) {
  return sqliteAll<QuestionRequestRow>(
    `SELECT id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status, created_at
     FROM question_requests
     WHERE session_id = ? AND status = 'pending'
     ORDER BY created_at ASC`,
    [input.sessionId],
  ).map(mapQuestionRequestRow);
}

function buildSessionFileChangesSummary(input: { sessionId: string; userId: string }) {
  return buildSessionFileChangesProjection({
    fileDiffs: listSessionFileDiffs({ sessionId: input.sessionId, userId: input.userId }),
    snapshots: listSessionSnapshots({ sessionId: input.sessionId, userId: input.userId }),
  }).summary;
}

async function reconcileSessionRuntimeForResponse(
  session: SessionRow,
  userId: string,
): Promise<SessionRow> {
  const reconciliation = await reconcileSessionRuntime({ sessionId: session.id, userId });

  if (!reconciliation.status) {
    return session;
  }

  const refreshedSession = sqliteGet<SessionRow>(
    'SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [session.id, userId],
  );
  if (refreshedSession) {
    return refreshedSession;
  }

  if (reconciliation.status === session.state_status) {
    return session;
  }

  return {
    ...session,
    state_status: reconciliation.status,
  };
}

export async function registerSessionSharedReadRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/sessions/shared-with-me',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { step } = startRequestWorkflow(request, 'session.shared.list');
      const query = sharedSessionsQuerySchema.safeParse(
        (request as FastifyRequest & { query: unknown }).query,
      );
      if (!query.success) {
        step.fail('invalid query params');
        return reply.status(400).send({ error: 'Invalid query params' });
      }

      const shares = listSharedSessionsForRecipient({
        email: user.email,
        limit: query.data.limit,
        offset: query.data.offset,
      }).map((share) => ({
        sessionId: share.session.id,
        title: share.session.title,
        stateStatus: share.session.stateStatus,
        workspacePath: share.session.workspacePath,
        sharedByEmail: share.sharedByEmail,
        permission: share.permission,
        createdAt: share.session.createdAt,
        updatedAt: share.session.updatedAt,
        shareCreatedAt: share.shareCreatedAt,
        shareUpdatedAt: share.shareUpdatedAt,
      }));

      step.succeed(undefined, { count: shares.length });
      return reply.send({ sessions: shares });
    },
  );

  app.get(
    '/sessions/shared-with-me/:sessionId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.shared.get', undefined, {
        sessionId,
      });

      const sharedAccess = getSharedSessionForRecipient({ email: user.email, sessionId });
      if (!sharedAccess) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Shared session not found' });
      }

      const sessionRow: SessionRow = {
        id: sharedAccess.session.id,
        user_id: sharedAccess.ownerUserId,
        messages_json: sharedAccess.messagesJson,
        state_status: sharedAccess.session.stateStatus,
        metadata_json: sharedAccess.session.metadataJson,
        title: sharedAccess.session.title,
        created_at: sharedAccess.session.createdAt,
        updated_at: sharedAccess.session.updatedAt,
      };
      const reconciledSession = await reconcileSessionRuntimeForResponse(
        sessionRow,
        sharedAccess.ownerUserId,
      );
      const session = toPublicSessionResponse(
        {
          ...reconciledSession,
          metadata_json: sanitizeSessionMetadataJson(reconciledSession.metadata_json),
        },
        filterVisibleSessionMessages(
          listSessionMessages({
            sessionId,
            userId: sharedAccess.ownerUserId,
            legacyMessagesJson: sharedAccess.messagesJson,
          }),
        ),
        listSessionTodos(sessionId),
        listSessionRunEvents(sessionId),
      );
      if (canOperateSharedSession(sharedAccess.permission)) {
        const expiredPermissionCount = expirePendingPermissionRequests({
          nowMs: Date.now(),
          sessionId,
        });
        const expiredQuestionCount = expirePendingQuestionRequests({
          nowMs: Date.now(),
          sessionId,
        });
        if (expiredPermissionCount > 0 || expiredQuestionCount > 0) {
          await terminateTaskChildSessionAsTimeout({
            childSessionId: sessionId,
            userId: sharedAccess.ownerUserId,
          });
        }
      }
      const pendingPermissions = canOperateSharedSession(sharedAccess.permission)
        ? listSharedPendingPermissionRequests({ sessionId })
        : [];
      const pendingQuestions = canOperateSharedSession(sharedAccess.permission)
        ? listSharedPendingQuestionRequests({ sessionId })
        : [];

      step.succeed(undefined, { permission: sharedAccess.permission, sessionId });
      return reply.send({
        share: {
          sessionId: sharedAccess.session.id,
          title: sharedAccess.session.title,
          stateStatus: reconciledSession.state_status,
          workspacePath: sharedAccess.session.workspacePath,
          sharedByEmail: sharedAccess.sharedByEmail,
          permission: sharedAccess.permission,
          createdAt: sharedAccess.session.createdAt,
          updatedAt: sharedAccess.session.updatedAt,
          shareCreatedAt: sharedAccess.shareCreatedAt,
          shareUpdatedAt: sharedAccess.shareUpdatedAt,
        },
        comments: listSharedSessionComments({
          ownerUserId: sharedAccess.ownerUserId,
          sessionId,
        }),
        presence: listSharedSessionPresence({
          ownerUserId: sharedAccess.ownerUserId,
          sessionId,
        }),
        pendingPermissions,
        pendingQuestions,
        session: {
          ...session,
          fileChangesSummary: buildSessionFileChangesSummary({
            sessionId,
            userId: sharedAccess.ownerUserId,
          }),
        },
      });
    },
  );

  app.post(
    '/sessions/shared-with-me/:sessionId/comments',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.shared.comment.create', undefined, {
        sessionId,
      });
      const body = sharedSessionCommentSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const sharedAccess = getSharedSessionForRecipient({ email: user.email, sessionId });
      if (!sharedAccess) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Shared session not found' });
      }

      if (!canWriteSharedComment(sharedAccess.permission)) {
        step.fail('forbidden');
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const comment = createSharedSessionComment({
        ownerUserId: sharedAccess.ownerUserId,
        sessionId,
        authorUserId: user.sub,
        authorEmail: user.email,
        content: body.data.content,
      });
      logTeamAudit({
        action: 'shared_comment_created',
        actorEmail: user.email,
        actorUserId: user.sub,
        detail: `会话：${sharedAccess.session.title ?? sessionId}；工作区：${sharedAccess.session.workspacePath ?? '未绑定工作区'}；评论：${body.data.content}`,
        entityId: comment.id,
        entityType: 'shared_session_comment',
        summary: `${user.email} 在“${sharedAccess.session.title ?? sessionId}”中新增了一条共享评论`,
        userId: sharedAccess.ownerUserId,
      });
      step.succeed(undefined, { commentId: comment.id });
      return reply.status(201).send({ comment });
    },
  );

  app.post(
    '/sessions/shared-with-me/:sessionId/presence',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.shared.presence.touch', undefined, {
        sessionId,
      });

      const sharedAccess = getSharedSessionForRecipient({ email: user.email, sessionId });
      if (!sharedAccess) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Shared session not found' });
      }

      const presence = touchSharedSessionPresence({
        ownerUserId: sharedAccess.ownerUserId,
        sessionId,
        viewerUserId: user.sub,
        viewerEmail: user.email,
      });

      step.succeed(undefined, { count: presence.length });
      return reply.send({ presence });
    },
  );

  app.post(
    '/sessions/shared-with-me/:sessionId/permissions/reply',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.shared.permission.reply', undefined, {
        sessionId,
      });
      const body = replyPermissionSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const sharedAccess = getSharedSessionForRecipient({ email: user.email, sessionId });
      if (!sharedAccess) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Shared session not found' });
      }
      if (!canOperateSharedSession(sharedAccess.permission)) {
        step.fail('forbidden');
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const permissionRequest = sqliteGet<PermissionRequestRow>(
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, created_at
         FROM permission_requests
         WHERE id = ? AND session_id = ?
         LIMIT 1`,
        [body.data.requestId, sessionId],
      );
      if (!permissionRequest) {
        step.fail('permission request not found');
        return reply.status(404).send({ error: 'Permission request not found' });
      }
      if (
        permissionRequest.status === 'pending' &&
        typeof permissionRequest.expires_at === 'number' &&
        permissionRequest.expires_at <= Date.now()
      ) {
        expirePendingPermissionRequests({ nowMs: Date.now(), sessionId });
        await terminateTaskChildSessionAsTimeout({
          childSessionId: sessionId,
          userId: sharedAccess.ownerUserId,
        });
        step.fail('permission request expired');
        return reply.status(409).send({ error: 'Permission request expired' });
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
        persistWorkspacePermanentPermission({
          sessionId,
          toolName: permissionRequest.tool_name,
          scope: permissionRequest.scope,
        });
      }

      const requestClientRequestId = (() => {
        if (!permissionRequest.request_payload_json) {
          return null;
        }
        try {
          const parsed = JSON.parse(permissionRequest.request_payload_json) as Record<
            string,
            unknown
          >;
          return typeof parsed['clientRequestId'] === 'string' ? parsed['clientRequestId'] : null;
        } catch {
          return null;
        }
      })();
      const resumePayload =
        body.data.decision === 'reject'
          ? null
          : parseApprovedPermissionResumePayload(permissionRequest.request_payload_json);
      publishSessionRunEvent(
        sessionId,
        createPermissionRepliedEvent({
          requestId: body.data.requestId,
          decision: body.data.decision,
        }),
        requestClientRequestId ? { clientRequestId: requestClientRequestId } : undefined,
      );
      if (resumePayload) {
        void resumeApprovedPermissionRequest({
          payload: {
            ...resumePayload,
            toolName: permissionRequest.tool_name,
          },
          sessionId,
          userId: sharedAccess.ownerUserId,
        }).catch((error) => {
          request.log.error(
            { err: error, requestId: body.data.requestId, sessionId },
            'failed to auto-resume approved shared permission request',
          );
        });
      }
      logTeamAudit({
        action: 'shared_permission_replied',
        actorEmail: user.email,
        actorUserId: user.sub,
        detail: `会话：${sharedAccess.session.title ?? sessionId}；工作区：${sharedAccess.session.workspacePath ?? '未绑定工作区'}；工具：${permissionRequest.tool_name}；范围：${permissionRequest.scope}；决策：${body.data.decision}`,
        entityId: body.data.requestId,
        entityType: 'permission_request',
        summary: `${user.email} 处理了“${sharedAccess.session.title ?? sessionId}”的权限请求（${body.data.decision}）`,
        userId: sharedAccess.ownerUserId,
      });

      step.succeed(undefined, { requestId: body.data.requestId, decision: body.data.decision });
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/sessions/shared-with-me/:sessionId/questions/reply',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.shared.question.reply', undefined, {
        sessionId,
      });
      const body = replyQuestionSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const sharedAccess = getSharedSessionForRecipient({ email: user.email, sessionId });
      if (!sharedAccess) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Shared session not found' });
      }
      if (!canOperateSharedSession(sharedAccess.permission)) {
        step.fail('forbidden');
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const questionRequest = sqliteGet<QuestionRequestRow>(
        `SELECT id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status, created_at
         FROM question_requests
         WHERE id = ? AND session_id = ?
         LIMIT 1`,
        [body.data.requestId, sessionId],
      );
      if (!questionRequest) {
        step.fail('question request not found');
        return reply.status(404).send({ error: 'Question request not found' });
      }
      if (
        questionRequest.status === 'pending' &&
        typeof questionRequest.expires_at === 'number' &&
        questionRequest.expires_at <= Date.now()
      ) {
        expirePendingQuestionRequests({ nowMs: Date.now(), sessionId });
        await terminateTaskChildSessionAsTimeout({
          childSessionId: sessionId,
          userId: sharedAccess.ownerUserId,
        });
        step.fail('question request expired');
        return reply.status(409).send({ error: 'Question request expired' });
      }
      if (questionRequest.status !== 'pending') {
        step.fail('question request already resolved');
        return reply.status(409).send({ error: 'Question request already resolved' });
      }

      sqliteRun(
        `UPDATE question_requests
         SET status = ?, answer_json = ?, updated_at = datetime('now')
         WHERE id = ? AND session_id = ?`,
        [
          body.data.status,
          body.data.status === 'answered' ? JSON.stringify(body.data.answers) : null,
          body.data.requestId,
          sessionId,
        ],
      );

      const requestClientRequestId = (() => {
        if (!questionRequest.request_payload_json) {
          return null;
        }
        try {
          const parsed = JSON.parse(questionRequest.request_payload_json) as Record<
            string,
            unknown
          >;
          return typeof parsed['clientRequestId'] === 'string' ? parsed['clientRequestId'] : null;
        } catch {
          return null;
        }
      })();
      publishSessionRunEvent(
        sessionId,
        createQuestionRepliedEvent({
          requestId: body.data.requestId,
          status: body.data.status,
        }),
        requestClientRequestId ? { clientRequestId: requestClientRequestId } : undefined,
      );

      if (body.data.status === 'answered') {
        if (questionRequest.tool_name === 'ExitPlanMode') {
          updateSessionPlanModeForExitDecision({ answers: body.data.answers, sessionId });
        }
        const payload = parseQuestionResumePayload(questionRequest.request_payload_json);
        if (payload) {
          const questions = JSON.parse(
            questionRequest.questions_json,
          ) as QuestionToolInput['questions'];
          const answerOutput = formatAnsweredQuestionOutput({
            questions,
            answers: body.data.answers,
          });
          void resumeAnsweredQuestionRequest({
            payload: {
              ...payload,
              toolName: questionRequest.tool_name,
            },
            answerOutput,
            sessionId,
            userId: sharedAccess.ownerUserId,
          }).catch((error) => {
            request.log.error(
              { err: error, requestId: body.data.requestId, sessionId },
              'failed to auto-resume answered shared question request',
            );
          });
        }
      }
      logTeamAudit({
        action: 'shared_question_replied',
        actorEmail: user.email,
        actorUserId: user.sub,
        detail: `会话：${sharedAccess.session.title ?? sessionId}；工作区：${sharedAccess.session.workspacePath ?? '未绑定工作区'}；问题：${questionRequest.title}；结果：${body.data.status}`,
        entityId: body.data.requestId,
        entityType: 'question_request',
        summary: `${user.email} 处理了“${sharedAccess.session.title ?? sessionId}”的待回答问题（${body.data.status}）`,
        userId: sharedAccess.ownerUserId,
      });

      step.succeed(undefined, { requestId: body.data.requestId, status: body.data.status });
      return reply.send({ ok: true });
    },
  );
}
