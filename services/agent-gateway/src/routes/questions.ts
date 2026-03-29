import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { formatAnsweredQuestionOutput, type QuestionToolInput } from '../question-tools.js';
import { resumeAnsweredQuestionRequest, type ApprovedPermissionResumePayload } from './stream.js';

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
  status: 'pending' | 'answered' | 'dismissed';
  created_at: string;
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
        return reply.status(404).send({ error: 'Session not found' });
      }

      const requests = sqliteAll<QuestionRequestRow>(
        `SELECT id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, status, created_at
         FROM question_requests
         WHERE session_id = ? AND status = 'pending'
         ORDER BY created_at ASC`,
        [sessionId],
      ).map((row) => ({
        requestId: row.id,
        sessionId: row.session_id,
        toolName: row.tool_name,
        title: row.title,
        questions: JSON.parse(row.questions_json) as QuestionToolInput['questions'],
        status: row.status,
        createdAt: row.created_at,
      }));

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
      const body = replyQuestionSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      if (!ownsSession(sessionId, user.sub)) {
        step.fail('session not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const questionRequest = sqliteGet<QuestionRequestRow>(
        `SELECT id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, status, created_at
         FROM question_requests
         WHERE id = ? AND session_id = ?
         LIMIT 1`,
        [body.data.requestId, sessionId],
      );
      if (!questionRequest) {
        step.fail('question request not found');
        return reply.status(404).send({ error: 'Question request not found' });
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

      if (body.data.status === 'answered') {
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
            userId: user.sub,
          }).catch((error) => {
            request.log.error(
              { err: error, requestId: body.data.requestId, sessionId },
              'failed to auto-resume answered question request',
            );
          });
        }
      }

      step.succeed(undefined, { requestId: body.data.requestId, status: body.data.status });
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
    } as Omit<ApprovedPermissionResumePayload, 'toolName'>;
  } catch {
    return null;
  }
}
