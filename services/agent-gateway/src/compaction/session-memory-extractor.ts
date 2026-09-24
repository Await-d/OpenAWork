/**
 * Session Memory Extractor — Background extraction of session key information.
 *
 * Modeled after Claude Code's `services/SessionMemory/sessionMemory.ts`.
 *
 * Runs after each stream completes to extract and maintain a structured
 * markdown summary of the current session. This summary is used by
 * Session Memory Compact (Layer 1) to avoid LLM calls during compaction.
 *
 * Extraction triggers:
 * 1. Initialization threshold: First extraction when context reaches 30K tokens
 * 2. Update threshold: Subsequent extractions when 15K+ new tokens accumulated
 *    AND 5+ tool calls since last extraction
 *
 * The extractor uses the same LLM as the main conversation (via the
 * compaction route) but with a specialized prompt focused on maintaining
 * a living document rather than generating a one-shot summary.
 */

import type { Message } from '@openAwork/shared';
import { Effect } from 'effect';
import type { UnifiedMessage } from '../message/message-to-model-messages.js';
import type { ModelRouteConfig } from '../provider/model-router.js';
import {
  writeSessionMemoryContent,
  writeLastSessionMemoryMessageId,
  readSessionMemoryState,
} from './session-memory-store.js';
import { estimateMessageTokens } from './compaction-tail-budget.js';
import {
  runUpstreamGenerate,
  unifiedConversationToNativeMessages,
  type RunUpstreamGenerateResult,
} from '../v2-runtime/upstream/index.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface SessionMemoryExtractorConfig {
  /** Minimum context tokens before first extraction. */
  initializationThreshold: number;
  /** Minimum new tokens since last extraction to trigger update. */
  minimumTokensBetweenUpdate: number;
  /** Minimum tool calls since last extraction to trigger update. */
  toolCallsBetweenUpdates: number;
  /** Maximum output tokens for the extraction LLM call. */
  maxOutputTokens: number;
  /**
   * Token budget for the incremental delta sent to the extraction call.
   *
   * Extraction only sends messages after `lastSessionMemoryMessageId`; a
   * budget bounds the event where the delta grew much larger than the update
   * threshold (the remainder is summarized by the following extraction, since
   * the watermark only advances to the last selected message).
   */
  incrementalTokenBudget: number;
}

/** `enabled` 只走调用参数 / 环境变量，不进入默认阈值合并。 */
export interface SessionMemoryExtractionOptions extends Partial<SessionMemoryExtractorConfig> {
  /**
   * 显式开启/关闭本次提取；缺省读环境变量（默认关闭）。
   *
   * 对齐参考库 opencode v2.0.15：参考库**没有**会话记忆提取这一层（其辅助
   * LLM 调用只有 title / compaction / generate），该机制源自 Claude Code 的
   * 分层压缩设计。默认关闭可消除这笔参考库不存在的额外调用；确需启用时设置
   * `OPENAWORK_ENABLE_SESSION_MEMORY_EXTRACTION=1`，或在此显式传 true。
   */
  enabled?: boolean;
}

export const DEFAULT_EXTRACTOR_CONFIG: SessionMemoryExtractorConfig = {
  initializationThreshold: 30_000,
  minimumTokensBetweenUpdate: 15_000,
  toolCallsBetweenUpdates: 5,
  maxOutputTokens: 4_096,
  incrementalTokenBudget: 20_000,
};

/** 会话记忆提取的总开关；默认关闭（对齐参考库「无此机制」）。 */
export function isSessionMemoryExtractionEnabled(): boolean {
  const raw = globalThis.process?.env?.['OPENAWORK_ENABLE_SESSION_MEMORY_EXTRACTION'];
  if (typeof raw !== 'string') return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/**
 * Wall-clock timeout for the session-memory extraction upstream call.
 * Extraction runs fire-and-forget after a stream completes and the
 * caller passes no abort signal, so without this an upstream socket
 * that connects but never responds would leak a pending request (and
 * its in-flight conversation buffer) for the lifetime of the process.
 */
const SESSION_MEMORY_LLM_TIMEOUT_MS = 120_000;

// ─── Template ────────────────────────────────────────────────────────────────

const SESSION_MEMORY_TEMPLATE = `# Session Memory

## 用户目标
- (待提取)

## 关键决策
- (待提取)

## 当前进度
### 已完成
- (待提取)

### 进行中
- (待提取)

## 重要文件
- (待提取)

## 错误与修复
- (待提取)

## 用户偏好与约束
- (待提取)
`;

const SESSION_MEMORY_SYSTEM_PROMPT = `你是一个会话记忆维护助手。你的任务是根据最近的对话内容更新会话记忆文件。

规则：
1. 保留仍然有效的信息，删除已过期的
2. 合并新的事实和进展
3. 精确保留文件路径、命令、错误信息和代码片段
4. 使用简短要点，不写段落
5. 只更新有变化的部分
6. 不要添加你不确定的信息
7. 使用对话所用的语言

直接输出更新后的完整会话记忆内容，不要添加任何解释或前缀。`;

function buildExtractionUserPrompt(currentMemory: string): string {
  return `请根据以上对话内容更新下面的会话记忆。保留仍然有效的信息，合并新事实，删除已过期的内容。

当前会话记忆：
<current-memory>
${currentMemory}
</current-memory>

直接输出更新后的完整会话记忆内容：`;
}

// ─── Extraction Logic ────────────────────────────────────────────────────────

/**
 * Check if session memory extraction should run.
 * Returns true when both token and tool-call thresholds are met.
 */
export function shouldExtractSessionMemory(input: {
  sessionId: string;
  userId: string;
  messages: Message[];
  config?: Partial<SessionMemoryExtractorConfig>;
}): boolean {
  const config = { ...DEFAULT_EXTRACTOR_CONFIG, ...input.config };

  // Estimate current context size
  const totalTokens = input.messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);

  // Single DB read for all session memory state
  const state = readSessionMemoryState(input.sessionId, input.userId);

  if (!state.content && !state.lastMessageId) {
    // First extraction: check initialization threshold
    return totalTokens >= config.initializationThreshold;
  }

  // Subsequent extraction: check update thresholds
  // Count tokens and tool calls since last extraction
  const lastMessageId = state.lastMessageId;
  let foundLastMessage = !lastMessageId; // If no lastMessageId, count everything
  let newTokens = 0;
  let newToolCalls = 0;

  for (const msg of input.messages) {
    if (!foundLastMessage) {
      if (msg.id === lastMessageId) {
        foundLastMessage = true;
      }
      continue;
    }

    newTokens += estimateMessageTokens(msg);
    if (msg.role === 'assistant') {
      for (const content of msg.content) {
        if (content.type === 'tool_call') {
          newToolCalls++;
        }
      }
    }
  }

  // Both thresholds must be met
  return (
    newTokens >= config.minimumTokensBetweenUpdate && newToolCalls >= config.toolCallsBetweenUpdates
  );
}

/**
 * Extract/update session memory for a session.
 *
 * Called after each stream completes. Uses the compaction LLM route
 * to generate/update the session memory document.
 *
 * This is a fire-and-forget operation — errors are logged but don't
 * block the main flow.
 */
export async function extractSessionMemory(input: {
  sessionId: string;
  userId: string;
  route: ModelRouteConfig;
  signal?: AbortSignal;
  config?: SessionMemoryExtractionOptions;
}): Promise<{ success: boolean; error?: string }> {
  // 默认关闭（对齐参考库）：只有显式传 enabled 或环境变量开启才执行。
  const enabled = input.config?.enabled ?? isSessionMemoryExtractionEnabled();
  if (!enabled) {
    return { success: true };
  }

  const config = { ...DEFAULT_EXTRACTOR_CONFIG, ...input.config };

  try {
    // Load messages
    const messages = listSessionMessagesV2({
      sessionId: input.sessionId,
      userId: input.userId,
      statuses: ['final'],
    });

    // Check if extraction should run
    if (!shouldExtractSessionMemory({ ...input, messages })) {
      return { success: true }; // Not needed yet, not an error
    }

    // Get current memory (or initialize with template)
    const state = readSessionMemoryState(input.sessionId, input.userId);
    const currentMemory = state.content ?? SESSION_MEMORY_TEMPLATE;

    // Build the extraction prompt
    const userPrompt = buildExtractionUserPrompt(currentMemory);

    // Build the conversation context: ONLY the delta since the last
    // summarized message, capped at a token budget. Previously this re-sent
    // up to 50K tokens of already-summarized history on every update.
    const deltaMessages = selectIncrementalMessagesForExtraction({
      messages,
      lastMessageId: state.lastMessageId,
      tokenBudget: config.incrementalTokenBudget,
    });
    const conversationMessages: UnifiedMessage[] = deltaMessages.map((msg) => {
      if (msg.role === 'user') {
        const text = msg.content
          .filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        return { role: 'user' as const, content: text || '(empty)' };
      }
      if (msg.role === 'assistant') {
        const text = msg.content
          .filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        const toolCalls = msg.content
          .filter((c): c is Extract<typeof c, { type: 'tool_call' }> => c.type === 'tool_call')
          .map((c) => `[Tool: ${c.toolName}]`)
          .join(' ');
        return {
          role: 'assistant' as const,
          content: [text, toolCalls].filter(Boolean).join('\n') || '(empty)',
        };
      }
      return { role: 'user' as const, content: '(system message)' };
    });

    // Add the extraction prompt
    conversationMessages.push({ role: 'user', content: userPrompt });

    // Call LLM
    const modelMessages = unifiedConversationToNativeMessages(conversationMessages);
    const timeoutController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, SESSION_MEMORY_LLM_TIMEOUT_MS);
    timer.unref?.();
    const signal: AbortSignal = input.signal
      ? AbortSignal.any([timeoutController.signal, input.signal])
      : timeoutController.signal;
    let result: RunUpstreamGenerateResult;
    try {
      result = await Effect.runPromise(
        runUpstreamGenerate({
          providerType: input.route.providerType ?? 'openai',
          ...(input.route.upstreamProtocol
            ? { upstreamProtocol: input.route.upstreamProtocol }
            : {}),
          ...(input.route.apiKey ? { apiKey: input.route.apiKey } : {}),
          ...(input.route.apiBaseUrl ? { baseURL: input.route.apiBaseUrl } : {}),
          ...(input.route.openaiFastMode === true ? { openaiFastMode: true } : {}),
          ...(input.route.requestOverrides.headers &&
          Object.keys(input.route.requestOverrides.headers).length > 0
            ? { headers: input.route.requestOverrides.headers }
            : {}),
          model: input.route.model,
          // Pass the owning session so this call gets a prompt cache key + affinity header.
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          system: SESSION_MEMORY_SYSTEM_PROMPT,
          messages: modelMessages,
          maxOutputTokens: config.maxOutputTokens,
          temperature: 0,
          requestOverrides: input.route.requestOverrides,
          signal,
        }),
      );
    } catch (err) {
      if (timedOut) {
        throw new Error(`session memory LLM timeout (${SESSION_MEMORY_LLM_TIMEOUT_MS}ms)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const updatedMemory = result.text.trim();
    if (!updatedMemory) {
      return { success: false, error: 'LLM returned empty session memory' };
    }

    // Persist the updated memory
    writeSessionMemoryContent(input.sessionId, input.userId, updatedMemory);

    // Advance the watermark only to the last message that was actually sent
    // to the extractor — if the delta exceeded the budget, the remaining
    // messages are picked up by the next extraction instead of being skipped.
    const lastExtractedMessage = deltaMessages.at(-1);
    if (lastExtractedMessage) {
      writeLastSessionMemoryMessageId(input.sessionId, input.userId, lastExtractedMessage.id);
    }

    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.warn('[SESSION_MEMORY_EXTRACTOR] extraction failed:', message);
    return { success: false, error: message };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Select the incremental delta for extraction.
 *
 * Only messages after the stored watermark are eligible — re-sending already
 * summarized history was the single largest auxiliary-call waste in this
 * module (up to 50K tokens per update). Semantics:
 *
 * - No watermark → start from the beginning of the session (first extraction).
 * - Watermark not found in the current list (e.g. compacted away) → fall back
 *   to a bounded tail window instead of resending the whole history.
 * - Delta larger than the budget → take the OLDEST part of the delta; the
 *   caller advances the watermark only to the last selected message, so the
 *   next extraction picks up the remainder in order.
 */
function selectIncrementalMessagesForExtraction(input: {
  messages: Message[];
  lastMessageId: string | null;
  tokenBudget: number;
}): Message[] {
  const { messages, lastMessageId, tokenBudget } = input;
  if (messages.length === 0) {
    return [];
  }

  const watermarkIndex = lastMessageId
    ? messages.findIndex((message) => message.id === lastMessageId)
    : -1;
  // Watermark present but no longer in the list → bounded tail fallback.
  if (lastMessageId && watermarkIndex < 0) {
    return selectTailWithinBudget(messages, tokenBudget);
  }

  const startIndex = watermarkIndex + 1;
  const selected: Message[] = [];
  let totalTokens = 0;
  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    const tokens = estimateMessageTokens(message);
    if (selected.length > 0 && totalTokens + tokens > tokenBudget) break;
    selected.push(message);
    totalTokens += tokens;
  }

  return selected;
}

/** Bounded tail window used when the watermark is unavailable. */
function selectTailWithinBudget(messages: Message[], tokenBudget: number): Message[] {
  let totalTokens = 0;
  const selected: Message[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const tokens = estimateMessageTokens(message);
    if (selected.length > 0 && totalTokens + tokens > tokenBudget) break;
    selected.unshift(message);
    totalTokens += tokens;
  }
  return selected;
}
