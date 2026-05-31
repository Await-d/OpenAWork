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

  it('moonshot 仅 kimi-k2.5 系列支持下发 thinking；mimo 全系支持', () => {
    expect(catalogModelSupportsThinking('moonshot', 'kimi-k2.5')).toBe(true);
    expect(catalogModelSupportsThinking('moonshot', 'moonshot-v1-32k')).toBe(false);
    expect(catalogModelSupportsThinking('mimo', 'mimo-v2.5-pro')).toBe(true);
    expect(catalogModelSupportsThinking('mimo', 'mimo-v2-flash')).toBe(true);
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
