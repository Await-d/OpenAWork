import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseQuery } from '../infra/parse-request.js';
import {
  mapPermissionRequestRow,
  parseApprovedPermissionResumePayload,
  parsePermissionAlwaysJson,
  type PermissionDecision,
  type PermissionRequestStatus,
  type PermissionRiskLevel,
} from '../permission/permission-contract.js';
import type { JwtPayload } from '../infra/auth.js';
import { appendPermissionDecisionLog } from '../session/permission-decision-log-store.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { createPermissionRepliedEvent } from '../session/session-permission-events.js';
import { createQuestionRepliedEvent } from '../session/session-question-events.js';
import {
  createSharedSessionComment,
  listSharedSessionComments,
} from '../session/session-shared-comment-store.js';
import {
  listSharedSessionPresence,
  touchSharedSessionPresence,
} from '../session/session-shared-presence-store.js';
import { filterVisibleSessionMessages } from '../session/session-message-store.js';
import {
  listSessionMessagesV2,
  listRuntimeSafeSessionMessagesV2,
} from '../message/message-v2-adapter.js';
import {
  getSharedSessionForRecipient,
  listSharedSessionsForRecipient,
} from '../session/session-shared-access.js';
import { buildSessionFileChangesProjection } from '../session/session-file-changes-projection.js';
import { listSessionFileDiffs } from '../session/session-file-diff-store.js';
import { listSessionRunEvents } from '../session/session-run-events.js';
import { listSessionSnapshots } from '../session/session-snapshot-store.js';
import { reconcileSessionRuntime } from '../session/session-runtime-reconciler.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  parseSessionMetadataJson,
  sanitizeSessionMetadataJson,
} from '../session/session-workspace-metadata.js';
import { listSessionTodos } from '../tools/todo-tools.js';
import { formatAnsweredQuestionOutput, type QuestionToolInput } from '../tools/question-tools.js';
import { shouldExitPlanModeFromAnswers } from '../tools/plan-mode-tools.js';
import { publishSessionRunEvent } from '../session/session-run-events.js';
import {
  resumeAnsweredQuestionRequest,
  resumeApprovedPermissionRequest,
} from './stream-runtime.js';
import { type ApprovedPermissionResumePayload } from './stream.js';
import { expirePendingPermissionRequests } from './permissions.js';
import { expirePendingQuestionRequests } from './questions.js';
import { persistWorkspacePermanentPermission } from '../workspace/workspace-safety.js';
import { resolvePermissionCategory } from '@openAwork/agent-core';
import { logTeamAudit } from '../team/team-audit-store.js';
import { toPublicSessionResponse } from './session-route-helpers.js';
import { mergeRuntimeSafeSessionMessages } from '../session/runtime-safe-message-merge.js';
import { markPermissionNotificationsReadByRequestIds } from '../session/notification-store.js';

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
import { parseBody } from '../infra/parse-request.js';

interface PermissionRequestRow {
  always_json: string | null;
  created_at: string;
  decision: PermissionDecision | null;
  expires_at: number | null;
  id: string;
  preview_action: string | null;
  reason: string;
  request_payload_json: string | null;
  risk_level: PermissionRiskLevel;
  scope: string;
  session_id: string;
  status: PermissionRequestStatus | 'consumed';
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

const sharedSessionPermissionDecisionSchema = z.enum(['once', 'session', 'permanent', 'reject']);

const replyPermissionSchema = z.object({
  requestId: z.string().min(1),
  decision: sharedSessionPermissionDecisionSchema,
  alwaysOverride: z.array(z.string().min(1)).optional(),
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

// Corrupt-row tolerance (§0.89-§0.92 class): `questions_json` is persisted
// via `JSON.stringify`, but a crash mid-write, a disk error, or a hand-edited
// DB can leave a column that is not valid JSON. The pending-questions list does
// `.map(mapQuestionRequestRow)`, so a SINGLE corrupt row used to throw and 500
// the WHOLE shared-session pending-questions list — making every pending
// question unviewable. Return `null` + warn so the list path can skip the bad
// row, mirroring the sibling `mapPermissionRequestRow`.
function mapQuestionRequestRow(row: QuestionRequestRow) {
  let questions: QuestionToolInput['questions'];
  try {
    questions = JSON.parse(row.questions_json) as QuestionToolInput['questions'];
  } catch (error) {
    console.warn(
      `[shared-session] 提问请求 ${row.id} questions_json 解析失败，已跳过：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
  return {
    requestId: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    title: row.title,
    questions,
    status: row.status,
    createdAt: row.created_at,
  };
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
    `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, always_json, created_at
     FROM permission_requests
     WHERE session_id = ? AND status = 'pending'
     ORDER BY created_at ASC`,
    [input.sessionId],
  ).flatMap((row) => {
    const mapped = mapPermissionRequestRow(row);
    return mapped ? [mapped] : [];
  });
}

function listSharedPendingQuestionRequests(input: { sessionId: string }) {
  return sqliteAll<QuestionRequestRow>(
    `SELECT id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status, created_at
     FROM question_requests
     WHERE session_id = ? AND status = 'pending'
     ORDER BY created_at ASC`,
    [input.sessionId],
  ).flatMap((row) => {
    const mapped = mapQuestionRequestRow(row);
    return mapped ? [mapped] : [];
  });
}

type SharedSessionRecipientAccess = NonNullable<ReturnType<typeof getSharedSessionForRecipient>>;

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

async function buildSharedSessionDetailResponse(input: {
  sharedAccess: SharedSessionRecipientAccess;
  sessionId: string;
}): Promise<{
  comments: ReturnType<typeof listSharedSessionComments>;
  pendingPermissions: ReturnType<typeof listSharedPendingPermissionRequests>;
  pendingQuestions: ReturnType<typeof listSharedPendingQuestionRequests>;
  presence: ReturnType<typeof listSharedSessionPresence>;
  share: {
    createdAt: string;
    permission: SharedSessionRecipientAccess['permission'];
    sessionId: string;
    shareCreatedAt: string;
    shareUpdatedAt: string;
    sharedByEmail: string;
    stateStatus: string;
    title: string | null;
    updatedAt: string;
    workspacePath: string | null;
  };
  session: ReturnType<typeof toPublicSessionResponse> & {
    fileChangesSummary: ReturnType<typeof buildSessionFileChangesSummary>;
  };
}> {
  const sessionRow: SessionRow = {
    id: input.sharedAccess.session.id,
    user_id: input.sharedAccess.ownerUserId,
    messages_json: input.sharedAccess.messagesJson,
    state_status: input.sharedAccess.session.stateStatus,
    metadata_json: input.sharedAccess.session.metadataJson,
    title: input.sharedAccess.session.title,
    created_at: input.sharedAccess.session.createdAt,
    updated_at: input.sharedAccess.session.updatedAt,
  };
  const reconciledSession = await reconcileSessionRuntimeForResponse(
    sessionRow,
    input.sharedAccess.ownerUserId,
  );
  const sessionMessages = mergeRuntimeSafeSessionMessages({
    legacyMessages: listSessionMessagesV2({
      sessionId: input.sessionId,
      userId: input.sharedAccess.ownerUserId,
    }),
    runtimeMessages: listRuntimeSafeSessionMessagesV2({
      sessionId: input.sessionId,
      userId: input.sharedAccess.ownerUserId,
    }),
  });

  const session = toPublicSessionResponse(
    {
      ...reconciledSession,
      metadata_json: sanitizeSessionMetadataJson(reconciledSession.metadata_json),
    },
    filterVisibleSessionMessages(sessionMessages),
    listSessionTodos(input.sessionId),
    listSessionRunEvents(input.sessionId),
  );
  if (canOperateSharedSession(input.sharedAccess.permission)) {
    const nowMs = Date.now();
    expirePendingPermissionRequests({ nowMs, sessionId: input.sessionId });
    expirePendingQuestionRequests({ nowMs, sessionId: input.sessionId });
  }
  const pendingPermissions = canOperateSharedSession(input.sharedAccess.permission)
    ? listSharedPendingPermissionRequests({ sessionId: input.sessionId })
    : [];
  const pendingQuestions = canOperateSharedSession(input.sharedAccess.permission)
    ? listSharedPendingQuestionRequests({ sessionId: input.sessionId })
    : [];

  return {
    share: {
      sessionId: input.sharedAccess.session.id,
      title: input.sharedAccess.session.title,
      stateStatus: reconciledSession.state_status,
      workspacePath: input.sharedAccess.session.workspacePath,
      sharedByEmail: input.sharedAccess.sharedByEmail,
      permission: input.sharedAccess.permission,
      createdAt: input.sharedAccess.session.createdAt,
      updatedAt: input.sharedAccess.session.updatedAt,
      shareCreatedAt: input.sharedAccess.shareCreatedAt,
      shareUpdatedAt: input.sharedAccess.shareUpdatedAt,
    },
    comments: listSharedSessionComments({
      ownerUserId: input.sharedAccess.ownerUserId,
      sessionId: input.sessionId,
    }),
    presence: listSharedSessionPresence({
      ownerUserId: input.sharedAccess.ownerUserId,
      sessionId: input.sessionId,
    }),
    pendingPermissions,
    pendingQuestions,
    session: {
      ...session,
      fileChangesSummary: buildSessionFileChangesSummary({
        sessionId: input.sessionId,
        userId: input.sharedAccess.ownerUserId,
      }),
    },
  };
}

export async function registerSessionSharedReadRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/sessions/shared-with-me',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { step } = startRequestWorkflow(request, 'session.shared.list');
      const query = parseQuery(
        sharedSessionsQuerySchema,
        (request as FastifyRequest & { query: unknown }).query,
      );

      const shares = listSharedSessionsForRecipient({
        email: user.email,
        limit: query.limit,
        offset: query.offset,
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
        return reply.status(404).send({ error: '目标共享会话不存在。' });
      }
      const detail = await buildSharedSessionDetailResponse({
        sharedAccess,
        sessionId,
      });

      step.succeed(undefined, { permission: sharedAccess.permission, sessionId });
      return reply.send(detail);
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
      const body = parseBody(sharedSessionCommentSchema, request.body);

      const sharedAccess = getSharedSessionForRecipient({ email: user.email, sessionId });
      if (!sharedAccess) {
        step.fail('not found');
        return reply.status(404).send({ error: '目标共享会话不存在。' });
      }

      if (!canWriteSharedComment(sharedAccess.permission)) {
        step.fail('forbidden');
        return reply.status(403).send({ error: '当前共享权限不足，无法执行该操作。' });
      }

      const comment = createSharedSessionComment({
        ownerUserId: sharedAccess.ownerUserId,
        sessionId,
        authorUserId: user.sub,
        authorEmail: user.email,
        content: body.content,
      });
      logTeamAudit({
        action: 'shared_comment_created',
        actorEmail: user.email,
        actorUserId: user.sub,
        detail: `会话：${sharedAccess.session.title ?? sessionId}；工作区：${sharedAccess.session.workspacePath ?? '未绑定工作区'}；评论：${body.content}`,
        entityId: comment.id,
        entityType: 'shared_session_comment',
        sessionId,
        summary: `${user.email} 在“${sharedAccess.session.title ?? sessionId}”中新增了一条共享评论`,
        userId: sharedAccess.ownerUserId,
      });
      step.succeed(undefined, { commentId: comment.id });
      return reply.status(201).send({
        comment,
        detail: await buildSharedSessionDetailResponse({
          sharedAccess,
          sessionId,
        }),
      });
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
        return reply.status(404).send({ error: '目标共享会话不存在。' });
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
      const body = parseBody(replyPermissionSchema, request.body);

      const sharedAccess = getSharedSessionForRecipient({ email: user.email, sessionId });
      if (!sharedAccess) {
        step.fail('not found');
        return reply.status(404).send({ error: '目标共享会话不存在。' });
      }
      if (!canOperateSharedSession(sharedAccess.permission)) {
        step.fail('forbidden');
        return reply.status(403).send({ error: '当前共享权限不足，无法执行该操作。' });
      }

      const permissionRequest = sqliteGet<PermissionRequestRow>(
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, always_json, created_at
         FROM permission_requests
         WHERE id = ? AND session_id = ?
         LIMIT 1`,
        [body.requestId, sessionId],
      );
      if (!permissionRequest) {
        step.fail('permission request not found');
        return reply.status(404).send({ error: '目标权限请求不存在。' });
      }
      if (permissionRequest.status !== 'pending') {
        step.fail('permission request already resolved');
        return reply.status(409).send({ error: '权限请求已处理，无法重复提交。' });
      }

      sqliteRun(
        `UPDATE permission_requests
         SET status = ?, decision = ?, updated_at = datetime('now')
         WHERE id = ? AND session_id = ?`,
        [
          body.decision === 'reject' ? 'rejected' : 'approved',
          body.decision,
          body.requestId,
          sessionId,
        ],
      );
      appendPermissionDecisionLog({
        requestId: body.requestId,
        sessionId,
        toolName: permissionRequest.tool_name,
        scope: permissionRequest.scope,
        decision: body.decision,
      });

      const permissionCategory = resolvePermissionCategory(permissionRequest.tool_name);
      const alwaysPatterns =
        body.alwaysOverride && body.alwaysOverride.length > 0
          ? body.alwaysOverride
          : (() => {
              const parsedAlways = parsePermissionAlwaysJson(permissionRequest.always_json);
              return parsedAlways.length > 0 ? parsedAlways : [permissionRequest.scope];
            })();

      if (body.decision === 'permanent') {
        for (const pattern of alwaysPatterns) {
          persistWorkspacePermanentPermission({
            sessionId,
            toolName: permissionCategory,
            scope: pattern,
          });
        }
      } else if (body.decision === 'session') {
        for (const pattern of alwaysPatterns) {
          const existing = sqliteGet<{ id: string }>(
            `SELECT id FROM permission_requests
             WHERE session_id = ? AND tool_name = ? AND scope = ?
               AND status = 'approved' AND decision = 'session'
             LIMIT 1`,
            [sessionId, permissionCategory, pattern],
          );
          if (existing) continue;
          if (
            permissionCategory === permissionRequest.tool_name &&
            pattern === permissionRequest.scope
          ) {
            continue;
          }
          sqliteRun(
            `INSERT INTO permission_requests
             (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status, decision)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'approved', 'session')`,
            [
              randomUUID(),
              sessionId,
              permissionCategory,
              pattern,
              permissionRequest.reason,
              permissionRequest.risk_level,
              permissionRequest.preview_action,
              JSON.stringify([pattern]),
            ],
          );
        }
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
        body.decision === 'reject'
          ? null
          : parseApprovedPermissionResumePayload(permissionRequest.request_payload_json);
      publishSessionRunEvent(
        sessionId,
        createPermissionRepliedEvent({
          requestId: body.requestId,
          decision: body.decision,
        }),
        requestClientRequestId ? { clientRequestId: requestClientRequestId } : undefined,
      );
      markPermissionNotificationsReadByRequestIds({
        requestIds: [body.requestId],
        sessionId,
        userId: sharedAccess.ownerUserId,
      });
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
            { err: error, requestId: body.requestId, sessionId },
            'failed to auto-resume approved shared permission request',
          );
        });
      }
      logTeamAudit({
        action: 'shared_permission_replied',
        actorEmail: user.email,
        actorUserId: user.sub,
        detail: `会话：${sharedAccess.session.title ?? sessionId}；工作区：${sharedAccess.session.workspacePath ?? '未绑定工作区'}；工具：${permissionRequest.tool_name}；范围：${permissionRequest.scope}；决策：${body.decision}`,
        entityId: body.requestId,
        entityType: 'permission_request',
        sessionId,
        summary: `${user.email} 处理了“${sharedAccess.session.title ?? sessionId}”的权限请求（${body.decision}）`,
        userId: sharedAccess.ownerUserId,
      });

      step.succeed(undefined, { requestId: body.requestId, decision: body.decision });
      return reply.send({
        ok: true,
        detail: await buildSharedSessionDetailResponse({
          sharedAccess,
          sessionId,
        }),
      });
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
      const body = parseBody(replyQuestionSchema, request.body);

      const sharedAccess = getSharedSessionForRecipient({ email: user.email, sessionId });
      if (!sharedAccess) {
        step.fail('not found');
        return reply.status(404).send({ error: '目标共享会话不存在。' });
      }
      if (!canOperateSharedSession(sharedAccess.permission)) {
        step.fail('forbidden');
        return reply.status(403).send({ error: '当前共享权限不足，无法执行该操作。' });
      }

      const questionRequest = sqliteGet<QuestionRequestRow>(
        `SELECT id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status, created_at
         FROM question_requests
         WHERE id = ? AND session_id = ?
         LIMIT 1`,
        [body.requestId, sessionId],
      );
      if (!questionRequest) {
        if (body.status === 'dismissed') {
          publishSessionRunEvent(
            sessionId,
            createQuestionRepliedEvent({
              requestId: body.requestId,
              status: 'dismissed',
            }),
          );
          step.succeed(undefined, {
            idempotent: true,
            requestId: body.requestId,
            status: body.status,
          });
          return reply.send({
            ok: true,
            idempotent: true,
            detail: await buildSharedSessionDetailResponse({
              sharedAccess,
              sessionId,
            }),
          });
        }
        step.fail('question request not found');
        return reply.status(404).send({ error: '目标提问请求不存在。' });
      }
      if (questionRequest.status !== 'pending') {
        publishSessionRunEvent(
          sessionId,
          createQuestionRepliedEvent({
            requestId: body.requestId,
            status: questionRequest.status === 'answered' ? 'answered' : 'dismissed',
          }),
        );
        step.succeed(undefined, {
          alreadyResolved: true,
          requestId: body.requestId,
          status: questionRequest.status,
        });
        return reply.send({
          ok: true,
          alreadyResolved: true,
          detail: await buildSharedSessionDetailResponse({
            sharedAccess,
            sessionId,
          }),
        });
      }

      sqliteRun(
        `UPDATE question_requests
         SET status = ?, answer_json = ?, updated_at = datetime('now')
         WHERE id = ? AND session_id = ?`,
        [
          body.status,
          body.status === 'answered' ? JSON.stringify(body.answers) : null,
          body.requestId,
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
          requestId: body.requestId,
          status: body.status,
        }),
        requestClientRequestId ? { clientRequestId: requestClientRequestId } : undefined,
      );

      if (body.status === 'answered') {
        if (questionRequest.tool_name === 'ExitPlanMode') {
          updateSessionPlanModeForExitDecision({ answers: body.answers, sessionId });
        }
        const payload = parseQuestionResumePayload(questionRequest.request_payload_json);
        if (payload) {
          const questions = JSON.parse(
            questionRequest.questions_json,
          ) as QuestionToolInput['questions'];
          const answerOutput = formatAnsweredQuestionOutput({
            questions,
            answers: body.answers,
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
              { err: error, requestId: body.requestId, sessionId },
              'failed to auto-resume answered shared question request',
            );
          });
        }
      }
      logTeamAudit({
        action: 'shared_question_replied',
        actorEmail: user.email,
        actorUserId: user.sub,
        detail: `会话：${sharedAccess.session.title ?? sessionId}；工作区：${sharedAccess.session.workspacePath ?? '未绑定工作区'}；问题：${questionRequest.title}；结果：${body.status}`,
        entityId: body.requestId,
        entityType: 'question_request',
        sessionId,
        summary: `${user.email} 处理了“${sharedAccess.session.title ?? sessionId}”的待回答问题（${body.status}）`,
        userId: sharedAccess.ownerUserId,
      });

      step.succeed(undefined, { requestId: body.requestId, status: body.status });
      return reply.send({
        ok: true,
        detail: await buildSharedSessionDetailResponse({
          sharedAccess,
          sessionId,
        }),
      });
    },
  );
}
