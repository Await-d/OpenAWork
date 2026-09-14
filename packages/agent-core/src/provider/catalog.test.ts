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
    expect(resolveThinkingStyle('zhipu')).toBe('body_thinking_type');
    expect(resolveThinkingStyle('doubao')).toBe('body_thinking_type');
    expect(resolveThinkingStyle('azure')).toBe('openai_effort');
    expect(resolveThinkingStyle('xai')).toBe('openai_effort');
    expect(resolveThinkingStyle('openrouter')).toBe('openrouter_reasoning');
    expect(resolveThinkingStyle('custom', 'my-reasoner')).toBe('openai_effort');
    expect(resolveThinkingStyle('ollama')).toBe('none');
    expect(resolveThinkingStyle('mistral')).toBe('none');
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
    // custom + 未知模型 → openai_effort（自定义渠道默认可下发 reasoningEffort）
    expect(resolveThinkingStyle('custom', 'totally-unknown')).toBe('openai_effort');
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

  it('OpenAI 内置模型目录包含 GPT-5.6 三个官方变体', () => {
    const openai = getCatalogEntry('openai');
    const expectedModels = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];

    for (const modelId of expectedModels) {
      const model = openai?.defaultModels.find((item) => item.id === modelId);
      expect(model).toMatchObject({
        id: modelId,
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        supportsThinking: true,
      });
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

  it('识别硬编码示例之上的未来厂商版本（版本号数值比较，不需逐版本加规则）', () => {
    expect(catalogModelSupportsThinking('anthropic', 'claude-opus-5-0')).toBe(true);
    expect(catalogModelSupportsThinking('anthropic', 'claude-sonnet-5-0')).toBe(true);
    expect(catalogModelSupportsThinking('xai', 'grok-5')).toBe(true);
    expect(catalogModelSupportsThinking('gemini', 'gemini-4-pro')).toBe(true);
    expect(catalogModelSupportsThinking('qwen', 'qwen4-max')).toBe(true);
    expect(catalogModelSupportsThinking('zhipu', 'glm-5.0')).toBe(true);
    expect(catalogModelSupportsThinking('doubao', 'doubao-seed-2.0')).toBe(true);
    expect(catalogModelSupportsThinking('moonshot', 'kimi-k3')).toBe(true);
    expect(catalogModelSupportsThinking('openai', 'o5')).toBe(true);
  });

  it('智谱 / 豆包 / Azure / xAI / OpenRouter 按模型放开 thinking', () => {
    expect(catalogModelSupportsThinking('zhipu', 'glm-4.5')).toBe(true);
    expect(catalogModelSupportsThinking('zhipu', 'glm-4-flash')).toBe(false);
    expect(catalogModelSupportsThinking('doubao', 'doubao-seed-1.6')).toBe(true);
    expect(catalogModelSupportsThinking('doubao', 'ep-your-endpoint-id')).toBe(false);
    expect(catalogModelSupportsThinking('azure', 'gpt-5')).toBe(true);
    expect(catalogModelSupportsThinking('azure', 'gpt-4o')).toBe(false);
    expect(catalogModelSupportsThinking('xai', 'grok-3')).toBe(true);
    expect(catalogModelSupportsThinking('openrouter', 'anthropic/claude-sonnet-4-0')).toBe(true);
    expect(catalogModelSupportsThinking('openrouter', 'openai/gpt-5')).toBe(true);
    // OpenRouter 网关 supportsOpenRouterReasoning 对所有 gpt/claude/gemini-3 放开。
    expect(catalogModelSupportsThinking('openrouter', 'openai/gpt-4.1')).toBe(true);
    expect(catalogModelSupportsThinking('openrouter', 'deepseek/deepseek-chat-v3-0324')).toBe(
      false,
    );
    expect(catalogModelSupportsThinking('qwen', 'qwen3-235b-a22b')).toBe(true);
    expect(catalogModelSupportsThinking('qwen', 'qwen-max')).toBe(false);
    expect(catalogModelSupportsThinking('siliconflow', 'deepseek-ai/DeepSeek-V3')).toBe(true);
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

describe('provider catalog expansion (2026-07-23)', () => {
  const expectedNewTypes = [
    'mistral',
    'zhipu',
    'doubao',
    'groq',
    'siliconflow',
    'azure',
    'xai',
    'minimax',
    'baichuan',
    'hunyuan',
    'qianfan',
  ] as const;

  it('包含全部新增一等公民 type 且默认不启用', () => {
    for (const type of expectedNewTypes) {
      const entry = getCatalogEntry(type);
      expect(entry, type).toBeDefined();
      expect(entry!.enabledByDefault).toBe(false);
      expect(entry!.defaultModels.length).toBeGreaterThan(0);
      expect(getDefaultUpstream(entry!)).toBeDefined();
    }
  });

  it('别名归一到新 type', () => {
    expect(normalizeProviderAlias('glm')).toBe('zhipu');
    expect(normalizeProviderAlias('bigmodel')).toBe('zhipu');
    expect(normalizeProviderAlias('grok')).toBe('xai');
    expect(normalizeProviderAlias('volcengine')).toBe('doubao');
    expect(normalizeProviderAlias('ark')).toBe('doubao');
    expect(normalizeProviderAlias('silicon')).toBe('siliconflow');
    expect(normalizeProviderAlias('mistralai')).toBe('mistral');
    expect(normalizeProviderAlias('wenxin')).toBe('qianfan');
    expect(normalizeProviderAlias('baidu')).toBe('qianfan');
  });

  it('host 反推覆盖新平台', () => {
    expect(inferProviderTypeFromHostname('api.mistral.ai')).toBe('mistral');
    expect(inferProviderTypeFromHostname('api.x.ai')).toBe('xai');
    expect(inferProviderTypeFromHostname('api.groq.com')).toBe('groq');
    expect(inferProviderTypeFromHostname('open.bigmodel.cn')).toBe('zhipu');
    expect(inferProviderTypeFromHostname('api.siliconflow.cn')).toBe('siliconflow');
  });

  it('siliconflow 按 modelId 前缀推断 thinking 风格', () => {
    expect(resolveThinkingStyle('siliconflow', 'deepseek-ai/DeepSeek-V3')).toBe(
      'deepseek_thinking',
    );
    expect(resolveThinkingStyle('siliconflow', 'Qwen/Qwen2.5-7B-Instruct')).toBe(
      'qwen_enable_thinking',
    );
    expect(resolveThinkingStyle('siliconflow', 'totally-unknown-model')).toBe('none');
  });
});

describe('opencode-go 思考（按官方 models.dev 元数据下发 reasoning_effort）', () => {
  it('有 effort 变体的 chat 模型走 openai_effort（wire 字段 reasoning_effort）', () => {
    expect(resolveThinkingStyle('opencode-go', 'deepseek-v4.1-flash')).toBe('openai_effort');
    expect(resolveThinkingStyle('opencode-go', 'glm-5.3')).toBe('openai_effort');
    expect(resolveThinkingStyle('opencode-go', 'glm-5.2')).toBe('openai_effort');
    expect(resolveThinkingStyle('opencode-go', 'kimi-k3')).toBe('openai_effort');
    expect(resolveThinkingStyle('opencode-go', 'hy3')).toBe('openai_effort');
    expect(resolveThinkingStyle('opencode-go', 'hy4-preview')).toBe('openai_effort');
  });

  it('没有 effort 变体的模型不下发 reasoning 参数（与官方 opencode 行为一致）', () => {
    expect(resolveThinkingStyle('opencode-go', 'glm-5.1')).toBe('none');
    expect(resolveThinkingStyle('opencode-go', 'kimi-k2.6')).toBe('none');
    expect(resolveThinkingStyle('opencode-go', 'mimo-v2.5')).toBe('none');
    expect(resolveThinkingStyle('opencode-go', 'longcat-2.0')).toBe('none');
    expect(resolveThinkingStyle('opencode-go')).toBe('none');
  });

  it('可推理模型判定为支持思考（含厂商反推与显式声明的模型）', () => {
    expect(catalogModelSupportsThinking('opencode-go', 'deepseek-v4.1-flash')).toBe(true);
    expect(catalogModelSupportsThinking('opencode-go', 'glm-5.3')).toBe(true);
    expect(catalogModelSupportsThinking('opencode-go', 'kimi-k2.6')).toBe(true);
    expect(catalogModelSupportsThinking('opencode-go', 'qwen3.8-max')).toBe(true);
    expect(catalogModelSupportsThinking('opencode-go', 'minimax-m3')).toBe(true);
    expect(catalogModelSupportsThinking('opencode-go', 'mimo-v2.5-pro')).toBe(true);
  });

  it('官方 models.dev 标记为 reasoning 的模型全部声明支持（含 longcat/hy/muse-spark）', () => {
    expect(catalogModelSupportsThinking('opencode-go', 'longcat-2.0')).toBe(true);
    expect(catalogModelSupportsThinking('opencode-go', 'hy3')).toBe(true);
    expect(catalogModelSupportsThinking('opencode-go', 'muse-spark-1.3-contributor')).toBe(true);
    expect(catalogModelSupportsThinking('opencode-go', 'totally-unknown-model')).toBe(false);
  });
});
