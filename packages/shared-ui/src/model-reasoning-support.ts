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

  // Anthropic / Claude：只要 catalog 已经把 `supportsThinking` 标为 true（Claude 3.7+ /
  // 4.x / Opus 4.x 等带 extended thinking 的模型），就一律放开「思考等级」UI。
  // 后端 `provider-options.ts` 的 anthropic 分支会把 effort 映射到 `thinking.budgetTokens`
  // （minimal=1024 ~ xhigh=31999），与 opencode 在 `@ai-sdk/anthropic` 分支的处理一致；
  // 之前这里写死 false 是历史遗留，导致 Claude 全系思考档位被前端锁死，但实际后端是
  // 完全可用的。`canConfigureThinkingForModel` 不应再二次否决 catalog 的 supportsThinking。
  if (providerType === 'anthropic' || providerType === 'claude') {
    return true;
  }

  // Gemini / Qwen：后端 provider-options.ts 也支持 enabled/effort → thinking_budget /
  // enable_thinking。同样让 catalog 的 supportsThinking 决定是否展示这个 UI。
  if (providerType === 'gemini' || providerType === 'qwen') {
    return true;
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
