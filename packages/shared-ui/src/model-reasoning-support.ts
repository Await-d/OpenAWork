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

// `gpt-5-pro` and its versioned siblings (`gpt-5.4-pro`, ...) run their own
// internal reasoning and reject any effort knob upstream — mirroring opencode
// (`if (id === "gpt-5-pro") return {}`), we expose zero variants and also flip
// `canConfigureThinkingForModel` to false so the UI surfaces a "模型自带思考"
// pill and disables the toggle, instead of pretending `high` is selectable.
const OPENAI_PRO_MODEL_PATTERN = /^gpt-5(?:\.\d+)?-pro/;

function isOpenAIProModel(modelId: string): boolean {
  return OPENAI_PRO_MODEL_PATTERN.test(modelId);
}

const OPENAI_REASONING_SUPPORT_RULES: readonly OpenAIReasoningSupportRule[] = [
  {
    efforts: [],
    matches: (modelId) => isOpenAIProModel(modelId),
  },
  {
    efforts: ['medium', 'high', 'xhigh'],
    matches: (modelId) => modelId.includes('codex-max'),
  },
  {
    efforts: ['low', 'medium', 'high', 'xhigh'],
    matches: (modelId) => {
      const match = /^gpt-5\.(\d+)(?=$|[^\d])/.exec(modelId);
      const minorRaw = match?.[1];
      if (!minorRaw) return false;
      const minor = Number.parseInt(minorRaw, 10);
      return Number.isFinite(minor) && minor >= 2;
    },
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
    return !isOpenAIProModel(modelId.toLowerCase());
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
