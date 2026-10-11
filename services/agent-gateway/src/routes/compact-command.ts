import { randomUUID } from 'node:crypto';
import { ApiError } from '../infra/error-response.js';
import {
  COMPACTION_SETTINGS_KEY,
  readCompactionSettings,
} from '../compaction/compaction-policy.js';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { resolveCompactionRoute, type ModelRouteConfig } from '../provider/model-router.js';
import {
  getCompactionProviderConfig,
  getProviderConfigForSelection,
} from '../provider/provider-config.js';
import { executeSessionCompaction } from '../session/session-compaction.js';
import { publishSessionRunEvent } from '../session/session-run-events.js';
import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { CommandExecutionResult, Message } from '@openAwork/shared';
import { taskManager, parseStoredJson } from './command-executors.js';

type SessionCompactionResult = Awaited<ReturnType<typeof executeSessionCompaction>>;

export function requireCompactionSummary(result: SessionCompactionResult): string {
  if (typeof result.summary === 'string') {
    return result.summary;
  }

  const message = result.llmErrorMessage ?? '压缩未生成摘要。';
  if (result.retryable) {
    throw new ApiError(409, 'BadRequest', message);
  }
  throw ApiError.internal(message);
}

async function resolveCompactCommandRoute(userId: string): Promise<ModelRouteConfig | null> {
  const providerRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );

  const providers = parseStoredJson(providerRow?.value);
  const activeSelection = parseStoredJson(selectionRow?.value);
  const compactionConfig = await getCompactionProviderConfig(providers, activeSelection);
  if (compactionConfig) {
    return resolveCompactionRoute(compactionConfig.provider, compactionConfig.modelId);
  }

  const chatConfig = await getProviderConfigForSelection(providers, activeSelection);
  if (!chatConfig) {
    return null;
  }

  return resolveCompactionRoute(chatConfig.provider, chatConfig.modelId);
}

async function executeCompactCommand(params: {
  args: string[];
  commandId: string;
  executionId?: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const strategy = 'runtime_replace' as const;
  const fallbackStrategy = 'summary_only' as const;
  const executionId = params.executionId?.trim() || randomUUID();
  const commandRunId = `command:${params.sessionId}:${params.commandId}:${executionId}`;
  const task = taskManager.addTask(params.graph, {
    title: '压缩会话',
    description: '执行 /compact 命令并生成摘要卡片',
    status: 'pending',
    blockedBy: [],
    sessionId: params.sessionId,
    priority: 'medium',
    tags: ['command', 'compaction'],
  });
  taskManager.startTask(params.graph, task.id);
  const compactionRoute = await resolveCompactCommandRoute(params.userId);
  const compactionSettingsRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [params.userId, COMPACTION_SETTINGS_KEY],
  );
  const compactionSettings = readCompactionSettings(parseStoredJson(compactionSettingsRow?.value));
  const startedAt = Date.now();
  const startedEvent = {
    type: 'compaction' as const,
    summary: '正在压缩会话上下文。',
    trigger: 'manual' as const,
    phase: 'started' as const,
    cause: 'manual' as const,
    strategy,
    runId: commandRunId,
    eventId: `${params.sessionId}:${params.commandId}:${executionId}:compaction:started`,
    occurredAt: startedAt,
  };
  publishSessionRunEvent(params.sessionId, startedEvent, {
    clientRequestId: `${params.sessionId}:${params.commandId}:${executionId}`,
  });

  let compaction: SessionCompactionResult;
  let summary: string;
  try {
    compaction = await executeSessionCompaction({
      metadataJson: params.metadataJson,
      messages: params.messages,
      prune: compactionSettings.prune,
      recentMessagesKept: compactionSettings.recentMessagesKept,
      route: compactionRoute,
      sessionId: params.sessionId,
      trigger: 'manual',
      userId: params.userId,
    });
    summary = requireCompactionSummary(compaction);
  } catch (error: unknown) {
    publishSessionRunEvent(
      params.sessionId,
      {
        type: 'compaction',
        summary: error instanceof Error ? error.message : '压缩失败。',
        trigger: 'manual',
        phase: 'failed',
        cause: 'manual',
        strategy: fallbackStrategy,
        runId: commandRunId,
        eventId: `${params.sessionId}:${params.commandId}:${executionId}:compaction:failed`,
        occurredAt: Date.now(),
      },
      { clientRequestId: `${params.sessionId}:${params.commandId}:${executionId}` },
    );
    throw error;
  }
  const completedAt = Date.now();
  const card = {
    type: 'compaction' as const,
    title: 'compact',
    summary,
    trigger: 'manual' as const,
  };

  sqliteRun("UPDATE sessions SET updated_at = datetime('now') WHERE id = ? AND user_id = ?", [
    params.sessionId,
    params.userId,
  ]);
  taskManager.completeTask(params.graph, task.id, summary);
  await taskManager.save(params.graph);

  const failedEvent = compaction.llmErrorMessage
    ? ({
        type: 'compaction' as const,
        summary: `压缩 LLM 失败，已回退到结构化摘要：${compaction.llmErrorMessage}`,
        trigger: 'manual' as const,
        phase: 'failed' as const,
        cause: 'manual' as const,
        strategy: fallbackStrategy,
        runId: commandRunId,
        eventId: `${params.sessionId}:${params.commandId}:${executionId}:compaction:failed`,
        occurredAt: completedAt,
      } as const)
    : null;
  const completedEvent = {
    type: 'compaction' as const,
    summary,
    trigger: 'manual' as const,
    phase: 'completed' as const,
    cause: 'manual' as const,
    strategy,
    compactedMessages: compaction.durableSummary?.newlySummarizedMessages ?? params.messages.length,
    representedMessages:
      compaction.durableSummary?.totalRepresentedMessages ?? params.messages.length,
    runId: commandRunId,
    eventId: `${params.sessionId}:${params.commandId}:${executionId}:compaction:completed`,
    occurredAt: completedAt,
  };
  if (failedEvent) {
    publishSessionRunEvent(params.sessionId, failedEvent, {
      clientRequestId: `${params.sessionId}:${params.commandId}:${executionId}`,
    });
  }
  publishSessionRunEvent(params.sessionId, completedEvent, {
    clientRequestId: `${params.sessionId}:${params.commandId}:${executionId}`,
  });

  return {
    sessionId: params.sessionId,
    events: [
      {
        type: 'task_update',
        taskId: task.id,
        label: task.title,
        status: 'done',
        sessionId: params.sessionId,
        parentTaskId: task.parentTaskId,
        runId: commandRunId,
        eventId: `${params.sessionId}:${params.commandId}:${executionId}:task`,
        occurredAt: Date.now(),
      },
      startedEvent,
      ...(failedEvent ? [failedEvent] : []),
      completedEvent,
    ],
    card,
  };
}

export { executeCompactCommand };
