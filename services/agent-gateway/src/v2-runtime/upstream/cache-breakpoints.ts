/**
 * cache-breakpoints — annotate OpenCode LLM `Message[]` with prompt-caching
 * breakpoints so the upstream caches the leading
 *     system / context messages and keeps the most recent
 * user/assistant turn reusable across consecutive requests.
 *
 * Why this lives here:
 *   - The legacy `applyCacheBreakpoints` (in routes/upstream-request.ts)
 *     decorates the wire-format Chat-Completions JSON directly. OpenCode LLM
 *     hides the wire shape behind `Message`, so we have to
 *     inject the same prompt-cache markers through providerOptions.
 *   - The same heuristic (system + last turn) keeps cache hit
 *     rates aligned between the legacy and v2 paths.
 *
 * Behaviour matrix follows the reference provider transform:
 *   - Select first 2 system messages plus the last 2 non-system
 *     messages. The two trailing breakpoints create a rolling window
 *     so subsequent turns hit the cache even after an extra
 *     user/tool message is appended (matches opencode's
 *     `applyCaching` semantics in `provider/transform.ts`).
 *   - Anthropic / Bedrock use message-level providerOptions.
 *   - Other providers with array content use the last content part.
 */

import type { ModelMessage, SystemModelMessage } from './opencode-llm-compat.js';

type ProviderOptionsRecord = Record<string, unknown>;

export interface PromptCacheModelInfo {
  providerID: string;
  id: string;
  api: {
    id: string;
    npm: string;
  };
}

const CACHE_PROVIDER_OPTIONS = {
  anthropic: {
    cacheControl: { type: 'ephemeral' },
  },
  openrouter: {
    cacheControl: { type: 'ephemeral' },
  },
  bedrock: {
    cachePoint: { type: 'default' },
  },
  openaiCompatible: {
    cache_control: { type: 'ephemeral' },
  },
  copilot: {
    copilot_cache_control: { type: 'ephemeral' },
  },
  alibaba: {
    cacheControl: { type: 'ephemeral' },
  },
} satisfies ProviderOptionsRecord;

function isRecord(value: unknown): value is ProviderOptionsRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDeep(
  target: ProviderOptionsRecord,
  source: ProviderOptionsRecord,
): ProviderOptionsRecord {
  const result: ProviderOptionsRecord = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeDeep(current, value) : value;
  }
  return result;
}

function sdkNpmForProviderType(providerType: string): string {
  if (providerType === 'anthropic' || providerType === 'claude') {
    return '@ai-sdk/anthropic';
  }
  if (providerType.includes('bedrock')) {
    return '@ai-sdk/amazon-bedrock';
  }
  if (providerType === 'alibaba') {
    return '@ai-sdk/alibaba';
  }
  return '@ai-sdk/openai-compatible';
}

export function buildPromptCacheModelInfo(input: {
  providerType?: string;
  model?: string;
}): PromptCacheModelInfo {
  const providerType = (input.providerType ?? '').toLowerCase();
  const providerID = providerType === 'claude' ? 'anthropic' : providerType;
  const id = input.model ?? providerID;
  return {
    providerID,
    id,
    api: {
      id,
      npm: sdkNpmForProviderType(providerType),
    },
  };
}

function shouldApplyCaching(model: PromptCacheModelInfo): boolean {
  return (
    (model.providerID === 'anthropic' ||
      model.providerID === 'google-vertex-anthropic' ||
      model.api.id.includes('anthropic') ||
      model.api.id.includes('claude') ||
      model.id.includes('anthropic') ||
      model.id.includes('claude') ||
      model.api.npm === '@ai-sdk/anthropic' ||
      model.api.npm === '@ai-sdk/alibaba') &&
    model.api.npm !== '@ai-sdk/gateway'
  );
}

function useMessageLevelOptions(model: PromptCacheModelInfo): boolean {
  return (
    model.providerID === 'anthropic' ||
    model.providerID.includes('bedrock') ||
    model.api.npm === '@ai-sdk/amazon-bedrock'
  );
}

function uniqueMessages(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    if (!result.includes(message)) {
      result.push(message);
    }
  }
  return result;
}

function mergeProviderOptionsIntoMessage(message: ModelMessage): void {
  message.providerOptions = mergeDeep(
    message.providerOptions ?? {},
    CACHE_PROVIDER_OPTIONS,
  ) as NonNullable<ModelMessage['providerOptions']>;
}

function mergeProviderOptionsIntoContentPart(part: ProviderOptionsRecord): void {
  part['providerOptions'] = mergeDeep(
    (part['providerOptions'] ?? {}) as ProviderOptionsRecord,
    CACHE_PROVIDER_OPTIONS,
  );
}

/**
 * Apply a cache breakpoint to a single message in place. Extracted from
 * `applyCaching` so it can be reused by `applyCachingToSystemMessages`
 * for messages passed via the dedicated `system` parameter.
 */
function applyCacheBreakpointToMessage(message: ModelMessage, model: PromptCacheModelInfo): void {
  const shouldUseContentOptions =
    !useMessageLevelOptions(model) && Array.isArray(message.content) && message.content.length > 0;

  if (shouldUseContentOptions) {
    const lastContent = message.content[message.content.length - 1] as
      ProviderOptionsRecord | undefined;
    if (
      lastContent &&
      typeof lastContent === 'object' &&
      lastContent['type'] !== 'tool-approval-request' &&
      lastContent['type'] !== 'tool-approval-response'
    ) {
      mergeProviderOptionsIntoContentPart(lastContent);
      return;
    }
  }

  mergeProviderOptionsIntoMessage(message);
}

export function applyCaching(
  messages: ModelMessage[],
  model: PromptCacheModelInfo,
): ModelMessage[] {
  if (!shouldApplyCaching(model)) {
    return messages;
  }

  // System messages passed via the dedicated `system` parameter are
  // cached separately by `applyCachingToSystemMessages`. Here we only
  // handle the trailing non-system messages to avoid exceeding
  // Anthropic's 4-breakpoint limit (2 system + 2 trailing = 4 max).
  // Residual system messages in the `messages` array (from persisted
  // session history, passed through via `allowSystemInMessages`) are
  // intentionally NOT cached — they are not part of the stable prefix.
  const final = messages.filter((message) => message.role !== 'system').slice(-2);

  for (const message of uniqueMessages(final)) {
    applyCacheBreakpointToMessage(message, model);
  }

  return messages;
}

/**
 * Apply prompt-cache breakpoints to system messages passed via the AI SDK's
 * dedicated `system` parameter. This is the companion to `applyCaching` for
 * the pattern where leading system messages are extracted from the
 * conversation and passed separately — it ensures the same cache breakpoints
 * are applied to those messages.
 *
 * Takes up to the first 2 system messages (matching `applyCaching`'s
 * heuristic) and mutates them in place with `providerOptions` cache markers.
 */
export function applyCachingToSystemMessages(
  system: SystemModelMessage[],
  model: PromptCacheModelInfo,
): SystemModelMessage[] {
  if (!shouldApplyCaching(model) || system.length === 0) {
    return system;
  }

  const toCache = system.slice(0, 2);
  for (const message of toCache) {
    applyCacheBreakpointToMessage(message, model);
  }

  return system;
}
