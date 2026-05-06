import type { RequestOverrides } from '@openAwork/agent-core';
import type { UpstreamProtocol } from './upstream-protocol.js';
import type { PromptCacheConfig } from '../provider-adapter.js';
import { applyOpenAIDefaultTextVerbosity } from '../render-shared.js';
import {
  renderNormalizedConversationToUpstreamChatMessages,
  type NormalizedConversationMessage,
  type UpstreamChatMessage,
} from '../normalized-conversation.js';

export type {
  NormalizedConversationMessage,
  UpstreamChatMessage,
} from '../normalized-conversation.js';

export type UpstreamRequestBody = Record<string, unknown>;
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

interface UpstreamFunctionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
    deferLoading?: boolean;
  };
}

interface UpstreamThinkingConfig {
  enabled: boolean;
  effort: ReasoningEffort;
  providerType?: string;
  supportsThinking: boolean;
}

const ANTHROPIC_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16000,
  xhigh: 31999,
};

const GEMINI_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16000,
  xhigh: 24576,
};

function readObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function mergeGeminiThinkingConfig(
  body: UpstreamRequestBody,
  value: Record<string, unknown>,
): void {
  const extraBody = readObjectRecord(body['extra_body']);
  const googleBody = readObjectRecord(extraBody['google']);

  body['extra_body'] = {
    ...extraBody,
    google: {
      ...googleBody,
      thinking_config: {
        ...readObjectRecord(googleBody['thinking_config']),
        ...value,
      },
    },
  };
}

function mapAnthropicThinkingBudget(effort: ReasoningEffort): number {
  return ANTHROPIC_THINKING_BUDGETS[effort];
}

function mapGeminiThinkingBudget(effort: ReasoningEffort): number {
  return GEMINI_THINKING_BUDGETS[effort];
}

function mapGeminiThinkingLevel(effort: ReasoningEffort): 'low' | 'medium' | 'high' {
  if (effort === 'minimal' || effort === 'low') {
    return 'low';
  }

  if (effort === 'xhigh') {
    return 'high';
  }

  return effort;
}

function supportsOpenRouterReasoning(model: string): boolean {
  return model.includes('gpt') || model.includes('claude') || model.includes('gemini-3');
}

function isMoonshotThinkingModel(model: string): boolean {
  return (
    model.includes('kimi-k2.5') ||
    model.includes('kimi-k2-thinking') ||
    model.includes('kimi-k2p5') ||
    model.includes('kimi-k2-5')
  );
}

export function applyRequestOverridesToBody(
  body: UpstreamRequestBody,
  requestOverrides: RequestOverrides,
  protocol: UpstreamProtocol = 'chat_completions',
): UpstreamRequestBody {
  const nextBody: UpstreamRequestBody = { ...body };

  if (requestOverrides.maxTokens !== undefined) {
    nextBody[protocol === 'responses' ? 'max_output_tokens' : 'max_tokens'] =
      requestOverrides.maxTokens;
  }
  if (requestOverrides.temperature !== undefined) {
    nextBody['temperature'] = requestOverrides.temperature;
  }
  if (requestOverrides.topP !== undefined) {
    nextBody['top_p'] = requestOverrides.topP;
  }
  if (requestOverrides.frequencyPenalty !== undefined) {
    nextBody['frequency_penalty'] = requestOverrides.frequencyPenalty;
  }
  if (requestOverrides.presencePenalty !== undefined) {
    nextBody['presence_penalty'] = requestOverrides.presencePenalty;
  }
  if (requestOverrides.body) {
    Object.assign(nextBody, requestOverrides.body);
  }

  for (const key of requestOverrides.omitBodyKeys ?? []) {
    delete nextBody[key];
  }

  return nextBody;
}

function applyThinkingConfigToBody(
  body: UpstreamRequestBody,
  thinking: UpstreamThinkingConfig | undefined,
  protocol: UpstreamProtocol,
): UpstreamRequestBody {
  if (!thinking || !thinking.supportsThinking) {
    return body;
  }

  const nextBody: UpstreamRequestBody = { ...body };
  const modelValue = typeof nextBody['model'] === 'string' ? nextBody['model'] : '';
  const model = modelValue.toLowerCase();

  switch (thinking.providerType) {
    case 'openai':
      if (protocol === 'responses') {
        if (thinking.enabled) {
          nextBody['reasoning'] = { effort: thinking.effort, summary: 'auto' };
        } else {
          delete nextBody['reasoning'];
        }
        return nextBody;
      }

      if (thinking.enabled) {
        nextBody['reasoning_effort'] = thinking.effort;
      } else {
        delete nextBody['reasoning_effort'];
      }
      return nextBody;
    case 'deepseek':
      if (thinking.enabled && !model.includes('reasoner')) {
        nextBody['thinking'] = { type: 'enabled' };
      } else {
        delete nextBody['thinking'];
      }
      return nextBody;
    case 'anthropic':
      if (thinking.enabled) {
        nextBody['thinking'] = {
          type: 'enabled',
          budget_tokens: mapAnthropicThinkingBudget(thinking.effort),
        };
      } else {
        delete nextBody['thinking'];
      }
      return nextBody;
    case 'gemini':
      if (!thinking.enabled) {
        mergeGeminiThinkingConfig(nextBody, {
          thinking_budget: 0,
        });
        return nextBody;
      }

      if (model.includes('gemini-3')) {
        mergeGeminiThinkingConfig(nextBody, {
          include_thoughts: true,
          thinking_level: mapGeminiThinkingLevel(thinking.effort),
        });
        return nextBody;
      }

      mergeGeminiThinkingConfig(nextBody, {
        include_thoughts: true,
        thinking_budget: mapGeminiThinkingBudget(thinking.effort),
      });
      return nextBody;
    case 'openrouter':
      if (!supportsOpenRouterReasoning(model)) {
        return nextBody;
      }

      nextBody['reasoning'] = thinking.enabled ? { effort: thinking.effort } : { enabled: false };
      return nextBody;
    case 'qwen':
      nextBody['enable_thinking'] = thinking.enabled;
      return nextBody;
    case 'moonshot':
      if (isMoonshotThinkingModel(model)) {
        nextBody['thinking'] = { type: thinking.enabled ? 'enabled' : 'disabled' };
      }
      return nextBody;
    default:
      return nextBody;
  }
}

function applyChatStreamUsageOptions(
  body: UpstreamRequestBody,
  protocol: UpstreamProtocol,
): UpstreamRequestBody {
  if (protocol !== 'chat_completions' || body['stream'] !== true) {
    return body;
  }

  const streamOptions = body['stream_options'];
  const streamOptionsRecord =
    streamOptions && typeof streamOptions === 'object' && !Array.isArray(streamOptions)
      ? (streamOptions as Record<string, unknown>)
      : {};

  return {
    ...body,
    stream_options: {
      ...streamOptionsRecord,
      include_usage: true,
    },
  };
}

export function buildUpstreamRequestBody(input: {
  protocol: UpstreamProtocol;
  model: string;
  variant?: string;
  maxTokens: number;
  temperature: number;
  messages?: UpstreamChatMessage[];
  normalizedMessages?: NormalizedConversationMessage[];
  tools: UpstreamFunctionToolDefinition[];
  requestOverrides: RequestOverrides;
  thinking?: UpstreamThinkingConfig;
  cache?: PromptCacheConfig;
}): UpstreamRequestBody {
  const renderedMessages = input.normalizedMessages
    ? renderNormalizedConversationToUpstreamChatMessages(input.normalizedMessages)
    : (input.messages ?? []);

  // Apply cache_control breakpoints for Anthropic/OpenRouter on chat messages
  const annotatedMessages = applyCacheBreakpoints(
    renderedMessages.map(({ reasoning: _reasoning, ...rest }) => rest),
    input.cache?.providerType,
  );

  const previousResponseId = findLastResponseId(input.normalizedMessages);

  const baseBody: UpstreamRequestBody =
    input.protocol === 'responses'
      ? {
          model: input.model,
          ...(input.variant ? { variant: input.variant } : {}),
          input: convertConversationToResponsesInput(renderedMessages),
          max_output_tokens: input.maxTokens,
          temperature: input.temperature,
          stream: true,
          ...(input.tools.length > 0
            ? {
                tools: convertToolsToResponsesTools(input.tools),
                tool_choice: 'auto' as const,
              }
            : {}),
          ...buildResponsesCacheKeyFields(input.cache),
          ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        }
      : input.protocol === 'anthropic_messages'
        ? buildAnthropicMessagesBody(renderedMessages, input)
        : {
            model: input.model,
            ...(input.variant ? { variant: input.variant } : {}),
            messages: annotatedMessages,
            max_tokens: input.maxTokens,
            temperature: input.temperature,
            stream: true,
            stream_options: {
              include_usage: true,
            },
            ...(input.tools.length > 0 ? { tools: input.tools, tool_choice: 'auto' as const } : {}),
            ...buildCacheKeyFields(input.cache),
          };

  const overriddenBody = applyRequestOverridesToBody(
    baseBody,
    input.requestOverrides,
    input.protocol,
  );
  const usageAwareBody = applyChatStreamUsageOptions(overriddenBody, input.protocol);

  const thoughtAwareBody = applyThinkingConfigToBody(
    usageAwareBody,
    input.thinking,
    input.protocol,
  );

  // Default `verbosity: "low"` on gpt-5.x non-codex non-chat models (top-level
  // for chat completions, nested under `text` for responses). Independent of
  // thinking enabled/disabled — verbosity is OpenAI's text-output-length knob,
  // not a reasoning param. Mirrors opencode (`transform.ts` ~lines 950-957).
  return applyOpenAIDefaultTextVerbosity(
    thoughtAwareBody,
    input.thinking?.providerType ?? input.cache?.providerType,
    input.model,
    input.protocol,
  );
}

function convertConversationToResponsesInput(messages: UpstreamChatMessage[]): unknown[] {
  // 协议端点由 buildUpstreamRequestBody 已确定为 `responses`，
  // 因此 system 指令统一使用 Responses API 标准的 `developer` role，
  // 不再按模型名（gpt-5/o1/o3 等）做启发式判定。
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'user') {
      if (!message.content) continue;
      input.push({
        role: message.role === 'system' ? 'developer' : message.role,
        content: [{ type: 'input_text', text: message.content }],
      });
      continue;
    }

    if (message.role === 'assistant') {
      // Include reasoning item for Responses API multi-turn support, but only
      // when we have replayable metadata. Purely local reasoning text is not a
      // valid Responses input item and can break tool continuation requests.
      if (message.reasoning?.encryptedContent || message.reasoning?.summary) {
        const reasoningItem: Record<string, unknown> = {
          type: 'reasoning',
        };
        if (message.reasoning.encryptedContent) {
          reasoningItem['encrypted_content'] = message.reasoning.encryptedContent;
        }
        if (message.reasoning.summary) {
          reasoningItem['summary'] = [{ type: 'summary_text', text: message.reasoning.summary }];
        }
        input.push(reasoningItem);
      }

      if (message.content) {
        input.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: message.content }],
        });
      }

      for (const toolCall of message.tool_calls ?? []) {
        input.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        });
      }
      continue;
    }

    if (message.role === 'tool' && message.tool_call_id && message.content) {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content,
      });
    }
  }

  return input;
}

function convertToolsToResponsesTools(tools: UpstreamFunctionToolDefinition[]): unknown[] {
  const hasDeferredTools = tools.some((tool) => tool.function.deferLoading);
  const result: unknown[] = tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters ?? { type: 'object', properties: {} },
    strict: tool.function.strict ?? false,
    ...(tool.function.deferLoading ? { defer_loading: true } : {}),
  }));

  if (hasDeferredTools) {
    result.push({ type: 'tool_search' });
  }

  return result;
}

/**
 * Sanitize an upstream conversation by removing messages that would cause
 * format errors at the upstream provider. Common issues include:
 *
 * 1. Orphaned tool_result messages whose tool_call_id doesn't match any
 *    preceding assistant tool_call.
 * 2. Tool messages not immediately preceded by an assistant message with
 *    tool_calls.
 * 3. Empty messages (no content and no tool_calls).
 * 4. Consecutive messages with the same role (some providers reject this).
 *
 * Returns a new array — does not mutate input.
 */
export function sanitizeUpstreamConversation(
  messages: UpstreamChatMessage[],
): UpstreamChatMessage[] {
  // Phase 1: Build the set of valid tool_call_ids from assistant messages
  const validToolCallIds = new Set<string>();
  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls) {
      for (const tc of message.tool_calls) {
        validToolCallIds.add(tc.id);
      }
    }
  }

  // Phase 2: Filter out orphaned tool results and empty messages,
  // then fix role ordering issues
  const filtered: UpstreamChatMessage[] = [];

  for (const message of messages) {
    // Skip empty messages (no content and no tool_calls)
    if (
      (!message.content || message.content.trim().length === 0) &&
      (!message.tool_calls || message.tool_calls.length === 0) &&
      message.role !== 'tool'
    ) {
      continue;
    }

    // Skip orphaned tool results
    if (message.role === 'tool') {
      if (!message.tool_call_id || !validToolCallIds.has(message.tool_call_id)) {
        continue;
      }
      // Skip tool messages with empty content
      if (!message.content || message.content.trim().length === 0) {
        continue;
      }
    }

    // Skip assistant messages with no content and no tool_calls
    if (
      message.role === 'assistant' &&
      (!message.content || message.content.trim().length === 0) &&
      (!message.tool_calls || message.tool_calls.length === 0)
    ) {
      continue;
    }

    filtered.push(message);
  }

  // Phase 3: Ensure tool messages are preceded by an assistant with tool_calls
  const result: UpstreamChatMessage[] = [];
  const seenToolCallIds = new Set<string>();

  for (let i = 0; i < filtered.length; i++) {
    const message = filtered[i]!;

    if (message.role === 'assistant' && message.tool_calls) {
      for (const tc of message.tool_calls) {
        seenToolCallIds.add(tc.id);
      }
    }

    if (message.role === 'tool') {
      // Check if the tool_call_id was seen in a preceding assistant message
      if (!seenToolCallIds.has(message.tool_call_id!)) {
        continue;
      }
    }

    result.push(message);
  }

  return result;
}

// ─── Prompt Cache Helpers ───

type AnnotatedMessage = Record<string, unknown>;

function applyCacheBreakpoints(
  messages: AnnotatedMessage[],
  providerType?: string,
): AnnotatedMessage[] {
  if (providerType !== 'anthropic' && providerType !== 'openrouter') {
    return messages;
  }

  const cacheControl = { type: 'ephemeral' as const };

  let systemCount = 0;
  for (const msg of messages) {
    if (msg['role'] === 'system' && systemCount < 2) {
      msg['cache_control'] = cacheControl;
      systemCount++;
    }
  }

  const nonSystemIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!['role'] !== 'system') {
      nonSystemIndices.push(i);
    }
  }
  const tailIndices = nonSystemIndices.slice(-2);
  for (const idx of tailIndices) {
    messages[idx]!['cache_control'] = cacheControl;
  }

  return messages;
}

function buildCacheKeyFields(cache?: PromptCacheConfig): Record<string, unknown> {
  if (!cache?.sessionId) return {};

  if (cache.providerType === 'openai') {
    return { store: false, prompt_cache_key: cache.sessionId };
  }
  if (cache.providerType === 'openrouter') {
    return { prompt_cache_key: cache.sessionId };
  }

  return {};
}

/**
 * Build cache key fields for the Responses API endpoint.
 * The Responses API uses snake_case `prompt_cache_key` and requires `store: false`
 * for OpenAI to enable prompt cache routing without persisting responses.
 */
function buildResponsesCacheKeyFields(cache?: PromptCacheConfig): Record<string, unknown> {
  if (!cache?.sessionId) return {};

  if (cache.providerType === 'openai') {
    return { store: false, prompt_cache_key: cache.sessionId };
  }
  if (cache.providerType === 'openrouter') {
    return { prompt_cache_key: cache.sessionId };
  }

  return {};
}

/**
 * Find the response ID from the last assistant message that has one.
 * Used to set `previous_response_id` for the next Responses API request,
 * enabling OpenAI to reuse cached KV state including reasoning tokens.
 */
function findLastResponseId(messages?: NormalizedConversationMessage[]): string | undefined {
  if (!messages) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === 'assistant' && msg.reasoning?.responseId) {
      return msg.reasoning.responseId;
    }
  }
  return undefined;
}

/**
 * Build Anthropic native Messages API request body.
 * Used by the legacy buildUpstreamRequestBody path (compaction-llm, etc.).
 * The primary stream path uses ProviderAdapter.render instead.
 */
function buildAnthropicMessagesBody(
  messages: UpstreamChatMessage[],
  input: {
    model: string;
    variant?: string;
    maxTokens: number;
    temperature: number;
    tools: UpstreamFunctionToolDefinition[];
    cache?: PromptCacheConfig;
  },
): UpstreamRequestBody {
  const systemBlocks: Array<Record<string, unknown>> = [];
  const anthropicMessages: Array<Record<string, unknown>> = [];
  let cacheBreakpointCount = 0;
  const MAX_CACHE_BREAKPOINTS = 4;
  const maybeCacheControl = (): Record<string, unknown> | undefined =>
    cacheBreakpointCount < MAX_CACHE_BREAKPOINTS
      ? (() => {
          cacheBreakpointCount++;
          return { cache_control: { type: 'ephemeral' as const } };
        })()
      : undefined;

  let systemIndex = 0;
  for (const msg of messages) {
    if (msg.role !== 'system' || !msg.content) continue;
    const block: Record<string, unknown> = { type: 'text', text: msg.content };
    if (systemIndex < 2) {
      Object.assign(block, maybeCacheControl());
    }
    systemBlocks.push(block);
    systemIndex++;
  }

  const nonSystemMessages = messages.filter((m) => m.role !== 'system');
  const lastTwoIndices = new Set<number>();
  for (let i = nonSystemMessages.length - 1, count = 0; i >= 0 && count < 2; i--) {
    lastTwoIndices.add(i);
    count++;
  }

  for (let i = 0; i < nonSystemMessages.length; i++) {
    const msg = nonSystemMessages[i]!;
    const isTail = lastTwoIndices.has(i);

    if (msg.role === 'user') {
      const contentBlocks: Array<Record<string, unknown>> = [
        { type: 'text', text: msg.content ?? '' },
      ];
      if (isTail) {
        Object.assign(contentBlocks[0]!, maybeCacheControl());
      }
      anthropicMessages.push({ role: 'user', content: contentBlocks });
      continue;
    }

    if (msg.role === 'assistant') {
      const contentBlocks: Array<Record<string, unknown>> = [];
      if (msg.content) {
        const textBlock: Record<string, unknown> = { type: 'text', text: msg.content };
        if (isTail) {
          Object.assign(textBlock, maybeCacheControl());
        }
        contentBlocks.push(textBlock);
      }
      for (const tc of msg.tool_calls ?? []) {
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
      if (contentBlocks.length === 0) {
        contentBlocks.push({ type: 'text', text: '' });
      }
      anthropicMessages.push({ role: 'assistant', content: contentBlocks });
      continue;
    }

    if (msg.role === 'tool') {
      const toolResultBlock: Record<string, unknown> = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: msg.content ?? '',
      };
      if (isTail) {
        Object.assign(toolResultBlock, maybeCacheControl());
      }
      anthropicMessages.push({ role: 'user', content: [toolResultBlock] });
      continue;
    }
  }

  return {
    model: input.model,
    ...(input.variant ? { variant: input.variant } : {}),
    ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
    messages: anthropicMessages,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    stream: true,
    ...(input.tools.length > 0
      ? {
          tools: input.tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
          })),
        }
      : {}),
    ...buildCacheKeyFields(input.cache),
  };
}
