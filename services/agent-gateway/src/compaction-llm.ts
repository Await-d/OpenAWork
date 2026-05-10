import type { ModelRouteConfig } from './model-router.js';
import type { UnifiedMessage } from './message-to-model-messages.js';
import {
  runUpstreamGenerate,
  unifiedConversationToModelMessages,
} from './v2-runtime/upstream/index.js';
import { COMPACTION_SYSTEM_PROMPT, buildCompactionUserPrompt } from './compaction-prompt.js';

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
  const conversation: UnifiedMessage[] = [
    ...input.conversationMessages,
    { role: 'user', content: userPrompt },
  ];
  const messages = unifiedConversationToModelMessages(conversation);

  const result = await runUpstreamGenerate({
    providerType: input.route.providerType ?? 'openai',
    // Forward the resolved upstream protocol so providers configured for
    // `anthropic_messages` / `responses` actually hit their native API
    // surface instead of silently degrading to OpenAI Chat Completions.
    ...(input.route.upstreamProtocol ? { upstreamProtocol: input.route.upstreamProtocol } : {}),
    ...(input.route.apiKey ? { apiKey: input.route.apiKey } : {}),
    ...(input.route.apiBaseUrl ? { baseURL: input.route.apiBaseUrl } : {}),
    ...(input.route.requestOverrides.headers &&
    Object.keys(input.route.requestOverrides.headers).length > 0
      ? { headers: input.route.requestOverrides.headers }
      : {}),
    model: input.route.model,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    system: COMPACTION_SYSTEM_PROMPT,
    messages,
    maxOutputTokens: input.route.maxTokens,
    temperature: 0,
    requestOverrides: input.route.requestOverrides,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const summary = result.text.trim();
  if (!summary) {
    throw new Error('Compaction LLM returned empty summary');
  }
  return {
    summary,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
