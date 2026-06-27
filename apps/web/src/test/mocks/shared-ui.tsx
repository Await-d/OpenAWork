import type { ReactElement, ReactNode } from 'react';

export interface GenerativeUIMessage {
  payload?: Record<string, unknown>;
  type?: string;
}

export function GenerativeUIRenderer(_props: { message: GenerativeUIMessage }): ReactNode {
  return null;
}

export interface AlwaysScopeLevel {
  label: string;
  description: string;
  pattern: string;
  category: 'full' | 'partial' | 'base';
}

export function categorizeAlwaysPatterns(
  _previewAction: string | undefined,
  scope: string,
  always: string[] | undefined,
): AlwaysScopeLevel[] {
  const seenPatterns = new Set<string>([scope]);
  const uniqueAlways: string[] = [];

  for (const pattern of always ?? []) {
    if (pattern.trim().length === 0 || seenPatterns.has(pattern)) continue;
    seenPatterns.add(pattern);
    uniqueAlways.push(pattern);
  }

  return [
    {
      label: '仅本次指令',
      description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
      pattern: scope,
      category: 'full',
    },
    {
      label: '同子命令',
      description:
        uniqueAlways.length >= 2
          ? '覆盖网关提供的相同子命令模式。'
          : '当前没有可用的同子命令规则，选择后仍只覆盖当前命令。',
      pattern: uniqueAlways.length >= 2 ? uniqueAlways[0]! : scope,
      category: 'partial',
    },
    {
      label: '同类指令',
      description:
        uniqueAlways.length >= 1
          ? '覆盖网关提供的同类指令模式。'
          : '当前没有可用的同类指令规则，选择后仍只覆盖当前命令。',
      pattern: uniqueAlways.length >= 1 ? uniqueAlways[uniqueAlways.length - 1]! : scope,
      category: 'base',
    },
  ];
}

/**
 * Lightweight mock of the real `@openAwork/shared-ui` InstalledSkillsManager
 * used by tests that need to drive user interactions (toggle switches,
 * click "移除", etc.) without pulling the full compiled dist bundle.
 *
 * Contract mirrored:
 *   - Renders the skill name (so `findByText(name)` works).
 *   - For each row, emits a `role=switch` button with aria-label
 *     `"禁用 <name>"` or `"启用 <name>"` and aria-checked matching
 *     `enabled` — UNLESS `onToggle` is omitted OR `toggleDisabledReason`
 *     returns a non-null string, in which case a plain badge is shown
 *     instead (matching the real component's fallback).
 *   - Calls `onToggle(id, !enabled)` with the INVERTED state.
 */
export interface InstalledSkill {
  id: string;
  name: string;
  version: string;
  latestVersion?: string;
  source: string;
  enabled: boolean;
  preinstalled?: boolean;
}

export type MarketInstalledSkill = InstalledSkill;

export interface InstalledSkillsManagerProps {
  skills: InstalledSkill[];
  onUninstall: (id: string) => void;
  onUpdate: (id: string) => void;
  onCheckUpdates: () => void;
  onToggle?: (id: string, nextEnabled: boolean) => void;
  toggleDisabledReason?: (skill: InstalledSkill) => string | null;
}

export function InstalledSkillsManager(props: InstalledSkillsManagerProps): ReactElement {
  const { skills, onToggle, toggleDisabledReason } = props;
  return (
    <table>
      <tbody>
        {skills.map((skill) => {
          const disabledReason = onToggle ? (toggleDisabledReason?.(skill) ?? null) : null;
          const showSwitch = !!onToggle && !disabledReason;
          return (
            <tr key={skill.id} data-skill-id={skill.id}>
              <td>{skill.name}</td>
              <td>
                {showSwitch ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={skill.enabled}
                    aria-label={`${skill.enabled ? '禁用' : '启用'} ${skill.name}`}
                    onClick={() => onToggle?.(skill.id, !skill.enabled)}
                  >
                    {skill.enabled ? '已启用' : '已禁用'}
                  </button>
                ) : (
                  <span title={disabledReason ?? undefined}>
                    {skill.enabled ? '已启用' : '已禁用'}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── provider-catalog-ui mock ───────────────────────────────────────────────
// 真实实现见 packages/shared-ui/src/models/provider-catalog-ui.ts。
// 测试环境只需提供同名导出与最小行为，避免消费方（如 team-runtime-ui-config）
// 在模块加载期因缺失导出而抛 "is not a function"。

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
  // no-op in tests
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

export type SupportedReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

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

function resolveEffectiveProviderType(providerType: string, modelId: string): string {
  if (providerType === 'openai' || providerType === 'custom') {
    return inferVendorFromModelId(modelId) ?? providerType;
  }
  return providerType;
}

export function inferSupportsThinking(
  providerType: string | undefined,
  modelId: string | undefined,
  declaredSupportsThinking: boolean,
): boolean {
  if (declaredSupportsThinking) return true;
  if (!providerType || !modelId) return false;
  const effectiveType = resolveEffectiveProviderType(providerType, modelId);
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
    const id = modelId.toLowerCase();
    return id.includes('gpt') || id.includes('claude') || id.includes('gemini-3');
  }
  return false;
}

export function canConfigureThinkingForModel(
  providerType: string | undefined,
  modelId: string | undefined,
): boolean {
  if (!providerType || !modelId) return false;
  const id = modelId.toLowerCase();
  const effectiveType = resolveEffectiveProviderType(providerType, modelId);
  const actualModelId = leafModelId(modelId);

  if (effectiveType === 'openai') {
    return inferSupportsThinking(providerType, modelId, false) && !/^gpt-5(?:\.\d+)?-pro/.test(actualModelId);
  }
  if (effectiveType === 'deepseek') {
    return !actualModelId.includes('reasoner');
  }
  if (effectiveType === 'moonshot') {
    return (
      actualModelId.includes('kimi-k2.5') ||
      actualModelId.includes('kimi-k2-thinking') ||
      actualModelId.includes('kimi-k2p5') ||
      actualModelId.includes('kimi-k2-5')
    );
  }
  if (
    effectiveType === 'mimo' ||
    effectiveType === 'anthropic' ||
    effectiveType === 'claude' ||
    effectiveType === 'gemini' ||
    effectiveType === 'qwen'
  ) {
    return true;
  }
  if (effectiveType === 'openrouter') {
    return id.includes('gpt') || id.includes('claude') || id.includes('gemini-3');
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

  if (effectiveType === 'openai') {
    if (/^gpt-5(?:\.\d+)?-pro/.test(id)) return [];
    if (id.includes('codex-max')) return ['medium', 'high', 'xhigh'];
    const minorMatch = /^gpt-5\.(\d+)(?=$|[^\d])/.exec(id);
    const minor = minorMatch?.[1] ? Number.parseInt(minorMatch[1], 10) : undefined;
    if (Number.isFinite(minor) && (minor ?? 0) >= 2) {
      return ['low', 'medium', 'high', 'xhigh'];
    }
    if (id.startsWith('gpt-5.1')) return ['low', 'medium', 'high'];
    if (id === 'gpt-5' || id.startsWith('gpt-5-')) return ['minimal', 'low', 'medium', 'high'];
    return ['low', 'medium', 'high'];
  }
  if (
    effectiveType === 'anthropic' ||
    effectiveType === 'claude' ||
    effectiveType === 'gemini' ||
    effectiveType === 'openrouter' ||
    effectiveType === 'deepseek' ||
    effectiveType === 'qwen'
  ) {
    return ['minimal', 'low', 'medium', 'high', 'xhigh'];
  }
  if (effectiveType === 'moonshot' || effectiveType === 'mimo') {
    return ['medium'];
  }
  return ['low', 'medium', 'high'];
}

export function describeReasoningEffort(level: SupportedReasoningEffort): string {
  return level;
}
