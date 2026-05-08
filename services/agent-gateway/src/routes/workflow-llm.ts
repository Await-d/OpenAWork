/**
 * Workflow non-streaming LLM caller — routes the upstream call through
 * the v2 `runUpstreamGenerate` wrapper (Vercel AI SDK `generateText`)
 * so the workflow / team / settings paths share the same provider
 * factory, retry surface, and provider middleware as the rest of the
 * gateway.
 *
 * Public surface kept stable for existing callers (workflows.ts,
 * team.ts, settings.ts):
 *   - `WorkflowLlmRequestConfig` (input shape).
 *   - `requestWorkflowLlmCompletion(config) -> Promise<string>`.
 *
 * Removed (dead after the migration; tracked in git history):
 *   - `WorkflowLlmRequest`, `buildWorkflowLlmRequest`,
 *     `extractWorkflowLlmText`, `extractWorkflowLlmTextNode`. These
 *     hand-built the wire payload and parsed responses across
 *     provider variants — `runUpstreamGenerate` does both.
 */

import type { AIProvider } from '@openAwork/agent-core';
import type { UpstreamProtocolKind } from '../v2-runtime/upstream/provider.js';
import { runUpstreamGenerate } from '../v2-runtime/upstream/index.js';

const WORKFLOW_MAX_OUTPUT_TOKENS = 2048;

export interface WorkflowLlmRequestConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  temperature: number;
  /**
   * OpenAWork provider type (`openai`, `anthropic`, ...) — when the
   * caller already knows the configured provider type, forward it so
   * we skip the lossy hostname-based inference below. The hostname
   * fallback only sees the public OpenAI/Anthropic/etc. endpoints and
   * defaults custom relays to OpenAI-compatible.
   */
  providerType?: AIProvider['type'];
  /**
   * Per-provider explicit upstream protocol override (e.g. when the
   * configured provider uses Responses or anthropic_messages instead
   * of chat_completions). Forwarded straight to the AI SDK provider
   * factory.
   */
  upstreamProtocol?: UpstreamProtocolKind;
  /** Session ID — reserved for future cache-key routing. */
  sessionId?: string;
}

function inferWorkflowProviderType(
  apiBaseUrl: string,
  model: string,
): AIProvider['type'] | undefined {
  const hostname = parseHostname(apiBaseUrl);

  switch (hostname) {
    case 'api.openai.com':
      return 'openai';
    case 'api.anthropic.com':
      return 'anthropic';
    case 'api.deepseek.com':
      return 'deepseek';
    case 'generativelanguage.googleapis.com':
      return 'gemini';
    case 'openrouter.ai':
      return 'openrouter';
    case 'dashscope.aliyuncs.com':
      return 'qwen';
    case 'api.moonshot.cn':
      return 'moonshot';
    default:
      return model.startsWith('claude') ? 'anthropic' : undefined;
  }
}

function parseHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function requestWorkflowLlmCompletion(
  input: WorkflowLlmRequestConfig,
): Promise<string> {
  // Prefer the caller-supplied provider type (sourced from the user's
  // configured provider record) so we do not lose vendor information
  // for custom relays that share a host with the public OpenAI API.
  // Vendor inference is kept as a fallback for legacy callers that
  // only know the base URL.
  const providerType =
    input.providerType ?? inferWorkflowProviderType(input.apiBaseUrl, input.model) ?? 'openai';

  const result = await runUpstreamGenerate({
    providerType,
    ...(input.upstreamProtocol ? { upstreamProtocol: input.upstreamProtocol } : {}),
    apiKey: input.apiKey,
    baseURL: input.apiBaseUrl,
    model: input.model,
    messages: [{ role: 'user', content: input.prompt }],
    temperature: input.temperature,
    maxOutputTokens: WORKFLOW_MAX_OUTPUT_TOKENS,
  });

  return result.text;
}
