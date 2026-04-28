/**
 * Provider Adapter — unified protocol rendering from UnifiedMessage[].
 *
 * Dispatches to platform-specific renderers:
 *   - anthropic_messages → render-anthropic-messages.ts
 *   - responses          → render-responses-api.ts
 *   - chat_completions   → render-chat-completions.ts
 *
 * Shared types and the main entry point live here; each renderer
 * handles its own format conversion, overrides, and thinking config.
 */

import type { RequestOverrides } from '@openAwork/agent-core';
import type { UpstreamProtocol } from './routes/upstream-protocol.js';
import type { UnifiedMessage } from './message-to-model-messages.js';
import type { AIProvider } from '@openAwork/agent-core';
import { renderAnthropicMessages } from './render-anthropic-messages.js';
import { renderChatCompletions } from './render-chat-completions.js';
import { renderResponsesApi } from './render-responses-api.js';

export type { UpstreamProtocol } from './routes/upstream-protocol.js';
export type UpstreamRequestBody = Record<string, unknown>;
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// ─── Tool Definition ───

export interface FunctionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
    deferLoading?: boolean;
  };
}

// ─── Thinking Config ───

export interface ThinkingConfig {
  enabled: boolean;
  effort: ReasoningEffort;
  providerType?: string;
  supportsThinking: boolean;
}

// ─── Render Options ───

export interface PromptCacheConfig {
  /** Provider type — determines which cache annotation style to use. */
  providerType?: AIProvider['type'];
  /** Session ID — used as promptCacheKey for OpenAI/Azure/OpenRouter. */
  sessionId?: string;
}

export interface RenderOptions {
  protocol: UpstreamProtocol;
  model: string;
  variant?: string;
  maxTokens: number;
  temperature: number;
  tools: FunctionToolDefinition[];
  requestOverrides: RequestOverrides;
  thinking?: ThinkingConfig;
  cache?: PromptCacheConfig;
}

// ─── Main Entry Point ───

export const ProviderAdapter = {
  render(messages: UnifiedMessage[], options: RenderOptions): UpstreamRequestBody {
    if (options.protocol === 'anthropic_messages') {
      return renderAnthropicMessages(messages, options);
    }
    if (options.protocol === 'responses') {
      return renderResponsesApi(messages, options);
    }
    return renderChatCompletions(messages, options);
  },
};
