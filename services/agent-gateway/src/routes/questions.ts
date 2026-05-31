import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { ApiError } from '../infra/error-response.js';
import { parseBody } from '../infra/parse-request.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { formatAnsweredQuestionOutput, type QuestionToolInput } from '../tools/question-tools.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { createQuestionRepliedEvent } from '../session/session-question-events.js';
import { publishSessionRunEvent } from '../session/session-run-events.js';
import { shouldExitPlanModeFromAnswers } from '../tools/plan-mode-tools.js';
import { setPersistedSessionStateStatus, type ApprovedPermissionResumePayload } from './stream.js';
import { resumeAnsweredQuestionRequest } from './stream-runtime.js';

const replyQuestionSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum(['answered', 'dismissed']),
  answers: z.array(z.array(z.string())).optional().default([]),
});

interface SessionOwnershipRow {
  id: string;
  user_id: string;
}

interface QuestionRequestRow {
  id: string;
  session_id: string;
  user_id: string;
  tool_name: string;
  title: string;
  questions_json: string;
  answer_json: string | null;
  request_payload_json: string | null;
  expires_at: number | null;
  status: 'pending' | 'answered' | 'dismissed';
  created_at: string;
}

export function expirePendingQuestionRequests(input: {
  nowMs?: number;
  sessionId: string;
}): number {
  const nowMs = input.nowMs ?? Date.now();
  const requests = sqliteAll<QuestionRequestRow>(
    `SELECT id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status, created_at
     FROM question_requests
     WHERE session_id = ? AND status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?
     ORDER BY created_at ASC`,
    [input.sessionId, nowMs],
  );

  for (const request of requests) {
    sqliteRun(
      `UPDATE question_requests
       SET status = 'dismissed', updated_at = datetime('now')
       WHERE id = ? AND session_id = ? AND status = 'pending'`,
      [request.id, input.sessionId],
    );
    const requestClientRequestId = parseQuestionRequestClientRequestId(
      request.request_payload_json,
    );
    publishSessionRunEvent(
      input.sessionId,
      createQuestionRepliedEvent({ requestId: request.id, status: 'dismissed' }),
      requestClientRequestId ? { clientRequestId: requestClientRequestId } : undefined,
    );
  }

  return requests.length;
}

// Corrupt-row tolerance (§0.89 class): `questions_json` is persisted via
// `JSON.stringify`, but a crash mid-write / disk error / hand-edited DB can
// leave it invalid. The pending-questions list does `rows.map(...)`, so a
// single corrupt row used to throw and 500 the WHOLE pending-question list for
// that session — blanking every pending question, not just the bad one. Return
// `null` + warn so the list path skips the bad row, mirroring the sibling
// `mapRecoveryQuestionRequestRow` (sessions.ts) / `mapQuestionRequestRow`
// (session-shared-read-routes.ts).
function mapPendingQuestionRequestRow(row: QuestionRequestRow) {
  let questions: QuestionToolInput['questions'];
  try {
    questions = JSON.parse(row.questions_json) as QuestionToolInput['questions'];
  } catch (error) {
    console.warn(
      `[questions] 提问请求 ${row.id} questions_json 解析失败，已跳过：${
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

export async function questionsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/sessions/:sessionId/questions/pending',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'question.pending.list', undefined, {
        sessionId,
      });

      if (!ownsSession(sessionId, user.sub)) {
        step.fail('session not found');
        return reply.status(404).send({ error: '目标会话不存在。' });
      }

      const requests = sqliteAll<QuestionRequestRow>(
        `SELECT id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status, created_at
         FROM question_requests
         WHERE session_id = ? AND status = 'pending'
         ORDER BY created_at ASC`,
        [sessionId],
      )
        .map(mapPendingQuestionRequestRow)
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      step.succeed(undefined, { count: requests.length });
      return reply.send({ requests });
    },
  );

  app.post(
    '/sessions/:sessionId/questions/reply',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'question.request.reply', undefined, {
        sessionId,
      });
      const body = parseBody(replyQuestionSchema, request.body);

      if (!ownsSession(sessionId, user.sub)) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const questionRequest = sqliteGet<QuestionRequestRow>(
        `SELECT id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status, created_at
         FROM question_requests
         WHERE id = ? AND session_id = ?
         LIMIT 1`,
        [body.requestId, sessionId],
      );
      if (!questionRequest) {
        throw ApiError.notFound('目标提问请求不存在。');
      }
      if (questionRequest.status !== 'pending') {
        step.fail('question request already resolved');
        return reply.status(409).send({ error: '提问请求已处理，无法重复提交。' });
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

      const requestClientRequestId = parseQuestionRequestClientRequestId(
        questionRequest.request_payload_json,
      );
      publishSessionRunEvent(
        sessionId,
        createQuestionRepliedEvent({
          requestId: body.requestId,
          status: body.status,
        }),
        requestClientRequestId ? { clientRequestId: requestClientRequestId } : undefined,
      );

      const resumePayload =
        body.status === 'answered'
          ? parseQuestionResumePayload(questionRequest.request_payload_json)
          : null;

      // Synchronously transition the persisted session state BEFORE returning
      // the HTTP response. The frontend immediately re-fetches the recovery
      // snapshot after a successful reply; without this update the row still
      // says 'paused' while the question_request is no longer pending, which
      // causes reconcileSessionStateStatus to forcibly reset the session to
      // 'idle' and prevents the SSE attach loop from kicking in even when a
      // resume is on its way. Mirrors permissions.ts:366-370.
      setPersistedSessionStateStatus({
        sessionId,
        status: resumePayload ? 'running' : 'idle',
        userId: user.sub,
      });

      if (body.status === 'answered') {
        if (questionRequest.tool_name === 'ExitPlanMode') {
          updateSessionPlanModeForExitDecision({
            answers: body.answers,
            sessionId,
          });
        }
        if (resumePayload) {
          const questions = JSON.parse(
            questionRequest.questions_json,
          ) as QuestionToolInput['questions'];
          const answerOutput = formatAnsweredQuestionOutput({
            questions,
            answers: body.answers,
          });
          void resumeAnsweredQuestionRequest({
            payload: {
              ...resumePayload,
              toolName: questionRequest.tool_name,
            },
            answerOutput,
            sessionId,
            userId: user.sub,
          }).catch((error) => {
            request.log.error(
              { err: error, requestId: body.requestId, sessionId },
              'failed to auto-resume answered question request',
            );
          });
        }
      }

      step.succeed(undefined, { requestId: body.requestId, status: body.status });
      return reply.send({ ok: true });
    },
  );
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

function ownsSession(sessionId: string, userId: string): boolean {
  const session = sqliteGet<SessionOwnershipRow>(
    'SELECT id, user_id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  return session !== undefined;
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
    } as Omit<ApprovedPermissionResumePayload, 'toolName'>;
  } catch {
    return null;
  }
}

function parseQuestionRequestClientRequestId(payloadJson: string | null): string | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    return typeof parsed['clientRequestId'] === 'string' ? parsed['clientRequestId'] : null;
  } catch {
    return null;
  }
}
