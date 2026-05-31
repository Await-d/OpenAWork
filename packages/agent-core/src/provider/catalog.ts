/**
 * Provider Catalog — 平台「单一事实来源」(single source of truth)。
 *
 * 一个平台 = 一个 `ProviderCatalogEntry`。所有派生信息(内置预设、API Key
 * 环境变量、上游 baseUrl/协议、thinking 下发风格、host→type 推断、别名归一、
 * 前端 UI 元数据)都从这里产生，而不是散落在十几个 `Record<type,...>` 里。
 *
 * 新增一个平台的标准做法：
 *   1. 在 `packages/agent-core/src/provider/types.ts` 的 `ProviderType` 联合
 *      类型里加一个成员(保留编译期穷尽检查)。
 *   2. 在本文件的 `PROVIDER_CATALOG` 里加一个条目。
 *   3. (可选)在 `apps/web/public/` 放一个 `logo-<type>.svg`。
 *
 * 其余一切(预设、网关枚举、thinking、host 推断、前端选择器/设置页 UI)都会
 * 自动生效，无需再改其它文件。
 */

import type { AIModelConfig, ProviderType } from './types.js';

/**
 * thinking / reasoning 在请求里的下发「风格」。每个风格对应网关
 * `v2-runtime/upstream/provider-options.ts` 里的一种实现分支。新增平台若复用
 * 已有风格(最常见)，则无需改任何网关代码——只在 catalog 里选一个风格即可。
 */
export type ProviderThinkingStyle =
  | 'none'
  | 'anthropic_budget' // providerOptions.<key>.thinking = { type, budgetTokens }
  | 'openai_effort' // providerOptions.<key>.reasoningEffort
  | 'openrouter_reasoning' // providerOptions.<key>.body.reasoning
  | 'deepseek_thinking' // body.thinking(reasoner 模型由 id 自带，跳过)
  | 'gemini_thinking' // body.google.thinking_config
  | 'qwen_enable_thinking' // body.enable_thinking
  | 'body_thinking_type'; // body.thinking = { type: 'enabled' | 'disabled' }

export type CatalogUpstreamProtocol = 'chat_completions' | 'responses' | 'anthropic_messages';

/**
 * 一个平台可能暴露多个上游入口(例如小米 MiMo 同时有 OpenAI 兼容与 Anthropic
 * 兼容两个端点)。`isDefault` 标记默认变体，用于生成内置预设的 baseUrl。
 */
export interface ProviderUpstreamVariant {
  /** 人类可读标签，如 'OpenAI 兼容' / 'Anthropic 兼容'。 */
  label: string;
  baseUrl: string;
  /** 显式上游协议；省略则交给 `resolveUpstreamProtocol` 启发式判定。 */
  protocol?: CatalogUpstreamProtocol;
  isDefault?: boolean;
}

/** 前端渲染所需的纯数据(可经接口序列化到浏览器)。 */
export interface ProviderUiMeta {
  /** 主 logo 资源路径(public 下)。 */
  logoUrl?: string;
  /** logo 缺失时的回退字形。 */
  fallbackGlyph?: string;
  /** 归一化别名(host 反推 / 模型来源标签 / 第三方 hint)。 */
  aliases?: string[];
  /** 用量页按 modelId 前缀反推厂商标签时使用，如 ['kimi','moonshot']。 */
  modelIdPrefixes?: string[];
}

export interface ProviderCatalogEntry {
  /** 内置平台类型(必须是 `ProviderType` 之一，保证与联合类型同步)。 */
  type: Exclude<ProviderType, 'custom'>;
  /** 默认显示名。 */
  displayName: string;
  /** 内置预设是否默认启用。 */
  enabledByDefault: boolean;
  /** 默认读取的 API Key 环境变量。 */
  apiKeyEnv?: string;
  /** 该平台官方端点 host(用于从 baseUrl 反推 providerType)。 */
  hostnames?: string[];
  ui: ProviderUiMeta;
  /** 上游入口变体；至少一个，第一个或 isDefault 的作为默认。 */
  upstreams: ProviderUpstreamVariant[];
  thinkingStyle: ProviderThinkingStyle;
  /**
   * 可选：限定哪些 modelId 才真正支持 thinking(如 moonshot 仅 kimi-k2.5 系列)。
   * 返回 false 的模型不会下发 thinking 选项。省略表示该平台所有模型一致处理。
   */
  thinkingModelMatcher?: (modelId: string) => boolean;
  defaultModels: AIModelConfig[];
}

const isMoonshotThinkingModel = (modelId: string): boolean => {
  const id = modelId.toLowerCase();
  return (
    id.includes('kimi-k2.5') ||
    id.includes('kimi-k2-thinking') ||
    id.includes('kimi-k2p5') ||
    id.includes('kimi-k2-5')
  );
};

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    type: 'anthropic',
    displayName: 'Anthropic',
    enabledByDefault: true,
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    hostnames: ['api.anthropic.com'],
    ui: {
      logoUrl: '/logo-anthropic.svg',
      fallbackGlyph: '◌',
      aliases: ['claude'],
      modelIdPrefixes: ['claude'],
    },
    upstreams: [
      {
        label: 'Anthropic Messages',
        baseUrl: 'https://api.anthropic.com/v1',
        protocol: 'anthropic_messages',
        isDefault: true,
      },
    ],
    thinkingStyle: 'anthropic_budget',
    defaultModels: [
      {
        id: 'claude-opus-4-0',
        label: 'Claude Opus 4',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        supportsThinking: true,
        inputPricePerMillion: 15,
        outputPricePerMillion: 75,
      },
      {
        id: 'claude-sonnet-4-0',
        label: 'Claude Sonnet 4',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        supportsThinking: true,
        inputPricePerMillion: 3,
        outputPricePerMillion: 15,
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 1,
        outputPricePerMillion: 5,
      },
      {
        id: 'claude-3-7-sonnet-20250219',
        label: 'Claude Sonnet 3.7',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        supportsThinking: true,
        inputPricePerMillion: 3,
        outputPricePerMillion: 15,
      },
      {
        id: 'claude-3-5-haiku-20241022',
        label: 'Claude Haiku 3.5',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 0.8,
        outputPricePerMillion: 4,
      },
    ],
  },
  {
    type: 'openai',
    displayName: 'OpenAI',
    enabledByDefault: true,
    apiKeyEnv: 'OPENAI_API_KEY',
    hostnames: ['api.openai.com'],
    ui: {
      logoUrl: '/logo-openai.svg',
      fallbackGlyph: '◎',
      modelIdPrefixes: ['gpt', 'o1', 'o3', 'o4'],
    },
    upstreams: [{ label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', isDefault: true }],
    thinkingStyle: 'openai_effort',
    defaultModels: [
      {
        id: 'gpt-4.1',
        label: 'GPT-4.1',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 2,
        outputPricePerMillion: 8,
      },
      {
        id: 'gpt-4.1-mini',
        label: 'GPT-4.1 mini',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 0.4,
        outputPricePerMillion: 1.6,
      },
      {
        id: 'gpt-4.1-nano',
        label: 'GPT-4.1 nano',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
      },
      {
        id: 'o3',
        label: 'o3',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        supportsThinking: true,
        inputPricePerMillion: 2,
        outputPricePerMillion: 8,
      },
      {
        id: 'o4-mini',
        label: 'o4-mini',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        supportsThinking: true,
        inputPricePerMillion: 1.1,
        outputPricePerMillion: 4.4,
      },
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10,
      },
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 0.15,
        outputPricePerMillion: 0.6,
      },
      {
        id: 'gpt-image-2',
        label: 'GPT Image 2',
        enabled: true,
        supportsImageGeneration: true,
        supportsImageGeneration4K: false,
      },
    ],
  },
  {
    type: 'deepseek',
    displayName: 'DeepSeek',
    enabledByDefault: true,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    hostnames: ['api.deepseek.com'],
    ui: {
      logoUrl: '/logo-deepseek.svg',
      fallbackGlyph: '◇',
      modelIdPrefixes: ['deepseek'],
    },
    upstreams: [{ label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', isDefault: true }],
    thinkingStyle: 'deepseek_thinking',
    defaultModels: [
      {
        id: 'deepseek-chat',
        label: 'DeepSeek Chat (V3)',
        enabled: true,
        supportsTools: true,
        supportsThinking: true,
        inputPricePerMillion: 0.28,
        outputPricePerMillion: 0.42,
      },
      {
        id: 'deepseek-reasoner',
        label: 'DeepSeek Reasoner (R1)',
        enabled: true,
        supportsTools: true,
        supportsThinking: true,
        inputPricePerMillion: 0.28,
        outputPricePerMillion: 0.42,
      },
    ],
  },
  {
    type: 'gemini',
    displayName: 'Google Gemini',
    enabledByDefault: true,
    apiKeyEnv: 'GEMINI_API_KEY',
    hostnames: ['generativelanguage.googleapis.com'],
    ui: {
      logoUrl: '/logo-gemini.svg',
      fallbackGlyph: '✦',
      aliases: ['google', 'googlegemini'],
      modelIdPrefixes: ['gemini'],
    },
    upstreams: [
      {
        label: 'Gemini (OpenAI 兼容)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        isDefault: true,
      },
    ],
    thinkingStyle: 'gemini_thinking',
    defaultModels: [
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        supportsThinking: true,
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10,
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        supportsThinking: true,
        inputPricePerMillion: 0.3,
        outputPricePerMillion: 2.5,
      },
      {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash Lite',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
      },
      {
        id: 'gemini-2.0-flash',
        label: 'Gemini 2.0 Flash',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
      },
    ],
  },
  {
    type: 'ollama',
    displayName: 'Ollama',
    enabledByDefault: false,
    ui: {
      logoUrl: '/logo-ollama.svg',
      fallbackGlyph: '◒',
    },
    upstreams: [{ label: 'Ollama (本地)', baseUrl: 'http://localhost:11434/v1', isDefault: true }],
    thinkingStyle: 'none',
    defaultModels: [
      {
        id: 'qwen3:8b',
        label: 'Qwen3 8B (local)',
        enabled: true,
        supportsTools: false,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
      {
        id: 'llama3.1:8b',
        label: 'Llama 3.1 8B (local)',
        enabled: true,
        supportsTools: false,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
    ],
  },
  {
    type: 'openrouter',
    displayName: 'OpenRouter',
    enabledByDefault: false,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    hostnames: ['openrouter.ai'],
    ui: {
      logoUrl: '/logo-openrouter.svg',
      fallbackGlyph: '↗',
    },
    upstreams: [{ label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', isDefault: true }],
    thinkingStyle: 'openrouter_reasoning',
    defaultModels: [
      {
        id: 'anthropic/claude-sonnet-4-0',
        label: 'Claude Sonnet 4 (OpenRouter)',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 3,
        outputPricePerMillion: 15,
      },
      {
        id: 'openai/gpt-4.1',
        label: 'GPT-4.1 (OpenRouter)',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 2,
        outputPricePerMillion: 8,
      },
      {
        id: 'google/gemini-2.5-pro',
        label: 'Gemini 2.5 Pro (OpenRouter)',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10,
      },
      {
        id: 'deepseek/deepseek-chat-v3-0324',
        label: 'DeepSeek V3 (OpenRouter)',
        enabled: true,
        supportsTools: true,
        inputPricePerMillion: 0.28,
        outputPricePerMillion: 0.88,
      },
      {
        id: 'openai/gpt-4o-mini',
        label: 'GPT-4o mini (OpenRouter)',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 0.15,
        outputPricePerMillion: 0.6,
      },
    ],
  },
  {
    type: 'qwen',
    displayName: 'Qwen',
    enabledByDefault: false,
    apiKeyEnv: 'QWEN_API_KEY',
    hostnames: ['dashscope.aliyuncs.com'],
    ui: {
      logoUrl: '/logo-qwen.svg',
      fallbackGlyph: 'Q',
      modelIdPrefixes: ['qwen', 'qwq'],
    },
    upstreams: [
      {
        label: 'DashScope (OpenAI 兼容)',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        isDefault: true,
      },
    ],
    thinkingStyle: 'qwen_enable_thinking',
    defaultModels: [
      {
        id: 'qwen3-235b-a22b',
        label: 'Qwen3 235B-A22B',
        enabled: true,
        supportsTools: true,
        supportsVision: false,
        supportsThinking: true,
        inputPricePerMillion: 0.7,
        outputPricePerMillion: 2.8,
      },
      {
        id: 'qwen-max',
        label: 'Qwen Max',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        inputPricePerMillion: 1.6,
        outputPricePerMillion: 6.4,
      },
      {
        id: 'qwen-plus',
        label: 'Qwen Plus',
        enabled: true,
        supportsTools: true,
        supportsVision: false,
        inputPricePerMillion: 0.4,
        outputPricePerMillion: 1.2,
      },
      {
        id: 'qwen-turbo',
        label: 'Qwen Turbo',
        enabled: true,
        supportsTools: true,
        supportsVision: false,
        inputPricePerMillion: 0.05,
        outputPricePerMillion: 0.2,
      },
      {
        id: 'qwq-plus',
        label: 'QwQ Plus',
        enabled: true,
        supportsTools: true,
        supportsThinking: true,
        inputPricePerMillion: 0.8,
        outputPricePerMillion: 2.4,
      },
    ],
  },
  {
    type: 'moonshot',
    displayName: 'Moonshot (Kimi)',
    enabledByDefault: false,
    apiKeyEnv: 'MOONSHOT_API_KEY',
    hostnames: ['api.moonshot.cn'],
    ui: {
      logoUrl: '/logo-moonshot.svg',
      fallbackGlyph: '☾',
      aliases: ['moonshotai', 'moonshotai-cn', 'kimi'],
      modelIdPrefixes: ['moonshot', 'kimi'],
    },
    upstreams: [{ label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', isDefault: true }],
    thinkingStyle: 'body_thinking_type',
    thinkingModelMatcher: isMoonshotThinkingModel,
    defaultModels: [
      {
        id: 'kimi-k2.5',
        label: 'Kimi K2.5',
        enabled: true,
        supportsTools: true,
        supportsVision: false,
        supportsThinking: true,
        inputPricePerMillion: 0.6,
        outputPricePerMillion: 3,
      },
      {
        id: 'kimi-k2-thinking',
        label: 'Kimi K2 Thinking',
        enabled: true,
        supportsTools: true,
        supportsThinking: true,
        inputPricePerMillion: 0.6,
        outputPricePerMillion: 2.5,
      },
      {
        id: 'kimi-k2-turbo-preview',
        label: 'Kimi K2 Turbo',
        enabled: true,
        supportsTools: true,
        inputPricePerMillion: 2.4,
        outputPricePerMillion: 10,
      },
    ],
  },
  {
    type: 'mimo',
    displayName: 'Xiaomi MiMo',
    enabledByDefault: false,
    apiKeyEnv: 'MIMO_API_KEY',
    hostnames: ['api.xiaomimimo.com'],
    ui: {
      logoUrl: '/logo-mimo.svg',
      fallbackGlyph: 'Mi',
      aliases: ['xiaomi', 'xiaomimimo'],
      modelIdPrefixes: ['mimo'],
    },
    upstreams: [
      {
        label: 'OpenAI 兼容',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        protocol: 'chat_completions',
        isDefault: true,
      },
      {
        label: 'Anthropic 兼容',
        baseUrl: 'https://api.xiaomimimo.com/anthropic/v1',
        protocol: 'anthropic_messages',
      },
    ],
    thinkingStyle: 'body_thinking_type',
    defaultModels: [
      {
        id: 'mimo-v2.5-pro',
        label: 'MiMo V2.5 Pro',
        enabled: true,
        contextWindow: 1_000_000,
        maxOutputTokens: 131072,
        supportsTools: true,
        supportsThinking: true,
        inputPricePerMillion: 1,
        outputPricePerMillion: 3,
      },
      {
        id: 'mimo-v2.5',
        label: 'MiMo V2.5',
        enabled: true,
        contextWindow: 1_000_000,
        maxOutputTokens: 131072,
        supportsTools: true,
        supportsVision: true,
        supportsThinking: true,
        inputPricePerMillion: 0.4,
        outputPricePerMillion: 2,
      },
      {
        id: 'mimo-v2-flash',
        label: 'MiMo V2 Flash',
        enabled: true,
        contextWindow: 256_000,
        maxOutputTokens: 65536,
        supportsTools: true,
        supportsThinking: true,
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.3,
      },
    ],
  },
];

const CATALOG_BY_TYPE = new Map<string, ProviderCatalogEntry>(
  PROVIDER_CATALOG.map((entry) => [entry.type, entry]),
);

/** 取某平台的 catalog 条目。 */
export const getCatalogEntry = (type: string): ProviderCatalogEntry | undefined =>
  CATALOG_BY_TYPE.get(type);

/** 取某平台的默认上游变体(优先 isDefault，否则第一个)。 */
export const getDefaultUpstream = (
  entry: ProviderCatalogEntry,
): ProviderUpstreamVariant | undefined =>
  entry.upstreams.find((u) => u.isDefault) ?? entry.upstreams[0];

/**
 * thinking 风格解析：把 providerType(含 'claude' 这种别名)映射到风格。
 * 网关 provider-options.ts 用它替代原先的 `switch(providerType)`，使新增平台
 * 复用已有风格时无需改网关代码。
 */
export const resolveThinkingStyle = (providerType: string): ProviderThinkingStyle => {
  const normalized = providerType.toLowerCase();
  if (normalized === 'claude') {
    return 'anthropic_budget';
  }
  return getCatalogEntry(normalized)?.thinkingStyle ?? 'none';
};

/** 该平台下某模型是否真正支持下发 thinking(用于 moonshot 这种部分模型场景)。 */
export const catalogModelSupportsThinking = (providerType: string, modelId: string): boolean => {
  const entry = getCatalogEntry(providerType.toLowerCase());
  if (!entry) {
    return true;
  }
  return entry.thinkingModelMatcher ? entry.thinkingModelMatcher(modelId) : true;
};

/** 由官方 host 反推 providerType(用于 workflow-llm 的 baseUrl 推断)。 */
export const inferProviderTypeFromHostname = (hostname: string): string | undefined => {
  const normalized = hostname.toLowerCase();
  for (const entry of PROVIDER_CATALOG) {
    if (entry.hostnames?.some((h) => h.toLowerCase() === normalized)) {
      return entry.type;
    }
  }
  return undefined;
};

/** 归一化第三方 provider hint / 别名到内置 type(用于团队模型选择匹配)。 */
export const normalizeProviderAlias = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  for (const entry of PROVIDER_CATALOG) {
    if (entry.type === normalized) {
      return entry.type;
    }
    if (entry.ui.aliases?.some((alias) => alias.toLowerCase() === normalized)) {
      return entry.type;
    }
  }
  return normalized;
};

/** 由 modelId 前缀反推厂商显示名(用量页用)。 */
export const inferProviderLabelFromModelId = (modelId: string): string | undefined => {
  const normalized = modelId.toLowerCase();
  for (const entry of PROVIDER_CATALOG) {
    if (entry.ui.modelIdPrefixes?.some((prefix) => normalized.startsWith(prefix))) {
      return entry.displayName;
    }
  }
  return undefined;
};

/** 平台显示名映射(供工作流模板等使用)。 */
export const getProviderDisplayName = (type: string): string | undefined =>
  getCatalogEntry(type.toLowerCase())?.displayName;

/** 前端可消费的纯 UI 元数据投影(可序列化，经接口下发)。 */
export interface ProviderCatalogUiEntry {
  type: string;
  displayName: string;
  logoUrl?: string;
  fallbackGlyph?: string;
  aliases?: string[];
  modelIdPrefixes?: string[];
  upstreams: Array<{
    label: string;
    baseUrl: string;
    protocol?: CatalogUpstreamProtocol;
    isDefault?: boolean;
  }>;
  apiKeyEnv?: string;
}

/** 把 catalog 投影成可序列化的 UI 数据(剥离函数字段)。 */
export const getProviderCatalogUi = (): ProviderCatalogUiEntry[] =>
  PROVIDER_CATALOG.map((entry) => ({
    type: entry.type,
    displayName: entry.displayName,
    ...(entry.ui.logoUrl ? { logoUrl: entry.ui.logoUrl } : {}),
    ...(entry.ui.fallbackGlyph ? { fallbackGlyph: entry.ui.fallbackGlyph } : {}),
    ...(entry.ui.aliases ? { aliases: [...entry.ui.aliases] } : {}),
    ...(entry.ui.modelIdPrefixes ? { modelIdPrefixes: [...entry.ui.modelIdPrefixes] } : {}),
    upstreams: entry.upstreams.map((u) => ({
      label: u.label,
      baseUrl: u.baseUrl,
      ...(u.protocol ? { protocol: u.protocol } : {}),
      ...(u.isDefault ? { isDefault: u.isDefault } : {}),
    })),
    ...(entry.apiKeyEnv ? { apiKeyEnv: entry.apiKeyEnv } : {}),
  }));
