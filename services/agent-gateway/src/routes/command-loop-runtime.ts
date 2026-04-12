import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'node:util';
import type { Message } from '@openAwork/shared';
import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { RalphLoopImpl } from '@openAwork/agent-core';
import {
  appendSessionMessageV2 as appendSessionMessage,
  listSessionMessagesV2 as listSessionMessages,
} from '../message-v2-adapter.js';
import { sqliteGet, sqliteRun } from '../db.js';

const execFileAsync = promisify(execFile);
const activeLoopExecutions = new Map<string, ActiveLoopRuntime>();
const cancelledBeforeStart = new Set<string>();
const STATE_FILE_PREFIX = '.openawork.ralph-loop';
const STATE_FILE_SUFFIX = '.local.md';
const LEGACY_OPENAWORK_STATE_FILE = '.openawork.ralph-loop.local.md';
const LEGACY_SISYPHUS_STATE_FILE = '.sisyphus/ralph-loop.local.md';
const DEFAULT_COMPLETION_PROMISE = 'DONE';

interface ActiveLoopRuntime {
  kind: 'ralph' | 'ulw';
  loop: RalphLoopImpl;
  taskId: string;
}

interface SessionRow {
  id: string;
  messages_json: string;
  metadata_json: string;
  user_id: string;
}

interface PersistedLoopState {
  active: boolean;
  completion_promise: string;
  initial_completion_promise?: string;
  iteration: number;
  max_iterations?: number;
  message_count_at_start?: number;
  prompt: string;
  session_id?: string;
  task_id?: string;
  started_at: string;
  strategy?: 'reset' | 'continue';
  ultrawork?: boolean;
  verification_pending?: boolean;
}

export interface WorkflowPlanSummaryLike {
  pendingItems: string[];
}

export interface LoopExecutionConfig {
  completionPromise: string;
  kind: 'ralph' | 'ulw';
  maxIterations: number;
  sessionId: string;
  strategy: 'continue' | 'reset';
  target: string;
  taskId: string;
  taskTitle: string;
  userId: string;
  workspaceRoot: string;
  taskManager: AgentTaskManagerImpl;
  summarizeMessages: (messages: Message[]) => string;
  extractLatestUserGoal: (messages: Message[]) => string;
  findLatestWorkflowPlan: (workspaceRoot: string) => Promise<WorkflowPlanSummaryLike | null>;
}

export interface ActiveLoopState {
  kind: 'Ralph Loop' | 'ULW Loop';
  taskId?: string;
}

export interface RequestedWorktree {
  note?: string;
  path?: string;
  requestedPath?: string;
}

export function scheduleLoopExecution(config: LoopExecutionConfig): void {
  writePersistedLoopState(
    config.workspaceRoot,
    {
      active: true,
      completion_promise: config.completionPromise || DEFAULT_COMPLETION_PROMISE,
      initial_completion_promise: config.completionPromise || DEFAULT_COMPLETION_PROMISE,
      iteration: 1,
      max_iterations: config.kind === 'ulw' ? undefined : config.maxIterations,
      message_count_at_start: readCurrentMessageCount(config.sessionId, config.userId),
      prompt: config.target,
      session_id: config.sessionId,
      task_id: config.taskId,
      started_at: new Date().toISOString(),
      strategy: config.strategy,
      ultrawork: config.kind === 'ulw' ? true : undefined,
    },
    config.sessionId,
  );

  const loop = new RalphLoopImpl();
  activeLoopExecutions.set(config.sessionId, {
    kind: config.kind,
    loop,
    taskId: config.taskId,
  });

  setTimeout(() => {
    if (cancelledBeforeStart.has(config.sessionId)) {
      cancelledBeforeStart.delete(config.sessionId);
      activeLoopExecutions.delete(config.sessionId);
      return;
    }

    void runLoopExecution({ ...config, loop }).finally(() => {
      const current = activeLoopExecutions.get(config.sessionId);
      if (current?.taskId === config.taskId) {
        activeLoopExecutions.delete(config.sessionId);
      }
    });
  }, 0);
}

export function stopActiveLoopExecution(sessionId: string): void {
  const active = activeLoopExecutions.get(sessionId);
  if (!active) {
    cancelledBeforeStart.delete(sessionId);
    return;
  }

  if (active.loop.getStatus().running) {
    active.loop.stop();
    return;
  }

  cancelledBeforeStart.add(sessionId);
}

export function clearPersistedLoopState(workspaceRoot: string, sessionId?: string): void {
  if (sessionId) {
    const sessionFilePath = getLoopStateFilePath(workspaceRoot, sessionId);
    if (existsSync(sessionFilePath)) {
      unlinkSync(sessionFilePath);
    }
  }

  clearLegacyLoopStateFiles(workspaceRoot, sessionId);
}

export function readPersistedLoopStateForSession(
  workspaceRoot: string,
  sessionId?: string,
): PersistedLoopState | null {
  return readPersistedLoopState(workspaceRoot, sessionId);
}

function clearLegacyLoopStateFiles(workspaceRoot: string, sessionId?: string): void {
  for (const legacyFilePath of getLegacyLoopStateFilePaths(workspaceRoot)) {
    if (!existsSync(legacyFilePath)) {
      continue;
    }

    if (!sessionId) {
      unlinkSync(legacyFilePath);
      continue;
    }

    const legacyState = readPersistedLoopStateFromFile(legacyFilePath);
    if (!legacyState || !legacyState.session_id || legacyState.session_id === sessionId) {
      unlinkSync(legacyFilePath);
    }
  }
}

export function hasPersistedLoopState(workspaceRoot: string, sessionId?: string): boolean {
  if (sessionId && existsSync(getLoopStateFilePath(workspaceRoot, sessionId))) {
    return true;
  }

  return getLegacyLoopStateFilePaths(workspaceRoot).some((legacyFilePath) => {
    if (!existsSync(legacyFilePath)) {
      return false;
    }

    if (!sessionId) {
      return true;
    }

    const legacyState = readPersistedLoopStateFromFile(legacyFilePath);
    return !legacyState || !legacyState.session_id || legacyState.session_id === sessionId;
  });
}

export function readActiveLoopState(metadataJson: string): ActiveLoopState | null {
  const metadata = readMetadataObject(metadataJson);
  if (metadata['activeLoopKind'] === 'ralph' || metadata['ralphLoopActive'] === true) {
    return {
      kind: 'Ralph Loop',
      taskId:
        typeof metadata['activeLoopTaskId'] === 'string'
          ? metadata['activeLoopTaskId']
          : typeof metadata['ralphLoopTaskId'] === 'string'
            ? metadata['ralphLoopTaskId']
            : undefined,
    };
  }

  if (metadata['activeLoopKind'] === 'ulw' || metadata['ulwLoopActive'] === true) {
    return {
      kind: 'ULW Loop',
      taskId:
        typeof metadata['activeLoopTaskId'] === 'string'
          ? metadata['activeLoopTaskId']
          : typeof metadata['ulwLoopTaskId'] === 'string'
            ? metadata['ulwLoopTaskId']
            : undefined,
    };
  }

  return null;
}

export function clearActiveLoopMetadata(metadataJson: string): Record<string, unknown> {
  const metadata = readMetadataObject(metadataJson);
  for (const key of [
    'activeLoopKind',
    'activeLoopTaskId',
    'activeLoopTaskDescription',
    'ralphLoopActive',
    'ralphLoopStartedAt',
    'ralphLoopCompletionPromise',
    'ralphLoopMaxIterations',
    'ralphLoopStrategy',
    'ralphLoopTaskId',
    'ulwLoopActive',
    'ulwLoopStartedAt',
    'ultraworkMode',
    'ulwLoopCompletionPromise',
    'ulwLoopVerificationRequired',
    'ulwLoopStrategy',
    'ulwLoopTaskId',
  ]) {
    delete metadata[key];
  }
  return metadata;
}

export function clearUlwLoopMetadata(metadataJson: string): Record<string, unknown> {
  const metadata = readMetadataObject(metadataJson);
  for (const key of [
    'ulwLoopActive',
    'ulwLoopStartedAt',
    'ultraworkMode',
    'ulwLoopCompletionPromise',
    'ulwLoopVerificationRequired',
    'ulwVerificationPendingAt',
    'ulwVerificationPendingTaskId',
    'ulwLoopStrategy',
    'ulwLoopTaskId',
  ]) {
    delete metadata[key];
  }

  if (metadata['activeLoopKind'] === 'ulw') {
    delete metadata['activeLoopKind'];
    delete metadata['activeLoopTaskId'];
    delete metadata['activeLoopTaskDescription'];
  }

  return metadata;
}

export function readUlwVerificationPendingTaskId(metadataJson: string): string | undefined {
  const metadata = readMetadataObject(metadataJson);
  return typeof metadata['ulwVerificationPendingTaskId'] === 'string'
    ? metadata['ulwVerificationPendingTaskId']
    : undefined;
}

function markUlwVerificationPendingMetadata(
  metadataJson: string,
  taskId: string,
): Record<string, unknown> {
  return {
    ...readMetadataObject(metadataJson),
    ulwVerificationPendingAt: Date.now(),
    ulwVerificationPendingTaskId: taskId,
  };
}

export async function resolveRequestedWorktree(
  value: string | boolean | undefined,
): Promise<RequestedWorktree> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {};
  }

  const requestedPath = value.trim();
  if (!path.isAbsolute(requestedPath)) {
    return {
      requestedPath,
      note: `Worktree 路径必须是绝对路径：${requestedPath}`,
    };
  }

  try {
    const stats = await fs.stat(requestedPath);
    if (!stats.isDirectory()) {
      return {
        requestedPath,
        note: `Worktree 路径不是目录：${requestedPath}`,
      };
    }

    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: requestedPath,
    });
    const worktreePath = stdout.trim();
    if (!worktreePath) {
      return {
        requestedPath,
        note: `Worktree 校验失败：${requestedPath}`,
      };
    }

    return {
      requestedPath,
      path: worktreePath,
      note: `Worktree：${worktreePath}（后续操作应限定在该工作树中）`,
    };
  } catch {
    return {
      requestedPath,
      note: `Worktree 需要先初始化：git worktree add ${requestedPath} <branch>`,
    };
  }
}

function readMetadataObject(metadataJson: string): Record<string, unknown> {
  try {
    return JSON.parse(metadataJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function runLoopExecution(
  config: LoopExecutionConfig & { loop: RalphLoopImpl },
): Promise<void> {
  const result = await config.loop.run(
    async (iteration, previousOutput) =>
      executeLoopIteration({ ...config, iteration, previousOutput }),
    {
      doneKeyword: buildPromiseTag(config.completionPromise),
      iterationDelayMs: config.maxIterations > 1 ? 60 : 0,
      maxIterations: config.maxIterations,
    },
  );

  await finalizeLoopExecution(config, result);
}

async function executeLoopIteration(
  input: LoopExecutionConfig & {
    iteration: number;
    previousOutput: string;
  },
): Promise<string> {
  const session = readSessionRecord(input.sessionId, input.userId);
  if (!session) {
    return `<promise>${input.completionPromise}</promise>\nSession missing.`;
  }

  const graph = await input.taskManager.loadOrCreate(input.workspaceRoot, input.sessionId);
  const loopTask = graph.tasks[input.taskId];
  if (!loopTask || loopTask.status === 'cancelled') {
    return `<promise>${input.completionPromise}</promise>\nLoop cancelled.`;
  }

  const persistedState = readPersistedLoopState(input.workspaceRoot, input.sessionId) ?? {
    active: true,
    completion_promise: input.completionPromise,
    initial_completion_promise: input.completionPromise,
    iteration: input.iteration,
    max_iterations: input.kind === 'ulw' ? undefined : input.maxIterations,
    prompt: input.target,
    session_id: input.sessionId,
    task_id: input.taskId,
    started_at: new Date().toISOString(),
    strategy: input.strategy,
    ultrawork: input.kind === 'ulw' ? true : undefined,
  };

  const messages = listSessionMessages({
    sessionId: input.sessionId,
    userId: input.userId,
    legacyMessagesJson: session.messages_json,
  });
  const effectiveState =
    persistedState.session_id && persistedState.session_id !== input.sessionId
      ? {
          active: true,
          completion_promise: input.completionPromise,
          initial_completion_promise: input.completionPromise,
          iteration: input.iteration,
          max_iterations: input.kind === 'ulw' ? undefined : input.maxIterations,
          message_count_at_start: messages.length,
          prompt: input.target,
          session_id: input.sessionId,
          task_id: input.taskId,
          started_at: new Date().toISOString(),
          strategy: input.strategy,
          ultrawork: input.kind === 'ulw' ? true : undefined,
        }
      : persistedState;
  const workflowPlan = await input.findLatestWorkflowPlan(input.workspaceRoot);
  const actionableTasks = Object.values(graph.tasks).filter(
    (task) =>
      task.sessionId === input.sessionId &&
      task.id !== input.taskId &&
      (task.status === 'pending' || task.status === 'running'),
  );
  const nextAction =
    workflowPlan?.pendingItems[0] ??
    actionableTasks[0]?.title ??
    input.extractLatestUserGoal(messages) ??
    '继续当前目标';
  const completionDetected = detectCompletionInMessages(
    messages,
    effectiveState.completion_promise,
    effectiveState.message_count_at_start,
  );
  const targetIterations = input.maxIterations <= 1 ? 1 : 2;
  const shouldComplete = completionDetected || input.iteration >= targetIterations;
  const loopOutput = shouldComplete
    ? buildCompletionOutput(effectiveState, input.kind)
    : buildContinuationPrompt({
        nextAction,
        previousOutput: input.previousOutput,
        state: {
          ...effectiveState,
          iteration: input.iteration,
          strategy: input.strategy,
        },
        summary: input.summarizeMessages(messages),
      });

  appendSessionMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'assistant',
    content: [{ type: 'text', text: loopOutput }],
    legacyMessagesJson: session.messages_json,
    clientRequestId: `loop:${input.kind}:${input.taskId}:iteration:${input.iteration}`,
  });

  input.taskManager.updateTask(graph, input.taskId, {
    description: `${input.taskTitle}（第 ${input.iteration} 轮）`,
    result: loopOutput,
  });
  await input.taskManager.save(graph);

  if (!shouldComplete) {
    writePersistedLoopState(
      input.workspaceRoot,
      {
        ...effectiveState,
        iteration: input.iteration + 1,
        message_count_at_start: messages.length,
      },
      input.sessionId,
    );
  }

  return loopOutput;
}

async function finalizeLoopExecution(
  config: LoopExecutionConfig,
  result: Awaited<ReturnType<RalphLoopImpl['run']>>,
): Promise<void> {
  const graph = await config.taskManager.loadOrCreate(config.workspaceRoot, config.sessionId);
  const task = graph.tasks[config.taskId];
  const session = readSessionRecord(config.sessionId, config.userId);
  const persistedState = readPersistedLoopState(config.workspaceRoot, config.sessionId);

  const shouldEnterUlwVerification =
    config.kind === 'ulw' &&
    task?.status === 'running' &&
    result.terminationReason === 'done_detected' &&
    !persistedState?.verification_pending;

  if (shouldEnterUlwVerification) {
    const verificationBaseState: PersistedLoopState = persistedState ?? {
      active: true,
      completion_promise: config.completionPromise,
      initial_completion_promise: config.completionPromise,
      iteration: 1,
      max_iterations: undefined,
      prompt: config.target,
      session_id: config.sessionId,
      task_id: config.taskId,
      started_at: new Date().toISOString(),
      strategy: config.strategy,
      ultrawork: true,
    };

    if (!session) {
      clearPersistedLoopState(config.workspaceRoot, config.sessionId);
      config.taskManager.failTask(
        graph,
        task.id,
        'ULW verification could not continue because the session no longer exists.',
      );
      await config.taskManager.save(graph);
      return;
    }

    const verificationState: PersistedLoopState = {
      ...verificationBaseState,
      completion_promise: 'VERIFIED',
      initial_completion_promise:
        verificationBaseState.initial_completion_promise ??
        verificationBaseState.completion_promise,
      verification_pending: true,
    };
    writePersistedLoopState(config.workspaceRoot, verificationState, config.sessionId);
    const verificationPrompt = buildContinuationPrompt({
      nextAction: '执行 /ulw-verify 提交验证结果',
      previousOutput: result.finalOutput,
      state: verificationState,
      summary: 'DONE 已达到，等待 /ulw-verify 人工验证。',
    });
    config.taskManager.updateTask(graph, task.id, {
      description: `${config.taskTitle}（等待 /ulw-verify 验证）`,
      result: verificationPrompt,
    });
    await config.taskManager.save(graph);

    sqliteRun(
      "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [
        JSON.stringify(markUlwVerificationPendingMetadata(session.metadata_json, task.id)),
        config.sessionId,
        config.userId,
      ],
    );

    appendSessionMessage({
      sessionId: config.sessionId,
      userId: config.userId,
      role: 'assistant',
      content: [{ type: 'text', text: verificationPrompt }],
      legacyMessagesJson: session.messages_json,
      clientRequestId: `loop:${config.kind}:${config.taskId}:verification-pending`,
    });
    return;
  }

  if (task) {
    if (task.status === 'running') {
      if (result.terminationReason === 'error') {
        config.taskManager.failTask(graph, task.id, result.finalOutput || 'Loop execution failed');
      } else {
        config.taskManager.completeTask(graph, task.id, result.finalOutput);
      }
      await config.taskManager.save(graph);
    } else {
      await config.taskManager.save(graph);
    }
  }

  clearPersistedLoopState(config.workspaceRoot, config.sessionId);

  if (!session) {
    return;
  }

  const activeLoop = readActiveLoopState(session.metadata_json);
  if (activeLoop?.taskId === config.taskId) {
    sqliteRun(
      "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [
        JSON.stringify(clearActiveLoopMetadata(session.metadata_json)),
        config.sessionId,
        config.userId,
      ],
    );
  }

  if (task?.status === 'cancelled') {
    return;
  }

  appendSessionMessage({
    sessionId: config.sessionId,
    userId: config.userId,
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: `[${config.kind === 'ulw' ? 'ULW Loop' : 'Ralph Loop'}] 已结束：${translateLoopTermination(result)}\n${truncateText(result.finalOutput, 600)}`,
      },
    ],
    legacyMessagesJson: session.messages_json,
    clientRequestId: `loop:${config.kind}:${config.taskId}:final`,
  });
}

function readSessionRecord(sessionId: string, userId: string): SessionRow | null {
  return (
    sqliteGet<SessionRow>(
      'SELECT id, user_id, messages_json, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
      [sessionId, userId],
    ) ?? null
  );
}

function translateLoopTermination(result: Awaited<ReturnType<RalphLoopImpl['run']>>): string {
  switch (result.terminationReason) {
    case 'done_detected':
      return '达到 DONE 检查点';
    case 'max_iterations':
      return '达到最大迭代次数';
    default:
      return '执行异常结束';
  }
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function getLoopStateFilePath(workspaceRoot: string, sessionId: string): string {
  return path.join(
    workspaceRoot,
    `${STATE_FILE_PREFIX}.${sanitizeSessionId(sessionId)}${STATE_FILE_SUFFIX}`,
  );
}

function readPersistedLoopState(
  workspaceRoot: string,
  sessionId?: string,
): PersistedLoopState | null {
  const sessionFilePath = sessionId ? getLoopStateFilePath(workspaceRoot, sessionId) : null;
  if (sessionFilePath && existsSync(sessionFilePath)) {
    const sessionState = readPersistedLoopStateFromFile(sessionFilePath);
    if (sessionState) {
      return sessionState;
    }
  }

  for (const legacyFilePath of getLegacyLoopStateFilePaths(workspaceRoot)) {
    if (!existsSync(legacyFilePath)) {
      continue;
    }

    const legacyState = readPersistedLoopStateFromFile(legacyFilePath);
    if (!legacyState) {
      continue;
    }

    if (sessionId && legacyState.session_id && legacyState.session_id !== sessionId) {
      continue;
    }

    if (sessionId) {
      const migratedState = { ...legacyState, session_id: legacyState.session_id ?? sessionId };
      writePersistedLoopState(workspaceRoot, migratedState, sessionId);
      clearLegacyLoopStateFiles(workspaceRoot, sessionId);
      return migratedState;
    }

    return legacyState;
  }

  return null;
}

function writePersistedLoopState(
  workspaceRoot: string,
  state: PersistedLoopState,
  sessionId?: string,
): void {
  const filePath = getLoopStateFilePath(workspaceRoot, sessionId ?? state.session_id ?? 'global');
  const directory = path.dirname(filePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  const lines = [
    '---',
    `active: ${state.active}`,
    `iteration: ${state.iteration}`,
    typeof state.max_iterations === 'number' ? `max_iterations: ${state.max_iterations}` : '',
    typeof state.message_count_at_start === 'number'
      ? `message_count_at_start: ${state.message_count_at_start}`
      : '',
    `completion_promise: "${state.completion_promise}"`,
    state.initial_completion_promise
      ? `initial_completion_promise: "${state.initial_completion_promise}"`
      : '',
    `started_at: "${state.started_at}"`,
    state.session_id ? `session_id: "${state.session_id}"` : '',
    state.task_id ? `task_id: "${state.task_id}"` : '',
    state.ultrawork ? 'ultrawork: true' : '',
    state.verification_pending ? 'verification_pending: true' : '',
    state.strategy ? `strategy: "${state.strategy}"` : '',
    '---',
    state.prompt,
    '',
  ].filter((line) => line.length > 0);

  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function readPersistedLoopStateFromFile(filePath: string): PersistedLoopState | null {
  try {
    const content = readFileSync(filePath, 'utf8');
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(content);
    if (!match) return null;
    const frontmatter = match[1] ?? '';
    const body = (match[2] ?? '').trim();
    const data = parseSimpleFrontmatter(frontmatter);
    const iteration = Number(data['iteration'] ?? 1);
    return {
      active: String(data['active'] ?? 'true') === 'true',
      completion_promise: String(data['completion_promise'] ?? DEFAULT_COMPLETION_PROMISE),
      initial_completion_promise:
        typeof data['initial_completion_promise'] === 'string'
          ? data['initial_completion_promise']
          : undefined,
      iteration: Number.isFinite(iteration) ? iteration : 1,
      max_iterations:
        typeof data['max_iterations'] === 'string' && data['max_iterations'].length > 0
          ? Number(data['max_iterations'])
          : undefined,
      message_count_at_start:
        typeof data['message_count_at_start'] === 'string' &&
        data['message_count_at_start'].length > 0
          ? Number(data['message_count_at_start'])
          : undefined,
      prompt: body,
      session_id: typeof data['session_id'] === 'string' ? data['session_id'] : undefined,
      task_id: typeof data['task_id'] === 'string' ? data['task_id'] : undefined,
      started_at: String(data['started_at'] ?? new Date().toISOString()),
      strategy: data['strategy'] === 'reset' ? 'reset' : 'continue',
      ultrawork: String(data['ultrawork'] ?? '') === 'true' ? true : undefined,
      verification_pending:
        String(data['verification_pending'] ?? '') === 'true' ? true : undefined,
    };
  } catch {
    return null;
  }
}

function getLegacyLoopStateFilePaths(workspaceRoot: string): string[] {
  return [
    path.join(workspaceRoot, LEGACY_OPENAWORK_STATE_FILE),
    path.join(workspaceRoot, LEGACY_SISYPHUS_STATE_FILE),
  ];
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function parseSimpleFrontmatter(frontmatter: string): Record<string, string> {
  const data: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    data[key] = value;
  }
  return data;
}

function readCurrentMessageCount(sessionId: string, userId: string): number {
  const session = readSessionRecord(sessionId, userId);
  if (!session) return 0;
  return listSessionMessages({ sessionId, userId, legacyMessagesJson: session.messages_json })
    .length;
}

function buildContinuationPrompt(input: {
  nextAction: string;
  previousOutput: string;
  state: PersistedLoopState;
  summary: string;
}): string {
  const maxLabel =
    typeof input.state.max_iterations === 'number'
      ? String(input.state.max_iterations)
      : 'unbounded';
  const basePrompt = input.state.verification_pending
    ? [
        `[SYSTEM DIRECTIVE - ULTRAWORK LOOP VERIFICATION ${input.state.iteration}/${maxLabel}]`,
        '',
        `You already emitted <promise>${input.state.initial_completion_promise ?? input.state.completion_promise}</promise>. This does NOT finish the loop yet.`,
        'REQUIRED NOW:',
        '- Review the original task outcome critically.',
        '- When verification passes, run: /ulw-verify --pass [optional note]',
        '- When verification fails, run: /ulw-verify --fail <reason>',
        `- Successful verification must conclude with <promise>${input.state.completion_promise}</promise> in the task result.`,
        '',
        'Original task:',
        input.state.prompt,
      ].join('\n')
    : [
        `[SYSTEM DIRECTIVE - RALPH LOOP ${input.state.iteration}/${maxLabel}]`,
        '',
        'Your previous attempt did not output the completion promise. Continue working on the task.',
        '',
        'IMPORTANT:',
        `- When FULLY complete, output: <promise>${input.state.completion_promise}</promise>`,
        `- Next recommended action: ${input.nextAction}`,
        input.previousOutput && input.state.strategy === 'continue'
          ? `- Continue from previous output: ${truncateText(input.previousOutput, 160)}`
          : '- Strategy: reset context and restate the task clearly.',
        `- Context summary: ${truncateText(input.summary || 'No recent summary.', 220)}`,
        '',
        'Original task:',
        input.state.prompt,
      ].join('\n');

  return input.state.ultrawork ? `ultrawork ${basePrompt}` : basePrompt;
}

function buildCompletionOutput(state: PersistedLoopState, kind: 'ralph' | 'ulw'): string {
  const promise = buildPromiseTag(state.completion_promise);
  if (kind === 'ulw') {
    return [
      `${promise}`,
      'Original task checkpoint reached.',
      'ULW verification is still required before final completion.',
      `Original task: ${state.prompt}`,
    ].join('\n');
  }

  return [promise, 'Task checkpoint reached.', `Original task: ${state.prompt}`].join('\n');
}

function buildPromiseTag(promise: string): string {
  return `<promise>${promise}</promise>`;
}

function detectCompletionInMessages(
  messages: Message[],
  completionPromise: string,
  sinceMessageIndex?: number,
): boolean {
  const escapedPromise = escapeRegex(completionPromise);
  const promisePattern = new RegExp(`(?:^|\\n)\\s*<promise>${escapedPromise}<\\/promise>(?:\\s|$)`);
  const relevantMessages =
    typeof sinceMessageIndex === 'number' && sinceMessageIndex >= 0
      ? messages.slice(sinceMessageIndex)
      : messages;

  return relevantMessages.some((message) => {
    if (message.role !== 'assistant') {
      return false;
    }

    const text = message.content
      .filter(
        (content): content is Extract<(typeof message.content)[number], { type: 'text' }> =>
          content.type === 'text',
      )
      .map((content) => content.text)
      .join('\n');
    return promisePattern.test(text);
  });
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
