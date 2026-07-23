export type SupportedReasoningEffort =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

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

// Moonshot 思考模型匹配——与后端 catalog.ts 的 isMoonshotThinkingModel 完全对齐，
// 覆盖 kimi-k2.5 / kimi-k2-thinking / kimi-k2p5 / kimi-k2-5 等命名变体。
function isMoonshotThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('kimi-k2.5') ||
    id.includes('kimi-k2-thinking') ||
    id.includes('kimi-k2p5') ||
    id.includes('kimi-k2-5')
  );
}

const OPENAI_REASONING_MODEL_RE = /(?:^|\/)(?:gpt-5(?:[.-]|$)|o[134](?:[.-]|$))/;

function isOpenAIReasoningModel(modelId: string): boolean {
  return OPENAI_REASONING_MODEL_RE.test(modelId.toLowerCase());
}

function isAnthropicThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('claude-opus-4') ||
    id.includes('claude-sonnet-4') ||
    id.includes('claude-3-7-sonnet')
  );
}

// OpenRouter reasoning 模型匹配——与后端 provider-options.ts 对齐。
// 注意：不要用裸 `gpt` 前缀，否则 gpt-4o / gpt-4.1 等非推理模型也会误开。
function isOpenRouterReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    isOpenAIReasoningModel(id) ||
    isAnthropicThinkingModel(id) ||
    id.includes('gemini-2.5') ||
    id.includes('gemini-3') ||
    id.includes('deepseek-r') ||
    id.includes('reasoner') ||
    id.includes('thinking')
  );
}

function isQwenThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('qwen3') || id.includes('qwq') || id.includes('thinking') || id.includes('reasoner')
  );
}

function isZhipuThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('glm-4.5') ||
    id.includes('glm-4-5') ||
    id.includes('glm-z1') ||
    id.includes('glm-4.6')
  );
}

function isDoubaoThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('doubao-seed-1.6') ||
    id.includes('doubao-seed-1-6') ||
    id.includes('doubao-1.5-thinking') ||
    id.includes('doubao-thinking') ||
    id.includes('seed-1.6') ||
    ((id.includes('doubao') || id.includes('seed')) &&
      (id.includes('thinking') || id.includes('reasoner')))
  );
}

function isXaiThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes('grok-3') || id.includes('grok-4') || id.includes('grok-2');
}

function modelIdCandidates(modelId: string): string[] {
  const normalized = modelId.toLowerCase();
  const slash = normalized.indexOf('/');
  if (slash <= 0 || slash === normalized.length - 1) {
    return [normalized];
  }
  return [normalized, normalized.slice(slash + 1)];
}

function leafModelId(modelId: string): string {
  const [, actualModelId] = modelIdCandidates(modelId);
  return actualModelId ?? modelId.toLowerCase();
}

// 当用户通过 OpenAI 兼容代理（providerType='openai' 或 'custom'）使用非 OpenAI
// 模型时，通过 modelId 前缀推断真实厂商。与后端 catalog.ts 的
// resolveThinkingStyle(providerType, modelId) 逻辑对齐。
function inferVendorFromModelId(modelId: string): string | undefined {
  const candidates = modelIdCandidates(modelId);
  if (candidates.some((id) => id.startsWith('claude'))) return 'anthropic';
  if (candidates.some((id) => id.startsWith('deepseek'))) return 'deepseek';
  if (candidates.some((id) => id.startsWith('gemini'))) return 'gemini';
  if (candidates.some((id) => id.startsWith('qwen') || id.startsWith('qwq'))) return 'qwen';
  if (candidates.some((id) => id.startsWith('kimi') || id.startsWith('moonshot'))) {
    return 'moonshot';
  }
  if (candidates.some((id) => id.startsWith('mimo'))) return 'mimo';
  if (candidates.some((id) => id.startsWith('glm'))) return 'zhipu';
  if (candidates.some((id) => id.startsWith('doubao') || id.startsWith('ep-'))) return 'doubao';
  if (candidates.some((id) => id.startsWith('grok'))) return 'xai';
  if (candidates.some((id) => isOpenAIReasoningModel(id))) return 'openai';
  return undefined;
}

// 归一化 providerType：当是 openai/custom/siliconflow 时尝试通过 modelId 推断真实厂商。
function resolveEffectiveProviderType(providerType: string, modelId: string): string {
  if (providerType === 'openai' || providerType === 'custom' || providerType === 'siliconflow') {
    return inferVendorFromModelId(modelId) ?? providerType;
  }
  return providerType;
}

/**
 * 推断某模型是否支持思考。当 `declaredSupportsThinking` 为 true 时直接返回 true；
 * 为 false 时，检查是否是因为用户通过 OpenAI 兼容代理使用非 OpenAI 模型（如
 * MiMo/Qwen/DeepSeek），此时 modelConfig 找不到导致 supportsThinking=false，
 * 但 modelId 推断出真实厂商后应视为支持思考。
 *
 * 前端 UI 在判断 `controlEnabled` 时应使用此函数而非直接读 `model.supportsThinking`。
 */
export function inferSupportsThinking(
  providerType: string | undefined,
  modelId: string | undefined,
  declaredSupportsThinking: boolean,
): boolean {
  if (declaredSupportsThinking) return true;
  if (!providerType || !modelId) return false;
  const actualModelId = leafModelId(modelId);

  // OpenAI/custom/siliconflow 兼容代理场景：通过 modelId 推断真实厂商。
  if (providerType === 'openai' || providerType === 'custom' || providerType === 'siliconflow') {
    const inferredVendor = inferVendorFromModelId(modelId);
    if (!inferredVendor) {
      return false;
    }
    if (inferredVendor === 'openai') {
      return isOpenAIReasoningModel(modelId);
    }
    if (inferredVendor === 'anthropic') {
      return isAnthropicThinkingModel(modelId);
    }
    if (inferredVendor === 'qwen') {
      return isQwenThinkingModel(actualModelId);
    }
    if (inferredVendor === 'moonshot') {
      return isMoonshotThinkingModel(actualModelId);
    }
    if (inferredVendor === 'zhipu') {
      return isZhipuThinkingModel(actualModelId);
    }
    if (inferredVendor === 'doubao') {
      return isDoubaoThinkingModel(actualModelId);
    }
    if (inferredVendor === 'xai') {
      return isXaiThinkingModel(actualModelId);
    }
    // deepseek / gemini / mimo：厂商级默认支持（具体模型细节由 canConfigure 再收窄）
    return true;
  }

  if (providerType === 'openrouter') {
    return isOpenRouterReasoningModel(modelId);
  }
  if (providerType === 'azure') {
    return isOpenAIReasoningModel(actualModelId);
  }
  if (providerType === 'xai') {
    return isXaiThinkingModel(actualModelId);
  }
  if (providerType === 'zhipu') {
    return isZhipuThinkingModel(actualModelId);
  }
  if (providerType === 'doubao') {
    return isDoubaoThinkingModel(actualModelId);
  }
  if (providerType === 'qwen') {
    return isQwenThinkingModel(actualModelId);
  }
  if (providerType === 'moonshot') {
    return isMoonshotThinkingModel(actualModelId);
  }
  if (providerType === 'mimo' || providerType === 'deepseek') {
    return true;
  }
  if (providerType === 'gemini') {
    const id = actualModelId.toLowerCase();
    return id.includes('gemini-2.5') || id.includes('gemini-3');
  }
  if (providerType === 'anthropic' || providerType === 'claude') {
    return isAnthropicThinkingModel(actualModelId);
  }
  if (providerType === 'openai') {
    return isOpenAIReasoningModel(actualModelId);
  }

  return false;
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
  // GPT-5.6 系列（Sol/Terra/Luna）：支持 none/low/medium/high/max。
  {
    efforts: ['none', 'low', 'medium', 'high', 'max'],
    matches: (modelId) => /^gpt-5\.6\b/.test(modelId),
  },
  // GPT-5.5：支持 none/low/medium/high/xhigh。
  {
    efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    matches: (modelId) => /^gpt-5\.5\b/.test(modelId),
  },
  {
    efforts: ['low', 'medium', 'high', 'xhigh'],
    matches: (modelId) => {
      const match = /^gpt-5\.(\d+)(?=$|[^\d])/.exec(modelId);
      const minorRaw = match?.[1];
      if (!minorRaw) return false;
      const minor = Number.parseInt(minorRaw, 10);
      return Number.isFinite(minor) && minor >= 2 && minor < 5;
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
  declaredSupportsThinking = false,
): boolean {
  if (!providerType || !modelId) {
    return false;
  }

  // 当用户通过 OpenAI 兼容代理使用非 OpenAI 模型时，通过 modelId 推断真实厂商。
  const effectiveType = resolveEffectiveProviderType(providerType, modelId);
  const actualModelId = leafModelId(modelId);

  // 自定义渠道 / Azure 部署名 / OpenAI 兼容代理：用户显式勾选 supportsThinking 后
  // 必须可配置。否则「思考」勾选只是假控件——聊天侧会因 canConfigure=false 强制关闭。
  // gpt-5-pro 仍保持不可配置（上游拒绝 effort 旋钮）。
  if (
    declaredSupportsThinking &&
    (providerType === 'custom' ||
      providerType === 'azure' ||
      providerType === 'openai' ||
      providerType === 'siliconflow')
  ) {
    return !isOpenAIProModel(actualModelId);
  }

  if (effectiveType === 'openai' || effectiveType === 'azure') {
    return isOpenAIReasoningModel(actualModelId) && !isOpenAIProModel(actualModelId);
  }

  // DeepSeek：后端 provider-options.ts 的 deepseek_thinking 分支会对非 reasoner
  // 模型下发 `body.thinking = { type: 'enabled' }`；reasoner 模型自带思考，后端
  // 会跳过（不额外下发），前端也应跳过配置。
  if (effectiveType === 'deepseek') {
    return !actualModelId.includes('reasoner');
  }

  // Moonshot：与后端 catalog 的 isMoonshotThinkingMatcher 对齐。
  if (effectiveType === 'moonshot') {
    return isMoonshotThinkingModel(actualModelId);
  }

  if (effectiveType === 'mimo') {
    return true;
  }

  if (effectiveType === 'anthropic' || effectiveType === 'claude') {
    return isAnthropicThinkingModel(actualModelId);
  }

  if (effectiveType === 'gemini') {
    const id = actualModelId.toLowerCase();
    return id.includes('gemini-2.5') || id.includes('gemini-3');
  }
  if (effectiveType === 'qwen') {
    return isQwenThinkingModel(actualModelId);
  }

  if (effectiveType === 'openrouter') {
    return isOpenRouterReasoningModel(modelId);
  }

  if (effectiveType === 'xai') {
    return isXaiThinkingModel(actualModelId);
  }

  if (effectiveType === 'zhipu') {
    return isZhipuThinkingModel(actualModelId);
  }

  if (effectiveType === 'doubao') {
    return isDoubaoThinkingModel(actualModelId);
  }

  return false;
}

const ANTHROPIC_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly SupportedReasoningEffort[];

const GEMINI_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly SupportedReasoningEffort[];

const OPENROUTER_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly SupportedReasoningEffort[];

const DEEPSEEK_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly SupportedReasoningEffort[];

const QWEN_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly SupportedReasoningEffort[];

const MIMO_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
] as const satisfies readonly SupportedReasoningEffort[];

const XAI_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
] as const satisfies readonly SupportedReasoningEffort[];

const BINARY_TOGGLE_EFFORTS = ['medium'] as const satisfies readonly SupportedReasoningEffort[];

export function getSupportedReasoningEffortsForModel(
  providerType: string | undefined,
  modelId: string | undefined,
): readonly SupportedReasoningEffort[] {
  if (!providerType || !modelId) {
    return DEFAULT_REASONING_EFFORTS;
  }

  const effectiveType = resolveEffectiveProviderType(providerType, modelId);
  const actualModelId = leafModelId(modelId);

  if (effectiveType === 'openai' || effectiveType === 'azure') {
    const matchedRule = OPENAI_REASONING_SUPPORT_RULES.find((rule) => rule.matches(actualModelId));
    return matchedRule?.efforts ?? DEFAULT_REASONING_EFFORTS;
  }

  if (effectiveType === 'anthropic' || effectiveType === 'claude') {
    return ANTHROPIC_REASONING_EFFORTS;
  }

  if (effectiveType === 'gemini') {
    return GEMINI_REASONING_EFFORTS;
  }

  if (effectiveType === 'openrouter') {
    return OPENROUTER_REASONING_EFFORTS;
  }

  if (effectiveType === 'deepseek') {
    return DEEPSEEK_REASONING_EFFORTS;
  }

  if (effectiveType === 'qwen') {
    return QWEN_REASONING_EFFORTS;
  }

  if (effectiveType === 'moonshot') {
    return BINARY_TOGGLE_EFFORTS;
  }

  if (effectiveType === 'mimo') {
    return MIMO_REASONING_EFFORTS;
  }

  if (effectiveType === 'xai') {
    return XAI_REASONING_EFFORTS;
  }

  if (effectiveType === 'zhipu' || effectiveType === 'doubao') {
    return BINARY_TOGGLE_EFFORTS;
  }

  // 自定义渠道声明思考但无法推断厂商时，默认三档 effort。
  if (providerType === 'custom') {
    return DEFAULT_REASONING_EFFORTS;
  }

  return DEFAULT_REASONING_EFFORTS;
}

export function describeReasoningEffort(level: SupportedReasoningEffort): string {
  switch (level) {
    case 'none':
      return '不进行推理';
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
    case 'max':
      return '最高推理强度（GPT-5.6 Sol 独占）';
  }
}
