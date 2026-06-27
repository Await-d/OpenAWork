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

// OpenRouter reasoning 模型匹配——与后端 provider-options.ts 的
// supportsOpenRouterReasoning 对齐：只有 gpt / claude / gemini-3 系列
// 才会下发 `body.reasoning = { effort }`。
function isOpenRouterReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes('gpt') || id.includes('claude') || id.includes('gemini-3');
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
// 返回推断出的厂商 type，或 undefined 表示无法推断（当 OpenAI 模型处理）。
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
  if (candidates.some((id) => isOpenAIReasoningModel(id))) return 'openai';
  return undefined;
}

// 归一化 providerType：当是 openai/custom 时尝试通过 modelId 推断真实厂商。
function resolveEffectiveProviderType(
  providerType: string,
  modelId: string,
): string {
  if (providerType === 'openai' || providerType === 'custom') {
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
  const effectiveType = resolveEffectiveProviderType(providerType, modelId);
  // OpenAI/custom 兼容代理场景：通过 modelId 推断真实厂商。
  if (providerType === 'openai' || providerType === 'custom') {
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
    return true;
  }
  if (effectiveType === 'openrouter') {
    return isOpenRouterReasoningModel(modelId);
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

  // 当用户通过 OpenAI 兼容代理使用非 OpenAI 模型时，通过 modelId 推断真实厂商。
  const effectiveType = resolveEffectiveProviderType(providerType, modelId);
  const actualModelId = leafModelId(modelId);

  if (effectiveType === 'openai') {
    return inferSupportsThinking(providerType, modelId, false) && !isOpenAIProModel(actualModelId);
  }

  // DeepSeek：后端 provider-options.ts 的 deepseek_thinking 分支会对非 reasoner
  // 模型下发 `body.thinking = { type: 'enabled' }`；reasoner 模型自带思考，后端
  // 会跳过（不额外下发），前端也应跳过配置。catalog 的 supportsThinking 标记
  // deepseek-chat 和 deepseek-reasoner 都为 true，但 reasoner 不需要手动开关。
  if (effectiveType === 'deepseek') {
    return !actualModelId.includes('reasoner');
  }

  // Moonshot：与后端 catalog 的 isMoonshotThinkingMatcher 对齐，覆盖 kimi-k2.5 /
  // kimi-k2-thinking / kimi-k2p5 / kimi-k2-5 等变体。
  if (effectiveType === 'moonshot') {
    return isMoonshotThinkingModel(actualModelId);
  }

  if (effectiveType === 'mimo') {
    // 小米 MiMo V2.5 系列与 V2 Flash 均支持 enabled/disabled 思维链开关，
    // 后端 provider-options.ts 的 body_thinking_type 分支会下发
    // `thinking: { type: 'enabled' | 'disabled' }`。MiMo API 不支持力度调节
    // 参数（无 thinking_budget / effort / thinking_level），因此 getSupported-
    // ReasoningEffortsForModel 对 mimo 返回单档 'medium'，UI 表现为纯开关。
    return true;
  }

  // Anthropic / Claude：只要 catalog 已经把 `supportsThinking` 标为 true（Claude 3.7+ /
  // 4.x / Opus 4.x 等带 extended thinking 的模型），就一律放开「思考等级」UI。
  // 后端 `provider-options.ts` 的 anthropic 分支会把 effort 映射到 `thinking.budgetTokens`
  // （minimal=1024 ~ xhigh=31999），与 opencode 在 `@ai-sdk/anthropic` 分支的处理一致；
  // 之前这里写死 false 是历史遗留，导致 Claude 全系思考档位被前端锁死，但实际后端是
  // 完全可用的。`canConfigureThinkingForModel` 不应再二次否决 catalog 的 supportsThinking。
  if (effectiveType === 'anthropic' || effectiveType === 'claude') {
    return true;
  }

  // Gemini / Qwen：后端 provider-options.ts 也支持 enabled/effort → thinking_budget /
  // enable_thinking。同样让 catalog 的 supportsThinking 决定是否展示这个 UI。
  if (effectiveType === 'gemini' || effectiveType === 'qwen') {
    return true;
  }

  // OpenRouter：后端 provider-options.ts 有 openrouter_reasoning 分支，对包含
  // gpt/claude/gemini-3 的模型 ID 会下发 `body.reasoning = { effort }`。前端应放开
  // 思考等级 UI，让用户可以调节推理力度。
  if (effectiveType === 'openrouter') {
    return isOpenRouterReasoningModel(modelId);
  }

  return false;
}

// 各渠道默认暴露的 effort 档位。后端 provider-options.ts 的各 thinking 风格
// 会把 effort 映射到不同的 vendor 字段（budgetTokens / thinking_budget /
// thinking_level / enable_thinking / body.thinking.type 等），档位越多不代表
// 上游一定区分——但对 Anthropic / Gemini 等确实有 budget 区分的渠道，暴露
// minimal / xhigh 能让用户更精细地控制思考力度。
const ANTHROPIC_REASONING_EFFORTS = [
  'minimal',
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

// DeepSeek：上游 API 支持 reasoning_effort 参数（"high" / "max"），
// 后端 deepseek_thinking 风格会按 effort 映射。暴露全 5 档，后端自行
// 映射到上游支持的取值子集。
const DEEPSEEK_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly SupportedReasoningEffort[];

// Qwen：上游 DashScope API 支持 thinking_budget 参数（整数 Token 数），
// 后端 qwen_enable_thinking 风格会按 effort 映射到不同 budget 值。
// 暴露全 5 档。注意 QwQ 系列模型不响应 thinking_budget，但也不会报错。
const QWEN_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly SupportedReasoningEffort[];

// 纯开关渠道（后端只区分 enabled/disabled，不区分 effort 档位）。
// body_thinking_type 风格 → body.thinking = { type: 'enabled' }（Moonshot / MiMo）
// 上游 API 不暴露 thinking_budget / effort / thinking_level 等力度参数，
// 展示多档位会误导用户。返回单档 'medium' 作为"开启思考"的默认选项，
// UI 上表现为"关闭思考" + "开启思考"二选一。
const BINARY_TOGGLE_EFFORTS = [
  'medium',
] as const satisfies readonly SupportedReasoningEffort[];

export function getSupportedReasoningEffortsForModel(
  providerType: string | undefined,
  modelId: string | undefined,
): readonly SupportedReasoningEffort[] {
  if (!providerType || !modelId) {
    return DEFAULT_REASONING_EFFORTS;
  }

  // 当用户通过 OpenAI 兼容代理使用非 OpenAI 模型时，通过 modelId 推断真实厂商。
  const effectiveType = resolveEffectiveProviderType(providerType, modelId);
  const actualModelId = leafModelId(modelId);

  if (effectiveType === 'openai') {
    const normalizedModelId = actualModelId;
    const matchedRule = OPENAI_REASONING_SUPPORT_RULES.find((rule) =>
      rule.matches(normalizedModelId),
    );
    return matchedRule?.efforts ?? DEFAULT_REASONING_EFFORTS;
  }

  // Anthropic / Claude：budgetTokens 从 1024(minimal) 到 31999(xhigh)，
  // 5 档均有实际区别。
  if (effectiveType === 'anthropic' || effectiveType === 'claude') {
    return ANTHROPIC_REASONING_EFFORTS;
  }

  // Gemini：2.5 用 thinking_budget（5 档均有区别，xhigh 会 clamp 到 max），
  // 3 用 thinking_level（仅 minimal/low/medium/high，xhigh 会被后端 clamp 到 high）。
  // 两种都暴露 5 档，后端自行 clamp。
  if (effectiveType === 'gemini') {
    return GEMINI_REASONING_EFFORTS;
  }

  // OpenRouter：透传 effort 给上游，取决于实际路由到的模型。暴露全 5 档，
  // 后端会通过 clampReasoningEffortForModel 做安全降级。
  if (effectiveType === 'openrouter') {
    return OPENROUTER_REASONING_EFFORTS;
  }

  // DeepSeek：上游支持 reasoning_effort 参数，后端会按 effort 映射。
  if (effectiveType === 'deepseek') {
    return DEEPSEEK_REASONING_EFFORTS;
  }

  // Qwen：上游支持 thinking_budget 参数，后端会按 effort 映射到 budget 值。
  if (effectiveType === 'qwen') {
    return QWEN_REASONING_EFFORTS;
  }

  // Moonshot / MiMo：后端只区分 enabled/disabled，上游 API 不支持力度
  // 调节参数。返回单档 'medium'，UI 表现为纯开关。
  if (effectiveType === 'moonshot' || effectiveType === 'mimo') {
    return BINARY_TOGGLE_EFFORTS;
  }

  return DEFAULT_REASONING_EFFORTS;
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
