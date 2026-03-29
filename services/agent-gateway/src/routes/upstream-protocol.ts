export type UpstreamProtocol = 'chat_completions' | 'responses';

function isOpenAIModelId(modelId: string): boolean {
  return /^(gpt-|o[134]|codex-?)/i.test(modelId);
}

export function resolveUpstreamProtocol(input: {
  model: string;
  providerType?: string;
}): UpstreamProtocol {
  if (input.providerType === 'openai') {
    return 'responses';
  }

  if (!input.providerType && isOpenAIModelId(input.model)) {
    return 'responses';
  }

  return 'chat_completions';
}
