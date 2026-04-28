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
import { runUpstreamGenerate } from '../v2-runtime/upstream/index.js';

const WORKFLOW_MAX_OUTPUT_TOKENS = 2048;

export interface WorkflowLlmRequestConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  temperature: number;
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
  // Vendor inference matches the legacy `buildWorkflowLlmRequest`
  // exactly so existing routes do not see behaviour drift; an unknown
  // vendor falls back to OpenAI-compatible (the same wire shape the
  // legacy fetch+JSON path used).
  const providerType = inferWorkflowProviderType(input.apiBaseUrl, input.model) ?? 'openai';

  const result = await runUpstreamGenerate({
    providerType,
    apiKey: input.apiKey,
    baseURL: input.apiBaseUrl,
    model: input.model,
    messages: [{ role: 'user', content: input.prompt }],
    temperature: input.temperature,
    maxOutputTokens: WORKFLOW_MAX_OUTPUT_TOKENS,
  });

  return result.text;
}
