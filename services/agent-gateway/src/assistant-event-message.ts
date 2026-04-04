import type { MessageContent, RunEvent } from '@openAwork/shared';

const INTERNAL_ASSISTANT_EVENT_SOURCE = 'openawork_internal';

type AssistantEventKind =
  | 'agent'
  | 'audit'
  | 'compaction'
  | 'mcp'
  | 'permission'
  | 'skill'
  | 'task'
  | 'tool';

type AssistantEventStatus = 'error' | 'paused' | 'running' | 'success';

interface AssistantEventPayload {
  kind: AssistantEventKind;
  message: string;
  status: AssistantEventStatus;
  title: string;
}

export function buildAssistantEventMessageContent(event: RunEvent): MessageContent[] | null {
  const text = createAssistantEventText(event);
  return text ? [{ type: 'text', text }] : null;
}

function createAssistantEventText(event: RunEvent): string | null {
  if (event.type === 'compaction') {
    return createAssistantEventCardContent({
      kind: 'compaction',
      title: '会话已压缩',
      message: event.summary,
      status: 'success',
    });
  }

  if (event.type === 'permission_asked') {
    return createAssistantEventCardContent({
      kind: classifyAssistantEventKind(`${event.toolName} ${event.previewAction ?? ''}`),
      title: `等待权限 · ${event.toolName}`,
      message: [event.previewAction, event.reason, `${event.scope} · ${event.riskLevel}`]
        .filter((item) => typeof item === 'string' && item.trim().length > 0)
        .join('\n'),
      status: 'paused',
    });
  }

  if (event.type === 'permission_replied') {
    return createAssistantEventCardContent({
      kind: 'permission',
      title: '权限已响应',
      message: formatPermissionDecision(event.decision),
      status: event.decision === 'reject' ? 'error' : 'success',
    });
  }

  if (event.type === 'question_asked') {
    return createAssistantEventCardContent({
      kind: 'task',
      title: `等待回答 · ${event.toolName}`,
      message: event.title,
      status: 'paused',
    });
  }

  if (event.type === 'question_replied') {
    return createAssistantEventCardContent({
      kind: 'task',
      title: '问题已响应',
      message: event.status === 'answered' ? '已回答，继续执行。' : '已忽略，等待进一步处理。',
      status: event.status === 'answered' ? 'success' : 'paused',
    });
  }

  if (event.type === 'task_update') {
    const messageParts: string[] = [];
    if (event.assignedAgent) {
      messageParts.push(`代理：${event.assignedAgent}`);
    }
    if (event.errorMessage) {
      messageParts.push(`错误：${event.errorMessage}`);
    } else if (event.result) {
      messageParts.push(`结果：${event.result}`);
    }
    if (event.reason) {
      messageParts.push(`原因：${formatTaskTerminalReason(event.reason)}`);
    }
    if ('parentTaskId' in event && typeof event.parentTaskId === 'string') {
      messageParts.push(`父任务：${event.parentTaskId}`);
    }
    if (event.parentSessionId) {
      messageParts.push(`父会话：${event.parentSessionId}`);
    }
    if (event.sessionId) {
      messageParts.push(`会话：${event.sessionId}`);
    }

    return createAssistantEventCardContent({
      kind: classifyAssistantEventKind(
        event.assignedAgent ? `${event.label} ${event.assignedAgent}` : event.label,
      ),
      title: `任务${formatTaskStatusLabel(event.status)}${event.reason === 'timeout' ? '（超时）' : ''} · ${event.label}`,
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
      kind: classifyAssistantEventKind(event.title ?? event.sessionId),
      title: '已创建子会话',
      message: [event.title, event.sessionId].filter((item) => Boolean(item)).join('\n'),
      status: 'success',
    });
  }

  if (event.type === 'audit_ref') {
    return createAssistantEventCardContent({
      kind: event.toolName ? classifyAssistantEventKind(event.toolName) : 'audit',
      title: '已记录审计引用',
      message: [event.toolName ? `工具：${event.toolName}` : '', `审计 ID：${event.auditLogId}`]
        .filter((item) => item.length > 0)
        .join('\n'),
      status: 'success',
    });
  }

  return null;
}

function createAssistantEventCardContent(payload: AssistantEventPayload): string {
  return JSON.stringify({
    source: INTERNAL_ASSISTANT_EVENT_SOURCE,
    type: 'assistant_event',
    payload,
  });
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

function formatTaskTerminalReason(reason: string): string {
  if (reason === 'timeout') return '执行超时';
  if (reason === 'cancelled') return '用户取消';
  return reason;
}
