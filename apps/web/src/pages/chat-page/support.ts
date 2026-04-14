import type { DialogueMode } from '../dialogue-mode.js';
import type {
  FileBackupRef,
  CapabilitySource,
  CanonicalRoleDescriptor,
  CommandDescriptor,
  CommandResultCard,
  FileDiffContent,
  Message,
  ModifiedFilesSummaryContent,
  RunEvent,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';
import {
  buildReadableAssistantText,
  collectTextCandidateFields,
  extractReasoningBlocks,
  isReasoningRecord,
  normalizeReasoningText,
} from './reasoning-content.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  rawContent?: Message['content'];
  model?: string;
  providerId?: string;
  createdAt?: number | string;
  durationMs?: number;
  firstTokenLatencyMs?: number;
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' | string;
  tokenEstimate?: number;
  toolCallCount?: number;
  modifiedFilesSummary?: ModifiedFilesSummaryContent;
  status?: 'streaming' | 'completed' | 'error';
}

export interface AssistantTraceToolCall {
  kind?: 'agent' | 'mcp' | 'skill' | 'tool';
  toolCallId?: string;
  toolName: string;
  input: Record<string, unknown>;
  clientRequestId?: string;
  fileDiffs?: FileDiffContent[];
  isError?: boolean;
  observability?: ToolCallObservabilityAnnotation;
  output?: unknown;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  status?: 'running' | 'paused' | 'completed' | 'failed';
}

export interface AssistantTracePayload {
  modifiedFilesSummary?: ModifiedFilesSummaryContent;
  reasoningBlocks?: string[];
  text: string;
  toolCalls: AssistantTraceToolCall[];
}

interface CopiedToolCardSections {
  inputText?: string;
  isError?: boolean;
  kind?: AssistantTraceToolCall['kind'];
  outputText?: string;
  resumedAfterApproval?: boolean;
  status?: AssistantTraceToolCall['status'];
  toolName: string;
}

export type AssistantEventKind =
  | 'agent'
  | 'audit'
  | 'compaction'
  | 'mcp'
  | 'permission'
  | 'skill'
  | 'task'
  | 'tool';

export type AssistantEventStatus = 'error' | 'paused' | 'running' | 'success';

export interface AssistantEventPayload {
  kind: AssistantEventKind;
  message: string;
  status: AssistantEventStatus;
  title: string;
}

export interface ChatUsageDetails {
  requestIndex: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  firstTokenLatencyMs?: number;
  tokensPerSecond?: number;
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

type StatusTone = 'info' | 'success' | 'warning' | 'error';

const SNAPSHOT_RECONCILE_TIME_TOLERANCE_MS = 15_000;
const BRACKETED_PASTE_START_MARKER = '\u001b[200~';
const BRACKETED_PASTE_END_MARKER = '\u001b[201~';
const HOST_PASTE_PREFIX_PATTERN = /^\s*\[Pasted(?:\s*~\d+)?\]?\s*/iu;

export function estimateTokenCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.round(normalized.length / 4));
}

export function sanitizeComposerPlainText(text: string): string {
  if (text.length === 0) {
    return text;
  }

  return text
    .replaceAll(BRACKETED_PASTE_START_MARKER, '')
    .replaceAll(BRACKETED_PASTE_END_MARKER, '')
    .replace(HOST_PASTE_PREFIX_PATTERN, '');
}

export function createAssistantTraceContent(payload: AssistantTracePayload): string {
  const reasoningBlocks = (payload.reasoningBlocks ?? [])
    .map((item) => normalizeReasoningText(item))
    .filter((item) => item.length > 0);

  return JSON.stringify({
    type: 'assistant_trace',
    payload: {
      modifiedFilesSummary: payload.modifiedFilesSummary,
      ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
      text: payload.text,
      toolCalls: payload.toolCalls,
    },
  });
}

export function createAssistantEventCardContent(payload: AssistantEventPayload): string {
  return JSON.stringify({
    source: 'openawork_internal',
    type: 'assistant_event',
    payload,
  });
}

export function parseAssistantEventContent(content: string): AssistantEventPayload | null {
  try {
    const parsed = JSON.parse(content) as {
      payload?: Record<string, unknown>;
      type?: unknown;
    };

    if (parsed?.type !== 'assistant_event') {
      return null;
    }

    const payload = parsed.payload ?? {};
    const kind =
      payload['kind'] === 'agent' ||
      payload['kind'] === 'audit' ||
      payload['kind'] === 'compaction' ||
      payload['kind'] === 'mcp' ||
      payload['kind'] === 'permission' ||
      payload['kind'] === 'skill' ||
      payload['kind'] === 'task' ||
      payload['kind'] === 'tool'
        ? payload['kind']
        : null;
    const status =
      payload['status'] === 'error' ||
      payload['status'] === 'paused' ||
      payload['status'] === 'running' ||
      payload['status'] === 'success'
        ? payload['status']
        : null;

    if (
      !kind ||
      !status ||
      typeof payload['title'] !== 'string' ||
      typeof payload['message'] !== 'string'
    ) {
      return null;
    }

    return {
      kind,
      message: payload['message'],
      status,
      title: payload['title'],
    };
  } catch {
    return null;
  }
}

export function createStatusCardContent(payload: {
  title: string;
  message: string;
  tone: StatusTone;
}): string {
  return JSON.stringify({
    type: 'status',
    payload,
  });
}

export function createCompactionCardContent(payload: {
  summary: string;
  title: string;
  trigger: 'manual' | 'automatic';
}): string {
  return JSON.stringify({
    type: 'compaction',
    payload,
  });
}

export function createCommandCardContent(
  card: CommandResultCard,
  options?: { kindOverride?: AssistantEventKind },
): string {
  return card.type === 'compaction'
    ? createAssistantEventCardContent({
        kind: options?.kindOverride ?? 'compaction',
        title: card.title,
        message: card.summary,
        status: 'success',
      })
    : createAssistantEventCardContent({
        kind: options?.kindOverride ?? classifyAssistantEventKind(`${card.title}\n${card.message}`),
        title: card.title,
        message: card.message,
        status: mapToneToAssistantStatus(card.tone),
      });
}

export function createAssistantEventContent(
  event: RunEvent,
  options?: { kindOverride?: AssistantEventKind },
): string | null {
  if (event.type === 'compaction') {
    return createAssistantEventCardContent({
      kind: options?.kindOverride ?? 'compaction',
      title: '会话已压缩',
      message: event.summary,
      status: 'success',
    });
  }

  if (event.type === 'permission_asked') {
    return createAssistantEventCardContent({
      kind:
        options?.kindOverride ??
        classifyAssistantEventKind(`${event.toolName} ${event.previewAction ?? ''}`),
      title: `等待权限 · ${event.toolName}`,
      message: [event.previewAction, event.reason, `${event.scope} · ${event.riskLevel}`]
        .filter((item) => typeof item === 'string' && item.trim().length > 0)
        .join('\n'),
      status: 'paused',
    });
  }

  if (event.type === 'permission_replied') {
    return createAssistantEventCardContent({
      kind: options?.kindOverride ?? 'permission',
      title: '权限已响应',
      message: formatPermissionDecision(event.decision),
      status: event.decision === 'reject' ? 'error' : 'success',
    });
  }

  if (event.type === 'question_asked') {
    return createAssistantEventCardContent({
      kind: options?.kindOverride ?? 'task',
      title: `等待回答 · ${event.toolName}`,
      message: event.title,
      status: 'paused',
    });
  }

  if (event.type === 'question_replied') {
    return createAssistantEventCardContent({
      kind: options?.kindOverride ?? 'task',
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

export function parseAssistantTraceContent(content: string): AssistantTracePayload | null {
  try {
    const parsed = JSON.parse(content) as {
      payload?: {
        modifiedFilesSummary?: unknown;
        reasoningBlocks?: unknown;
        text?: unknown;
        toolCalls?: unknown;
      };
      type?: unknown;
    };

    if (parsed?.type !== 'assistant_trace') {
      return null;
    }

    const text = typeof parsed.payload?.text === 'string' ? parsed.payload.text : '';
    const reasoningBlocks = Array.isArray(parsed.payload?.reasoningBlocks)
      ? parsed.payload.reasoningBlocks
          .filter((item): item is string => typeof item === 'string')
          .map((item) => normalizeReasoningText(item))
          .filter((item) => item.length > 0)
      : [];
    const toolCalls = Array.isArray(parsed.payload?.toolCalls)
      ? parsed.payload.toolCalls.flatMap((item) => {
          if (!item || typeof item !== 'object') {
            return [];
          }

          const record = item as Record<string, unknown>;
          if (typeof record['toolName'] !== 'string') {
            return [];
          }

          const input =
            record['input'] &&
            typeof record['input'] === 'object' &&
            !Array.isArray(record['input'])
              ? (record['input'] as Record<string, unknown>)
              : {};

          return [
            {
              ...(record['kind'] === 'agent' ||
              record['kind'] === 'mcp' ||
              record['kind'] === 'skill' ||
              record['kind'] === 'tool'
                ? { kind: record['kind'] }
                : {}),
              ...(typeof record['clientRequestId'] === 'string'
                ? { clientRequestId: record['clientRequestId'] }
                : {}),
              ...(Array.isArray(record['fileDiffs'])
                ? { fileDiffs: record['fileDiffs'].flatMap((item) => parseFileDiffContent(item)) }
                : {}),
              ...(typeof record['toolCallId'] === 'string'
                ? { toolCallId: record['toolCallId'] }
                : {}),
              toolName: record['toolName'],
              input,
              output: record['output'],
              isError: record['isError'] === true,
              ...(parseToolCallObservability(record['observability'])
                ? { observability: parseToolCallObservability(record['observability']) }
                : {}),
              ...(typeof record['pendingPermissionRequestId'] === 'string'
                ? { pendingPermissionRequestId: record['pendingPermissionRequestId'] }
                : {}),
              ...(record['resumedAfterApproval'] === true ? { resumedAfterApproval: true } : {}),
              status:
                record['status'] === 'running' ||
                record['status'] === 'paused' ||
                record['status'] === 'completed' ||
                record['status'] === 'failed'
                  ? record['status']
                  : undefined,
            } satisfies AssistantTraceToolCall,
          ];
        })
      : [];

    const modifiedFilesSummary = parseModifiedFilesSummaryContent(
      parsed.payload?.modifiedFilesSummary,
    );

    return {
      text,
      toolCalls,
      modifiedFilesSummary: modifiedFilesSummary ?? undefined,
      reasoningBlocks,
    };
  } catch {
    return null;
  }
}

export function clearResolvedPendingPermissionFromMessage(
  message: ChatMessage,
  requestId: string,
): ChatMessage | null {
  if (message.role !== 'assistant') {
    return message;
  }

  const assistantTrace = parseAssistantTraceContent(message.content);
  if (!assistantTrace) {
    return message;
  }

  const remainingToolCalls = assistantTrace.toolCalls.filter(
    (toolCall) => toolCall.pendingPermissionRequestId !== requestId,
  );
  if (remainingToolCalls.length === assistantTrace.toolCalls.length) {
    return message;
  }

  const hasReasoningBlocks = (assistantTrace.reasoningBlocks?.length ?? 0) > 0;
  const hasModifiedFilesSummary = Boolean(assistantTrace.modifiedFilesSummary);
  const hasText = assistantTrace.text.trim().length > 0;

  if (
    !hasText &&
    !hasReasoningBlocks &&
    !hasModifiedFilesSummary &&
    remainingToolCalls.length === 0
  ) {
    return null;
  }

  const nextContent =
    remainingToolCalls.length === 0 && !hasReasoningBlocks && !hasModifiedFilesSummary
      ? assistantTrace.text
      : createAssistantTraceContent({
          ...(hasModifiedFilesSummary
            ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
            : {}),
          ...(hasReasoningBlocks ? { reasoningBlocks: assistantTrace.reasoningBlocks } : {}),
          text: assistantTrace.text,
          toolCalls: remainingToolCalls,
        });

  return {
    ...message,
    content: nextContent,
    modifiedFilesSummary: hasModifiedFilesSummary ? assistantTrace.modifiedFilesSummary : undefined,
    toolCallCount: remainingToolCalls.length > 0 ? remainingToolCalls.length : undefined,
  };
}

function parseCopiedToolCardJson(value: string): unknown {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return value;
  }
}

function parseCopiedToolCardInput(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  const parsed = parseCopiedToolCardJson(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? { raw: normalized } : {};
}

function mapCopiedToolCardKind(value: string | undefined): AssistantTraceToolCall['kind'] {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'AGENT') return 'agent';
  if (normalized === 'MCP') return 'mcp';
  if (normalized === 'SKILL') return 'skill';
  if (normalized === 'TOOL') return 'tool';
  return undefined;
}

function mapCopiedToolCardStatus(value: string | undefined): AssistantTraceToolCall['status'] {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized === '完成') return 'completed';
  if (normalized === '失败') return 'failed';
  if (normalized === '恢复后失败') return 'failed';
  if (normalized === '执行中') return 'running';
  if (
    normalized === '等待权限' ||
    normalized === '等待处理' ||
    normalized === '等待回答' ||
    normalized === '等待确认'
  )
    return 'paused';
  return undefined;
}

function normalizeCopiedToolCardName(rawToolName: string): string {
  if (rawToolName === '子代理任务') {
    return 'task';
  }

  if (rawToolName === '技能') {
    return 'Skill';
  }

  if (rawToolName === '询问用户') {
    return 'AskUserQuestion';
  }

  if (rawToolName === '代理委派') {
    return 'Agent';
  }

  if (rawToolName === '进入规划模式') {
    return 'EnterPlanMode';
  }

  if (rawToolName === '退出规划模式') {
    return 'ExitPlanMode';
  }

  return rawToolName;
}

function parseCopiedToolCardSections(content: string): CopiedToolCardSections | null {
  const normalized = content.trim();
  if (!normalized.startsWith('工具：')) {
    return null;
  }

  const sections = normalized
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);
  const header = sections[0];
  if (!header) {
    return null;
  }

  const headerLines = header
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const toolLine = headerLines.find((line) => line.startsWith('工具：'));
  const typeLine = headerLines.find((line) => line.startsWith('类型：'));
  const statusLine = headerLines.find((line) => line.startsWith('状态：'));
  const summaryLine = headerLines.find((line) => line.startsWith('摘要：'));
  const resumeLine = headerLines.find((line) => line.startsWith('恢复：'));
  if (!toolLine || !typeLine || !statusLine || !summaryLine) {
    return null;
  }

  let inputText: string | undefined;
  let outputText: string | undefined;
  let isError = false;
  for (let index = 1; index < sections.length; index += 1) {
    const section = sections[index];
    if (!section) {
      continue;
    }

    if (section === '输入' || section.startsWith('输入\n')) {
      inputText = section === '输入' ? sections[index + 1] : section.slice('输入\n'.length);
      if (section === '输入') {
        index += 1;
      }
      continue;
    }

    if (
      section === '输出' ||
      section === '错误输出' ||
      section.startsWith('输出\n') ||
      section.startsWith('错误输出\n')
    ) {
      if (section === '输出' || section === '错误输出') {
        outputText = sections[index + 1];
        isError = section === '错误输出';
        index += 1;
        continue;
      }

      if (section.startsWith('错误输出\n')) {
        outputText = section.slice('错误输出\n'.length);
        isError = true;
        continue;
      }

      outputText = section.slice('输出\n'.length);
    }
  }

  const rawToolName = toolLine.slice('工具：'.length).trim();
  if (!rawToolName) {
    return null;
  }

  return {
    inputText,
    isError,
    kind: mapCopiedToolCardKind(typeLine.slice('类型：'.length)),
    outputText,
    resumedAfterApproval: resumeLine?.slice('恢复：'.length).trim() === '审批已通过后继续执行',
    status: mapCopiedToolCardStatus(statusLine.slice('状态：'.length)),
    toolName: normalizeCopiedToolCardName(rawToolName),
  };
}

export function parseCopiedToolCardContent(content: string): AssistantTraceToolCall | null {
  const sections = parseCopiedToolCardSections(content);
  if (!sections) {
    return null;
  }

  return {
    kind: sections.kind,
    toolName: sections.toolName,
    input: parseCopiedToolCardInput(sections.inputText),
    output: sections.outputText ? parseCopiedToolCardJson(sections.outputText) : undefined,
    isError: sections.isError,
    ...(sections.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
    status: sections.status,
  };
}

function parseLegacyToolCallContent(content: string): AssistantTraceToolCall | null {
  try {
    const parsed = JSON.parse(content) as {
      payload?: Record<string, unknown>;
      type?: string;
    };

    if (parsed?.type !== 'tool_call') {
      return parseCopiedToolCardContent(content);
    }

    const payload = parsed.payload ?? {};
    return {
      kind:
        payload['kind'] === 'agent' ||
        payload['kind'] === 'mcp' ||
        payload['kind'] === 'skill' ||
        payload['kind'] === 'tool'
          ? payload['kind']
          : undefined,
      toolCallId: typeof payload['toolCallId'] === 'string' ? payload['toolCallId'] : undefined,
      toolName: typeof payload['toolName'] === 'string' ? payload['toolName'] : 'tool',
      input:
        payload['input'] && typeof payload['input'] === 'object' && !Array.isArray(payload['input'])
          ? (payload['input'] as Record<string, unknown>)
          : {},
      output: payload['output'],
      isError: payload['isError'] === true,
      ...(payload['resumedAfterApproval'] === true ? { resumedAfterApproval: true } : {}),
      pendingPermissionRequestId:
        typeof payload['pendingPermissionRequestId'] === 'string'
          ? payload['pendingPermissionRequestId']
          : undefined,
      status:
        payload['status'] === 'running' ||
        payload['status'] === 'paused' ||
        payload['status'] === 'completed' ||
        payload['status'] === 'failed'
          ? payload['status']
          : undefined,
    };
  } catch {
    return parseCopiedToolCardContent(content);
  }
}

function appendToolCallToAssistantMessage(
  message: ChatMessage,
  toolCall: AssistantTraceToolCall,
): ChatMessage {
  const assistantTrace = parseAssistantTraceContent(message.content);
  if (assistantTrace) {
    return {
      ...message,
      content: createAssistantTraceContent({
        ...(assistantTrace.modifiedFilesSummary
          ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
          : {}),
        ...(assistantTrace.reasoningBlocks && assistantTrace.reasoningBlocks.length > 0
          ? { reasoningBlocks: assistantTrace.reasoningBlocks }
          : {}),
        text: assistantTrace.text,
        toolCalls: [...assistantTrace.toolCalls, toolCall],
      }),
      toolCallCount: (message.toolCallCount ?? assistantTrace.toolCalls.length) + 1,
    };
  }

  return {
    ...message,
    content: createAssistantTraceContent({
      text: message.content,
      toolCalls: [toolCall],
    }),
    toolCallCount: (message.toolCallCount ?? 0) + 1,
  };
}

export function parseToolCallInputText(inputText: string): Record<string, unknown> {
  const normalized = inputText.trim();
  if (normalized.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { raw: normalized };
  }
  return { raw: normalized };
}

export function formatShortTime(value: number | string | undefined): string | null {
  if (value === undefined) return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDurationLabel(durationMs: number | undefined): string | null {
  if (!durationMs || durationMs <= 0) return null;
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function formatStopReasonLabel(stopReason: string | undefined): string | null {
  if (!stopReason) return null;
  if (stopReason === 'end_turn') return '完成';
  if (stopReason === 'tool_use') return '调用工具';
  if (stopReason === 'max_tokens') return '达到上限';
  if (stopReason === 'error') return '错误';
  if (stopReason === 'cancelled') return '已停止';
  return stopReason;
}

export interface WorkspaceFileMentionItem {
  path: string;
  label: string;
  relativePath: string;
}

export interface SlashCommandItem {
  id: string;
  kind: 'slash';
  source: 'agent' | 'command' | 'mcp' | 'skill' | 'tool';
  type: 'action' | 'insert';
  label: string;
  description: string;
  onSelect: () => Promise<void>;
  badgeLabel?: string;
  insertText?: string;
}

export interface InstalledComposerSkill {
  id: string;
  label: string;
  description: string;
  source?: CapabilitySource;
}

export interface ComposerAgentTool {
  name: string;
  description: string;
}

export interface ComposerCapabilityItem {
  id: string;
  kind: 'agent' | 'command' | 'mcp' | 'skill' | 'tool';
  label: string;
  description: string;
  callable?: boolean;
  canonicalRole?: CanonicalRoleDescriptor;
  aliases?: string[];
  source?: CapabilitySource;
}

export interface MentionItem {
  id: string;
  kind: 'mention';
  label: string;
  description: string;
  insertText: string;
}

export type ComposerMenuState =
  | {
      type: 'slash';
      query: string;
      start: number;
      end: number;
      selectedIndex: number;
    }
  | {
      type: 'mention';
      query: string;
      start: number;
      end: number;
      selectedIndex: number;
    }
  | null;

interface WorkspaceTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: WorkspaceTreeNode[];
}

export function detectComposerTrigger(
  text: string,
  caret: number,
): Omit<NonNullable<ComposerMenuState>, 'selectedIndex'> | null {
  const beforeCaret = text.slice(0, caret);
  const lastBreak = Math.max(beforeCaret.lastIndexOf(' '), beforeCaret.lastIndexOf('\n'));
  const tokenStart = lastBreak + 1;
  const token = beforeCaret.slice(tokenStart);

  if (token.startsWith('/')) {
    return {
      type: 'slash',
      query: token.slice(1),
      start: tokenStart,
      end: caret,
    };
  }

  if (token.startsWith('@')) {
    return {
      type: 'mention',
      query: token.slice(1),
      start: tokenStart,
      end: caret,
    };
  }

  return null;
}

export function flattenWorkspaceFiles(
  nodes: WorkspaceTreeNode[],
  workingDirectory: string,
): WorkspaceFileMentionItem[] {
  const output: WorkspaceFileMentionItem[] = [];

  const visit = (entries: WorkspaceTreeNode[]) => {
    for (const entry of entries) {
      if (entry.type === 'file') {
        const relativePath = entry.path.startsWith(workingDirectory)
          ? entry.path.slice(workingDirectory.length).replace(/^\//, '')
          : entry.path;
        output.push({
          path: entry.path,
          label: entry.name,
          relativePath: relativePath || entry.name,
        });
      }
      if (
        entry.type === 'directory' &&
        Array.isArray(entry.children) &&
        entry.children.length > 0
      ) {
        visit(entry.children);
      }
    }
  };

  visit(nodes);
  return output;
}

export function parseSessionModeMetadata(metadataJson: string | undefined): {
  agentId?: string;
  dialogueMode: DialogueMode;
  toolSurfaceProfile: 'openawork' | 'claude_code_default' | 'claude_code_simple';
  yoloMode: boolean;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  providerId?: string;
  modelId?: string;
} {
  if (!metadataJson) {
    return {
      dialogueMode: 'clarify',
      toolSurfaceProfile: 'openawork',
      yoloMode: false,
      webSearchEnabled: false,
      thinkingEnabled: false,
      reasoningEffort: 'medium',
    };
  }

  try {
    const parsed = JSON.parse(metadataJson) as {
      dialogueMode?: DialogueMode;
      agentId?: string;
      yoloMode?: boolean;
      webSearchEnabled?: boolean;
      thinkingEnabled?: boolean;
      reasoningEffort?: ReasoningEffort;
      providerId?: string;
      modelId?: string;
      toolSurfaceProfile?: 'openawork' | 'claude_code_default' | 'claude_code_simple';
    };
    return {
      agentId: typeof parsed.agentId === 'string' ? parsed.agentId : undefined,
      dialogueMode:
        parsed.dialogueMode === 'clarify' ||
        parsed.dialogueMode === 'coding' ||
        parsed.dialogueMode === 'programmer'
          ? parsed.dialogueMode
          : 'clarify',
      toolSurfaceProfile:
        parsed['toolSurfaceProfile'] === 'claude_code_simple' ||
        parsed['toolSurfaceProfile'] === 'claude_code_default'
          ? parsed['toolSurfaceProfile']
          : 'openawork',
      yoloMode: parsed.yoloMode === true,
      webSearchEnabled: parsed.webSearchEnabled === true,
      thinkingEnabled: parsed.thinkingEnabled === true,
      reasoningEffort:
        parsed.reasoningEffort === 'minimal' ||
        parsed.reasoningEffort === 'low' ||
        parsed.reasoningEffort === 'medium' ||
        parsed.reasoningEffort === 'high' ||
        parsed.reasoningEffort === 'xhigh'
          ? parsed.reasoningEffort
          : 'medium',
      providerId: typeof parsed.providerId === 'string' ? parsed.providerId : undefined,
      modelId: typeof parsed.modelId === 'string' ? parsed.modelId : undefined,
    };
  } catch {
    return {
      agentId: undefined,
      dialogueMode: 'clarify',
      toolSurfaceProfile: 'openawork',
      yoloMode: false,
      webSearchEnabled: false,
      thinkingEnabled: false,
      reasoningEffort: 'medium',
    };
  }
}

export function toSharedMessageSnapshot(messages: ChatMessage[]): Message[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: normalizeCreatedAt(message.createdAt),
    content: [
      {
        type: 'text',
        text:
          message.role === 'assistant'
            ? (() => {
                const assistantTrace = parseAssistantTraceContent(message.content);
                return assistantTrace
                  ? buildReadableAssistantText(assistantTrace.text, assistantTrace.reasoningBlocks)
                  : message.content;
              })()
            : message.content,
      },
    ],
  }));
}

export function reconcileSnapshotChatMessages(
  previousMessages: ChatMessage[],
  snapshotMessages: ChatMessage[],
): ChatMessage[] {
  if (previousMessages.length === 0 || snapshotMessages.length === 0) {
    return snapshotMessages.length === 0 ? previousMessages : snapshotMessages;
  }

  // Build an index of previous messages by ID for O(1) lookup.
  const previousById = new Map<string, { message: ChatMessage; index: number }>();
  for (let index = 0; index < previousMessages.length; index++) {
    const message = previousMessages[index]!;
    previousById.set(message.id, { message, index });
  }

  // Track which previous messages have been matched so we can append unmatched ones.
  const matchedPreviousIndices = new Set<number>();
  const reconciled: ChatMessage[] = [];

  // Walk through snapshot messages in server order (canonical order).
  for (const snapshotMessage of snapshotMessages) {
    const previousEntry = previousById.get(snapshotMessage.id);

    if (previousEntry) {
      // Same ID: prefer the previous version to preserve local state
      // (e.g. pending permission annotations), but update if snapshot is more complete.
      matchedPreviousIndices.add(previousEntry.index);
      const previousMessage = previousEntry.message;
      if (previousMessage.status === 'streaming' && snapshotMessage.status !== 'streaming') {
        // Snapshot has a finalized version (e.g. completed/error), prefer it.
        reconciled.push(snapshotMessage);
      } else {
        reconciled.push(previousMessage);
      }
    } else {
      // No ID match — check if a previous message at a nearby position is equivalent
      // (handles cases where server assigns a different ID for the same logical message).
      let foundEquivalent = false;
      for (let offset = -1; offset <= 1 && !foundEquivalent; offset++) {
        const candidateIndex = reconciled.length + offset;
        if (
          candidateIndex >= 0 &&
          candidateIndex < previousMessages.length &&
          !matchedPreviousIndices.has(candidateIndex) &&
          areSnapshotMessagesEquivalent(previousMessages[candidateIndex]!, snapshotMessage)
        ) {
          matchedPreviousIndices.add(candidateIndex);
          reconciled.push(previousMessages[candidateIndex]!);
          foundEquivalent = true;
        }
      }

      if (!foundEquivalent) {
        // Genuinely new message from the server.
        reconciled.push(snapshotMessage);
      }
    }
  }

  // Append any previous messages that were not matched (local-only, e.g. event cards
  // appended during streaming that the server snapshot hasn't synced yet).
  for (let index = 0; index < previousMessages.length; index++) {
    if (!matchedPreviousIndices.has(index)) {
      const previousMessage = previousMessages[index]!;
      // Only preserve completed local messages; skip streaming placeholders
      // that should have been replaced by the snapshot.
      if (previousMessage.status !== 'streaming') {
        reconciled.push(previousMessage);
      }
    }
  }

  return reconciled;
}

export function normalizeChatMessages(rawMessages: unknown): ChatMessage[] {
  if (!Array.isArray(rawMessages)) return [];

  const toolCallMap = new Map<string, { input: Record<string, unknown>; toolName: string }>();
  const assistantMessageIndexByToolCallId = new Map<string, number>();
  const normalizedMessages: ChatMessage[] = [];

  for (const rawMessage of rawMessages) {
    if (!rawMessage || typeof rawMessage !== 'object') continue;
    const record = rawMessage as Record<string, unknown>;
    const role = record['role'];
    if (role !== 'user' && role !== 'assistant' && role !== 'tool') continue;
    const id = typeof record['id'] === 'string' ? record['id'] : crypto.randomUUID();
    const createdAt =
      typeof record['createdAt'] === 'number' || typeof record['createdAt'] === 'string'
        ? record['createdAt']
        : undefined;
    const model = normalizeOptionalString(record['model']);
    const providerId = normalizeOptionalString(record['providerId']);
    const durationMs =
      typeof record['durationMs'] === 'number' && Number.isFinite(record['durationMs'])
        ? record['durationMs']
        : undefined;
    const firstTokenLatencyMs =
      typeof record['firstTokenLatencyMs'] === 'number' &&
      Number.isFinite(record['firstTokenLatencyMs'])
        ? record['firstTokenLatencyMs']
        : undefined;
    const stopReason = typeof record['stopReason'] === 'string' ? record['stopReason'] : undefined;
    const tokenEstimate =
      typeof record['tokenEstimate'] === 'number' && Number.isFinite(record['tokenEstimate'])
        ? record['tokenEstimate']
        : undefined;

    if (typeof record['content'] === 'string') {
      if (role !== 'tool') {
        const nextMessage: ChatMessage = {
          id,
          role,
          content: record['content'],
          createdAt: normalizeCreatedAt(createdAt),
          model,
          providerId,
          durationMs,
          firstTokenLatencyMs,
          stopReason,
          tokenEstimate,
          status:
            record['status'] === 'streaming' ||
            record['status'] === 'completed' ||
            record['status'] === 'error'
              ? record['status']
              : undefined,
        };

        if (role === 'assistant') {
          const legacyToolCall = parseLegacyToolCallContent(record['content']);
          const assistantTrace = parseAssistantTraceContent(record['content']);
          const previousMessage = normalizedMessages[normalizedMessages.length - 1];

          if (legacyToolCall && previousMessage?.role === 'assistant') {
            normalizedMessages[normalizedMessages.length - 1] = appendToolCallToAssistantMessage(
              previousMessage,
              legacyToolCall,
            );
            continue;
          }

          if (legacyToolCall) {
            normalizedMessages.push({
              ...nextMessage,
              content: createAssistantTraceContent({ text: '', toolCalls: [legacyToolCall] }),
              toolCallCount: 1,
              tokenEstimate: nextMessage.tokenEstimate ?? 0,
            });
            continue;
          }

          if (assistantTrace) {
            const messageIndex = normalizedMessages.length;
            normalizedMessages.push({
              ...nextMessage,
              modifiedFilesSummary: assistantTrace.modifiedFilesSummary ?? undefined,
              toolCallCount:
                assistantTrace.toolCalls.length > 0 ? assistantTrace.toolCalls.length : undefined,
            });

            assistantTrace.toolCalls.forEach((toolCall) => {
              if (!toolCall.toolCallId) {
                return;
              }

              toolCallMap.set(toolCall.toolCallId, {
                input: toolCall.input,
                toolName: toolCall.toolName,
              });
              assistantMessageIndexByToolCallId.set(toolCall.toolCallId, messageIndex);
            });
            continue;
          }
        }

        normalizedMessages.push(nextMessage);
      }
      continue;
    }

    if (!Array.isArray(record['content'])) continue;

    const content = record['content'];
    const createdAtValue = normalizeCreatedAt(createdAt);

    if (role === 'user') {
      const text = extractDisplayText(content);
      if (text.length > 0) {
        normalizedMessages.push({
          id,
          role: 'user',
          content: text,
          rawContent: content as Message['content'],
          createdAt: createdAtValue,
          model,
          providerId,
          durationMs,
          firstTokenLatencyMs,
          stopReason,
          tokenEstimate,
          status: 'completed',
        });
      }
      continue;
    }

    if (role === 'assistant') {
      const text = extractDisplayText(content);
      const reasoningBlocks = extractReasoningBlocks(content, extractTextFragments);
      const toolCalls = extractToolCalls(content);
      const modifiedFilesSummary = extractModifiedFilesSummary(content);
      toolCalls.forEach((toolCall) => {
        toolCallMap.set(toolCall.toolCallId, {
          input: toolCall.input,
          toolName: toolCall.toolName,
        });
      });

      const assistantToolCalls = toolCalls.map((toolCall) => ({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
        status: 'running' as const,
      }));

      if (text.length > 0 || assistantToolCalls.length > 0 || reasoningBlocks.length > 0) {
        const messageIndex = normalizedMessages.length;
        normalizedMessages.push({
          id,
          role: 'assistant',
          content:
            assistantToolCalls.length > 0 || reasoningBlocks.length > 0
              ? createAssistantTraceContent({
                  text,
                  toolCalls: assistantToolCalls,
                  ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
                  ...(modifiedFilesSummary ? { modifiedFilesSummary } : {}),
                })
              : text,
          rawContent: content as Message['content'],
          createdAt: createdAtValue,
          model,
          providerId,
          durationMs,
          firstTokenLatencyMs,
          stopReason,
          tokenEstimate:
            tokenEstimate ?? estimateTokenCount(buildReadableAssistantText(text, reasoningBlocks)),
          toolCallCount: assistantToolCalls.length > 0 ? assistantToolCalls.length : undefined,
          modifiedFilesSummary: modifiedFilesSummary ?? undefined,
          status: 'completed',
        });

        toolCalls.forEach((toolCall) => {
          assistantMessageIndexByToolCallId.set(toolCall.toolCallId, messageIndex);
        });
      }

      continue;
    }

    const toolResults = extractToolResults(content);
    for (const toolResult of toolResults) {
      const toolCall = toolCallMap.get(toolResult.toolCallId);
      const assistantMessageIndex = assistantMessageIndexByToolCallId.get(toolResult.toolCallId);

      if (assistantMessageIndex !== undefined) {
        const targetMessage = normalizedMessages[assistantMessageIndex];
        const parsedTrace = targetMessage
          ? parseAssistantTraceContent(targetMessage.content)
          : null;

        if (targetMessage && parsedTrace) {
          targetMessage.content = createAssistantTraceContent({
            ...(parsedTrace.modifiedFilesSummary
              ? { modifiedFilesSummary: parsedTrace.modifiedFilesSummary }
              : {}),
            ...(parsedTrace.reasoningBlocks && parsedTrace.reasoningBlocks.length > 0
              ? { reasoningBlocks: parsedTrace.reasoningBlocks }
              : {}),
            text: parsedTrace.text,
            toolCalls: parsedTrace.toolCalls.map((item) => {
              const matchesToolResult =
                item.toolName === (toolCall?.toolName ?? item.toolName) &&
                (item.toolCallId
                  ? item.toolCallId === toolResult.toolCallId
                  : JSON.stringify(item.input) === JSON.stringify(toolCall?.input ?? item.input));

              if (!matchesToolResult) {
                return item;
              }

              const {
                pendingPermissionRequestId: _stalePendingPermissionRequestId,
                resumedAfterApproval: _staleResumedAfterApproval,
                ...baseItem
              } = item;

              return {
                ...baseItem,
                ...(toolResult.clientRequestId
                  ? { clientRequestId: toolResult.clientRequestId }
                  : {}),
                ...(toolResult.fileDiffs ? { fileDiffs: toolResult.fileDiffs } : {}),
                output: toolResult.output,
                isError: toolResult.pendingPermissionRequestId ? false : toolResult.isError,
                ...(toolResult.observability ? { observability: toolResult.observability } : {}),
                ...(toolResult.pendingPermissionRequestId
                  ? { pendingPermissionRequestId: toolResult.pendingPermissionRequestId }
                  : {}),
                ...(toolResult.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
                status: toolResult.pendingPermissionRequestId
                  ? 'paused'
                  : toolResult.isError
                    ? 'failed'
                    : 'completed',
              };
            }),
          });
        }
        continue;
      }

      normalizedMessages.push({
        id: `${id}:tool-fallback`,
        role: 'assistant',
        content: createAssistantTraceContent({
          text: '',
          toolCalls: [
            {
              ...(toolResult.clientRequestId
                ? { clientRequestId: toolResult.clientRequestId }
                : {}),
              ...(toolResult.fileDiffs ? { fileDiffs: toolResult.fileDiffs } : {}),
              toolCallId: toolResult.toolCallId,
              toolName: toolResult.toolName ?? toolCall?.toolName ?? 'tool',
              input: toolCall?.input ?? {},
              output: toolResult.output,
              isError: toolResult.pendingPermissionRequestId ? false : toolResult.isError,
              ...(toolResult.observability ? { observability: toolResult.observability } : {}),
              ...(toolResult.pendingPermissionRequestId
                ? { pendingPermissionRequestId: toolResult.pendingPermissionRequestId }
                : {}),
              ...(toolResult.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
              status: toolResult.pendingPermissionRequestId
                ? 'paused'
                : toolResult.isError
                  ? 'failed'
                  : 'completed',
            },
          ],
        }),
        rawContent: content as Message['content'],
        createdAt: createdAtValue,
        model,
        providerId,
        durationMs,
        firstTokenLatencyMs,
        stopReason,
        tokenEstimate: tokenEstimate ?? 0,
        toolCallCount: 1,
        status: toolResult.pendingPermissionRequestId
          ? 'completed'
          : toolResult.isError
            ? 'error'
            : 'completed',
      });
      assistantMessageIndexByToolCallId.set(toolResult.toolCallId, normalizedMessages.length - 1);
      if (!toolCall) {
        toolCallMap.set(toolResult.toolCallId, {
          input: {},
          toolName: toolResult.toolName ?? 'tool',
        });
      }
    }
  }

  return normalizedMessages;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function matchServerSlashCommand(
  input: string,
  commands: CommandDescriptor[],
): CommandDescriptor | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [commandToken] = trimmed.split(/\s+/, 1);
  if (!commandToken) return null;

  return (
    commands.find(
      (command) =>
        command.execution === 'server' &&
        command.label.toLowerCase() === commandToken.toLowerCase(),
    ) ?? null
  );
}

export function matchClientSlashCommand(
  input: string,
  commands: CommandDescriptor[],
): CommandDescriptor | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [commandToken] = trimmed.split(/\s+/, 1);
  if (!commandToken) return null;

  return (
    commands.find(
      (command) =>
        command.execution === 'client' &&
        command.label.toLowerCase() === commandToken.toLowerCase(),
    ) ?? null
  );
}

function normalizeCreatedAt(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function getComparableCreatedAt(value: number | string | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function areSnapshotMessagesEquivalent(left: ChatMessage, right: ChatMessage): boolean {
  if (left.role !== right.role || left.content !== right.content) {
    return false;
  }

  const leftCreatedAt = getComparableCreatedAt(left.createdAt);
  const rightCreatedAt = getComparableCreatedAt(right.createdAt);
  if (leftCreatedAt === null || rightCreatedAt === null) {
    return true;
  }

  return Math.abs(leftCreatedAt - rightCreatedAt) <= SNAPSHOT_RECONCILE_TIME_TOLERANCE_MS;
}

function extractDisplayText(rawContent: unknown[]): string {
  return extractTextFragments(rawContent).join('\n').trim();
}

function extractTextFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextFragments(item));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const content = value as Record<string, unknown>;
  const type = content['type'];

  if (type === 'tool_call' || type === 'tool_result') {
    return [];
  }

  if (isReasoningRecord(content)) {
    return [];
  }

  if (
    (type === 'text' || type === 'input_text' || type === 'output_text') &&
    typeof content['text'] === 'string'
  ) {
    return content['text'].trim().length > 0 ? [content['text']] : [];
  }

  return collectTextCandidateFields(content).flatMap((item) => extractTextFragments(item));
}

function extractToolCalls(
  rawContent: unknown[],
): Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }> {
  return rawContent.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const content = item as Record<string, unknown>;
    if (
      content['type'] === 'tool_call' &&
      typeof content['toolCallId'] === 'string' &&
      typeof content['toolName'] === 'string' &&
      content['input'] &&
      typeof content['input'] === 'object' &&
      !Array.isArray(content['input'])
    ) {
      return [
        {
          toolCallId: content['toolCallId'],
          toolName: content['toolName'],
          input: content['input'] as Record<string, unknown>,
        },
      ];
    }
    return [];
  });
}

function extractToolResults(rawContent: unknown[]): Array<{
  clientRequestId?: string;
  fileDiffs?: FileDiffContent[];
  toolCallId: string;
  toolName?: string;
  output: unknown;
  isError: boolean;
  observability?: ToolCallObservabilityAnnotation;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
}> {
  return rawContent.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const content = item as Record<string, unknown>;
    if (content['type'] === 'tool_result' && typeof content['toolCallId'] === 'string') {
      return [
        {
          ...(typeof content['clientRequestId'] === 'string'
            ? { clientRequestId: content['clientRequestId'] }
            : {}),
          ...(Array.isArray(content['fileDiffs'])
            ? { fileDiffs: content['fileDiffs'].flatMap((item) => parseFileDiffContent(item)) }
            : {}),
          toolCallId: content['toolCallId'],
          ...(typeof content['toolName'] === 'string' ? { toolName: content['toolName'] } : {}),
          output: content['output'],
          isError: content['isError'] === true,
          ...(parseToolCallObservability(content['observability'])
            ? { observability: parseToolCallObservability(content['observability']) }
            : {}),
          ...(typeof content['pendingPermissionRequestId'] === 'string'
            ? { pendingPermissionRequestId: content['pendingPermissionRequestId'] }
            : {}),
          ...(content['resumedAfterApproval'] === true ? { resumedAfterApproval: true } : {}),
        },
      ];
    }
    return [];
  });
}

function extractModifiedFilesSummary(rawContent: unknown[]): ModifiedFilesSummaryContent | null {
  for (const item of rawContent) {
    const summary = parseModifiedFilesSummaryContent(item);
    if (summary) {
      return summary;
    }
  }
  return null;
}

function parseModifiedFilesSummaryContent(value: unknown): ModifiedFilesSummaryContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    record['type'] !== 'modified_files_summary' ||
    typeof record['title'] !== 'string' ||
    typeof record['summary'] !== 'string' ||
    !Array.isArray(record['files'])
  ) {
    return null;
  }

  const files = record['files'].flatMap((item) => parseFileDiffContent(item));
  if (files.length === 0) {
    return null;
  }

  return {
    type: 'modified_files_summary',
    title: record['title'],
    summary: record['summary'],
    files,
  };
}

function parseToolCallObservability(value: unknown): ToolCallObservabilityAnnotation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const presentedToolName = normalizeOptionalString(record['presentedToolName']);
  const canonicalToolName = normalizeOptionalString(record['canonicalToolName']);
  const toolSurfaceProfile = normalizeOptionalString(record['toolSurfaceProfile']);
  const adapterVersion = normalizeOptionalString(record['adapterVersion']);

  if (!presentedToolName && !canonicalToolName && !toolSurfaceProfile && !adapterVersion) {
    return undefined;
  }

  return {
    presentedToolName,
    canonicalToolName,
    toolSurfaceProfile: toolSurfaceProfile as ToolCallObservabilityAnnotation['toolSurfaceProfile'],
    adapterVersion,
  };
}

function parseFileBackupRef(value: unknown): FileBackupRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const backupId = normalizeOptionalString(record['backupId']);
  const kind = normalizeOptionalString(record['kind']);
  if (!backupId || !kind) {
    return undefined;
  }

  return {
    backupId,
    kind,
    storagePath: normalizeOptionalString(record['storagePath']),
    artifactId: normalizeOptionalString(record['artifactId']),
    contentHash: normalizeOptionalString(record['contentHash']),
  } as FileBackupRef;
}

function parseFileDiffContent(value: unknown): FileDiffContent[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record['file'] !== 'string' ||
    typeof record['before'] !== 'string' ||
    typeof record['after'] !== 'string' ||
    typeof record['additions'] !== 'number' ||
    typeof record['deletions'] !== 'number'
  ) {
    return [];
  }

  return [
    {
      file: record['file'],
      before: record['before'],
      after: record['after'],
      additions: record['additions'],
      deletions: record['deletions'],
      clientRequestId: normalizeOptionalString(record['clientRequestId']),
      requestId: normalizeOptionalString(record['requestId']),
      toolName: normalizeOptionalString(record['toolName']),
      toolCallId: normalizeOptionalString(record['toolCallId']),
      sourceKind: normalizeOptionalString(record['sourceKind']) as FileDiffContent['sourceKind'],
      guaranteeLevel: normalizeOptionalString(
        record['guaranteeLevel'],
      ) as FileDiffContent['guaranteeLevel'],
      backupBeforeRef: parseFileBackupRef(record['backupBeforeRef']),
      backupAfterRef: parseFileBackupRef(record['backupAfterRef']),
      observability: parseToolCallObservability(record['observability']),
      status:
        record['status'] === 'added' ||
        record['status'] === 'deleted' ||
        record['status'] === 'modified'
          ? record['status']
          : undefined,
    },
  ];
}
