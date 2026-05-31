/**
 * Provider 连通性自检 —— 对「单个已配置模型」发起一次最小化的上游调用，
 * 用于让用户在保存配置后确认「这个 provider + 模型是否真的能用」。
 *
 * 设计要点：
 *   - 复用 `resolveModelRouteFromProvider`(解析 apiKey / baseUrl / 协议 /
 *     requestOverrides)与 `runUpstreamGenerate`(AI SDK 非流式单发)，与真实
 *     聊天链路走同一套 provider 工厂，确保自检结果与实际使用一致。
 *   - 只发一个极短 prompt、限制极小 maxTokens，并施加独立 wall-clock 超时，
 *     避免自检本身拖垮或挂死。
 *   - 永不抛出：把任何失败(网络/认证/限流/超时/空响应)归类为结构化结果，
 *     交由路由层透传给前端按钮显示。
 *   - thinking 一律关闭：自检只验证「连通 + 鉴权 + 模型可达」，不验证推理。
 */

import type { AIProvider } from '@openAwork/agent-core';
import { resolveModelRouteFromProvider } from './model-router.js';
import { classifyUpstreamError } from './retry-classify.js';
import { runUpstreamGenerate } from '../v2-runtime/upstream/index.js';

/** 自检用的最小请求参数。 */
const PROBE_PROMPT = 'ping';
const PROBE_MAX_OUTPUT_TOKENS = 16;
const DEFAULT_PROBE_TIMEOUT_MS = 20_000;

export type ProviderTestStatus =
  | 'ok'
  | 'auth_error'
  | 'rate_limited'
  | 'timeout'
  | 'not_found'
  | 'error';

export interface ProviderConnectivityTestResult {
  /** 是否连通可用。 */
  ok: boolean;
  /** 细分状态，便于前端用不同颜色/文案展示。 */
  status: ProviderTestStatus;
  /** 面向用户的中文提示。 */
  message: string;
  /** 实际命中的上游协议(chat_completions / responses / anthropic_messages)。 */
  protocol?: string;
  /** 实际请求的 baseUrl(便于用户核对自己填的地址)。 */
  baseUrl?: string;
  /** 端到端耗时(毫秒)。 */
  latencyMs?: number;
  /** 上游是否真的回了 token(进一步佐证模型可达)。 */
  outputTokens?: number;
}

export interface ProviderConnectivityTestInput {
  provider: AIProvider;
  modelId: string;
  /** wall-clock 超时(毫秒)，默认 20s。 */
  timeoutMs?: number;
}

function mapErrorToResult(
  error: unknown,
  meta: { protocol?: string; baseUrl?: string; latencyMs: number; timedOut: boolean },
): ProviderConnectivityTestResult {
  if (meta.timedOut) {
    return {
      ok: false,
      status: 'timeout',
      message: '连接超时：上游在限定时间内没有响应，请检查网络或 Base URL 是否可达。',
      ...(meta.protocol ? { protocol: meta.protocol } : {}),
      ...(meta.baseUrl ? { baseUrl: meta.baseUrl } : {}),
      latencyMs: meta.latencyMs,
    };
  }

  const classification = classifyUpstreamError(error);
  const rawMessage = error instanceof Error ? error.message : String(error);
  const lower = rawMessage.toLowerCase();

  // 鉴权类错误(401/403/无效 key)单独归类，给用户最直接的修复指引。
  const looksLikeAuth =
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('authentication') ||
    lower.includes('api key');

  if (looksLikeAuth) {
    return {
      ok: false,
      status: 'auth_error',
      message: 'API Key 无效或无权访问该模型，请检查 Key 与所选模型权限。',
      ...(meta.protocol ? { protocol: meta.protocol } : {}),
      ...(meta.baseUrl ? { baseUrl: meta.baseUrl } : {}),
      latencyMs: meta.latencyMs,
    };
  }

  if (classification.category === 'rate_limit') {
    return {
      ok: false,
      status: 'rate_limited',
      message: '触发限流(rate limit)：凭证有效但调用过于频繁，稍后再试即可。',
      ...(meta.protocol ? { protocol: meta.protocol } : {}),
      ...(meta.baseUrl ? { baseUrl: meta.baseUrl } : {}),
      latencyMs: meta.latencyMs,
    };
  }

  // 404 / Not Found：能连上服务器但目标端点不存在，几乎都是 Base URL 与上游协议
  // 不匹配(例如 baseUrl 指向 Anthropic 兼容路径 `/anthropic`，却选了
  // chat_completions，导致请求被发到 `…/anthropic/chat/completions`)。给出可操作提示。
  const looksLikeNotFound =
    lower.includes('not found') ||
    lower.includes('404') ||
    lower.includes('no such') ||
    lower.includes('does not exist');

  if (looksLikeNotFound) {
    const protocolHint =
      meta.protocol === 'anthropic_messages'
        ? 'Anthropic 端点通常形如 `…/anthropic/v1/messages`'
        : meta.protocol === 'responses'
          ? 'Responses 端点通常形如 `…/v1/responses`'
          : 'OpenAI 兼容端点通常形如 `…/v1/chat/completions`';
    return {
      ok: false,
      status: 'not_found',
      message: `接口不存在(404)：能连上服务器，但目标路径不对。多半是 Base URL 与「上游协议」不匹配——当前协议为 ${meta.protocol ?? '未知'}，${protocolHint}。请核对 Base URL 是否与所选协议一致。`,
      ...(meta.protocol ? { protocol: meta.protocol } : {}),
      ...(meta.baseUrl ? { baseUrl: meta.baseUrl } : {}),
      latencyMs: meta.latencyMs,
    };
  }

  return {
    ok: false,
    status: 'error',
    message: `调用失败：${rawMessage.slice(0, 300)}`,
    ...(meta.protocol ? { protocol: meta.protocol } : {}),
    ...(meta.baseUrl ? { baseUrl: meta.baseUrl } : {}),
    latencyMs: meta.latencyMs,
  };
}

/**
 * 对单个 provider + 模型做一次连通性自检。永不抛出。
 */
export async function testProviderConnectivity(
  input: ProviderConnectivityTestInput,
): Promise<ProviderConnectivityTestResult> {
  const route = resolveModelRouteFromProvider(input.provider, input.modelId, {
    maxTokens: PROBE_MAX_OUTPUT_TOKENS,
    temperature: 0,
  });

  if (!route.apiKey) {
    return {
      ok: false,
      status: 'auth_error',
      message: '未提供 API Key：请先填写该 provider 的 API Key(或配置对应环境变量)。',
      protocol: route.upstreamProtocol,
      baseUrl: route.apiBaseUrl,
    };
  }

  const timeoutMs =
    typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? input.timeoutMs
      : DEFAULT_PROBE_TIMEOUT_MS;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  const startedAt = Date.now();
  try {
    const result = await runUpstreamGenerate({
      providerType: route.providerType ?? input.provider.type,
      ...(route.upstreamProtocol ? { upstreamProtocol: route.upstreamProtocol } : {}),
      apiKey: route.apiKey,
      baseURL: route.apiBaseUrl,
      // 透传 provider/model 级自定义 headers(部分中转网关需要特定头才放行)。
      ...(route.requestOverrides.headers ? { headers: route.requestOverrides.headers } : {}),
      model: route.model,
      messages: [{ role: 'user', content: PROBE_PROMPT }],
      temperature: 0,
      maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
      // 透传 requestOverrides 以复用 omitBodyKeys —— 否则 GPT-5 系列会因为收到
      // `temperature` 被上游 400 拒绝，导致自检误报失败。
      requestOverrides: route.requestOverrides,
      // 自检不传 thinking 配置，避免触发更慢/更贵的推理路径；只验证连通与鉴权。
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;
    return {
      ok: true,
      status: 'ok',
      message: `连接正常，模型可用(用时 ${latencyMs}ms）。`,
      protocol: route.upstreamProtocol,
      baseUrl: route.apiBaseUrl,
      latencyMs,
      outputTokens: result.outputTokens,
    };
  } catch (error) {
    return mapErrorToResult(error, {
      protocol: route.upstreamProtocol,
      baseUrl: route.apiBaseUrl,
      latencyMs: Date.now() - startedAt,
      timedOut,
    });
  } finally {
    clearTimeout(timer);
  }
}
