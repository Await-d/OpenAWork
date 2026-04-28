/**
 * Anthropic native Messages API renderer.
 *
 * Converts UnifiedMessage[] to Anthropic's /v1/messages request format:
 *   - System messages → top-level `system` field (content block array)
 *   - `cache_control` on content blocks (Anthropic native format)
 *   - Tool calls use `tool_use` / `tool_result` format
 *   - Consecutive user-role messages are merged
 *
 * This format is required for Anthropic prompt caching to work correctly.
 * The OpenAI-compatible `/v1/chat/completions` endpoint silently ignores `cache_control`.
 */

import type { UnifiedMessage } from './message-to-model-messages.js';
import type {
  UpstreamRequestBody,
  ReasoningEffort,
  ThinkingConfig,
  RenderOptions,
} from './provider-adapter.js';
import { buildPromptCacheKeyFields, applyRequestOverrides } from './render-shared.js';

// ─── Budget Maps ───

const ANTHROPIC_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16000,
  xhigh: 31999,
};

// ─── Anthropic Messages Renderer ───

export function renderAnthropicMessages(
  messages: UnifiedMessage[],
  options: RenderOptions,
): UpstreamRequestBody {
  const systemBlocks: Array<Record<string, unknown>> = [];
  const anthropicMessages: Array<Record<string, unknown>> = [];

  // Cache control counter — Anthropic allows up to 4 cache breakpoints per request
  let cacheBreakpointCount = 0;
  const MAX_CACHE_BREAKPOINTS = 4;
  const maybeCacheControl = (): Record<string, unknown> | undefined =>
    cacheBreakpointCount < MAX_CACHE_BREAKPOINTS
      ? (() => {
          cacheBreakpointCount++;
          return { cache_control: { type: 'ephemeral' as const } };
        })()
      : undefined;

  // First pass: extract system messages into top-level `system` field
  // with cache_control on first 2 system blocks (stable prefix)
  let systemIndex = 0;
  for (const msg of messages) {
    if (msg.role !== 'system' || !msg.content) continue;
    const block: Record<string, unknown> = {
      type: 'text',
      text: msg.content,
    };
    // First 2 system blocks get cache breakpoints (high hit rate)
    if (systemIndex < 2) {
      Object.assign(block, maybeCacheControl());
    }
    systemBlocks.push(block);
    systemIndex++;
  }

  // Second pass: render non-system messages in Anthropic native format
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');
  // Mark last 2 non-system messages for cache breakpoints (conversation edge)
  const lastTwoIndices = new Set<number>();
  for (let i = nonSystemMessages.length - 1, count = 0; i >= 0 && count < 2; i--) {
    lastTwoIndices.add(i);
    count++;
  }

  for (let i = 0; i < nonSystemMessages.length; i++) {
    const msg = nonSystemMessages[i]!;
    const isTail = lastTwoIndices.has(i);

    if (msg.role === 'user') {
      const contentBlocks: Array<Record<string, unknown>> = [];
      if (msg.content) {
        const textBlock: Record<string, unknown> = { type: 'text', text: msg.content };
        if (isTail) {
          Object.assign(textBlock, maybeCacheControl());
        }
        contentBlocks.push(textBlock);
      }

      for (const image of msg.images ?? []) {
        if (!image.imageUrl?.startsWith('data:')) {
          continue;
        }

        const match = image.imageUrl.match(/^data:([^;]+);base64,(.+)$/i);
        if (!match) {
          continue;
        }

        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: match[1],
            data: match[2],
          },
        });
      }

      if (contentBlocks.length === 0) {
        contentBlocks.push({ type: 'text', text: '' });
      }

      // Merge consecutive user-role messages (tool_result + user text)
      // Anthropic API requires alternating user/assistant roles
      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg && lastMsg['role'] === 'user') {
        const existingContent = lastMsg['content'] as Array<Record<string, unknown>>;
        lastMsg['content'] = [...existingContent, ...contentBlocks];
      } else {
        anthropicMessages.push({ role: 'user', content: contentBlocks });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const contentBlocks: Array<Record<string, unknown>> = [];

      // Thinking block
      if (msg.reasoning?.summary) {
        contentBlocks.push({
          type: 'thinking',
          thinking: msg.reasoning.summary,
        });
      }

      // Text content
      if (msg.content) {
        const textBlock: Record<string, unknown> = {
          type: 'text',
          text: msg.content,
        };
        if (isTail) {
          Object.assign(textBlock, maybeCacheControl());
        }
        contentBlocks.push(textBlock);
      }

      // Tool use blocks
      for (const tc of msg.toolCalls ?? []) {
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: JSON.parse(tc.arguments),
        });
      }

      // Ensure at least one content block (Anthropic requires non-empty content)
      if (contentBlocks.length === 0) {
        contentBlocks.push({ type: 'text', text: '' });
      }

      anthropicMessages.push({ role: 'assistant', content: contentBlocks });
      continue;
    }

    if (msg.role === 'tool') {
      // Anthropic tool_result format — content must be content block array or string
      const toolResultContent = msg.content ?? '';
      const toolResultBlock: Record<string, unknown> = {
        type: 'tool_result',
        tool_use_id: msg.toolCallId,
        // Anthropic API accepts string or content block array for tool_result content
        content: toolResultContent,
      };
      if (isTail) {
        Object.assign(toolResultBlock, maybeCacheControl());
      }

      // Merge tool_result into previous user message if the last message is also user role
      // (consecutive tool_result + user messages must be merged into one user turn)
      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg && lastMsg['role'] === 'user') {
        const existingContent = lastMsg['content'] as Array<Record<string, unknown>>;
        lastMsg['content'] = [...existingContent, toolResultBlock];
      } else {
        anthropicMessages.push({
          role: 'user',
          content: [toolResultBlock],
        });
      }
      continue;
    }
  }

  const body: UpstreamRequestBody = {
    model: options.model,
    ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
    messages: anthropicMessages,
    max_tokens: options.maxTokens,
    stream: true,
    ...(options.tools.length > 0
      ? {
          tools: options.tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
          })),
          tool_choice: { type: 'auto' },
        }
      : {}),
    ...buildPromptCacheKeyFields(options.cache),
  };

  // Temperature: omit for thinking-enabled models (Anthropic rejects it)
  if (options.thinking?.enabled !== true) {
    body['temperature'] = options.temperature;
  }

  return applyOverridesAndThinking(body, options);
}

// ─── Overrides & Thinking (Anthropic-specific) ───

function applyOverridesAndThinking(
  body: UpstreamRequestBody,
  options: RenderOptions,
): UpstreamRequestBody {
  let result = applyRequestOverrides(body, options.requestOverrides);
  result = applyAnthropicThinking(result, options.thinking);
  return result;
}

function applyAnthropicThinking(
  body: UpstreamRequestBody,
  thinking: ThinkingConfig | undefined,
): UpstreamRequestBody {
  if (!thinking || !thinking.supportsThinking) return body;

  const next: UpstreamRequestBody = { ...body };

  if (thinking.enabled) {
    next['thinking'] = {
      type: 'enabled',
      budget_tokens: ANTHROPIC_THINKING_BUDGETS[thinking.effort],
    };
  } else {
    delete next['thinking'];
  }

  return next;
}
