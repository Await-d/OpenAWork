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
import { inferProviderTypeFromHostname } from '@openAwork/agent-core';
import type { UpstreamProtocolKind } from '../v2-runtime/upstream/provider.js';
import { runUpstreamGenerate } from '../v2-runtime/upstream/index.js';

const WORKFLOW_MAX_OUTPUT_TOKENS = 2048;

/**
 * Default wall-clock timeout for non-streaming workflow / team LLM
 * calls. The AI SDK `generateText` honours `abortSignal` but has no
 * built-in wall-clock deadline, so without this a hung upstream socket
 * would leave reception / pm1 / pm2 / quality-review calls pending
 * forever (and, via the in-flight dedup sets, wedge the whole runtime).
 */
const DEFAULT_WORKFLOW_LLM_TIMEOUT_MS = 60_000;

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
  /**
   * Override the default output token budget (`WORKFLOW_MAX_OUTPUT_TOKENS`).
   * Structured-JSON callers with many items (e.g. team model assignment over
   * a large pool / many layers, especially on reasoning models that also emit
   * thinking tokens) can raise this to avoid the response being truncated
   * mid-JSON.
   */
  maxOutputTokens?: number;
  /**
   * Wall-clock timeout in milliseconds. Defaults to
   * `DEFAULT_WORKFLOW_LLM_TIMEOUT_MS`. Pass `0` (or a non-finite value)
   * to disable the internal deadline — callers that already wrap the
   * call with their own timeout signal may opt out this way.
   */
  timeoutMs?: number;
  /**
   * Optional caller abort signal. Combined with the internal timeout so
   * either source can abort the upstream request.
   */
  signal?: AbortSignal;
}

function inferWorkflowProviderType(
  apiBaseUrl: string,
  model: string,
): AIProvider['type'] | undefined {
  const hostname = parseHostname(apiBaseUrl);
  if (hostname) {
    // 由 catalog 的 hostnames 反推，新增平台无需在此加 case。
    const fromCatalog = inferProviderTypeFromHostname(hostname);
    if (fromCatalog) {
      return fromCatalog as AIProvider['type'];
    }
  }
  return model.startsWith('claude') ? 'anthropic' : undefined;
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

  const timeoutMs = input.timeoutMs ?? DEFAULT_WORKFLOW_LLM_TIMEOUT_MS;
  const useTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;

  const timeoutController = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (useTimeout) {
    timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);
    // Do not keep the event loop alive solely for this deadline.
    timer.unref?.();
  }

  // Combine the internal deadline with any caller-supplied signal so
  // that either source can abort the upstream request.
  const signal: AbortSignal = input.signal
    ? AbortSignal.any([timeoutController.signal, input.signal])
    : timeoutController.signal;

  try {
    const result = await runUpstreamGenerate({
      providerType,
      ...(input.upstreamProtocol ? { upstreamProtocol: input.upstreamProtocol } : {}),
      apiKey: input.apiKey,
      baseURL: input.apiBaseUrl,
      model: input.model,
      messages: [{ role: 'user', content: input.prompt }],
      temperature: input.temperature,
      maxOutputTokens:
        typeof input.maxOutputTokens === 'number' && input.maxOutputTokens > 0
          ? input.maxOutputTokens
          : WORKFLOW_MAX_OUTPUT_TOKENS,
      signal,
    });

    return result.text;
  } catch (err) {
    if (timedOut) {
      throw new Error(`workflow LLM timeout (${timeoutMs}ms)`);
    }
    throw err;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
