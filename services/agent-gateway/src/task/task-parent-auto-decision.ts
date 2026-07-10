import { randomUUID } from 'node:crypto';
import { sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';
import { listSessionMessagesV2 as listSessionMessages } from '../message/message-v2-adapter.js';
import { parseApprovedPermissionResumePayload } from '../permission/permission-contract.js';
import {
  broadcastPersistedSessionRunEvent,
  persistSessionRunEventForRequest,
} from '../session/session-run-events.js';
import { createPermissionRepliedEvent } from '../session/session-permission-events.js';
import { createQuestionRepliedEvent } from '../session/session-question-events.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { shouldExitPlanModeFromAnswers } from '../tools/plan-mode-tools.js';
import { formatAnsweredQuestionOutput, type QuestionToolInput } from '../tools/question-tools.js';
import type { ApprovedPermissionResumePayload } from '../routes/stream.js';

const TASK_PARENT_DECISION_REQUEST_PREFIX = 'task-parent-decision:';
const MAX_PARENT_DECISION_MESSAGE_LENGTH = 16000;
const DECIDING_INTERACTION_TIMEOUT_SQL = "datetime('now', '-10 minutes')";

interface ChildSessionRow {
  id: string;
  metadata_json: string;
  user_id: string;
}

interface TaskParentAutoResumeContextRow {
  child_session_id: string;
  parent_session_id: string;
  request_data_json: string;
  task_id: string;
  user_id: string;
}

interface PendingQuestionRow {
  id: string;
  questions_json: string;
  request_payload_json: string | null;
  title: string;
  tool_name: string;
}

interface PendingPermissionRow {
  id: string;
  preview_action: string | null;
  reason: string;
  request_payload_json: string | null;
  risk_level: string;
  scope: string;
  tool_name: string;
}

type ParentDecision =
  | { kind: 'question'; answers: string[][]; rationale?: string }
  | { kind: 'permission'; decision: 'once' | 'reject'; feedback?: string; rationale?: string };

function readTextContent(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
}

function parseQuestionDecisionAnswers(value: unknown): string[][] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const answers: string[][] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length === 0) {
      return null;
    }
    const entryAnswers = entry.map((answer) => (typeof answer === 'string' ? answer.trim() : ''));
    if (entryAnswers.some((answer) => answer.length === 0)) {
      return null;
    }
    answers.push(entryAnswers);
  }

  return answers;
}

function parseParentDecision(text: string): ParentDecision | null {
  const trimmed = text.trim();
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = match?.[1]?.trim() ?? trimmed;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    if (parsed['kind'] === 'question') {
      const answers = parseQuestionDecisionAnswers(parsed['answers']);
      if (!answers) {
        return null;
      }
      return {
        kind: 'question',
        answers,
        ...(typeof parsed['rationale'] === 'string' ? { rationale: parsed['rationale'] } : {}),
      };
    }
    if (
      parsed['kind'] === 'permission' &&
      (parsed['decision'] === 'approve' ||
        parsed['decision'] === 'once' ||
        parsed['decision'] === 'reject')
    ) {
      return {
        kind: 'permission',
        decision: parsed['decision'] === 'approve' ? 'once' : parsed['decision'],
        ...(typeof parsed['feedback'] === 'string' ? { feedback: parsed['feedback'] } : {}),
        ...(typeof parsed['rationale'] === 'string' ? { rationale: parsed['rationale'] } : {}),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function getTaskCreatedChildSession(input: {
  childSessionId: string;
  userId: string;
}): ChildSessionRow | null {
  const row = sqliteGet<ChildSessionRow>(
    'SELECT id, user_id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.childSessionId, input.userId],
  );
  if (!row) {
    return null;
  }

  const metadata = parseSessionMetadataJson(row.metadata_json);
  if (metadata['createdByTool'] !== 'task' || typeof metadata['parentSessionId'] !== 'string') {
    return null;
  }

  return row;
}

function getParentContext(input: {
  childSessionId: string;
  userId: string;
}): TaskParentAutoResumeContextRow | null {
  return (
    sqliteGet<TaskParentAutoResumeContextRow>(
      `SELECT child_session_id, parent_session_id, user_id, task_id, request_data_json
     FROM task_parent_auto_resume_contexts
     WHERE child_session_id = ? AND user_id = ?
     LIMIT 1`,
      [input.childSessionId, input.userId],
    ) ?? null
  );
}

function getPendingQuestion(childSessionId: string): PendingQuestionRow | null {
  return (
    sqliteGet<PendingQuestionRow>(
      `SELECT id, tool_name, title, questions_json, request_payload_json
     FROM question_requests
     WHERE session_id = ? AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 1`,
      [childSessionId],
    ) ?? null
  );
}

function getPendingPermission(childSessionId: string): PendingPermissionRow | null {
  return (
    sqliteGet<PendingPermissionRow>(
      `SELECT id, tool_name, scope, reason, risk_level, preview_action, request_payload_json
     FROM permission_requests
     WHERE session_id = ? AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 1`,
      [childSessionId],
    ) ?? null
  );
}

function buildQuestionDecisionMessage(input: {
  childSessionId: string;
  parentTaskId: string;
  question: PendingQuestionRow;
}): string {
  return [
    '你是上级任务分配 AI。下级开发 agent 因实现细节选择题暂停。',
    '这是开发执行层决策，不要转问用户；请基于任务目标做保守、可继续推进的选择。',
    '只输出 JSON，不要输出解释文本。格式：{"kind":"question","answers":[["选项label"]],"rationale":"一句话依据"}',
    '',
    `父任务：${input.parentTaskId}`,
    `子会话：${input.childSessionId}`,
    `问题请求：${input.question.id}`,
    `问题：${input.question.questions_json}`,
  ]
    .join('\n')
    .slice(0, MAX_PARENT_DECISION_MESSAGE_LENGTH);
}

function buildPermissionDecisionMessage(input: {
  childSessionId: string;
  parentTaskId: string;
  permission: PendingPermissionRow;
}): string {
  return [
    '你是上级任务分配 AI。下级开发 agent 因工具权限请求暂停。',
    '这是开发执行层决策，不要转问用户；请判断是否批准。危险、破坏性、外部副作用不明确时拒绝并要求替代方案。',
    '只输出 JSON，不要输出解释文本。格式：{"kind":"permission","decision":"approve|reject","feedback":"拒绝时给替代建议","rationale":"一句话依据"}',
    '',
    `父任务：${input.parentTaskId}`,
    `子会话：${input.childSessionId}`,
    `权限请求：${input.permission.id}`,
    `工具：${input.permission.tool_name}`,
    `范围：${input.permission.scope}`,
    `风险：${input.permission.risk_level}`,
    `原因：${input.permission.reason}`,
    `预览：${input.permission.preview_action ?? '无'}`,
  ]
    .join('\n')
    .slice(0, MAX_PARENT_DECISION_MESSAGE_LENGTH);
}

function buildDecisionRequestData(input: {
  baseRequestData: Record<string, unknown>;
  childSessionId: string;
  message: string;
  parentSessionId: string;
}): Record<string, unknown> {
  return {
    ...input.baseRequestData,
    clientRequestId: `${TASK_PARENT_DECISION_REQUEST_PREFIX}${input.childSessionId}:${randomUUID()}`,
    displayMessage: undefined,
    message: input.message,
  };
}

async function requestParentDecision(input: {
  childSessionId: string;
  context: TaskParentAutoResumeContextRow;
  message: string;
  userId: string;
}): Promise<ParentDecision | null> {
  let requestData: Record<string, unknown>;
  try {
    requestData = buildDecisionRequestData({
      baseRequestData: JSON.parse(input.context.request_data_json) as Record<string, unknown>,
      childSessionId: input.childSessionId,
      message: input.message,
      parentSessionId: input.context.parent_session_id,
    });
  } catch {
    return null;
  }

  const clientRequestId = String(requestData['clientRequestId']);
  const { runSessionInBackground } = await import('../routes/stream-runtime.js');
  const result = await runSessionInBackground({
    requestData,
    sessionId: input.context.parent_session_id,
    userId: input.userId,
  });
  if (result.statusCode >= 400 || result.stopReason === 'error') {
    return null;
  }

  const messages = listSessionMessages({
    sessionId: input.context.parent_session_id,
    userId: input.userId,
  });
  const reply = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.clientRequestId === clientRequestId);
  if (!reply || !Array.isArray(reply.content)) {
    return null;
  }

  return parseParentDecision(readTextContent(reply));
}

function getLastSqliteChangeCount(): number {
  const row = sqliteGet<{ changes: number }>('SELECT changes() AS changes');
  return row?.changes ?? 0;
}

function claimPendingInteraction(input: {
  id: string;
  sessionId: string;
  table: 'permission_requests' | 'question_requests';
}): boolean {
  sqliteRun(
    `UPDATE ${input.table}
     SET status = 'deciding', updated_at = datetime('now')
     WHERE id = ? AND session_id = ? AND status = 'pending'`,
    [input.id, input.sessionId],
  );
  return getLastSqliteChangeCount() === 1;
}

function releasePendingInteraction(input: {
  id: string;
  sessionId: string;
  table: 'permission_requests' | 'question_requests';
}): void {
  sqliteRun(
    `UPDATE ${input.table}
     SET status = 'pending', updated_at = datetime('now')
     WHERE id = ? AND session_id = ? AND status = 'deciding'`,
    [input.id, input.sessionId],
  );
}

function safeReleasePendingInteraction(input: {
  id: string;
  interactionType: 'permission' | 'question';
  sessionId: string;
  table: 'permission_requests' | 'question_requests';
}): void {
  try {
    releasePendingInteraction(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('task parent auto-decision release failed', {
      error: message,
      interactionId: input.id,
      interactionType: input.interactionType,
      sessionId: input.sessionId,
    });
  }
}

function releaseStaleDecidingInteractions(sessionId: string): void {
  for (const table of ['permission_requests', 'question_requests'] as const) {
    sqliteRun(
      `UPDATE ${table}
       SET status = 'pending', updated_at = datetime('now')
       WHERE session_id = ? AND status = 'deciding' AND updated_at < ${DECIDING_INTERACTION_TIMEOUT_SQL}`,
      [sessionId],
    );
  }
}

function isQuestionDecisionAnswerSetValid(input: {
  answers: string[][];
  questions: QuestionToolInput['questions'];
}): boolean {
  if (input.answers.length !== input.questions.length) {
    return false;
  }

  return input.questions.every((question, index) => {
    const answers = input.answers[index] ?? [];
    if (answers.length === 0) {
      return false;
    }
    if (question.multiple !== true && answers.length > 1) {
      return false;
    }

    const optionLabels = new Set(question.options.map((option) => option.label));
    return answers.every((answer) => optionLabels.has(answer));
  });
}

function logTaskParentAutoDecisionError(input: {
  error: unknown;
  interactionId: string;
  interactionType: 'permission' | 'question';
  sessionId: string;
}): void {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  console.error('task parent auto-decision failed', {
    error: message,
    interactionId: input.interactionId,
    interactionType: input.interactionType,
    sessionId: input.sessionId,
  });
}

function logTaskParentAutoDecisionResumeError(input: {
  error: unknown;
  interactionId: string;
  interactionType: 'permission' | 'question';
  sessionId: string;
}): void {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  console.error('task parent auto-decision resume failed', {
    error: message,
    interactionId: input.interactionId,
    interactionType: input.interactionType,
    sessionId: input.sessionId,
  });
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
  sqliteRun("UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify({ ...metadata, planMode: !shouldExit }),
    input.sessionId,
  ]);
}

async function applyQuestionDecision(input: {
  decision: Extract<ParentDecision, { kind: 'question' }>;
  question: PendingQuestionRow;
  sessionId: string;
  userId: string;
}): Promise<boolean> {
  const payload = parseQuestionResumePayload(input.question.request_payload_json);
  if (!payload) {
    return false;
  }

  let questions: QuestionToolInput['questions'];
  try {
    questions = JSON.parse(input.question.questions_json) as QuestionToolInput['questions'];
  } catch {
    return false;
  }
  if (
    !isQuestionDecisionAnswerSetValid({
      answers: input.decision.answers,
      questions,
    })
  ) {
    return false;
  }

  const event = createQuestionRepliedEvent({ requestId: input.question.id, status: 'answered' });
  const eventMeta = { clientRequestId: payload.clientRequestId };
  const persistedEvent = sqliteTransaction(() => {
    sqliteRun(
      `UPDATE question_requests
       SET status = 'answered', answer_json = ?, updated_at = datetime('now')
       WHERE id = ? AND session_id = ? AND status = 'deciding'`,
      [JSON.stringify(input.decision.answers), input.question.id, input.sessionId],
    );
    if (getLastSqliteChangeCount() !== 1) {
      return null;
    }

    if (input.question.tool_name === 'ExitPlanMode') {
      updateSessionPlanModeForExitDecision({
        answers: input.decision.answers,
        sessionId: input.sessionId,
      });
    }

    return persistSessionRunEventForRequest(input.sessionId, event, eventMeta);
  });
  if (!persistedEvent) {
    return false;
  }
  broadcastPersistedSessionRunEvent(input.sessionId, event, {
    ...eventMeta,
    ...(persistedEvent.seq === null ? {} : { seq: persistedEvent.seq }),
  });

  const answerOutput = formatAnsweredQuestionOutput({ questions, answers: input.decision.answers });
  void import('../routes/stream-runtime.js')
    .then((runtime) =>
      runtime.resumeAnsweredQuestionRequest({
        payload: { ...payload, toolName: input.question.tool_name },
        answerOutput,
        sessionId: input.sessionId,
        userId: input.userId,
      }),
    )
    .catch((error: unknown) => {
      logTaskParentAutoDecisionResumeError({
        error,
        interactionId: input.question.id,
        interactionType: 'question',
        sessionId: input.sessionId,
      });
    });
  return true;
}

async function applyPermissionDecision(input: {
  decision: Extract<ParentDecision, { kind: 'permission' }>;
  permission: PendingPermissionRow;
  sessionId: string;
  userId: string;
}): Promise<boolean> {
  const payload = parseApprovedPermissionResumePayload(input.permission.request_payload_json);
  if (!payload) {
    return false;
  }

  const decisionValue = input.decision.decision === 'once' ? 'once' : 'reject';
  const event = createPermissionRepliedEvent({
    requestId: input.permission.id,
    decision: decisionValue,
    ...(input.decision.feedback ? { feedback: input.decision.feedback } : {}),
  });
  const eventMeta = { clientRequestId: payload.clientRequestId };
  const persistedEvent = sqliteTransaction(() => {
    sqliteRun(
      `UPDATE permission_requests
       SET status = ?, decision = ?, updated_at = datetime('now')
       WHERE id = ? AND session_id = ? AND status = 'deciding'`,
      [
        decisionValue === 'once' ? 'approved' : 'rejected',
        decisionValue,
        input.permission.id,
        input.sessionId,
      ],
    );
    if (getLastSqliteChangeCount() !== 1) {
      return null;
    }

    return persistSessionRunEventForRequest(input.sessionId, event, eventMeta);
  });
  if (!persistedEvent) {
    return false;
  }
  broadcastPersistedSessionRunEvent(input.sessionId, event, {
    ...eventMeta,
    ...(persistedEvent.seq === null ? {} : { seq: persistedEvent.seq }),
  });

  const resumePayload: ApprovedPermissionResumePayload = {
    ...payload,
    toolName: input.permission.tool_name,
  };
  void import('../routes/stream-runtime.js')
    .then((runtime) => {
      if (decisionValue === 'once') {
        return runtime.resumeApprovedPermissionRequest({
          payload: resumePayload,
          sessionId: input.sessionId,
          userId: input.userId,
        });
      }

      return runtime.resumeRejectedPermissionRequest({
        payload: resumePayload,
        feedback: input.decision.feedback,
        sessionId: input.sessionId,
        userId: input.userId,
      });
    })
    .catch((error: unknown) => {
      logTaskParentAutoDecisionResumeError({
        error,
        interactionId: input.permission.id,
        interactionType: 'permission',
        sessionId: input.sessionId,
      });
    });
  return true;
}

function parseQuestionResumePayload(
  payloadJson: string | null,
): Omit<ApprovedPermissionResumePayload, 'toolName'> | null {
  if (!payloadJson) return null;
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
    const requestData =
      parsed['requestData'] && typeof parsed['requestData'] === 'object'
        ? (parsed['requestData'] as Record<string, unknown>)
        : null;
    if (!clientRequestId || !toolCallId || nextRound === null || !rawInput || !requestData) {
      return null;
    }
    return { clientRequestId, nextRound, rawInput, requestData, toolCallId };
  } catch {
    return null;
  }
}

export async function tryResolveTaskPendingInteractionWithParent(input: {
  childSessionId: string;
  userId: string;
}): Promise<boolean> {
  if (!getTaskCreatedChildSession(input)) {
    return false;
  }
  const context = getParentContext(input);
  if (!context) {
    return false;
  }

  releaseStaleDecidingInteractions(input.childSessionId);

  const question = getPendingQuestion(input.childSessionId);
  if (question) {
    const claimed = claimPendingInteraction({
      id: question.id,
      sessionId: input.childSessionId,
      table: 'question_requests',
    });
    if (!claimed) {
      return false;
    }

    try {
      const decision = await requestParentDecision({
        childSessionId: input.childSessionId,
        context,
        message: buildQuestionDecisionMessage({
          childSessionId: input.childSessionId,
          parentTaskId: context.task_id,
          question,
        }),
        userId: input.userId,
      });
      if (decision?.kind !== 'question') {
        safeReleasePendingInteraction({
          id: question.id,
          interactionType: 'question',
          sessionId: input.childSessionId,
          table: 'question_requests',
        });
        return false;
      }

      const applied = await applyQuestionDecision({
        decision,
        question,
        sessionId: input.childSessionId,
        userId: input.userId,
      });
      if (!applied) {
        safeReleasePendingInteraction({
          id: question.id,
          interactionType: 'question',
          sessionId: input.childSessionId,
          table: 'question_requests',
        });
      }
      return applied;
    } catch (error) {
      safeReleasePendingInteraction({
        id: question.id,
        interactionType: 'question',
        sessionId: input.childSessionId,
        table: 'question_requests',
      });
      logTaskParentAutoDecisionError({
        error,
        interactionId: question.id,
        interactionType: 'question',
        sessionId: input.childSessionId,
      });
      return false;
    }
  }

  const permission = getPendingPermission(input.childSessionId);
  if (permission) {
    const claimed = claimPendingInteraction({
      id: permission.id,
      sessionId: input.childSessionId,
      table: 'permission_requests',
    });
    if (!claimed) {
      return false;
    }

    try {
      const decision = await requestParentDecision({
        childSessionId: input.childSessionId,
        context,
        message: buildPermissionDecisionMessage({
          childSessionId: input.childSessionId,
          parentTaskId: context.task_id,
          permission,
        }),
        userId: input.userId,
      });
      if (decision?.kind !== 'permission') {
        safeReleasePendingInteraction({
          id: permission.id,
          interactionType: 'permission',
          sessionId: input.childSessionId,
          table: 'permission_requests',
        });
        return false;
      }

      const applied = await applyPermissionDecision({
        decision,
        permission,
        sessionId: input.childSessionId,
        userId: input.userId,
      });
      if (!applied) {
        safeReleasePendingInteraction({
          id: permission.id,
          interactionType: 'permission',
          sessionId: input.childSessionId,
          table: 'permission_requests',
        });
      }
      return applied;
    } catch (error) {
      safeReleasePendingInteraction({
        id: permission.id,
        interactionType: 'permission',
        sessionId: input.childSessionId,
        table: 'permission_requests',
      });
      logTaskParentAutoDecisionError({
        error,
        interactionId: permission.id,
        interactionType: 'permission',
        sessionId: input.childSessionId,
      });
      return false;
    }
  }

  return false;
}
