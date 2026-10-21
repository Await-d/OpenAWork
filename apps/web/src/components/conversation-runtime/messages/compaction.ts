import type { ChatMessage } from './message-model.js';
import { estimateTokenCount } from './message-coercion.js';
import {
  createCompactionCardContent,
  parseAssistantEventContent,
  parseCompactionCardContent,
} from './card-codec.js';
import { parseAssistantTraceContent } from './trace-codec.js';

export type CompactionTranscriptSource = 'assistant_event' | 'card' | 'marker';
export type CompactionTranscriptPhase = 'completed' | 'failed' | 'started';

export interface CompactionTranscriptState {
  phase: CompactionTranscriptPhase;
  source: CompactionTranscriptSource;
  summary: string;
  tailStartMessageId?: string;
}

function compactionPhaseRank(phase: CompactionTranscriptPhase): number {
  if (phase === 'completed') return 3;
  if (phase === 'failed') return 2;
  return 1;
}

function parseCompactionTranscriptContent(content: string): CompactionTranscriptState | null {
  try {
    const parsed = JSON.parse(content) as {
      payload?: Record<string, unknown>;
      source?: unknown;
      type?: unknown;
    };
    const payload = parsed.payload ?? {};

    if (
      (parsed.source === 'openAwork' || parsed.source === 'openawork_internal') &&
      parsed.type === 'compaction_marker' &&
      typeof payload['summary'] === 'string'
    ) {
      return {
        phase: 'completed',
        source: 'marker',
        summary: payload['summary'],
        ...(typeof payload['tailStartMessageId'] === 'string'
          ? { tailStartMessageId: payload['tailStartMessageId'] }
          : {}),
      };
    }

    if (parsed.type === 'compaction' && typeof payload['summary'] === 'string') {
      return {
        phase:
          payload['phase'] === 'started' ||
          payload['phase'] === 'failed' ||
          payload['phase'] === 'completed'
            ? payload['phase']
            : 'completed',
        source: 'card',
        summary: payload['summary'],
      };
    }

    const assistantEvent = parseAssistantEventContent(content);
    if (assistantEvent?.kind === 'compaction') {
      return {
        phase:
          assistantEvent.status === 'running'
            ? 'started'
            : assistantEvent.status === 'error'
              ? 'failed'
              : 'completed',
        source: 'assistant_event',
        summary: assistantEvent.message,
      };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * 压缩状态 / 上下文 token 的按消息缓存。
 *
 * 这两个解析都会被「`messages` 每变化一次」的全表路径反复调用：
 * - `deduplicateCompactionMessages`、`shouldPreferHistoricalContextEstimate`、
 *   `shouldShowMessageInTranscript` 走 `readCompactionTranscriptState`；
 * - `messageInputTokens` 走 `estimateContextMessageTokens`。
 *
 * 其中 `parseAssistantTraceContent` / `JSON.parse` 作用在整段 content 上（含全部
 * 工具输出）。工具每执行完一条（`tool_result`）`messages` 就换一次引用，于是这些
 * 解析会对**整段历史**重跑一遍——长会话 + bash 长输出时，每次命令结束都是一次
 * 可感知的长任务。消息对象不可变（更新走新对象），因此按引用缓存安全。
 */
const compactionStateCache = new WeakMap<object, CompactionTranscriptState | null>();
const contextTokenCache = new WeakMap<object, number>();

function computeCompactionTranscriptState(
  message: Pick<ChatMessage, 'content' | 'role'>,
): CompactionTranscriptState | null {
  if (message.role !== 'assistant') {
    return null;
  }

  const direct = parseCompactionTranscriptContent(message.content);
  if (direct) {
    return direct;
  }

  const trace = parseAssistantTraceContent(message.content);
  if (trace && trace.text.trim().length > 0 && trace.text.trim() !== message.content.trim()) {
    return parseCompactionTranscriptContent(trace.text);
  }

  return null;
}

export function readCompactionTranscriptState(
  message: Pick<ChatMessage, 'content' | 'role'>,
): CompactionTranscriptState | null {
  const cached = compactionStateCache.get(message);
  if (cached !== undefined) {
    return cached;
  }

  const state = computeCompactionTranscriptState(message);
  compactionStateCache.set(message, state);
  return state;
}

/**
 * 判断消息内容是否是压缩消息（compaction）。
 * 用于在压缩消息上隐藏重试、收藏、点赞等操作按钮。
 */
export function isCompactionMessage(message: Pick<ChatMessage, 'content' | 'role'>): boolean {
  return readCompactionTranscriptState(message) !== null;
}

function resolveCompactionTranscriptIdentity(message: ChatMessage): string | null {
  const state = readCompactionTranscriptState(message);
  if (!state || state.source === 'marker') {
    return null;
  }

  const clientRequestId = message.clientRequestId?.trim() ?? '';
  if (clientRequestId.startsWith('assistant_event:compaction:')) {
    return clientRequestId.slice('assistant_event:'.length);
  }

  const legacyEventMatch = clientRequestId.match(
    /^assistant_event:(.+):compaction:(?:started|completed|failed|request-failed)$/,
  );
  if (legacyEventMatch?.[1]) {
    return `compaction:${legacyEventMatch[1]}`;
  }

  if (message.id.startsWith('assistant_event:compaction:')) {
    return message.id.slice('assistant_event:'.length);
  }

  return null;
}

export function deduplicateCompactionMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length < 2) {
    return messages;
  }

  const result: ChatMessage[] = [];
  const indexByIdentity = new Map<string, number>();
  for (const message of messages) {
    const identity = resolveCompactionTranscriptIdentity(message);
    if (!identity) {
      result.push(message);
      continue;
    }

    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, result.length);
      result.push(message);
      continue;
    }

    const existing = result[existingIndex];
    const nextState = readCompactionTranscriptState(message);
    const existingState = existing ? readCompactionTranscriptState(existing) : null;
    if (
      existing &&
      nextState &&
      (!existingState ||
        compactionPhaseRank(nextState.phase) >= compactionPhaseRank(existingState.phase))
    ) {
      result[existingIndex] = message;
    }
  }

  return result;
}

export function filterChatMessagesForContext(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  const deduplicatedMessages = deduplicateCompactionMessages(messages);
  let markerIndex = -1;
  let markerState: CompactionTranscriptState | null = null;
  for (let index = deduplicatedMessages.length - 1; index >= 0; index -= 1) {
    const state = readCompactionTranscriptState(deduplicatedMessages[index]!);
    if (state?.source === 'marker' && state.phase === 'completed') {
      markerIndex = index;
      markerState = state;
      break;
    }
  }

  if (markerIndex >= 0) {
    const tailIndex = markerState?.tailStartMessageId
      ? deduplicatedMessages.findIndex((message) => message.id === markerState?.tailStartMessageId)
      : -1;
    const messagesAfterMarker = deduplicatedMessages.slice(markerIndex + 1).filter((message) => {
      const state = readCompactionTranscriptState(message);
      // The persisted marker is the model-facing compaction summary. Any
      // assistant-event/card copy after it is display-only and must not be
      // counted or sent a second time.
      return state?.source !== 'assistant_event' && state?.source !== 'card';
    });
    if (tailIndex >= 0 && tailIndex <= markerIndex) {
      return [
        deduplicatedMessages[markerIndex]!,
        ...deduplicatedMessages.slice(tailIndex, markerIndex),
        ...messagesAfterMarker,
      ];
    }
    return [deduplicatedMessages[markerIndex]!, ...messagesAfterMarker];
  }

  for (let index = deduplicatedMessages.length - 1; index >= 0; index -= 1) {
    const state = readCompactionTranscriptState(deduplicatedMessages[index]!);
    if (state?.phase === 'completed') {
      return deduplicatedMessages.slice(index);
    }
  }

  return deduplicatedMessages;
}

export function estimateContextMessageTokens(message: ChatMessage): number {
  const cached = contextTokenCache.get(message);
  if (cached !== undefined) {
    return cached;
  }

  const tokens = computeContextMessageTokens(message);
  contextTokenCache.set(message, tokens);
  return tokens;
}

function computeContextMessageTokens(message: ChatMessage): number {
  const compaction = readCompactionTranscriptState(message);
  if (compaction) {
    if (compaction.phase !== 'completed') {
      return 0;
    }
    return estimateTokenCount(`What did we do so far?\n\n${compaction.summary}`);
  }

  if (message.role === 'assistant') {
    if (parseAssistantEventContent(message.content)) {
      return 0;
    }

    try {
      const parsed = JSON.parse(message.content) as { type?: unknown };
      if (
        parsed.type === 'status' ||
        parsed.type === 'tool_call' ||
        parsed.type === 'form' ||
        parsed.type === 'table' ||
        parsed.type === 'chart' ||
        parsed.type === 'approval' ||
        parsed.type === 'code_diff'
      ) {
        return 0;
      }
    } catch {
      // Plain assistant text and assistant traces continue below.
    }
  }

  return message.tokenEstimate ?? estimateTokenCount(message.content);
}

export function extractNestedCompactionCardContent(content: string): string | null {
  const directCard = parseCompactionCardContent(content);
  if (directCard) {
    return directCard;
  }

  const assistantEvent = parseAssistantEventContent(content);
  if (assistantEvent?.kind === 'compaction') {
    return createCompactionCardContent({
      title: assistantEvent.title.trim() || 'compact',
      summary: assistantEvent.message,
      trigger: 'automatic',
      phase:
        assistantEvent.status === 'running'
          ? 'started'
          : assistantEvent.status === 'error'
            ? 'failed'
            : 'completed',
    });
  }

  const trace = parseAssistantTraceContent(content);
  if (!trace) {
    return null;
  }

  const nested = trace.text.trim();
  if (nested.length === 0 || nested === content.trim()) {
    return null;
  }

  return parseCompactionCardContent(nested);
}
