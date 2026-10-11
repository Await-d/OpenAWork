import type { CommandExecutionResult, Message } from '@openAwork/shared';
import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { appendSessionMessageV2 as appendSessionMessage } from '../message/message-v2-adapter.js';
import { WORKSPACE_ROOT, sqliteRun } from '../infra/db.js';
import { recordUlwVerificationEvidence } from '../session/ulw-verification-evidence.js';
import { withWorkflowRuntimeEvidenceArtifact } from '../session/workflow-runtime-state.js';
import { parseCommandArgs } from './command-args.js';
import { parseUlwVerifyDecision } from './command-helpers.js';
import {
  clearPersistedLoopState,
  clearUlwLoopMetadata,
  readActiveLoopState,
  readPersistedLoopStateForSession,
  readUlwVerificationPendingTaskId,
} from './command-loop-runtime.js';
import {
  appendCommandCardArtifacts,
  taskManager,
  type CommandTaskGraph,
} from './command-executors.js';

type CommandTask = CommandTaskGraph['tasks'][string];

export async function executeUlwVerifyCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const parsedArgs = parseCommandArgs(params.args);
  const verifyDecision = parseUlwVerifyDecision(parsedArgs);
  const persistedState = readPersistedLoopStateForSession(WORKSPACE_ROOT, params.sessionId);
  const activeLoop = readActiveLoopState(params.metadataJson);
  const pendingVerificationTaskId = readUlwVerificationPendingTaskId(params.metadataJson);
  const persistedTaskId = persistedState?.task_id;
  const activeTaskId = activeLoop?.taskId;
  const recoverableState = resolveRecoverableUlwTask({
    activeTaskId,
    graph: params.graph,
    persistedTaskId,
    sessionId: params.sessionId,
  });
  const taskIdMismatch =
    activeTaskId !== undefined && persistedTaskId !== undefined && activeTaskId !== persistedTaskId;
  const loopTask = recoverableState.task;
  const effectivePersistedState =
    persistedState ??
    (pendingVerificationTaskId !== undefined &&
    loopTask &&
    pendingVerificationTaskId === loopTask.id
      ? buildFallbackUlwVerifyState(params.sessionId, loopTask)
      : undefined);

  if (!effectivePersistedState?.verification_pending || !effectivePersistedState.ultrawork) {
    if (activeLoop?.kind === 'ULW Loop' && recoverableState.reason === 'missing') {
      const cleanedMetadata = clearUlwLoopMetadata(params.metadataJson);
      clearPersistedLoopState(WORKSPACE_ROOT, params.sessionId);
      sqliteRun(
        "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [JSON.stringify(cleanedMetadata), params.sessionId, params.userId],
      );
    }

    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/ulw-verify unavailable',
        message: '当前会话没有等待验证的 ULW 状态。',
        tone: 'warning',
      },
    };
  }

  if (!loopTask) {
    if (recoverableState.reason === 'ambiguous') {
      return {
        sessionId: params.sessionId,
        events: [],
        card: {
          type: 'status',
          title: '/ulw-verify unavailable',
          message:
            '检测到多个可恢复的 ULW 任务，无法自动确定验证目标；请先清理多余 continuation 状态。',
          tone: 'warning',
        },
      };
    }

    const cleanedMetadata = clearUlwLoopMetadata(params.metadataJson);
    clearPersistedLoopState(WORKSPACE_ROOT, params.sessionId);
    sqliteRun(
      "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [JSON.stringify(cleanedMetadata), params.sessionId, params.userId],
    );
    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/ulw-verify unavailable',
        message: 'ULW 验证状态仍在，但关联任务已丢失；已清理残留状态。',
        tone: 'warning',
      },
    };
  }

  if (taskIdMismatch) {
    appendSessionMessage({
      sessionId: params.sessionId,
      userId: params.userId,
      role: 'system',
      content: [
        {
          type: 'text',
          text: `ULW verify recovered task selection. persisted=${persistedTaskId ?? 'none'}, metadata=${activeTaskId ?? 'none'}.`,
        },
      ],
      clientRequestId: `ulw-verify:${params.sessionId}:recovered-task-id`,
    });
  }

  if (!verifyDecision.decision) {
    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: '/ulw-verify 参数无效',
        message: '请使用 /ulw-verify --pass [说明] 或 /ulw-verify --fail [原因]。',
        tone: 'warning',
      },
    };
  }

  const explanation = verifyDecision.note;

  let metadata = clearUlwLoopMetadata(params.metadataJson);
  let events: CommandExecutionResult['events'];
  let card: CommandExecutionResult['card'];

  if (verifyDecision.decision === 'pass') {
    const didTransition =
      loopTask.status !== 'completed' &&
      loopTask.status !== 'failed' &&
      loopTask.status !== 'cancelled';
    const resultText = [
      '<promise>VERIFIED</promise>',
      'ULW verification passed.',
      explanation ? `Review note: ${explanation}` : null,
      `Original task: ${effectivePersistedState.prompt}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');

    if (didTransition) {
      taskManager.completeTask(params.graph, loopTask.id, resultText);
      await taskManager.save(params.graph);
    }

    card = {
      type: 'status',
      title: '/ulw-verify 已通过',
      message: explanation ? `ULW 验证已通过。\n说明：${explanation}` : 'ULW 验证已通过。',
      tone: 'info',
    };
    const evidence = recordUlwVerificationEvidence({
      note: explanation,
      prompt: effectivePersistedState.prompt,
      sessionId: params.sessionId,
      status: 'passed',
      taskId: loopTask.id,
      taskTitle: loopTask.title,
      userId: params.userId,
    });
    events = [...evidence.events];
    metadata = withWorkflowRuntimeEvidenceArtifact(metadata, {
      artifactId: evidence.artifactId,
      status: 'available',
    });
  } else {
    const didTransition =
      loopTask.status !== 'completed' &&
      loopTask.status !== 'failed' &&
      loopTask.status !== 'cancelled';
    const failureText = explanation || 'ULW verification failed.';
    if (didTransition) {
      taskManager.failTask(params.graph, loopTask.id, failureText);
      await taskManager.save(params.graph);
    }

    card = {
      type: 'status',
      title: '/ulw-verify 未通过',
      message: explanation ? `ULW 验证未通过。\n原因：${explanation}` : 'ULW 验证未通过。',
      tone: 'warning',
    };
    const evidence = recordUlwVerificationEvidence({
      note: explanation,
      prompt: effectivePersistedState.prompt,
      sessionId: params.sessionId,
      status: 'failed',
      taskId: loopTask.id,
      taskTitle: loopTask.title,
      userId: params.userId,
    });
    events = [...evidence.events];
    metadata = withWorkflowRuntimeEvidenceArtifact(metadata, {
      artifactId: evidence.artifactId,
      status: 'available',
    });
  }

  appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    card,
  });
  clearPersistedLoopState(WORKSPACE_ROOT, params.sessionId);
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), params.sessionId, params.userId],
  );

  return {
    sessionId: params.sessionId,
    events,
    card,
  };
}

export function buildFallbackUlwVerifyState(
  sessionId: string,
  task: CommandTask,
): {
  completion_promise: string;
  initial_completion_promise: string;
  iteration: number;
  prompt: string;
  session_id: string;
  task_id: string;
  started_at: string;
  ultrawork: true;
  verification_pending: true;
} {
  return {
    completion_promise: 'VERIFIED',
    initial_completion_promise: 'DONE',
    iteration: 1,
    prompt: task.result ?? task.description ?? task.title,
    session_id: sessionId,
    task_id: task.id,
    started_at: new Date(task.updatedAt).toISOString(),
    ultrawork: true,
    verification_pending: true,
  };
}

function resolveRecoverableUlwTask(input: {
  activeTaskId?: string;
  graph: CommandTaskGraph;
  persistedTaskId?: string;
  sessionId: string;
}): {
  reason: 'resolved' | 'missing' | 'ambiguous';
  task?: CommandTask;
} {
  const persistedTask =
    input.persistedTaskId !== undefined ? input.graph.tasks[input.persistedTaskId] : undefined;
  if (persistedTask && isVerifiableUlwTask(persistedTask, input.sessionId)) {
    return { reason: 'resolved', task: persistedTask };
  }

  const activeTask =
    input.activeTaskId !== undefined ? input.graph.tasks[input.activeTaskId] : undefined;
  if (activeTask && isVerifiableUlwTask(activeTask, input.sessionId)) {
    return { reason: 'resolved', task: activeTask };
  }

  const candidates = Object.values(input.graph.tasks).filter((task) =>
    isVerifiableUlwTask(task, input.sessionId),
  );
  if (candidates.length === 1) {
    return { reason: 'resolved', task: candidates[0] };
  }

  if (candidates.length > 1) {
    return { reason: 'ambiguous' };
  }

  return { reason: 'missing' };
}

function isVerifiableUlwTask(task: CommandTask, sessionId: string): boolean {
  const isUlw = task.tags.includes('ulw-loop');
  const isActive = task.status === 'running';
  return task.sessionId === sessionId && isUlw && isActive;
}
