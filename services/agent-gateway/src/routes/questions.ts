import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DialogueMode } from '@openAwork/shared';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { ApiError } from '../infra/error-response.js';
import { parseBody } from '../infra/parse-request.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { formatAnsweredQuestionOutput, type QuestionToolInput } from '../tools/question-tools.js';
import {
  applyAnswer,
  buildConfirmNode,
  CONFIRM_NODE_ID,
  createGrillState,
  isConfirmAffirmative,
  parseGrillState,
  serializeGrillState,
} from '@openAwork/agent-core';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import {
  switchSessionDialogueModeToCoding,
  type DialogueModeSwitchReason,
} from '../session/dialogue-mode-switch.js';
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
          return reply.send({ ok: true, idempotent: true });
        }
        throw ApiError.notFound('目标提问请求不存在。');
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
        return reply.send({ ok: true, alreadyResolved: true });
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

      let clarifyCompletionReason: DialogueModeSwitchReason | null = null;
      let autoSwitchedDialogueMode: DialogueMode | undefined;
      if (body.status === 'answered') {
        if (questionRequest.tool_name === 'ExitPlanMode') {
          const { planApproved } = updateSessionPlanModeForExitDecision({
            answers: body.answers,
            sessionId,
          });
          if (planApproved) {
            clarifyCompletionReason = 'plan_approved';
          }
        }
        const answeredQuestions = JSON.parse(
          questionRequest.questions_json,
        ) as QuestionToolInput['questions'];
        const { confirmedApplied } = updateSessionClarificationState({
          answers: body.answers,
          questions: answeredQuestions,
          sessionId,
        });
        if (confirmedApplied) {
          clarifyCompletionReason = 'clarification_confirmed';
        }
        if (clarifyCompletionReason) {
          // 设计已完成（共识确认 / 计划批准）→ 澄清模式自动切换到编程模式。
          // 必须在返回 HTTP 响应前同步落库：前端紧接着会用会话快照刷新本地模式，
          // 异步写会让它读到旧的 clarify 值。
          const autoSwitch = switchSessionDialogueModeToCoding({
            reason: clarifyCompletionReason,
            sessionId,
          });
          if (autoSwitch.switched) {
            autoSwitchedDialogueMode = autoSwitch.dialogueMode;
          }
        }
        if (resumePayload) {
          const answerOutput = formatAnsweredQuestionOutput({
            questions: answeredQuestions,
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
      return reply.send({
        ok: true,
        ...(autoSwitchedDialogueMode ? { dialogueMode: autoSwitchedDialogueMode } : {}),
      });
    },
  );
}

function updateSessionPlanModeForExitDecision(input: {
  answers: string[][];
  sessionId: string;
}): { planApproved: boolean } {
  const session = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [input.sessionId],
  );
  if (!session) {
    return { planApproved: false };
  }

  const metadata = parseSessionMetadataJson(session.metadata_json);
  const shouldExit = shouldExitPlanModeFromAnswers(input.answers);
  const nextMetadata = { ...metadata, planMode: !shouldExit };
  sqliteRun("UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify(nextMetadata),
    input.sessionId,
  ]);
  return { planApproved: shouldExit };
}

function toGrillOptions(
  options: QuestionToolInput['questions'][number]['options'],
): Array<{ description?: string; label: string; recommended?: boolean }> {
  return options.map((option) => ({
    label: option.label,
    ...(option.description !== undefined ? { description: option.description } : {}),
    ...(option.recommended === true ? { recommended: true } : {}),
  }));
}

function updateSessionClarificationState(input: {
  answers: string[][];
  questions: QuestionToolInput['questions'];
  sessionId: string;
}): { confirmedApplied: boolean } {
  // 确认节点由引擎按依赖自动构造（`buildConfirmNode`），不接受模型自定义 id，
  // 否则会与引擎节点重名。模型提供的确认题只用于同步选项文案（见下）。
  const incomingConfirmQuestion = input.questions.find(
    (question) => question.nodeId === CONFIRM_NODE_ID,
  );
  const grillNodes = input.questions.flatMap((question) => {
    const nodeId = question.nodeId;
    if (typeof nodeId !== 'string' || nodeId.length === 0) return [];
    if (nodeId === CONFIRM_NODE_ID) return [];
    return [
      {
        id: nodeId,
        question: question.question,
        options: toGrillOptions(question.options),
        dependsOn: [],
      },
    ];
  });
  // 终局确认轮通常只带确认题（frontier 已空），不能因为没有新决策节点就提前返回。
  if (grillNodes.length === 0 && incomingConfirmQuestion === undefined) {
    return { confirmedApplied: false };
  }

  const session = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [input.sessionId],
  );
  if (!session) {
    return { confirmedApplied: false };
  }

  const metadata = parseSessionMetadataJson(session.metadata_json);
  const persisted =
    typeof metadata['clarificationState'] === 'string'
      ? parseGrillState(metadata['clarificationState'])
      : null;

  // 只有确认题、却没有已建立的决策树：没有可确认的共识，保持原状。
  if (grillNodes.length === 0 && persisted === null) {
    return { confirmedApplied: false };
  }

  let state =
    persisted ??
    createGrillState([...grillNodes, buildConfirmNode(grillNodes.map((node) => node.id))]);

  const knownIds = new Set(state.nodes.map((node) => node.id));
  const addedNodes = grillNodes.filter((node) => !knownIds.has(node.id));
  if (addedNodes.length > 0) {
    const previousConfirm = state.nodes.find((node) => node.id === CONFIRM_NODE_ID);
    const questionIds = [
      ...state.nodes.filter((node) => node.id !== CONFIRM_NODE_ID).map((node) => node.id),
      ...addedNodes.map((node) => node.id),
    ];
    const confirmNode = buildConfirmNode(questionIds);
    state = {
      ...state,
      nodes: [
        ...state.nodes.filter((node) => node.id !== CONFIRM_NODE_ID),
        ...addedNodes,
        previousConfirm?.answer !== undefined
          ? { ...confirmNode, answer: previousConfirm.answer }
          : confirmNode,
      ],
    };
  }

  input.questions.forEach((question, index) => {
    const nodeId = question.nodeId;
    if (typeof nodeId !== 'string' || nodeId.length === 0) return;
    const answer = (input.answers[index] ?? []).join(', ');
    if (answer.length === 0) return;
    if (nodeId === CONFIRM_NODE_ID) {
      // 确认节点的判定依据是「字面量 `confirmed` 或 recommended 项标签」，而模型给出的
      // 措辞与推荐标记都不可控（可能漏标 recommended，也可能把 recommended 标在"需修改"
      // 这类否定项上——后者会让驳回被当成确认）。因此：采纳模型给出的选项文案，但把
      // recommended 强制归位到"肯定"选项上；若整题都没有肯定选项，则保留引擎默认选项。
      const confirmOptions = toGrillOptions(question.options);
      const affirmativeIndex = confirmOptions.findIndex((option) =>
        isConfirmAffirmative(option.label),
      );
      if (affirmativeIndex >= 0) {
        const normalizedOptions = confirmOptions.map((option, index) => {
          const { recommended: _recommended, ...rest } = option;
          return index === affirmativeIndex ? { ...rest, recommended: true } : rest;
        });
        state = {
          ...state,
          nodes: state.nodes.map((node) =>
            node.id === CONFIRM_NODE_ID ? { ...node, options: normalizedOptions } : node,
          ),
        };
      }
    }
    state = applyAnswer(state, nodeId, answer);
  });

  const confirmedApplied = state.confirmedAt !== undefined && persisted?.confirmedAt === undefined;

  sqliteRun("UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify({ ...metadata, clarificationState: serializeGrillState(state) }),
    input.sessionId,
  ]);

  return { confirmedApplied };
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
    };
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
