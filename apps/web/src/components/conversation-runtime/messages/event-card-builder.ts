import type { CommandResultCard, RunEvent } from '@openAwork/shared';
import type { AssistantEventKind, AssistantEventStatus } from './message-model.js';
import {
  createAssistantEventCardContent,
  createCompactionCardContent,
} from './card-codec.js';
import type { StatusTone } from './card-codec.js';

export function createCommandCardContent(
  card: CommandResultCard,
  options?: { kindOverride?: AssistantEventKind },
): string {
  return card.type === 'compaction'
    ? createCompactionCardContent({
        title: card.title,
        summary: card.summary,
        trigger: card.trigger,
        phase: 'completed',
      })
    : createAssistantEventCardContent({
        kind: options?.kindOverride ?? classifyAssistantEventKind(`${card.title}\n${card.message}`),
        title: card.title,
        message: card.message,
        status: mapToneToAssistantStatus(card.tone),
      });
}

function buildCompactionCardTitle(event: Extract<RunEvent, { type: 'compaction' }>): string {
  return 'compact';
}

function buildCompactionCardSummary(event: Extract<RunEvent, { type: 'compaction' }>): string {
  const lines: string[] = [];
  const summary = event.summary?.trim();
  if (summary) {
    lines.push(summary);
  }

  const metaParts: string[] = [];
  if (typeof event.compactedMessages === 'number' && event.compactedMessages > 0) {
    metaParts.push(`压缩 ${event.compactedMessages} 条`);
  }
  if (typeof event.representedMessages === 'number' && event.representedMessages > 0) {
    metaParts.push(`摘要覆盖 ${event.representedMessages} 条`);
  }
  if (event.cause === 'usage_overflow') {
    metaParts.push('触发：上下文用量溢出');
  } else if (event.cause === 'provider_overflow') {
    metaParts.push('触发：上游上下文溢出');
  } else if (event.cause === 'proactive_near_overflow') {
    metaParts.push('触发：接近上限主动压缩');
  } else if (event.cause === 'manual') {
    metaParts.push('触发：手动压缩');
  }

  if (metaParts.length > 0) {
    lines.push(metaParts.join(' · '));
  }

  if (lines.length === 0) {
    return event.trigger === 'automatic'
      ? '系统已压缩较早的对话内容，以腾出上下文空间。'
      : '会话上下文已压缩。';
  }
  return lines.join('\n');
}

export function createAssistantEventContent(
  event: RunEvent,
  options?: { kindOverride?: AssistantEventKind },
): string | null {
  if (event.type === 'compaction') {
    // Prefer the dedicated GenerativeUI compaction card so the main
    // transcript shows a purpose-built compact marker (title / trigger /
    // summary) instead of a generic operational status row.
    void options;
    return createCompactionCardContent({
      title: buildCompactionCardTitle(event),
      summary: buildCompactionCardSummary(event),
      trigger: event.trigger,
      phase: event.phase,
    });
  }

  if (event.type === 'permission_asked') {
    return createAssistantEventCardContent({
      kind: options?.kindOverride ?? 'permission',
      title: `等待权限 · ${event.toolName}`,
      message: [event.previewAction, event.reason, `${event.scope} · ${event.riskLevel}`]
        .filter((item) => typeof item === 'string' && item.trim().length > 0)
        .join('\n'),
      requestId: event.requestId,
      status: 'paused',
    });
  }

  if (event.type === 'permission_replied') {
    return createAssistantEventCardContent({
      kind: options?.kindOverride ?? 'permission',
      title: '权限已响应',
      message: formatPermissionDecision(event.decision),
      requestId: event.requestId,
      status: event.decision === 'reject' ? 'error' : 'success',
    });
  }

  if (event.type === 'question_asked') {
    return createAssistantEventCardContent({
      kind: options?.kindOverride ?? 'question',
      title: `等待回答 · ${event.toolName}`,
      message: event.title,
      status: 'paused',
    });
  }

  if (event.type === 'question_replied') {
    return createAssistantEventCardContent({
      kind: options?.kindOverride ?? 'question',
      title: '问题已响应',
      message: event.status === 'answered' ? '已回答，继续执行。' : '已忽略，等待进一步处理。',
      status: event.status === 'answered' ? 'success' : 'paused',
    });
  }

  if (event.type === 'task_update') {
    const messageParts: string[] = [];
    if (event.assignedAgent) messageParts.push(`代理：${event.assignedAgent}`);
    if (event.errorMessage) messageParts.push(`错误：${event.errorMessage}`);
    else if (event.result) messageParts.push(`结果：${event.result}`);
    if (event.parentTaskId) messageParts.push(`父任务：${event.parentTaskId}`);
    if (event.parentSessionId) messageParts.push(`父会话：${event.parentSessionId}`);
    if (event.sessionId) messageParts.push(`会话：${event.sessionId}`);
    return createAssistantEventCardContent({
      kind:
        options?.kindOverride ??
        classifyAssistantEventKind(
          event.assignedAgent ? `${event.label} ${event.assignedAgent}` : event.label,
        ),
      title: `任务${formatTaskStatusLabel(event.status)} · ${event.label}`,
      message: messageParts.join('\n'),
      status:
        event.status === 'failed'
          ? 'error'
          : event.status === 'cancelled'
            ? 'paused'
            : event.status === 'pending'
              ? 'paused'
              : event.status === 'done'
                ? 'success'
                : 'running',
    });
  }

  if (event.type === 'session_child') {
    return createAssistantEventCardContent({
      kind: options?.kindOverride ?? classifyAssistantEventKind(event.title ?? event.sessionId),
      title: '已创建子会话',
      message: [event.title, event.sessionId].filter((item) => Boolean(item)).join('\n'),
      status: 'success',
    });
  }

  if (event.type === 'audit_ref') {
    return createAssistantEventCardContent({
      kind:
        options?.kindOverride ??
        (event.toolName ? classifyAssistantEventKind(event.toolName) : 'audit'),
      title: '已记录审计引用',
      message: [event.toolName ? `工具：${event.toolName}` : '', `审计 ID：${event.auditLogId}`]
        .filter((item) => item.length > 0)
        .join('\n'),
      status: 'success',
    });
  }

  return null;
}

function classifyAssistantEventKind(text: string): AssistantEventKind {
  const normalized = text.trim().toLowerCase();
  if (normalized.includes('mcp') || normalized.includes('context7')) {
    return 'mcp';
  }
  if (normalized.includes('skill') || normalized.includes('技能')) {
    return 'skill';
  }
  if (
    normalized.includes('agent') ||
    normalized.includes('代理') ||
    normalized.includes('subagent') ||
    normalized.includes('oracle')
  ) {
    return 'agent';
  }
  if (normalized.includes('audit') || normalized.includes('审计')) {
    return 'audit';
  }
  if (normalized.includes('压缩') || normalized.includes('compact')) {
    return 'compaction';
  }
  if (normalized.includes('任务') || normalized.includes('task')) {
    return 'task';
  }
  return 'tool';
}

function mapToneToAssistantStatus(tone: StatusTone): AssistantEventStatus {
  if (tone === 'success') return 'success';
  if (tone === 'warning') return 'paused';
  if (tone === 'error') return 'error';
  return 'running';
}

function formatTaskStatusLabel(
  status: Extract<RunEvent, { type: 'task_update' }>['status'],
): string {
  if (status === 'in_progress') return '进行中';
  if (status === 'done') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return '待开始';
}

function formatPermissionDecision(
  decision: Extract<RunEvent, { type: 'permission_replied' }>['decision'],
): string {
  if (decision === 'once') return '本次允许';
  if (decision === 'session') return '本会话允许';
  if (decision === 'permanent') return '永久允许';
  return '已拒绝';
}
