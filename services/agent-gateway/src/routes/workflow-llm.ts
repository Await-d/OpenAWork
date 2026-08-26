/**
 * Workflow non-streaming LLM caller — routes the upstream call through
 * the native `runUpstreamGenerate` wrapper
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
import { calculateTokenUsageCost, inferProviderTypeFromHostname } from '@openAwork/agent-core';
import { Effect } from 'effect';
import type { UpstreamProtocolKind } from '../v2-runtime/upstream/native-model.js';
import { runUpstreamGenerate } from '../v2-runtime/upstream/index.js';
import { persistMonthlyUsageRecord } from '../session/usage-records-store.js';

const WORKFLOW_MAX_OUTPUT_TOKENS = 2048;

/**
 * 粗略 token 估算（~4 字符/token，与 compaction 的 estimateMessageTokens 同口径）。
 * 仅在 provider 不回 usage 时作为团队用量统计的兜底，保证度量面板有近似值可看，
 * 而不是因为缺 usage 就一直显示空。空串返回 0。
 */
function estimateTokensFromText(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function hasUsagePricing(input: {
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cacheReadPricePerMillion?: number;
  cacheWritePricePerMillion?: number;
}): boolean {
  return (
    typeof input.inputPricePerMillion === 'number' ||
    typeof input.outputPricePerMillion === 'number' ||
    typeof input.cacheReadPricePerMillion === 'number' ||
    typeof input.cacheWritePricePerMillion === 'number'
  );
}

/**
 * Default wall-clock timeout for non-streaming workflow / team LLM
 * calls. The native request honours `abortSignal` but has no built-in
 * wall-clock deadline, so without this a hung upstream socket
 * would leave reception / pm1 / pm2 / quality-review calls pending
 * forever (and, via the in-flight dedup sets, wedge the whole runtime).
 */
const DEFAULT_WORKFLOW_LLM_TIMEOUT_MS = 300_000;

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
   * of chat_completions). Forwarded straight to the native provider
   * factory.
   */
  upstreamProtocol?: UpstreamProtocolKind;
  openaiFastMode?: boolean;
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
  /**
   * 团队用量统计上下文。提供时，本次调用拿到 usage 后会发一条 `team_usage`
   * 事件给团队度量面板（按层聚合 token / 费用 / 调用次数）。
   *
   * 不提供时（chat 端 prompt-optimizer / translator 等非团队场景）行为不变，
   * 不发任何事件。这样团队的 reception / pm1 / pm2 链路也能被正确统计——
   * 此前它们走非流式 workflow caller，usage 被直接丢弃。
   */
  usageContext?: {
    userId: string;
    sessionId: string;
    /** 角色层级（reception/pm1/pm2/...）。空则不发事件。 */
    layer: string | null | undefined;
    agentId?: string | null;
    /** 每百万输入 token 单价（USD），用于估算成本；缺省则成本记 0。 */
    inputPricePerMillion?: number;
    /** 每百万输出 token 单价（USD）。 */
    outputPricePerMillion?: number;
    cacheReadPricePerMillion?: number;
    cacheWritePricePerMillion?: number;
  };
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
    const result = await Effect.runPromise(
      runUpstreamGenerate({
        providerType,
        ...(input.upstreamProtocol ? { upstreamProtocol: input.upstreamProtocol } : {}),
        ...(input.openaiFastMode === true ? { openaiFastMode: true } : {}),
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
      }),
    );

    // 团队用量统计：把这次非流式调用的 usage 发给团队度量面板（按层聚合）。
    // best-effort——发布失败不影响主返回。
    const usageContext = input.usageContext;
    if (usageContext?.layer) {
      try {
        const { publishTeamWorkflowUsageEvent } = await import('./stream-team-events.js');
        // 兜底：部分 OpenAI 兼容中转 / 自建 provider 在非流式响应里不回 usage，
        // 此时 result.inputTokens/outputTokens 为 0，会导致这层用量「永远统计不到」。
        // 用 ~4 字符/token 的粗略口径从 prompt / 响应文本估算，保证度量面板看得到
        // 近似真实用量（标注为估算），而不是一片空白。
        const cacheReadTokens = result.cacheReadTokens;
        const cacheWriteTokens = result.cacheWriteTokens;
        const hasProviderUsage =
          result.inputTokens > 0 ||
          result.outputTokens > 0 ||
          cacheReadTokens > 0 ||
          cacheWriteTokens > 0;
        const inputTokens =
          result.inputTokens > 0 || hasProviderUsage
            ? result.inputTokens
            : estimateTokensFromText(input.prompt);
        const outputTokens =
          result.outputTokens > 0 || hasProviderUsage
            ? result.outputTokens
            : estimateTokensFromText(result.text);
        const costUsd = hasUsagePricing(usageContext)
          ? calculateTokenUsageCost({
              inputTokens,
              outputTokens,
              cacheReadTokens,
              cacheWriteTokens,
              inputPricePerMillion: usageContext.inputPricePerMillion,
              outputPricePerMillion: usageContext.outputPricePerMillion,
              cacheReadPricePerMillion: usageContext.cacheReadPricePerMillion,
              cacheWritePricePerMillion: usageContext.cacheWritePricePerMillion,
            })
          : undefined;
        try {
          persistMonthlyUsageRecord({
            userId: usageContext.userId,
            inputPricePerMillion: usageContext.inputPricePerMillion,
            outputPricePerMillion: usageContext.outputPricePerMillion,
            cacheReadPricePerMillion: usageContext.cacheReadPricePerMillion,
            cacheWritePricePerMillion: usageContext.cacheWritePricePerMillion,
            usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
          });
        } catch (err) {
          console.warn(
            `[workflow-llm] persist monthly usage 失败：${err instanceof Error ? err.message : String(err)}`,
          );
        }
        publishTeamWorkflowUsageEvent({
          userId: usageContext.userId,
          sessionId: usageContext.sessionId,
          layer: usageContext.layer,
          agentId: usageContext.agentId ?? null,
          provider: providerType,
          model: input.model,
          inputTokens,
          outputTokens,
          ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
          ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
          ...(costUsd !== undefined ? { costUsd } : {}),
        });
      } catch (err) {
        console.warn(
          `[workflow-llm] publish team_usage 失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

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
