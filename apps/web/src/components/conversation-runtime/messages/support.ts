import type { DialogueMode } from '../../../pages/chat-page/mode/dialogue-mode.js';
import type {
  AssistantTracePart,
  AssistantTracePayload,
  AssistantTraceToolCall,
  FileBackupRef,
  InputImageContent,
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
  contentFromAssistantTraceParts,
  createAssistantTraceContent as createSharedAssistantTraceContent,
  parseAssistantTraceContent as parseSharedAssistantTraceContent,
  partsFromAssistantTrace as partsFromSharedAssistantTrace,
  readAssistantTracePayloadFromParts as readAssistantTracePayloadFromSharedParts,
} from '@openAwork/shared';
export type {
  AssistantTracePart,
  AssistantTracePayload,
  AssistantTraceToolCall,
} from '@openAwork/shared';
import {
  buildReadableAssistantText,
  collectTextCandidateFields,
  extractReasoningBlocks,
  extractReasoningBlocksWithTimings,
  isReasoningRecord,
  normalizeReasoningText,
} from './reasoning-content.js';

// ---------------------------------------------------------------------------
// Parts-based message model (inspired by opencode MessageV2.Part).
// Each part has a stable `id` so reconciliation can simply find-by-id.
// ---------------------------------------------------------------------------

export interface ChatTextPart {
  id: string;
  type: 'text';
  text: string;
}

export interface ChatReasoningPart {
  id: string;
  type: 'reasoning';
  text: string;
  /** Wall-clock time the reasoning block first started streaming. */
  startedAt?: number;
  /** Wall-clock time the reasoning block was closed (thinking_end). */
  endedAt?: number;
}

export interface ChatToolPart {
  id: string;
  type: 'tool';
  toolCallId: string;
  toolName: string;
  kind?: 'agent' | 'mcp' | 'skill' | 'tool';
  input: Record<string, unknown>;
  clientRequestId?: string;
  durationMs?: number;
  fileDiffs?: FileDiffContent[];
  isError?: boolean;
  observability?: ToolCallObservabilityAnnotation;
  output?: unknown;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  status?: 'running' | 'paused' | 'completed' | 'failed';
}

export interface ChatEventPart {
  id: string;
  type: 'event';
  payload: AssistantEventPayload;
}

export type ChatMessagePart = ChatTextPart | ChatReasoningPart | ChatToolPart | ChatEventPart;

// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Structured parts — source of truth for reconciliation. */
  parts?: ChatMessagePart[];
  rawContent?: Message['content'];
  model?: string;
  providerId?: string;
  /** Agent ID that generated this message (for per-agent color rendering). */
  agentId?: string;
  createdAt?: number | string;
  durationMs?: number;
  firstTokenLatencyMs?: number;
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' | string;
  tokenEstimate?: number;
  providerUsage?: Message['providerUsage'];
  toolCallCount?: number;
  modifiedFilesSummary?: ModifiedFilesSummaryContent;
  status?: 'streaming' | 'completed' | 'error';
  /**
   * Transient flag (live-streaming only): one boolean per `reasoningBlocks`
   * entry — true once the corresponding `thinking_end` event has been seen.
   * Not persisted; finalized assistant messages either omit this or treat all
   * reasoning blocks as ended by default.
   */
  reasoningBlocksEndedFlags?: boolean[];
  /**
   * Transient durations (live-streaming only): one number-of-millis per
   * `reasoningBlocks` entry. -1 indicates "duration unknown" (block hasn't
   * ended yet, or backend did not provide startedAt). Not persisted on the
   * client; for finalized messages durations come from the server payload.
   */
  reasoningBlocksDurationsMs?: number[];
}

export interface ChatInputImageItem {
  artifactId?: string;
  detail?: 'auto' | 'high' | 'low' | 'original';
  fileId?: string;
  fileName?: string;
  imageUrl?: string;
  mimeType?: string;
}

export function hasActivePendingPermissionRequest(input: {
  isError?: boolean;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  status?: string;
}): boolean {
  return (
    typeof input.pendingPermissionRequestId === 'string' &&
    input.pendingPermissionRequestId.trim().length > 0 &&
    input.isError !== true &&
    input.resumedAfterApproval !== true &&
    input.status !== 'completed' &&
    input.status !== 'failed' &&
    input.status !== 'error'
  );
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
  | 'question'
  | 'skill'
  | 'task'
  | 'tool';

export type AssistantEventStatus = 'error' | 'paused' | 'running' | 'success';

export interface AssistantEventPayload {
  kind: AssistantEventKind;
  message: string;
  requestId?: string;
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
  return createSharedAssistantTraceContent({
    ...payload,
    ...(payload.reasoningBlocks
      ? {
          reasoningBlocks: payload.reasoningBlocks
            .map((item) => normalizeReasoningText(item))
            .filter((item) => item.length > 0),
        }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Parts ↔ AssistantTrace conversion helpers.
// `content` remains the serialized form for rendering compatibility;
// `parts` is the structured form used for reconciliation.
// ---------------------------------------------------------------------------

/**
 * Build a `parts` array from a parsed `AssistantTracePayload`.
 * Each part gets a deterministic ID derived from the parent message ID.
 */
export function partsFromAssistantTrace(
  messageId: string,
  trace: AssistantTracePayload,
): ChatMessagePart[] {
  return partsFromSharedAssistantTrace(messageId, trace) as ChatMessagePart[];
}

/**
 * Build a `parts` array from the raw assistant `MessageContent[]` array,
 * preserving the on-wire order in which the gateway recorded the segments.
 * Use this when the persisted message still has its structured `content`
 * array (post-2025-04 ordered persistence) — it reflects the true streaming
 * sequence of reasoning / text / tool_call segments instead of the legacy
 * reasoning → text → tool flattening produced by `partsFromAssistantTrace`.
 *
 * `tool_result` entries that appear in the same content array (the V2
 * projection in `message-v2-adapter.ts:v2ToV1Message` emits tool_call and
 * tool_result back-to-back inside the assistant message — no follow-up
 * `role: 'tool'` message is produced anymore) are merged onto the matching
 * tool part so the renderer sees `output` / `isError` / `status` directly
 * from the parts array. This is required for cards like `generate_image`
 * that read `result.artifactId` out of `part.output` to fetch and display
 * the actual artifact; without it the card shows "图片已生成" but the
 * image preview never appears even after refresh.
 */
export function partsFromOrderedAssistantContent(
  messageId: string,
  content: unknown[],
): ChatMessagePart[] {
  const parts: ChatMessagePart[] = [];
  const toolPartIndexByCallId = new Map<string, number>();
  let reasoningCounter = 0;
  let textCounter = 0;
  for (let index = 0; index < content.length; index += 1) {
    const item = content[index];
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const type = record['type'];

    if (type === 'reasoning') {
      const text = typeof record['text'] === 'string' ? record['text'] : '';
      // Skip empty reasoning segments. The gateway may persist them when a
      // `thinking_end` event arrives without any preceding `thinking_delta`
      // (or when the wire stream gets cut between the open and the first
      // content chunk). Rendering an empty reasoning part shows a stray
      // "Thinking:" header with no body — exactly the symptom users see
      // after a refresh.
      if (text.trim().length === 0) continue;
      const startedAt = typeof record['startedAt'] === 'number' ? record['startedAt'] : undefined;
      const endedAt = typeof record['endedAt'] === 'number' ? record['endedAt'] : undefined;
      parts.push({
        id: `${messageId}:reasoning:${reasoningCounter}`,
        type: 'reasoning',
        text,
        ...(startedAt !== undefined ? { startedAt } : {}),
        ...(endedAt !== undefined ? { endedAt } : {}),
      } as ChatReasoningPart);
      reasoningCounter += 1;
      continue;
    }

    if (type === 'text') {
      const text = typeof record['text'] === 'string' ? record['text'] : '';
      if (text.trim().length === 0) continue;
      parts.push({
        id: textCounter === 0 ? `${messageId}:text` : `${messageId}:text:${textCounter}`,
        type: 'text',
        text,
      });
      textCounter += 1;
      continue;
    }

    if (type === 'tool_call') {
      const toolCallId = typeof record['toolCallId'] === 'string' ? record['toolCallId'] : '';
      const toolName = typeof record['toolName'] === 'string' ? record['toolName'] : '';
      const input =
        record['input'] && typeof record['input'] === 'object' && !Array.isArray(record['input'])
          ? (record['input'] as Record<string, unknown>)
          : {};
      // Tool parts default to `running` so a result that hasn't arrived yet
      // (e.g. a snapshot taken mid-execution) does not look "completed".
      // The tool_result branch below upgrades the status when the matching
      // result is present in the same content array.
      parts.push({
        id: toolCallId.length > 0 ? toolCallId : `${messageId}:tool:${parts.length}`,
        type: 'tool',
        toolCallId,
        toolName,
        input,
        status: 'running',
      });
      if (toolCallId.length > 0) {
        toolPartIndexByCallId.set(toolCallId, parts.length - 1);
      }
      continue;
    }

    if (type === 'tool_result') {
      const toolCallId = typeof record['toolCallId'] === 'string' ? record['toolCallId'] : '';
      if (toolCallId.length === 0) continue;
      const targetIndex = toolPartIndexByCallId.get(toolCallId);
      if (targetIndex === undefined) continue;
      const existing = parts[targetIndex];
      if (!existing || existing.type !== 'tool') continue;
      const isError = record['isError'] === true;
      const pendingPermissionRequestId =
        typeof record['pendingPermissionRequestId'] === 'string'
          ? record['pendingPermissionRequestId']
          : undefined;
      const resumedAfterApproval = record['resumedAfterApproval'] === true;
      const hasPendingPermission = hasActivePendingPermissionRequest({
        isError,
        pendingPermissionRequestId,
        resumedAfterApproval,
      });
      const nextStatus: ChatToolPart['status'] = hasPendingPermission
        ? 'paused'
        : isError
          ? 'failed'
          : 'completed';
      const observability = parseToolCallObservability(record['observability']);
      const fileDiffs = Array.isArray(record['fileDiffs'])
        ? record['fileDiffs'].flatMap((entry) => parseFileDiffContent(entry))
        : undefined;
      parts[targetIndex] = {
        ...existing,
        output: record['output'],
        isError: hasPendingPermission ? false : isError,
        ...(observability ? { observability } : {}),
        ...(fileDiffs && fileDiffs.length > 0 ? { fileDiffs } : {}),
        ...(hasPendingPermission && pendingPermissionRequestId
          ? { pendingPermissionRequestId }
          : { pendingPermissionRequestId: undefined }),
        ...(resumedAfterApproval ? { resumedAfterApproval: true } : {}),
        status: nextStatus,
      } satisfies ChatToolPart;
      continue;
    }
  }
  return parts;
}

/**
 * Rebuild an `AssistantTracePayload` from a `parts` array,
 * then serialize it to the `content` JSON string.
 */
export function contentFromParts(
  parts: ChatMessagePart[],
  modifiedFilesSummary?: ModifiedFilesSummaryContent,
): string {
  return contentFromAssistantTraceParts(parts as AssistantTracePart[], modifiedFilesSummary);
}

export function readAssistantTracePayloadFromParts(
  parts: ChatMessagePart[],
  modifiedFilesSummary?: ModifiedFilesSummaryContent,
): AssistantTracePayload {
  return readAssistantTracePayloadFromSharedParts(
    parts.filter(
      (part): part is AssistantTracePart => part.type !== 'event',
    ) as AssistantTracePart[],
    modifiedFilesSummary,
  );
}

export function readAssistantTracePayload(
  message: Pick<ChatMessage, 'content' | 'modifiedFilesSummary' | 'parts' | 'role'>,
): AssistantTracePayload | null {
  if (message.role !== 'assistant') {
    return null;
  }

  if (message.parts && message.parts.some((part) => part.type !== 'event')) {
    return readAssistantTracePayloadFromParts(message.parts, message.modifiedFilesSummary);
  }

  return parseAssistantTraceContent(message.content);
}

/**
 * Reconcile two `parts` arrays using the opencode pattern:
 * find by part ID → replace if exists, push if new.
 */
export function reconcilePartsById(
  existingParts: ChatMessagePart[],
  incomingParts: ChatMessagePart[],
): ChatMessagePart[] {
  const result = [...existingParts];

  for (const incoming of incomingParts) {
    const index = result.findIndex((p) => p.id === incoming.id);
    if (index > -1) {
      result[index] = incoming;
    } else {
      result.push(incoming);
    }
  }

  return result;
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
      requestId: typeof payload['requestId'] === 'string' ? payload['requestId'] : undefined,
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

export function parseAssistantTraceContent(content: string): AssistantTracePayload | null {
  return parseSharedAssistantTraceContent(content, {
    hasActivePendingPermissionRequest,
    normalizeReasoningText,
    parseFileDiffContent: (value) => parseFileDiffContent(value),
    parseModifiedFilesSummaryContent,
    parseToolCallObservability,
  });
}

export function clearResolvedPendingPermissionFromMessage(
  message: ChatMessage,
  requestId: string,
): ChatMessage | null {
  if (message.role !== 'assistant') {
    return message;
  }

  const assistantTrace = readAssistantTracePayload(message);
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

  // Also update parts: remove the tool part whose pendingPermissionRequestId matched.
  const nextParts = message.parts?.filter((part) => {
    if (part.type !== 'tool') return true;
    return part.pendingPermissionRequestId !== requestId;
  });

  return {
    ...message,
    content: nextContent,
    ...(nextParts ? { parts: nextParts } : {}),
    modifiedFilesSummary: hasModifiedFilesSummary ? assistantTrace.modifiedFilesSummary : undefined,
    toolCallCount: remainingToolCalls.length > 0 ? remainingToolCalls.length : undefined,
  };
}

export function applyPermissionDecisionToLocalAssistantMessages(
  messages: ChatMessage[],
  requestId: string,
  decision: Extract<RunEvent, { type: 'permission_replied' }>['decision'],
  feedback?: string,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant') {
      return message;
    }

    const assistantTrace = readAssistantTracePayload(message);
    if (!assistantTrace) {
      return message;
    }

    let updated = false;
    const nextToolCalls = assistantTrace.toolCalls.map((toolCall) => {
      if (toolCall.pendingPermissionRequestId !== requestId) {
        return toolCall;
      }

      updated = true;
      const {
        pendingPermissionRequestId: _resolvedPendingPermissionRequestId,
        output: _waitingOutput,
        ...baseToolCall
      } = toolCall;

      return {
        ...baseToolCall,
        isError: decision === 'reject',
        ...(decision === 'reject'
          ? {
              output: feedback ? `权限已拒绝。用户反馈: ${feedback}` : '权限已拒绝，工具未执行。',
            }
          : {}),
        ...(decision !== 'reject' ? { resumedAfterApproval: true } : {}),
        status: decision === 'reject' ? ('failed' as const) : ('running' as const),
      } satisfies AssistantTraceToolCall;
    });

    if (!updated) {
      return message;
    }

    // Also update the parts array to reflect the permission decision.
    const nextParts = message.parts?.map((part) => {
      if (part.type !== 'tool' || part.pendingPermissionRequestId !== requestId) {
        return part;
      }
      const { pendingPermissionRequestId: _resolved, output: _waitingOutput, ...basePart } = part;
      return {
        ...basePart,
        isError: decision === 'reject',
        ...(decision === 'reject'
          ? {
              output: feedback ? `权限已拒绝。用户反馈: ${feedback}` : '权限已拒绝，工具未执行。',
            }
          : {}),
        ...(decision !== 'reject' ? { resumedAfterApproval: true } : {}),
        status: (decision === 'reject' ? 'failed' : 'running') as ChatToolPart['status'],
      } satisfies ChatToolPart;
    });

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
        toolCalls: nextToolCalls,
      }),
      ...(nextParts ? { parts: nextParts } : {}),
      modifiedFilesSummary: assistantTrace.modifiedFilesSummary ?? undefined,
      toolCallCount: nextToolCalls.length > 0 ? nextToolCalls.length : undefined,
    };
  });
}

export function dismissPermissionEventMessage(
  messages: ChatMessage[],
  requestId: string,
): ChatMessage[] {
  return messages.filter((message) => {
    if (message.role !== 'assistant') {
      return true;
    }

    const assistantEvent = parseAssistantEventContent(message.content);
    return !(assistantEvent?.kind === 'permission' && assistantEvent.requestId === requestId);
  });
}

export function applyToolResultToLocalAssistantMessages(
  messages: ChatMessage[],
  event: Extract<RunEvent, { type: 'tool_result' }>,
): ChatMessage[] {
  const hasPendingPermission = hasActivePendingPermissionRequest(event);
  let matched = false;

  const nextMessages = messages.map((message) => {
    if (message.role !== 'assistant') {
      return message;
    }

    const assistantTrace = readAssistantTracePayload(message);
    if (!assistantTrace) {
      return message;
    }

    let updatedInMessage = false;
    const nextToolCalls = assistantTrace.toolCalls.map((toolCall) => {
      if (toolCall.toolCallId !== event.toolCallId) {
        return toolCall;
      }

      updatedInMessage = true;
      matched = true;

      const {
        pendingPermissionRequestId: _stalePendingPermissionRequestId,
        resumedAfterApproval: _staleResumedAfterApproval,
        ...baseToolCall
      } = toolCall;

      return {
        ...baseToolCall,
        output: event.output,
        isError: hasPendingPermission ? false : event.isError,
        ...(hasPendingPermission
          ? { pendingPermissionRequestId: event.pendingPermissionRequestId }
          : {}),
        ...(event.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
        status: hasPendingPermission ? 'paused' : event.isError ? 'failed' : 'completed',
      } satisfies AssistantTraceToolCall;
    });

    if (!updatedInMessage) {
      return message;
    }

    const nextContent = createAssistantTraceContent({
      ...(assistantTrace.modifiedFilesSummary
        ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
        : {}),
      ...(assistantTrace.reasoningBlocks && assistantTrace.reasoningBlocks.length > 0
        ? { reasoningBlocks: assistantTrace.reasoningBlocks }
        : {}),
      text: assistantTrace.text,
      toolCalls: nextToolCalls,
    });

    // Also update the parts array by replacing the matching tool part by ID.
    const nextParts = message.parts?.map((part) => {
      if (part.type !== 'tool' || part.toolCallId !== event.toolCallId) return part;
      return {
        ...part,
        output: event.output,
        isError: hasPendingPermission ? false : event.isError,
        ...(hasPendingPermission
          ? { pendingPermissionRequestId: event.pendingPermissionRequestId }
          : { pendingPermissionRequestId: undefined }),
        ...(event.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
        status: (hasPendingPermission
          ? 'paused'
          : event.isError
            ? 'failed'
            : 'completed') as ChatToolPart['status'],
      } satisfies ChatToolPart;
    });

    return {
      ...message,
      content: nextContent,
      ...(nextParts ? { parts: nextParts } : {}),
      modifiedFilesSummary: assistantTrace.modifiedFilesSummary ?? undefined,
      toolCallCount: nextToolCalls.length > 0 ? nextToolCalls.length : undefined,
    };
  });

  return matched ? nextMessages : messages;
}

export function upsertPermissionEventMessage(
  messages: ChatMessage[],
  event: Extract<RunEvent, { type: 'permission_asked' | 'permission_replied' }>,
): ChatMessage[] {
  const content = createAssistantEventContent(event);
  if (!content) {
    return messages;
  }

  const nextMessages: ChatMessage[] = [];
  let matched = false;

  for (const message of messages) {
    if (message.role !== 'assistant') {
      nextMessages.push(message);
      continue;
    }

    const assistantEvent = parseAssistantEventContent(message.content);
    if (assistantEvent?.kind !== 'permission' || assistantEvent.requestId !== event.requestId) {
      nextMessages.push(message);
      continue;
    }

    if (!matched) {
      nextMessages.push({
        ...message,
        content,
        createdAt: message.createdAt ?? event.occurredAt ?? Date.now(),
        status: 'completed',
      });
      matched = true;
    }
  }

  if (matched) {
    return nextMessages;
  }

  return [
    ...nextMessages,
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      createdAt: event.occurredAt ?? Date.now(),
      status: 'completed',
    },
  ];
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

function looksLikeWaitingStateOutput(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  const serialized =
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();

  const normalized = serialized.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }

  return (
    normalized.includes('waiting for approval') ||
    normalized.includes('requires approval') ||
    normalized.includes('permission request') ||
    normalized.includes('waiting for answer') ||
    normalized.includes('waiting for confirmation') ||
    normalized.includes('等待权限') ||
    normalized.includes('等待审批') ||
    normalized.includes('等待回答') ||
    normalized.includes('等待确认')
  );
}

function shouldPreservePausedToolState(input: {
  isError?: boolean;
  output?: unknown;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  status?: string;
}): boolean {
  if (hasActivePendingPermissionRequest(input)) {
    return true;
  }

  return (
    input.status === 'paused' &&
    input.isError !== true &&
    input.resumedAfterApproval !== true &&
    looksLikeWaitingStateOutput(input.output)
  );
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

  const output = sections.outputText ? parseCopiedToolCardJson(sections.outputText) : undefined;
  const shouldStayPaused = shouldPreservePausedToolState({
    isError: sections.isError,
    output,
    resumedAfterApproval: sections.resumedAfterApproval,
    status: sections.status,
  });

  return {
    kind: sections.kind,
    toolName: sections.toolName,
    input: parseCopiedToolCardInput(sections.inputText),
    output,
    isError: sections.isError,
    ...(sections.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
    status:
      sections.status === 'paused' && !shouldStayPaused
        ? sections.isError || sections.outputText
          ? 'failed'
          : 'completed'
        : sections.status,
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
    const isError = payload['isError'] === true;
    const pendingPermissionRequestId =
      typeof payload['pendingPermissionRequestId'] === 'string'
        ? payload['pendingPermissionRequestId']
        : undefined;
    const resumedAfterApproval = payload['resumedAfterApproval'] === true;
    const status =
      payload['status'] === 'running' ||
      payload['status'] === 'paused' ||
      payload['status'] === 'completed' ||
      payload['status'] === 'failed'
        ? payload['status']
        : undefined;
    const shouldStayPaused = shouldPreservePausedToolState({
      isError,
      output: payload['output'],
      pendingPermissionRequestId,
      resumedAfterApproval,
      status,
    });
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
      isError,
      ...(resumedAfterApproval ? { resumedAfterApproval: true } : {}),
      ...(shouldStayPaused && pendingPermissionRequestId ? { pendingPermissionRequestId } : {}),
      status:
        status === 'paused' && !shouldStayPaused
          ? isError || payload['output'] !== undefined
            ? 'failed'
            : 'completed'
          : status,
    };
  } catch {
    return parseCopiedToolCardContent(content);
  }
}

function appendToolCallToAssistantMessage(
  message: ChatMessage,
  toolCall: AssistantTraceToolCall,
): ChatMessage {
  const assistantTrace = readAssistantTracePayload(message);
  if (assistantTrace) {
    const nextToolCalls = [...assistantTrace.toolCalls, toolCall];
    const nextContent = createAssistantTraceContent({
      ...(assistantTrace.modifiedFilesSummary
        ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
        : {}),
      ...(assistantTrace.reasoningBlocks && assistantTrace.reasoningBlocks.length > 0
        ? { reasoningBlocks: assistantTrace.reasoningBlocks }
        : {}),
      text: assistantTrace.text,
      toolCalls: nextToolCalls,
    });

    // Append a new ToolPart keyed by toolCallId.
    const newToolPart: ChatToolPart = {
      id: toolCall.toolCallId ?? `${message.id}:tool:${nextToolCalls.length - 1}`,
      type: 'tool',
      toolCallId: toolCall.toolCallId ?? '',
      toolName: toolCall.toolName,
      kind: toolCall.kind,
      input: toolCall.input,
      clientRequestId: toolCall.clientRequestId,
      durationMs: toolCall.durationMs,
      fileDiffs: toolCall.fileDiffs,
      isError: toolCall.isError,
      observability: toolCall.observability,
      output: toolCall.output,
      pendingPermissionRequestId: toolCall.pendingPermissionRequestId,
      resumedAfterApproval: toolCall.resumedAfterApproval,
      status: toolCall.status,
    };

    return {
      ...message,
      content: nextContent,
      parts: [...(message.parts ?? []), newToolPart],
      toolCallCount: (message.toolCallCount ?? assistantTrace.toolCalls.length) + 1,
    };
  }

  const newTrace: AssistantTracePayload = {
    text: message.content,
    toolCalls: [toolCall],
  };
  const newToolPart: ChatToolPart = {
    id: toolCall.toolCallId ?? `${message.id}:tool:0`,
    type: 'tool',
    toolCallId: toolCall.toolCallId ?? '',
    toolName: toolCall.toolName,
    kind: toolCall.kind,
    input: toolCall.input,
    status: toolCall.status,
  };

  return {
    ...message,
    content: createAssistantTraceContent(newTrace),
    parts: [
      ...(message.parts ?? [
        { id: `${message.id}:text`, type: 'text' as const, text: message.content },
      ]),
      newToolPart,
    ],
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

export interface WorkspaceTreeNode {
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
      yoloMode: false,
      webSearchEnabled: true,
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
    };
    return {
      agentId: typeof parsed.agentId === 'string' ? parsed.agentId : undefined,
      dialogueMode:
        parsed.dialogueMode === 'clarify' ||
        parsed.dialogueMode === 'coding' ||
        parsed.dialogueMode === 'programmer'
          ? parsed.dialogueMode
          : 'clarify',
      yoloMode: parsed.yoloMode === true,
      webSearchEnabled: parsed.webSearchEnabled !== false,
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
      yoloMode: false,
      webSearchEnabled: true,
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
    content:
      message.role === 'assistant'
        ? [
            {
              type: 'text',
              text: (() => {
                const assistantTrace = readAssistantTracePayload(message);
                return assistantTrace
                  ? buildReadableAssistantText(assistantTrace.text, assistantTrace.reasoningBlocks)
                  : message.content;
              })(),
            },
          ]
        : message.rawContent && message.rawContent.length > 0
          ? message.rawContent
          : [{ type: 'text', text: message.content }],
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

  // Track which previous messages have been matched so we can preserve unmatched
  // assistant event cards near their original anchors without duplicating them later.
  const matchedPreviousIndices = new Set<number>();
  const preservedPreviousIndices = new Set<number>();
  const reconciledSnapshotEntries: Array<{
    matchedPreviousIndex: number | null;
    message: ChatMessage;
  }> = [];

  // Walk through snapshot messages in server order (canonical order).
  for (const snapshotMessage of snapshotMessages) {
    const previousEntry = previousById.get(snapshotMessage.id);

    if (previousEntry) {
      // Same ID — use parts-based merge (opencode pattern).
      matchedPreviousIndices.add(previousEntry.index);
      const previousMessage = previousEntry.message;

      if (previousMessage.status === 'streaming' && snapshotMessage.status !== 'streaming') {
        // Snapshot has a finalized version (e.g. completed/error), prefer it.
        reconciledSnapshotEntries.push({
          matchedPreviousIndex: previousEntry.index,
          message: snapshotMessage,
        });
      } else if (previousMessage.parts && snapshotMessage.parts) {
        // Both have parts — merge by part ID (find → replace or push).
        const mergedParts = reconcilePartsById(previousMessage.parts, snapshotMessage.parts);
        reconciledSnapshotEntries.push({
          matchedPreviousIndex: previousEntry.index,
          message: {
            ...previousMessage,
            parts: mergedParts,
            content: contentFromParts(
              mergedParts,
              previousMessage.modifiedFilesSummary ?? snapshotMessage.modifiedFilesSummary,
            ),
            modifiedFilesSummary:
              snapshotMessage.modifiedFilesSummary ?? previousMessage.modifiedFilesSummary,
          },
        });
      } else {
        // Fallback: prefer previous to preserve local annotations, but merge
        // if the snapshot has more complete text content.
        reconciledSnapshotEntries.push({
          matchedPreviousIndex: previousEntry.index,
          message: mergePreferringCompleteContent(previousMessage, snapshotMessage),
        });
      }
    } else {
      // No ID match — check if a previous message at a nearby position shares
      // overlapping part IDs or equivalent content (handles server assigning
      // a different message ID for the same logical message).
      // Use a wider forward window (+5) to skip over locally-appended event
      // cards (permission events, compaction cards, etc.) that the server
      // snapshot does not include.
      let foundEquivalent = false;
      for (let offset = -1; offset <= 5 && !foundEquivalent; offset++) {
        const candidateIndex = reconciledSnapshotEntries.length + offset;
        if (
          candidateIndex >= 0 &&
          candidateIndex < previousMessages.length &&
          !matchedPreviousIndices.has(candidateIndex)
        ) {
          const candidate = previousMessages[candidateIndex]!;
          const matchedByParts = hasOverlappingPartIds(candidate.parts, snapshotMessage.parts);
          if (matchedByParts || areSnapshotMessagesEquivalent(candidate, snapshotMessage)) {
            matchedPreviousIndices.add(candidateIndex);
            reconciledSnapshotEntries.push({
              matchedPreviousIndex: candidateIndex,
              // Part-ID match → use snapshot (authoritative); content-equivalence → preserve local.
              message: matchedByParts ? snapshotMessage : candidate,
            });
            foundEquivalent = true;
          }
        }
      }

      if (!foundEquivalent) {
        // Genuinely new message from the server.
        reconciledSnapshotEntries.push({ matchedPreviousIndex: null, message: snapshotMessage });
      }
    }
  }

  const reconciled: ChatMessage[] = [];
  let nextPreviousIndex = 0;

  const preserveInterleavedAssistantEventsBefore = (matchedPreviousIndex: number) => {
    while (nextPreviousIndex < matchedPreviousIndex) {
      if (!matchedPreviousIndices.has(nextPreviousIndex)) {
        const previousMessage = previousMessages[nextPreviousIndex]!;
        if (
          previousMessage.status !== 'streaming' &&
          parseAssistantEventContent(previousMessage.content)
        ) {
          preservedPreviousIndices.add(nextPreviousIndex);
          reconciled.push(previousMessage);
        }
      }
      nextPreviousIndex += 1;
    }
  };

  for (const entry of reconciledSnapshotEntries) {
    if (entry.matchedPreviousIndex !== null) {
      preserveInterleavedAssistantEventsBefore(entry.matchedPreviousIndex);
      reconciled.push(entry.message);
      nextPreviousIndex = entry.matchedPreviousIndex + 1;
      continue;
    }

    reconciled.push(entry.message);
  }

  // Append any previous messages that were not matched (local-only, e.g. event cards
  // appended during streaming that the server snapshot hasn't synced yet).
  // Before appending, check that no content-equivalent message already exists in
  // the reconciled list — this prevents duplication when the server snapshot assigns
  // a different ID to the same logical message the client created locally.
  for (let index = 0; index < previousMessages.length; index++) {
    if (!matchedPreviousIndices.has(index) && !preservedPreviousIndices.has(index)) {
      const previousMessage = previousMessages[index]!;
      // Only preserve completed local messages; skip streaming placeholders
      // that should have been replaced by the snapshot.
      if (previousMessage.status === 'streaming') {
        continue;
      }

      // Check if an equivalent message already exists in reconciled output
      // (e.g. the snapshot contains the same message under a different ID).
      const alreadyPresent = reconciled.some(
        (existing) =>
          existing.id !== previousMessage.id &&
          areSnapshotMessagesEquivalent(existing, previousMessage),
      );
      if (alreadyPresent) {
        continue;
      }

      reconciled.push(previousMessage);
    }
  }

  return reconciled;
}

/**
 * When a stream finishes (onDone), the finalized assistant message should replace
 * any pre-existing partial assistant message from the snapshot rather than being
 * appended as a duplicate.
 *
 * Primary: uses part IDs for matching (opencode pattern).
 * Fallback: uses tool-call overlap, text-prefix, or reasoning-prefix heuristics.
 */
export function replaceOrAppendStreamedAssistantMessage(
  previousMessages: ChatMessage[],
  onDoneMessage: ChatMessage,
  streamToolCallIds: ReadonlySet<string>,
): ChatMessage[] {
  for (let i = previousMessages.length - 1; i >= 0; i--) {
    const msg = previousMessages[i]!;
    if (msg.role !== 'assistant') continue;

    // Primary: check for overlapping part IDs (deterministic, no heuristics).
    if (hasOverlappingPartIds(msg.parts, onDoneMessage.parts)) {
      return [...previousMessages.slice(0, i), onDoneMessage, ...previousMessages.slice(i + 1)];
    }

    // Fallback: heuristic checks for messages without parts.
    const existingTrace = readAssistantTracePayload(msg);
    if (!existingTrace) continue;

    // Tool call ID overlap.
    if (streamToolCallIds.size > 0) {
      const existingIds = new Set(
        existingTrace.toolCalls.map((tc) => tc.toolCallId).filter(Boolean),
      );
      if ([...streamToolCallIds].some((id) => existingIds.has(id))) {
        return [...previousMessages.slice(0, i), onDoneMessage, ...previousMessages.slice(i + 1)];
      }
    }

    const onDoneTrace = readAssistantTracePayload(onDoneMessage);
    if (onDoneTrace) {
      // Text prefix match.
      const existingText = existingTrace.text.trim();
      const onDoneText = onDoneTrace.text.trim();
      if (
        existingText.length > 0 &&
        onDoneText.length >= existingText.length &&
        onDoneText.startsWith(existingText)
      ) {
        return [...previousMessages.slice(0, i), onDoneMessage, ...previousMessages.slice(i + 1)];
      }

      // Reasoning block prefix match.
      const existingReasoning = joinReasoningBlocks(existingTrace.reasoningBlocks);
      const onDoneReasoning = joinReasoningBlocks(onDoneTrace.reasoningBlocks);
      if (
        existingReasoning.length > 0 &&
        onDoneReasoning.length >= existingReasoning.length &&
        onDoneReasoning.startsWith(existingReasoning)
      ) {
        return [...previousMessages.slice(0, i), onDoneMessage, ...previousMessages.slice(i + 1)];
      }
    }

    // Only check the last assistant message with trace content.
    break;
  }

  return [...previousMessages, onDoneMessage];
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
    const agentId = normalizeOptionalString(record['agentId']);
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
    const providerUsage = normalizeProviderUsage(record['providerUsage']);

    if (typeof record['content'] === 'string') {
      if (role !== 'tool') {
        const nextMessage: ChatMessage = {
          id,
          role,
          content: record['content'],
          createdAt: normalizeCreatedAt(createdAt),
          model,
          providerId,
          agentId,
          durationMs,
          firstTokenLatencyMs,
          stopReason,
          tokenEstimate,
          providerUsage,
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
              parts: partsFromAssistantTrace(nextMessage.id, assistantTrace),
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
      const inputImages = extractInputImages(content);
      if (text.length > 0 || inputImages.length > 0) {
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
          providerUsage,
          status: 'completed',
        });
      }
      continue;
    }

    if (role === 'assistant') {
      const text = extractDisplayText(content);
      const reasoningEntries = extractReasoningBlocksWithTimings(content, extractTextFragments);
      const reasoningBlocks = reasoningEntries.map((entry) => entry.text);
      const reasoningBlocksTimings = reasoningEntries.map((entry) => ({
        ...(typeof entry.startedAt === 'number' ? { startedAt: entry.startedAt } : {}),
        ...(typeof entry.endedAt === 'number' ? { endedAt: entry.endedAt } : {}),
      }));
      const hasReasoningTimings = reasoningBlocksTimings.some(
        (entry) => typeof entry.startedAt === 'number' || typeof entry.endedAt === 'number',
      );
      const toolCalls = extractToolCalls(content);
      const modifiedFilesSummary = extractModifiedFilesSummary(content);
      toolCalls.forEach((toolCall) => {
        toolCallMap.set(toolCall.toolCallId, {
          input: toolCall.input,
          toolName: toolCall.toolName,
        });
      });

      // Merge tool_result into tool_call — mirrors opencode's Part.state pattern
      // where each tool part carries its own complete status/output/error.
      const toolResults = extractToolResults(content);
      const toolResultMap = new Map(toolResults.map((r) => [r.toolCallId, r]));

      const assistantToolCalls: AssistantTraceToolCall[] = toolCalls.map((toolCall) => {
        const result = toolResultMap.get(toolCall.toolCallId);
        const hasPendingPermission =
          result?.pendingPermissionRequestId && !result.resumedAfterApproval;
        const inferredStatus: 'running' | 'paused' | 'completed' | 'failed' = hasPendingPermission
          ? 'paused'
          : result?.isError
            ? 'failed'
            : result
              ? 'completed'
              : 'completed';
        return {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
          ...(result?.output !== undefined ? { output: result.output } : {}),
          ...(result?.isError ? { isError: true } : {}),
          ...(result?.pendingPermissionRequestId
            ? { pendingPermissionRequestId: result.pendingPermissionRequestId }
            : {}),
          ...(result?.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
          ...(result?.clientRequestId ? { clientRequestId: result.clientRequestId } : {}),
          ...(result?.fileDiffs && result.fileDiffs.length > 0
            ? { fileDiffs: result.fileDiffs }
            : {}),
          ...(result?.observability ? { observability: result.observability } : {}),
          status: inferredStatus,
        };
      });

      if (text.length > 0 || assistantToolCalls.length > 0 || reasoningBlocks.length > 0) {
        const messageIndex = normalizedMessages.length;
        const tracePayload: AssistantTracePayload = {
          text,
          toolCalls: assistantToolCalls,
          ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
          ...(reasoningBlocks.length > 0 && hasReasoningTimings ? { reasoningBlocksTimings } : {}),
          ...(modifiedFilesSummary ? { modifiedFilesSummary } : {}),
        };
        const traceContent =
          assistantToolCalls.length > 0 || reasoningBlocks.length > 0
            ? createAssistantTraceContent(tracePayload)
            : text;
        // Build parts directly from the structured `content` array so the
        // restored transcript reflects the on-wire ordering of reasoning /
        // text / tool_call segments. The legacy `partsFromAssistantTrace`
        // path is kept as a fallback for messages that for whatever reason
        // arrive without a well-formed content array (e.g. stringified
        // legacy traces).
        const orderedParts = partsFromOrderedAssistantContent(id, content);
        // Reconcile tool part statuses: `partsFromOrderedAssistantContent`
        // defaults tool parts to `running` when no paired `tool_result` is
        // found in the content array. However, for finalized messages loaded
        // from history, the `assistantToolCalls` array (built from
        // `extractToolCalls` + `extractToolResults`) has the correct
        // `inferredStatus` which defaults to `completed`. Align the parts
        // with the authoritative status so the UI doesn't show a perpetual
        // spinner after page refresh when the tool has actually completed.
        if (orderedParts.length > 0 && assistantToolCalls.length > 0) {
          const statusByCallId = new Map(
            assistantToolCalls
              .filter((tc) => tc.toolCallId)
              .map((tc) => [tc.toolCallId, tc] as const),
          );
          for (let i = 0; i < orderedParts.length; i += 1) {
            const part = orderedParts[i];
            if (part && part.type === 'tool' && part.status === 'running') {
              const authoritative = statusByCallId.get(part.toolCallId);
              if (authoritative && authoritative.status && authoritative.status !== 'running') {
                orderedParts[i] = {
                  ...part,
                  ...(authoritative.output !== undefined ? { output: authoritative.output } : {}),
                  ...(authoritative.isError ? { isError: true } : {}),
                  ...(authoritative.fileDiffs ? { fileDiffs: authoritative.fileDiffs } : {}),
                  ...(authoritative.observability
                    ? { observability: authoritative.observability }
                    : {}),
                  ...(authoritative.pendingPermissionRequestId
                    ? { pendingPermissionRequestId: authoritative.pendingPermissionRequestId }
                    : {}),
                  ...(authoritative.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
                  status: authoritative.status,
                };
              }
            }
          }
        }
        const partsForMessage =
          orderedParts.length > 0
            ? orderedParts
            : partsFromAssistantTrace(id, {
                text,
                toolCalls: assistantToolCalls,
                ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
                ...(reasoningBlocks.length > 0 && hasReasoningTimings
                  ? { reasoningBlocksTimings }
                  : {}),
              });
        normalizedMessages.push({
          id,
          role: 'assistant',
          content: traceContent,
          parts: partsForMessage,
          rawContent: content as Message['content'],
          createdAt: createdAtValue,
          model,
          providerId,
          durationMs,
          firstTokenLatencyMs,
          stopReason,
          tokenEstimate:
            tokenEstimate ?? estimateTokenCount(buildReadableAssistantText(text, reasoningBlocks)),
          providerUsage,
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
      const hasPendingPermission = hasActivePendingPermissionRequest(toolResult);

      if (assistantMessageIndex !== undefined) {
        const targetMessage = normalizedMessages[assistantMessageIndex];
        const parsedTrace = targetMessage ? readAssistantTracePayload(targetMessage) : null;

        if (targetMessage && parsedTrace) {
          const nextToolCalls = parsedTrace.toolCalls.map((item) => {
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
            const nextStatus: AssistantTraceToolCall['status'] = hasPendingPermission
              ? 'paused'
              : toolResult.isError
                ? 'failed'
                : 'completed';

            return {
              ...baseItem,
              ...(toolResult.clientRequestId
                ? { clientRequestId: toolResult.clientRequestId }
                : {}),
              ...(toolResult.fileDiffs ? { fileDiffs: toolResult.fileDiffs } : {}),
              output: toolResult.output,
              isError: hasPendingPermission ? false : toolResult.isError,
              ...(toolResult.observability ? { observability: toolResult.observability } : {}),
              ...(hasPendingPermission
                ? { pendingPermissionRequestId: toolResult.pendingPermissionRequestId }
                : {}),
              ...(toolResult.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
              status: nextStatus,
            } satisfies AssistantTraceToolCall;
          });
          const nextTracePayload = {
            ...(parsedTrace.modifiedFilesSummary
              ? { modifiedFilesSummary: parsedTrace.modifiedFilesSummary }
              : {}),
            ...(parsedTrace.reasoningBlocks && parsedTrace.reasoningBlocks.length > 0
              ? { reasoningBlocks: parsedTrace.reasoningBlocks }
              : {}),
            text: parsedTrace.text,
            toolCalls: nextToolCalls,
          } satisfies AssistantTracePayload;
          targetMessage.content = createAssistantTraceContent(nextTracePayload);
          // Update parts in place rather than rebuilding via
          // `partsFromAssistantTrace`. The latter would re-flatten parts to
          // the legacy reasoning → text → tool ordering, undoing the
          // wire-faithful interleaving that `partsFromOrderedAssistantContent`
          // (or the live-stream segment accumulator) produced. We only need
          // to mirror the new tool-result payload onto the existing
          // ChatToolPart so the renderer (which consumes parts) shows the
          // updated output / status alongside the right tool segment.
          const existingParts = targetMessage.parts;
          if (existingParts && existingParts.length > 0) {
            targetMessage.parts = existingParts.map((part) => {
              if (part.type !== 'tool' || part.toolCallId !== toolResult.toolCallId) {
                return part;
              }
              const nextStatus: ChatToolPart['status'] = hasPendingPermission
                ? 'paused'
                : toolResult.isError
                  ? 'failed'
                  : 'completed';
              return {
                ...part,
                ...(toolResult.clientRequestId
                  ? { clientRequestId: toolResult.clientRequestId }
                  : {}),
                ...(toolResult.fileDiffs ? { fileDiffs: toolResult.fileDiffs } : {}),
                output: toolResult.output,
                isError: hasPendingPermission ? false : toolResult.isError,
                ...(toolResult.observability ? { observability: toolResult.observability } : {}),
                pendingPermissionRequestId: hasPendingPermission
                  ? toolResult.pendingPermissionRequestId
                  : undefined,
                resumedAfterApproval: toolResult.resumedAfterApproval
                  ? true
                  : part.resumedAfterApproval,
                status: nextStatus,
              };
            });
          } else {
            targetMessage.parts = partsFromAssistantTrace(targetMessage.id, nextTracePayload);
          }
        }
        continue;
      }

      const fallbackMessageId = `${id}:tool-fallback`;
      const fallbackStatus: AssistantTraceToolCall['status'] = hasPendingPermission
        ? 'paused'
        : toolResult.isError
          ? 'failed'
          : 'completed';
      const fallbackTracePayload = {
        text: '',
        toolCalls: [
          {
            ...(toolResult.clientRequestId ? { clientRequestId: toolResult.clientRequestId } : {}),
            ...(toolResult.fileDiffs ? { fileDiffs: toolResult.fileDiffs } : {}),
            toolCallId: toolResult.toolCallId,
            toolName: toolResult.toolName ?? toolCall?.toolName ?? 'tool',
            input: toolCall?.input ?? {},
            output: toolResult.output,
            isError: hasPendingPermission ? false : toolResult.isError,
            ...(toolResult.observability ? { observability: toolResult.observability } : {}),
            ...(hasPendingPermission
              ? { pendingPermissionRequestId: toolResult.pendingPermissionRequestId }
              : {}),
            ...(toolResult.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
            status: fallbackStatus,
          } satisfies AssistantTraceToolCall,
        ],
      } satisfies AssistantTracePayload;

      normalizedMessages.push({
        id: fallbackMessageId,
        role: 'assistant',
        content: createAssistantTraceContent(fallbackTracePayload),
        parts: partsFromAssistantTrace(fallbackMessageId, fallbackTracePayload),
        rawContent: content as Message['content'],
        createdAt: createdAtValue,
        model,
        providerId,
        durationMs,
        firstTokenLatencyMs,
        stopReason,
        tokenEstimate: tokenEstimate ?? 0,
        toolCallCount: 1,
        status: hasPendingPermission ? 'completed' : toolResult.isError ? 'error' : 'completed',
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

function normalizeNonNegativeTokenCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeProviderUsage(value: unknown): Message['providerUsage'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const inputTokens = normalizeNonNegativeTokenCount(record['inputTokens']);
  const outputTokens = normalizeNonNegativeTokenCount(record['outputTokens']);
  const totalTokens = normalizeNonNegativeTokenCount(record['totalTokens']);
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
    return undefined;
  }

  const reasoningTokens = normalizeNonNegativeTokenCount(record['reasoningTokens']);
  const cacheReadTokens = normalizeNonNegativeTokenCount(record['cacheReadTokens']);
  const cacheWriteTokens = normalizeNonNegativeTokenCount(record['cacheWriteTokens']);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
  };
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

function joinReasoningBlocks(blocks: string[] | undefined): string {
  if (!blocks || blocks.length === 0) return '';
  return blocks.join('\n').trim();
}

/**
 * Check whether two parts arrays share at least one part ID (tool call ID,
 * text ID, reasoning ID). Used to detect equivalent messages across different
 * message IDs — e.g. the client and server may assign different message IDs
 * to the same logical turn.
 */
function hasOverlappingPartIds(
  a: ChatMessagePart[] | undefined,
  b: ChatMessagePart[] | undefined,
): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return false;
  const aIds = new Set(a.map((p) => p.id));
  return b.some((p) => aIds.has(p.id));
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

/**
 * When the previous message and snapshot share the same ID and are both non-streaming,
 * prefer the previous message's local annotations (tool call states, pending permissions)
 * but adopt the snapshot's text if it is strictly longer (more complete).
 */
function mergePreferringCompleteContent(previous: ChatMessage, snapshot: ChatMessage): ChatMessage {
  if (previous.role !== 'assistant') return previous;

  const prevTrace = readAssistantTracePayload(previous);
  const snapTrace = readAssistantTracePayload(snapshot);
  if (!prevTrace || !snapTrace) return previous;

  // Only merge if snapshot has strictly more content (text or reasoning).
  const prevText = prevTrace.text.trim();
  const snapText = snapTrace.text.trim();
  const prevReasoningLen = joinReasoningBlocks(prevTrace.reasoningBlocks).length;
  const snapReasoningLen = joinReasoningBlocks(snapTrace.reasoningBlocks).length;
  if (snapText.length <= prevText.length && snapReasoningLen <= prevReasoningLen) return previous;

  // Merge: use snapshot's text but preserve previous's local tool call annotations.
  const mergedToolCalls: AssistantTraceToolCall[] = snapTrace.toolCalls.map((snapTC) => {
    const prevTC = prevTrace.toolCalls.find((tc) => tc.toolCallId === snapTC.toolCallId);
    if (!prevTC) return snapTC;

    return {
      ...snapTC,
      ...(prevTC.pendingPermissionRequestId
        ? { pendingPermissionRequestId: prevTC.pendingPermissionRequestId }
        : {}),
      ...(prevTC.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
      status: prevTC.status !== 'running' ? prevTC.status : snapTC.status,
    } satisfies AssistantTraceToolCall;
  });

  return {
    ...previous,
    content: createAssistantTraceContent({
      text: snapText,
      toolCalls: mergedToolCalls,
      ...(snapTrace.reasoningBlocks && snapTrace.reasoningBlocks.length > 0
        ? { reasoningBlocks: snapTrace.reasoningBlocks }
        : prevTrace.reasoningBlocks && prevTrace.reasoningBlocks.length > 0
          ? { reasoningBlocks: prevTrace.reasoningBlocks }
          : {}),
      ...(snapTrace.modifiedFilesSummary
        ? { modifiedFilesSummary: snapTrace.modifiedFilesSummary }
        : {}),
    }),
    modifiedFilesSummary: snapTrace.modifiedFilesSummary ?? previous.modifiedFilesSummary,
  };
}

function areSnapshotMessagesEquivalent(left: ChatMessage, right: ChatMessage): boolean {
  if (left.role !== right.role) {
    return false;
  }

  // Fast path: exact content match.
  if (left.content === right.content) {
    const leftCreatedAt = getComparableCreatedAt(left.createdAt);
    const rightCreatedAt = getComparableCreatedAt(right.createdAt);
    if (leftCreatedAt === null || rightCreatedAt === null) {
      return true;
    }
    return Math.abs(leftCreatedAt - rightCreatedAt) <= SNAPSHOT_RECONCILE_TIME_TOLERANCE_MS;
  }

  // For assistant messages, the local version (from onDone) and the server snapshot may
  // have the same text but different tool call states serialized into the content JSON.
  // Compare by the displayable text portion to catch these cases.
  if (left.role === 'assistant') {
    const leftTrace = readAssistantTracePayload(left);
    const rightTrace = readAssistantTracePayload(right);
    if (leftTrace && rightTrace) {
      const leftText = leftTrace.text.trim();
      const rightText = rightTrace.text.trim();
      if (leftText === rightText && leftText.length > 0) {
        const leftCreatedAt = getComparableCreatedAt(left.createdAt);
        const rightCreatedAt = getComparableCreatedAt(right.createdAt);
        if (leftCreatedAt === null || rightCreatedAt === null) {
          return true;
        }
        return Math.abs(leftCreatedAt - rightCreatedAt) <= SNAPSHOT_RECONCILE_TIME_TOLERANCE_MS;
      }

      // If text is empty on both sides, compare by tool call IDs as a proxy.
      if (leftText.length === 0 && rightText.length === 0) {
        const leftToolCallIds = new Set(
          leftTrace.toolCalls.map((tc) => tc.toolCallId).filter(Boolean),
        );
        const rightToolCallIds = new Set(
          rightTrace.toolCalls.map((tc) => tc.toolCallId).filter(Boolean),
        );
        if (
          leftToolCallIds.size > 0 &&
          leftToolCallIds.size === rightToolCallIds.size &&
          [...leftToolCallIds].every((id) => rightToolCallIds.has(id))
        ) {
          return true;
        }

        // If no tool calls either, compare by reasoning blocks content.
        if (leftToolCallIds.size === 0 && rightToolCallIds.size === 0) {
          const leftReasoning = joinReasoningBlocks(leftTrace.reasoningBlocks);
          const rightReasoning = joinReasoningBlocks(rightTrace.reasoningBlocks);
          if (leftReasoning.length > 0 && leftReasoning === rightReasoning) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function extractDisplayText(rawContent: unknown[]): string {
  return extractTextFragments(rawContent).join('\n').trim();
}

export function extractInputImages(rawContent: unknown[]): ChatInputImageItem[] {
  return rawContent.flatMap((item) => parseInputImageContent(item));
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
    // Synthetic text parts (e.g. `<system-reminder>` capability blocks
    // and `[thinking-hint]` trailing tags) are persisted on the user
    // message body so the prompt-cache prefix stays byte-stable across
    // turns, but they are *internal* state: they must never surface in
    // the chat transcript. Without this filter, recovery payloads put
    // the system reminder + hint around the user's typed text, which
    // makes the user feel their message was lost / replaced after a
    // refresh — see persistStreamUserMessage's `synthetic: true` parts.
    if (content['synthetic'] === true) {
      return [];
    }
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

function parseInputImageContent(value: unknown): ChatInputImageItem[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const content = value as Record<string, unknown>;
  if (content['type'] !== 'input_image') {
    return [];
  }

  return [
    {
      ...(typeof content['artifactId'] === 'string' ? { artifactId: content['artifactId'] } : {}),
      ...(content['detail'] === 'auto' ||
      content['detail'] === 'high' ||
      content['detail'] === 'low' ||
      content['detail'] === 'original'
        ? { detail: content['detail'] }
        : {}),
      ...(typeof content['fileId'] === 'string' ? { fileId: content['fileId'] } : {}),
      ...(typeof content['fileName'] === 'string' ? { fileName: content['fileName'] } : {}),
      ...(typeof content['imageUrl'] === 'string' ? { imageUrl: content['imageUrl'] } : {}),
      ...(typeof content['mimeType'] === 'string' ? { mimeType: content['mimeType'] } : {}),
    } satisfies ChatInputImageItem,
  ];
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
  const adapterVersion = normalizeOptionalString(record['adapterVersion']);

  if (!presentedToolName && !canonicalToolName && !adapterVersion) {
    return undefined;
  }

  return {
    presentedToolName,
    canonicalToolName,
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
