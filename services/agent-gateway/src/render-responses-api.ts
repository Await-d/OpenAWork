/**
 * OpenAI Responses API renderer.
 *
 * Converts UnifiedMessage[] to the /v1/responses request format.
 * Used for OpenAI models accessed via the native Responses API endpoint.
 */

import type { UnifiedMessage } from './message-to-model-messages.js';
import type {
  UpstreamRequestBody,
  FunctionToolDefinition,
  ThinkingConfig,
  RenderOptions,
  PromptCacheConfig,
} from './provider-adapter.js';
import {
  applyRequestOverrides,
  isReasoningModel,
  applyOpenAIDefaultTextVerbosity,
} from './render-shared.js';

// ─── Responses API Renderer ───

export function renderResponsesApi(
  messages: UnifiedMessage[],
  options: RenderOptions,
): UpstreamRequestBody {
  const input = convertToResponsesInput(messages, options.model);
  // Extract previous_response_id from the last assistant message for caching.
  // The Responses API persists chain-of-thought tokens between turns via this ID,
  // providing 40-80% better cache utilization than re-sending encrypted_content.
  const previousResponseId = findLastResponseId(messages);
  const body: UpstreamRequestBody = {
    model: options.model,
    ...(options.variant ? { variant: options.variant } : {}),
    input,
    max_output_tokens: options.maxTokens,
    temperature: options.temperature,
    stream: true,
    ...(options.tools.length > 0
      ? {
          tools: convertToolsToResponsesTools(options.tools),
          tool_choice: 'auto' as const,
        }
      : {}),
    ...buildResponsesCacheKeyFields(options.cache),
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  };

  return applyOverridesAndThinking(body, options);
}

// ─── Input Conversion ───

function convertToResponsesInput(messages: UnifiedMessage[], model: string): unknown[] {
  const systemRole = isReasoningModel(model) ? 'developer' : 'system';
  const input: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (!msg.content) continue;
      input.push({
        role: systemRole,
        content: [{ type: 'input_text', text: msg.content }],
      });
      continue;
    }

    if (msg.role === 'user') {
      if (!msg.content && (!msg.images || msg.images.length === 0)) continue;
      const contentBlocks: Array<Record<string, unknown>> = [
        ...(msg.content ? [{ type: 'input_text', text: msg.content }] : []),
      ];

      for (const image of msg.images ?? []) {
        if (image.fileId) {
          contentBlocks.push({
            type: 'input_image',
            file_id: image.fileId,
            ...(image.detail ? { detail: image.detail } : {}),
          });
          continue;
        }

        if (image.imageUrl) {
          contentBlocks.push({
            type: 'input_image',
            image_url: image.imageUrl,
            ...(image.detail ? { detail: image.detail } : {}),
          });
        }
      }

      input.push({
        role: 'user',
        content: contentBlocks,
      });
      continue;
    }

    if (msg.role === 'assistant') {
      // Reasoning item for multi-turn support
      if (msg.reasoning?.encryptedContent || msg.reasoning?.summary) {
        const reasoningItem: Record<string, unknown> = { type: 'reasoning' };
        if (msg.reasoning.encryptedContent) {
          reasoningItem['encrypted_content'] = msg.reasoning.encryptedContent;
        }
        if (msg.reasoning.summary) {
          reasoningItem['summary'] = [{ type: 'summary_text', text: msg.reasoning.summary }];
        }
        input.push(reasoningItem);
      }

      if (msg.content) {
        input.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: msg.content }],
        });
      }

      for (const toolCall of msg.toolCalls ?? []) {
        input.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });
      }
      continue;
    }

    if (msg.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: msg.toolCallId,
        output: msg.content,
      });
    }
  }

  return input;
}

function convertToolsToResponsesTools(tools: FunctionToolDefinition[]): unknown[] {
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

// ─── Previous Response ID ───

/**
 * Find the response ID from the last assistant message that has one.
 * Used to set `previous_response_id` for the next request, enabling
 * OpenAI to reuse cached KV state including reasoning tokens.
 */
function findLastResponseId(messages: UnifiedMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === 'assistant' && msg.reasoning?.responseId) {
      return msg.reasoning.responseId;
    }
  }
  return undefined;
}

// ─── Prompt Cache Key Fields (Responses API) ───

/**
 * Build extra top-level body fields for session-level prompt caching
 * on the Responses API endpoint.
 *
 * Both Chat Completions and Responses API use snake_case `prompt_cache_key`.
 * OpenAI also requires `store: false` to enable prompt cache routing
 * without persisting responses.
 */
function buildResponsesCacheKeyFields(cache?: PromptCacheConfig): Record<string, unknown> {
  if (!cache?.sessionId) return {};

  const providerType = cache.providerType;
  if (providerType === 'openai') {
    return { store: false, prompt_cache_key: cache.sessionId };
  }
  if (providerType === 'openrouter') {
    return { prompt_cache_key: cache.sessionId };
  }

  return {};
}

// ─── Overrides & Thinking (Responses API) ───

function applyOverridesAndThinking(
  body: UpstreamRequestBody,
  options: RenderOptions,
): UpstreamRequestBody {
  let result = applyRequestOverrides(body, options.requestOverrides, {
    maxTokens: 'max_output_tokens',
  });
  result = applyResponsesThinking(result, options.thinking);
  // Default `text.verbosity = "low"` on gpt-5.x non-codex non-chat models
  // (Responses API nests verbosity under `text`). Mirrors opencode.
  result = applyOpenAIDefaultTextVerbosity(
    result,
    options.thinking?.providerType ?? options.cache?.providerType,
    options.model,
    'responses',
  );
  return result;
}

function applyResponsesThinking(
  body: UpstreamRequestBody,
  thinking: ThinkingConfig | undefined,
): UpstreamRequestBody {
  if (!thinking || !thinking.supportsThinking) return body;

  const next: UpstreamRequestBody = { ...body };

  if (thinking.enabled) {
    next['reasoning'] = { effort: thinking.effort, summary: 'auto' };
  } else {
    delete next['reasoning'];
  }

  return next;
}
