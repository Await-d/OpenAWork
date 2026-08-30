export interface ProviderUpstreamVariantUi {
  label: string;
  baseUrl: string;
  protocol?: 'chat_completions' | 'responses' | 'anthropic_messages';
  isDefault?: boolean;
}

export interface ProviderCatalogUiEntry {
  type: string;
  displayName: string;
  logoUrl?: string;
  fallbackGlyph?: string;
  aliases?: string[];
  modelIdPrefixes?: string[];
  upstreams?: ProviderUpstreamVariantUi[];
  apiKeyEnv?: string;
}

export interface ResolvedProviderVisual {
  type?: string;
  displayName: string;
  logoUrl?: string;
  fallbackGlyph?: string;
}

const MOCK_PROVIDER_ENTRIES: ProviderCatalogUiEntry[] = [
  { type: 'anthropic', displayName: 'Anthropic' },
  { type: 'openai', displayName: 'OpenAI' },
  { type: 'gemini', displayName: 'Google Gemini' },
  { type: 'deepseek', displayName: 'DeepSeek' },
  { type: 'qwen', displayName: 'Qwen' },
  { type: 'moonshot', displayName: 'Moonshot (Kimi)' },
  { type: 'mimo', displayName: 'Xiaomi MiMo' },
];

export function hydrateProviderCatalogUi(_entries: ProviderCatalogUiEntry[]): void {
  return undefined;
}

export function getProviderUiList(): ProviderCatalogUiEntry[] {
  return MOCK_PROVIDER_ENTRIES;
}

export function lookupProviderEntry(
  ...candidates: Array<string | null | undefined>
): ProviderCatalogUiEntry | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = candidate.trim().toLowerCase();
    const found = MOCK_PROVIDER_ENTRIES.find((entry) => entry.type === key);
    if (found) return found;
  }
  return undefined;
}

export function resolveProviderVisual(input: {
  providerType?: string | null;
  providerId?: string | null;
  providerName?: string | null;
}): ResolvedProviderVisual {
  const entry = lookupProviderEntry(input.providerType, input.providerId, input.providerName);
  if (entry) {
    return { type: entry.type, displayName: input.providerName?.trim() || entry.displayName };
  }
  const raw = (input.providerName || input.providerType || input.providerId || '').trim();
  return { displayName: raw || '助手' };
}

export function inferProviderLabelFromModelId(_modelId: string): string | undefined {
  return undefined;
}

export type SupportedReasoningEffort =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const OPENAI_FIXED_PRO_MODEL_PATTERN = /^gpt-5-pro(?:[.-]|$)/;
const OPENAI_VERSIONED_PRO_MODEL_PATTERN = /^gpt-5[.-]\d+-pro(?:[.-]|$)/;
const OPENAI_REASONING_MODEL_RE = /(?:^|\/)(?:gpt-5(?:[.-]|$)|o\d+(?:[.-]|$))/;

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
  return slash <= 0 || slash === normalized.length - 1
    ? [normalized]
    : [normalized, normalized.slice(slash + 1)];
}

function leafModelId(modelId: string): string {
  const [, actualModelId] = modelIdCandidates(modelId);
  return actualModelId ?? modelId.toLowerCase();
}

function inferVendorFromModelId(modelId: string): string | undefined {
  const candidates = modelIdCandidates(modelId);
  if (candidates.some((id) => id.startsWith('claude'))) return 'anthropic';
  if (candidates.some((id) => id.startsWith('deepseek'))) return 'deepseek';
  if (candidates.some((id) => id.startsWith('gemini'))) return 'gemini';
  if (candidates.some((id) => id.startsWith('qwen') || id.startsWith('qwq'))) return 'qwen';
  if (candidates.some((id) => id.startsWith('kimi') || id.startsWith('moonshot')))
    return 'moonshot';
  if (candidates.some((id) => id.startsWith('mimo'))) return 'mimo';
  if (candidates.some((id) => isOpenAIReasoningModel(id))) return 'openai';
  return undefined;
}

function resolveEffectiveProviderType(providerType: string, modelId: string): string {
  return providerType === 'openai' || providerType === 'custom' || providerType === 'siliconflow'
    ? (inferVendorFromModelId(modelId) ?? providerType)
    : providerType;
}

export function inferSupportsThinking(
  providerType: string | undefined,
  modelId: string | undefined,
  declaredSupportsThinking: boolean,
): boolean {
  if (declaredSupportsThinking) return true;
  if (!providerType || !modelId) return false;
  const effectiveType = resolveEffectiveProviderType(providerType, modelId);
  if (providerType === 'openai' || providerType === 'custom' || providerType === 'siliconflow') {
    const inferredVendor = inferVendorFromModelId(modelId);
    if (!inferredVendor) return false;
    if (inferredVendor === 'openai') return isOpenAIReasoningModel(modelId);
    if (inferredVendor === 'anthropic') return isAnthropicThinkingModel(modelId);
    return true;
  }
  if (providerType === 'azure') return isOpenAIReasoningModel(modelId);
  if (effectiveType === 'openrouter') {
    const id = modelId.toLowerCase();
    return isOpenAIReasoningModel(id) || id.includes('claude') || id.includes('gemini-3');
  }
  return false;
}

export function canConfigureThinkingForModel(
  providerType: string | undefined,
  modelId: string | undefined,
  declaredSupportsThinking = false,
): boolean {
  if (!providerType || !modelId) return false;
  const id = modelId.toLowerCase();
  const effectiveType = resolveEffectiveProviderType(providerType, modelId);
  const actualModelId = leafModelId(modelId);
  if (
    declaredSupportsThinking &&
    (providerType === 'custom' ||
      providerType === 'azure' ||
      providerType === 'openai' ||
      providerType === 'siliconflow')
  ) {
    return !OPENAI_FIXED_PRO_MODEL_PATTERN.test(actualModelId);
  }
  if (effectiveType === 'openai' || effectiveType === 'azure') {
    return (
      inferSupportsThinking(providerType, modelId, false) &&
      !OPENAI_FIXED_PRO_MODEL_PATTERN.test(actualModelId)
    );
  }
  if (effectiveType === 'deepseek') return !actualModelId.includes('reasoner');
  if (effectiveType === 'moonshot') return actualModelId.includes('kimi-k2');
  if (
    ['mimo', 'anthropic', 'claude', 'gemini', 'qwen', 'xai', 'zhipu', 'doubao'].includes(
      effectiveType,
    )
  ) {
    return true;
  }
  if (effectiveType === 'openrouter') {
    return (
      isOpenAIReasoningModel(id) ||
      id.includes('claude') ||
      id.includes('gemini-3') ||
      id.includes('thinking')
    );
  }
  return false;
}

export function getSupportedReasoningEffortsForModel(
  providerType: string | undefined,
  modelId: string | undefined,
): readonly SupportedReasoningEffort[] {
  if (!providerType || !modelId) return ['low', 'medium', 'high'];
  const id = leafModelId(modelId);
  const effectiveType = resolveEffectiveProviderType(providerType, modelId);
  if (effectiveType === 'openai' || effectiveType === 'azure') {
    if (OPENAI_FIXED_PRO_MODEL_PATTERN.test(id)) return [];
    if (OPENAI_VERSIONED_PRO_MODEL_PATTERN.test(id)) return ['medium', 'high', 'xhigh'];
    if (id.includes('codex-max')) return ['medium', 'high', 'xhigh'];
    const versionMatch = /^gpt-5[.-](\d+)(?=$|[^\d])/.exec(id);
    const minorRaw = versionMatch?.[1];
    if (minorRaw) {
      const minor = Number.parseInt(minorRaw, 10);
      if (Number.isFinite(minor) && minor >= 6) {
        return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
      }
      if (Number.isFinite(minor) && minor >= 2) {
        return ['none', 'low', 'medium', 'high', 'xhigh'];
      }
      if (Number.isFinite(minor) && minor === 1) {
        return ['none', 'low', 'medium', 'high'];
      }
    }
    if (id === 'gpt-5' || id.startsWith('gpt-5-')) return ['minimal', 'low', 'medium', 'high'];
    return ['low', 'medium', 'high'];
  }
  if (['anthropic', 'claude'].includes(effectiveType)) {
    return ['low', 'medium', 'high', 'xhigh'];
  }
  if (['gemini', 'openrouter', 'deepseek', 'qwen'].includes(effectiveType)) {
    return ['minimal', 'low', 'medium', 'high', 'xhigh'];
  }
  if (effectiveType === 'mimo') return ['low', 'medium', 'high'];
  if (effectiveType === 'moonshot') return ['medium'];
  return ['low', 'medium', 'high'];
}

export function describeReasoningEffort(level: SupportedReasoningEffort): string {
  return level;
}
