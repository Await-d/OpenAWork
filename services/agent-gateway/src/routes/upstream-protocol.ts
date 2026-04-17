export type UpstreamProtocol = 'chat_completions' | 'responses';

function isOpenAIModelId(modelId: string): boolean {
  return /^(gpt-|o[134]|codex-?)/i.test(modelId);
}

function isOpenAIOfficialBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

export function resolveUpstreamProtocol(input: {
  model: string;
  providerType?: string;
  baseUrl?: string;
}): UpstreamProtocol {
  if (input.providerType === 'openai') {
    // Only use the Responses API when pointing at the official OpenAI API.
    // Most OpenAI-compatible proxies (one-api, new-api, etc.) only support
    // /chat/completions and will return 502 for /responses.
    if (!input.baseUrl || isOpenAIOfficialBaseUrl(input.baseUrl)) {
      return 'responses';
    }
    return 'chat_completions';
  }

  if (!input.providerType && isOpenAIModelId(input.model)) {
    // Model ID looks like an OpenAI model but no provider type specified.
    // This typically means the user configured AI_API_BASE_URL to a proxy.
    // Only use Responses API if the base URL is the official OpenAI API.
    if (!input.baseUrl || isOpenAIOfficialBaseUrl(input.baseUrl)) {
      return 'responses';
    }
    return 'chat_completions';
  }

  return 'chat_completions';
}
