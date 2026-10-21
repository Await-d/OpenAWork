import * as OpenCodeLLM from '@openAwork/opencode-llm';
import type { UpstreamProtocol } from '../../routes/upstream-protocol.js';

export type UpstreamProtocolKind = UpstreamProtocol;

export interface NativeModelInput {
  readonly providerType?: string;
  readonly upstreamProtocol?: UpstreamProtocolKind;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly allowInsecureLocalhost?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly model: string;
}

const isAnthropic = (providerType: string | undefined): boolean => {
  const normalized = providerType?.trim().toLowerCase();
  return normalized === 'anthropic' || normalized === 'claude';
};

/**
 * Venice 的原生协议（`venice_parameters` / 加密推理 / `thought_signature`）只在官方
 * 端点可用。用户自建中转通常只实现 OpenAI 兼容子集，下发 Venice 专有字段会被拒，
 * 因此这类端点继续走下面的 `OpenAICompatible` 回落。
 */
const isVeniceOfficialEndpoint = (baseURL: string | undefined): boolean =>
  baseURL === undefined || baseURL.toLowerCase().includes('api.venice.ai');

const routeDefaults = (input: NativeModelInput) => ({
  ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
  ...(input.baseURL === undefined ? {} : { baseURL: input.baseURL }),
  allowInsecureLocalhost:
    input.allowInsecureLocalhost ??
    globalThis.process?.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'] === '1',
  ...(input.headers === undefined ? {} : { headers: { ...input.headers } }),
});

export function buildNativeModel(input: NativeModelInput): OpenCodeLLM.Model {
  OpenCodeLLM.validateProviderBaseUrl(input.baseURL, {
    allowInsecureLocalhost:
      input.allowInsecureLocalhost ??
      globalThis.process?.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'] === '1',
  });
  const defaults = routeDefaults(input);
  const providerType = input.providerType?.trim().toLowerCase() || 'custom';

  if (
    input.upstreamProtocol === 'anthropic_messages' ||
    (input.upstreamProtocol === undefined && isAnthropic(input.providerType))
  ) {
    return OpenCodeLLM.Providers.Anthropic.configure(defaults).model(input.model);
  }

  const openAI = OpenCodeLLM.Providers.OpenAI.configure(defaults);
  if (input.upstreamProtocol === 'responses') {
    return openAI.responses(input.model);
  }

  if (providerType === 'openai') {
    // 原生 OpenAI 支持 `prompt_cache_key`（会话级缓存亲和）；协议侧只在
    // compatibility 显式开启时下发，中转/兼容端点保持关闭。
    return OpenCodeLLM.Model.update(openAI.chat(input.model), {
      compatibility: { supportsPromptCacheKey: true },
    });
  }

  // Venice 走原生协议：官方端点才能承载 `venice_parameters` 与加密推理回传。
  if (providerType === 'venice' && isVeniceOfficialEndpoint(input.baseURL)) {
    return OpenCodeLLM.Providers.Venice.configure(defaults).model(input.model);
  }

  return OpenCodeLLM.Providers.OpenAICompatible.configure({
    ...defaults,
    provider: providerType,
    baseURL: input.baseURL ?? 'https://api.openai.com/v1',
  }).model(input.model);
}

export const NativeModel = { build: buildNativeModel } as const;
