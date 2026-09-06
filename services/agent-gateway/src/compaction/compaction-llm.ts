import type { ModelRouteConfig } from '../provider/model-router.js';
import type { UnifiedMessage } from '../message/message-to-model-messages.js';
import { projectToolOutput } from '../message/tool-output-model-view.js';
import { Effect } from 'effect';
import {
  runUpstreamGenerate,
  unifiedConversationToNativeMessages,
  type RunUpstreamGenerateResult,
} from '../v2-runtime/upstream/index.js';
import {
  COMPACTION_SYSTEM_PROMPT,
  buildCompactionUserPrompt,
  stripAnalysisBlock,
} from './compaction-prompt.js';
import { microcompactMessages } from './microcompact.js';

/**
 * Filter out system messages from the conversation history before sending
 * to the compaction LLM. The compaction prompt is already passed via the
 * dedicated `system` parameter — any system messages from the persisted
 * session history are not relevant for summarization.
 */
function filterSystemMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
  return messages.filter((msg) => msg.role !== 'system');
}

function projectToolMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
  return messages.map((message) =>
    message.role === 'tool'
      ? {
          ...message,
          content: projectToolOutput(message.toolCallId, message.content),
        }
      : message,
  );
}

export interface CompactionLlmInput {
  conversationMessages: UnifiedMessage[];
  route: ModelRouteConfig;
  /** Session ID for prompt cache key routing. */
  sessionId?: string;
  signal?: AbortSignal;
  /**
   * Previous compaction summary (the "anchor"). When provided the
   * compaction LLM is asked to *update* that summary in place — keeping
   * still-valid bullets, dropping stale ones, merging new facts —
   * instead of re-summarising the entire conversation from scratch.
   * This avoids detail loss across multiple compaction rounds in long
   * sessions. Mirrors opencode #23870.
   *
   * Callers typically read this from
   * `readLastCompactionLlmSummary(metadataJson)`.
   */
  previousSummary?: string;
}

export interface CompactionLlmResult {
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

const PTL_RETRY_TRIM_RATIO = 0.5; // On PTL retry, keep only the latest 50% of conversation messages
const PTL_ERROR_PATTERNS = [
  'context_length_exceeded',
  'maximum context length',
  'too many tokens',
  'prompt is too long',
  'input is too long',
];

/**
 * Wall-clock timeout for a single compaction summary call. The native
 * generator honours `abortSignal` but has no built-in deadline;
 * the request-scoped signal passed by callers only fires when the
 * client disconnects, not when an upstream socket connects-but-hangs.
 * Compaction runs on context pressure (often mid-turn), so a hung
 * summary call would stall the session indefinitely.
 */
const COMPACTION_LLM_TIMEOUT_MS = 120_000;

function isPtlError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return PTL_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export async function callCompactionLlm(input: CompactionLlmInput): Promise<CompactionLlmResult> {
  try {
    return await callCompactionLlmOnce(input);
  } catch (error: unknown) {
    // P4: PTL retry — if the error is a context-length error, trim old messages and retry once
    if (isPtlError(error) && input.conversationMessages.length > 4) {
      const trimCount = Math.floor(input.conversationMessages.length * PTL_RETRY_TRIM_RATIO);
      const trimmedMessages = input.conversationMessages.slice(trimCount);
      return callCompactionLlmOnce({ ...input, conversationMessages: trimmedMessages });
    }
    throw error;
  }
}

async function callCompactionLlmOnce(input: CompactionLlmInput): Promise<CompactionLlmResult> {
  const userPrompt = buildCompactionUserPrompt({
    ...(input.previousSummary ? { previousSummary: input.previousSummary } : {}),
  });
  const compactedMessages = microcompactMessages(
    projectToolMessages(filterSystemMessages(input.conversationMessages)),
    undefined,
    {
      ...(input.route.contextWindow ? { contextWindowTokens: input.route.contextWindow } : {}),
      ...(input.route.contextWindowOverride
        ? { contextWindowOverrideTokens: input.route.contextWindowOverride }
        : {}),
    },
  );
  const conversation: UnifiedMessage[] = [
    ...compactedMessages.messages,
    { role: 'user', content: userPrompt },
  ];
  const messages = unifiedConversationToNativeMessages(conversation);

  const timeoutController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, COMPACTION_LLM_TIMEOUT_MS);
  timer.unref?.();
  const signal: AbortSignal = input.signal
    ? AbortSignal.any([timeoutController.signal, input.signal])
    : timeoutController.signal;

  let result: RunUpstreamGenerateResult;
  try {
    result = await Effect.runPromise(
      runUpstreamGenerate({
        providerType: input.route.providerType ?? 'openai',
        // Forward the resolved upstream protocol so providers configured for
        // `anthropic_messages` / `responses` actually hit their native API
        // surface instead of silently degrading to OpenAI Chat Completions.
        ...(input.route.upstreamProtocol ? { upstreamProtocol: input.route.upstreamProtocol } : {}),
        ...(input.route.apiKey ? { apiKey: input.route.apiKey } : {}),
        ...(input.route.apiBaseUrl ? { baseURL: input.route.apiBaseUrl } : {}),
        ...(input.route.openaiFastMode === true ? { openaiFastMode: true } : {}),
        ...(input.route.requestOverrides.headers &&
        Object.keys(input.route.requestOverrides.headers).length > 0
          ? { headers: input.route.requestOverrides.headers }
          : {}),
        model: input.route.model,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        system: COMPACTION_SYSTEM_PROMPT,
        messages,
        maxOutputTokens: input.route.maxTokens,
        ...(input.route.contextWindow ? { contextWindowTokens: input.route.contextWindow } : {}),
        ...(input.route.contextWindowOverride
          ? { contextWindowOverrideTokens: input.route.contextWindowOverride }
          : {}),
        temperature: 0,
        requestOverrides: input.route.requestOverrides,
        signal,
      }),
    );
  } catch (err) {
    if (timedOut) {
      throw new Error(`compaction LLM timeout (${COMPACTION_LLM_TIMEOUT_MS}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const summary = result.text.trim();
  if (!summary) {
    throw new Error('Compaction LLM returned empty summary');
  }
  // Strip the <analysis> drafting scratchpad — it improves summary quality
  // but has no informational value once the summary is written.
  // Also extracts content from <summary> tags if present.
  const cleanedSummary = stripAnalysisBlock(summary);
  if (!cleanedSummary) {
    throw new Error('Compaction LLM returned empty summary after analysis stripping');
  }
  return {
    summary: cleanedSummary,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
