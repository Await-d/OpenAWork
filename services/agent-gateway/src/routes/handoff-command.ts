import type { CommandExecutionResult, Message } from '@openAwork/shared';
import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { buildHandoffDocument, formatHandoffMarkdown } from '@openAwork/agent-core';
import { WORKSPACE_ROOT, sqliteRun } from '../infra/db.js';
import { appendCommandCardArtifacts, extractLatestUserGoal } from './command-executors.js';
import { extractMessageText, summarizeMessages } from './message-text-utils.js';
import { findLatestWorkflowPlan, type WorkflowPlanSummary } from './workflow-plan-context.js';

function mergeHandoffMetadata(metadataJson: string, markdown: string): Record<string, unknown> {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return {
      ...metadata,
      lastHandoffAt: Date.now(),
      lastHandoffMarkdown: markdown,
    };
  } catch {
    return {
      lastHandoffAt: Date.now(),
      lastHandoffMarkdown: markdown,
    };
  }
}

function extractKeyDecisions(messages: Message[]): string[] {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => extractMessageText(message))
    .filter((text) => text.length > 0)
    .slice(-3);
}

function extractNextSteps(tasks: Array<{ title: string; status: string }>): string[] {
  const pending = tasks.filter((task) => task.status === 'pending' || task.status === 'running');
  if (pending.length > 0) {
    return pending.map((task) => task.title).slice(0, 5);
  }
  return ['继续从当前会话上下文推进下一步实现。'];
}

function hasMeaningfulHandoffContext(
  messages: Message[],
  tasks: Array<{ title: string; status: string }>,
  workflowPlan: WorkflowPlanSummary | null,
): boolean {
  const textLength = messages.reduce((sum, message) => sum + extractMessageText(message).length, 0);
  return textLength >= 24 || tasks.length > 0 || workflowPlan !== null;
}

function buildHandoffContinuationHints(workflowPlan: WorkflowPlanSummary | null): string[] {
  if (workflowPlan) {
    return [
      `新开一个会话，并把这份 handoff 作为第一条消息粘贴进去。`,
      `优先继续计划文件 ${workflowPlan.relativePath}。`,
      `先处理下一项：${workflowPlan.pendingItems[0] ?? '读取完整计划后继续执行。'}`,
    ];
  }

  return [
    '新开一个会话。',
    '把这份 handoff 作为第一条消息粘贴进去。',
    '在后面补充你的下一步任务要求。',
  ];
}

export async function executeHandoffCommand(params: {
  args: string[];
  commandId: string;
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  messages: Message[];
  metadataJson: string;
  rawInput?: string;
  sessionId: string;
  userId: string;
}): Promise<CommandExecutionResult> {
  const tasks = Object.values(params.graph.tasks)
    .filter((task) => task.sessionId === params.sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const workflowPlan = await findLatestWorkflowPlan(WORKSPACE_ROOT);

  if (!hasMeaningfulHandoffContext(params.messages, tasks, workflowPlan)) {
    return {
      sessionId: params.sessionId,
      events: [],
      card: {
        type: 'status',
        title: 'Handoff unavailable',
        message: '当前会话没有足够的有效上下文，暂时无需生成交接摘要。',
        tone: 'warning',
      },
    };
  }

  const completedTasks = tasks.filter((task) => task.status === 'completed');
  const activeTasks = tasks.filter(
    (task) => task.status === 'pending' || task.status === 'running',
  );
  const doc = buildHandoffDocument({
    sessionId: params.sessionId,
    title: 'Handoff Context',
    goal: extractLatestUserGoal(params.messages),
    summary: summarizeMessages(params.messages),
    currentState: [
      `会话任务：已完成 ${completedTasks.length} 项，进行中/待处理 ${activeTasks.length} 项。`,
      workflowPlan
        ? `工作计划：${workflowPlan.title}（${workflowPlan.completed}/${workflowPlan.total}）`
        : '当前没有检测到未完成的工作计划文件。',
    ],
    completedItems: completedTasks.map((task) => task.title),
    pendingItems: activeTasks.map((task) => task.title),
    keyFiles: workflowPlan ? [workflowPlan.relativePath] : [],
    keyDecisions: extractKeyDecisions(params.messages),
    continuationHints: buildHandoffContinuationHints(workflowPlan),
    nextSteps: extractNextSteps(tasks),
  });
  const markdown = formatHandoffMarkdown(doc);
  const metadata = mergeHandoffMetadata(params.metadataJson, markdown);
  const card = {
    type: 'status' as const,
    title: 'Handoff context ready（交接上下文已生成）',
    message: markdown,
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
        type: 'audit_ref',
        auditLogId: `${params.sessionId}:${params.commandId}:handoff`,
        eventId: `${params.sessionId}:${params.commandId}:handoff`,
        runId: `command:${params.sessionId}:${params.commandId}`,
        occurredAt: Date.now(),
      },
    ],
    card,
  };
}
