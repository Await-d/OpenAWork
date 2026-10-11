import type { CommandExecutionResult, Message } from '@openAwork/shared';
import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { sqliteRun } from '../infra/db.js';
import {
  collectDeadCodeDiagnostics,
  formatDeadCodeCandidates,
} from '../tools/dead-code-diagnostics.js';
import {
  parseCommandArgs,
  parseRefactorScope,
  parseRefactorMode,
  parseDeadcodeMode,
} from './command-args.js';
import { appendCommandCardArtifacts, mergeMetadata, taskManager } from './command-executors.js';

export async function executeRefactorCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const startedAt = Date.now();
  const parsedArgs = parseCommandArgs(params.args);
  const scope = parseRefactorScope(parsedArgs.named['scope']);
  const strategy = parseRefactorMode(parsedArgs.named['strategy']);
  const target = parsedArgs.positional.join(' ') || '当前会话上下文';
  const task = taskManager.addTask(params.graph, {
    title: 'LSP+重构',
    description: `基于 LSP 诊断结果执行智能重构任务：${target}`,
    status: 'pending',
    blockedBy: [],
    sessionId: params.sessionId,
    priority: 'high',
    tags: ['refactor', 'lsp'],
  });
  taskManager.startTask(params.graph, task.id);
  await taskManager.save(params.graph);
  const metadata = mergeMetadata(params.metadataJson, {
    refactorStartedAt: startedAt,
    refactorStrategy: strategy,
    refactorScope: scope,
    refactorTarget: target,
  });
  const card = {
    type: 'status' as const,
    title: '/refactor 已启动',
    message: `重构工作流已创建。\n目标：${target}\n范围：${scope}\n策略：${strategy}\n下一步：分析目标 → 建立影响面 → 执行并验证。\n任务：${task.title}\n任务 ID：${task.id}`,
    tone: 'info' as const,
  };
  appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), params.sessionId, params.userId],
  );
  return {
    sessionId: params.sessionId,
    events: [
      {
        type: 'task_update',
        taskId: task.id,
        label: task.title,
        status: 'in_progress',
        sessionId: params.sessionId,
        parentTaskId: task.parentTaskId,
        eventId: `${params.sessionId}:${task.id}:task`,
        runId: `command:${params.sessionId}:${params.commandId}`,
        occurredAt: Date.now(),
      },
    ],
    card,
  };
}

/**
 * `/remove-deadcode` — P2-DEADCODE (workflow 260509).
 *
 * Mirrors `executeRefactorCommand`: registers a tracked task on the
 * graph, stamps `removeDeadcodeStartedAt` onto session metadata so
 * `detectActiveCommandContext` keeps re-injecting the workflow
 * instruction across rounds, and emits a status card so the UI sees
 * the run kicked off.
 *
 * Args (all optional, parsed via `parseCommandArgs`):
 *   - positional → free-form scope description (file path, package
 *     name, glob, etc.). Falls back to "当前会话上下文" when omitted
 *     so the LLM still has something to anchor on.
 *   - `--mode=strict|opt-in` (default `strict`) — `strict` requires
 *     deterministic LSP/AST evidence before any deletion; `opt-in`
 *     also allows comment-out / TODO-marker style removals.
 *   - `--scope=file|module|project` (default `module`) — bounds the
 *     discovery scan, mirroring `/refactor`.
 */
export async function executeRemoveDeadcodeCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const startedAt = Date.now();
  const parsedArgs = parseCommandArgs(params.args);
  const scope = parseRefactorScope(parsedArgs.named['scope']);
  const mode = parseDeadcodeMode(parsedArgs.named['mode']);
  const target = parsedArgs.positional.join(' ') || '当前会话上下文';
  // T-DEAD-01/02 (workflow 260509): pull a deterministic candidate
  // list from the LSP layer's diagnostics codes (TS6133 / F401 / …)
  // and surface it on the status card. This converts the slash from
  // a generic "go look for dead code" prompt into one that already
  // carries the evidence the LLM is supposed to delete from. Failures
  // fall back to an empty list — the executor still creates the task
  // so the user can manually scope the work.
  const deadCodeCandidates = await collectDeadCodeDiagnostics().catch(() => []);
  const task = taskManager.addTask(params.graph, {
    title: '死代码清理',
    description: `基于 LSP/AST 证据移除已死代码：${target}`,
    status: 'pending',
    blockedBy: [],
    sessionId: params.sessionId,
    priority: 'high',
    tags: ['deadcode', 'lsp'],
  });
  taskManager.startTask(params.graph, task.id);
  await taskManager.save(params.graph);
  const metadata = mergeMetadata(params.metadataJson, {
    removeDeadcodeStartedAt: startedAt,
    removeDeadcodeMode: mode,
    removeDeadcodeScope: scope,
    removeDeadcodeTarget: target,
    removeDeadcodeCandidateCount: deadCodeCandidates.length,
  });
  const candidateBlock = formatDeadCodeCandidates(deadCodeCandidates);
  const card = {
    type: 'status' as const,
    title: '/remove-deadcode 已启动',
    message: [
      `死代码清理工作流已创建。`,
      `目标：${target}`,
      `范围：${scope}`,
      `模式：${mode}`,
      `LSP 候选：${deadCodeCandidates.length} 条`,
      `下一步：逐项校验 LSP find_references 为空 → 删除 → 重跑诊断验证。`,
      `任务：${task.title}`,
      `任务 ID：${task.id}`,
      ``,
      candidateBlock,
    ].join('\n'),
    tone: 'info' as const,
  };
  appendCommandCardArtifacts({
    sessionId: params.sessionId,
    userId: params.userId,
    card,
  });
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), params.sessionId, params.userId],
  );
  return {
    sessionId: params.sessionId,
    events: [
      {
        type: 'task_update',
        taskId: task.id,
        label: task.title,
        status: 'in_progress',
        sessionId: params.sessionId,
        parentTaskId: task.parentTaskId,
        eventId: `${params.sessionId}:${task.id}:task`,
        runId: `command:${params.sessionId}:${params.commandId}`,
        occurredAt: Date.now(),
      },
    ],
    card,
  };
}
