export type SupportedReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

const DEFAULT_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
] as const satisfies readonly SupportedReasoningEffort[];

interface OpenAIReasoningSupportRule {
  efforts: readonly SupportedReasoningEffort[];
  matches: (modelId: string) => boolean;
}

const OPENAI_REASONING_SUPPORT_RULES: readonly OpenAIReasoningSupportRule[] = [
  {
    efforts: ['high'],
    matches: (modelId) => modelId === 'gpt-5-pro' || /gpt-5(?:\.\d+)?-pro/.test(modelId),
  },
  {
    efforts: ['medium', 'high', 'xhigh'],
    matches: (modelId) => modelId.includes('codex-max'),
  },
  {
    efforts: ['low', 'medium', 'high', 'xhigh'],
    matches: (modelId) =>
      modelId.startsWith('gpt-5.2') ||
      modelId.startsWith('gpt-5.3') ||
      modelId.startsWith('gpt-5.4'),
  },
  {
    efforts: ['low', 'medium', 'high'],
    matches: (modelId) => modelId.startsWith('gpt-5.1'),
  },
  {
    efforts: ['minimal', 'low', 'medium', 'high'],
    matches: (modelId) => modelId === 'gpt-5' || modelId.startsWith('gpt-5-'),
  },
];

export function canConfigureThinkingForModel(
  providerType: string | undefined,
  modelId: string | undefined,
): boolean {
  if (!providerType || !modelId) {
    return false;
  }

  if (providerType === 'openai') {
    return true;
  }

  if (providerType === 'deepseek') {
    return modelId === 'deepseek-chat';
  }

  if (providerType === 'moonshot') {
    return modelId === 'kimi-k2.5';
  }

  return false;
}

export function getSupportedReasoningEffortsForModel(
  providerType: string | undefined,
  modelId: string | undefined,
): readonly SupportedReasoningEffort[] {
  if (providerType !== 'openai' || !modelId) {
    return DEFAULT_REASONING_EFFORTS;
  }

  const normalizedModelId = modelId.toLowerCase();
  const matchedRule = OPENAI_REASONING_SUPPORT_RULES.find((rule) =>
    rule.matches(normalizedModelId),
  );
  return matchedRule?.efforts ?? DEFAULT_REASONING_EFFORTS;
}

export function describeReasoningEffort(level: SupportedReasoningEffort): string {
  switch (level) {
    case 'minimal':
      return '最少推理开销';
    case 'low':
      return '更快返回结果';
    case 'medium':
      return '平衡速度与质量';
    case 'high':
      return '更充分的深度推理';
    case 'xhigh':
      return '最高推理强度';
  }
}
