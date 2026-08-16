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
    return openAI.chat(input.model);
  }

  return OpenCodeLLM.Providers.OpenAICompatible.configure({
    ...defaults,
    provider: providerType,
    baseURL: input.baseURL ?? 'https://api.openai.com/v1',
  }).model(input.model);
}

export const NativeModel = { build: buildNativeModel } as const;
