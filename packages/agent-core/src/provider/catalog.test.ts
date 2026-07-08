import { describe, expect, it } from 'vitest';
import {
  PROVIDER_CATALOG,
  getCatalogEntry,
  getDefaultUpstream,
  resolveThinkingStyle,
  catalogModelSupportsThinking,
  inferProviderTypeFromHostname,
  normalizeProviderAlias,
  inferProviderLabelFromModelId,
  getProviderDisplayName,
  getProviderCatalogUi,
} from './catalog.js';
import { getAllBuiltinPresets, BUILTIN_PROVIDER_TYPES } from './presets.js';

describe('provider catalog (single source of truth)', () => {
  it('每个 catalog 条目都有默认上游与至少一个模型', () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(getDefaultUpstream(entry)).toBeDefined();
      expect(entry.defaultModels.length).toBeGreaterThan(0);
    }
  });

  it('内置预设与 catalog 一一对应（type/baseUrl/apiKeyEnv 派生一致）', () => {
    const presets = getAllBuiltinPresets();
    expect(presets.length).toBe(PROVIDER_CATALOG.length);
    expect(BUILTIN_PROVIDER_TYPES.length).toBe(PROVIDER_CATALOG.length);

    for (const preset of presets) {
      const entry = getCatalogEntry(preset.type);
      expect(entry).toBeDefined();
      const upstream = getDefaultUpstream(entry!);
      expect(preset.baseUrl).toBe(upstream!.baseUrl);
      expect(preset.name).toBe(entry!.displayName);
      if (entry!.apiKeyEnv) {
        expect(preset.apiKeyEnv).toBe(entry!.apiKeyEnv);
      }
    }
  });

  it('thinking 风格按平台正确解析', () => {
    expect(resolveThinkingStyle('anthropic')).toBe('anthropic_budget');
    expect(resolveThinkingStyle('claude')).toBe('anthropic_budget');
    expect(resolveThinkingStyle('openai')).toBe('openai_effort');
    expect(resolveThinkingStyle('qwen')).toBe('qwen_enable_thinking');
    expect(resolveThinkingStyle('moonshot')).toBe('body_thinking_type');
    expect(resolveThinkingStyle('mimo')).toBe('body_thinking_type');
    expect(resolveThinkingStyle('ollama')).toBe('none');
    expect(resolveThinkingStyle('unknown-vendor')).toBe('none');
  });

  it('通过 modelId 推断真实厂商的 thinking 风格（第三方代理场景）', () => {
    // openai + 非_openai 模型 → 推断真实厂商
    expect(resolveThinkingStyle('openai', 'mimo-v2.5-pro')).toBe('body_thinking_type');
    expect(resolveThinkingStyle('openai', 'deepseek-chat')).toBe('deepseek_thinking');
    expect(resolveThinkingStyle('openai', 'qwen3-235b-a22b')).toBe('qwen_enable_thinking');
    expect(resolveThinkingStyle('openai', 'kimi-k2.5')).toBe('body_thinking_type');
    expect(resolveThinkingStyle('openai', 'claude-sonnet-4-0')).toBe('anthropic_budget');
    expect(resolveThinkingStyle('openai', 'gemini-2.5-pro')).toBe('gemini_thinking');
    // openai + 真 OpenAI 模型 → 保持 openai_effort
    expect(resolveThinkingStyle('openai', 'gpt-5')).toBe('openai_effort');
    expect(resolveThinkingStyle('openai', 'gpt-4o')).toBe('openai_effort');
    // custom + 任意已知模型 → 推断真实厂商
    expect(resolveThinkingStyle('custom', 'mimo-v2.5-pro')).toBe('body_thinking_type');
    expect(resolveThinkingStyle('custom', 'anthropic/claude-sonnet-4-0')).toBe('anthropic_budget');
    expect(resolveThinkingStyle('custom', 'google/gemini-2.5-pro')).toBe('gemini_thinking');
    expect(resolveThinkingStyle('custom', 'openai/gpt-5')).toBe('openai_effort');
    // custom + 未知模型 → none
    expect(resolveThinkingStyle('custom', 'totally-unknown')).toBe('none');
  });

  it('OpenAI 内置模型包含可直接用于 fast 的 GPT-5.x reasoning 候选', () => {
    const openai = getCatalogEntry('openai');
    expect(openai).toBeDefined();
    const expectedFastModels = ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5.4-nano'];

    for (const modelId of expectedFastModels) {
      const model = openai?.defaultModels.find((item) => item.id === modelId);
      expect(model).toBeDefined();
      expect(model?.enabled).toBe(true);
      expect(model?.supportsThinking).toBe(true);
      expect(model?.supportsTools).toBe(true);
      expect(model?.supportsVision).toBe(true);
    }
  });

  it('moonshot 仅 kimi-k2.5 系列支持下发 thinking；mimo 全系支持', () => {
    expect(catalogModelSupportsThinking('moonshot', 'kimi-k2.5')).toBe(true);
    expect(catalogModelSupportsThinking('moonshot', 'moonshot-v1-32k')).toBe(false);
    expect(catalogModelSupportsThinking('mimo', 'mimo-v2.5-pro')).toBe(true);
    expect(catalogModelSupportsThinking('mimo', 'mimo-v2-flash')).toBe(true);
    expect(catalogModelSupportsThinking('custom', 'anthropic/claude-haiku-4-5')).toBe(false);
    expect(catalogModelSupportsThinking('custom', 'openai/gpt-5')).toBe(true);
    expect(catalogModelSupportsThinking('custom', 'openai/o3')).toBe(true);
    expect(catalogModelSupportsThinking('custom', 'openai/gpt-4o')).toBe(false);
    expect(catalogModelSupportsThinking('custom', 'google/gemini-2.5-pro')).toBe(true);
    expect(catalogModelSupportsThinking('custom', 'qwen-max')).toBe(false);
    expect(catalogModelSupportsThinking('custom', 'gemini-2.0-flash')).toBe(false);
    expect(catalogModelSupportsThinking('custom', 'moonshot-v1-32k')).toBe(false);
  });

  it('host → providerType 反推覆盖各内置平台', () => {
    expect(inferProviderTypeFromHostname('api.openai.com')).toBe('openai');
    expect(inferProviderTypeFromHostname('api.anthropic.com')).toBe('anthropic');
    expect(inferProviderTypeFromHostname('api.moonshot.cn')).toBe('moonshot');
    expect(inferProviderTypeFromHostname('api.xiaomimimo.com')).toBe('mimo');
    expect(inferProviderTypeFromHostname('unknown.example.com')).toBeUndefined();
  });

  it('别名归一到内置 type', () => {
    expect(normalizeProviderAlias('google')).toBe('gemini');
    expect(normalizeProviderAlias('moonshotai')).toBe('moonshot');
    expect(normalizeProviderAlias('xiaomi')).toBe('mimo');
    expect(normalizeProviderAlias('xiaomimimo')).toBe('mimo');
    expect(normalizeProviderAlias('openai')).toBe('openai');
    expect(normalizeProviderAlias('totally-custom')).toBe('totally-custom');
  });

  it('modelId 前缀 → 厂商显示名', () => {
    expect(inferProviderLabelFromModelId('claude-opus-4-0')).toBe('Anthropic');
    expect(inferProviderLabelFromModelId('gpt-4o')).toBe('OpenAI');
    expect(inferProviderLabelFromModelId('anthropic/claude-sonnet-4-0')).toBe('Anthropic');
    expect(inferProviderLabelFromModelId('google/gemini-2.5-pro')).toBe('Google Gemini');
    expect(inferProviderLabelFromModelId('openai/gpt-5')).toBe('OpenAI');
    expect(inferProviderLabelFromModelId('kimi-k2.5')).toBe('Moonshot (Kimi)');
    expect(inferProviderLabelFromModelId('mimo-v2.5-pro')).toBe('Xiaomi MiMo');
    expect(inferProviderLabelFromModelId('totally-unknown')).toBeUndefined();
  });

  it('getProviderDisplayName 返回平台显示名', () => {
    expect(getProviderDisplayName('mimo')).toBe('Xiaomi MiMo');
    expect(getProviderDisplayName('openai')).toBe('OpenAI');
    expect(getProviderDisplayName('nope')).toBeUndefined();
  });

  it('UI 投影可序列化且剥离函数字段', () => {
    const ui = getProviderCatalogUi();
    expect(ui.length).toBe(PROVIDER_CATALOG.length);
    const mimo = ui.find((entry) => entry.type === 'mimo');
    expect(mimo).toBeDefined();
    expect(mimo?.logoUrl).toBe('/logo-mimo.svg');
    // 两个上游变体（OpenAI 兼容 + Anthropic 兼容）应被保留。
    expect(mimo?.upstreams.length).toBe(2);
    // 不应包含任何函数字段（可被 JSON 序列化）。
    expect(() => JSON.stringify(ui)).not.toThrow();
  });
});
