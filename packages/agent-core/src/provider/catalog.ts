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
import { CATALOG_DEFAULT_MODELS } from './catalog-models.js';

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
  modelsDevIds?: string[];
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

// 按版本号数值比较（k-major.minor >= 2.5），覆盖 k2.5/k2p5/k2-5 等分隔符变体，
// 不需要每次发新版本（k2.6、k3...）都加一行硬编码。与前端
// shared-ui/model-reasoning-support.ts 的 isMoonshotThinkingModel 完全对齐。
const isMoonshotThinkingModel = (modelId: string): boolean => {
  const id = modelId.toLowerCase();
  if (id.includes('kimi-k2-thinking')) return true;
  const match = /kimi-k(\d+)(?:[.p-](\d+))?/.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] !== undefined ? Number(match[2]) : 0;
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > 2 || (major === 2 && minor >= 5);
};

/**
 * 智谱：GLM major.minor >= 4.5（4.5/4.6/未来 4.7、5.0...）视为思考模型；
 * glm-z1 是独立系列前缀，无法数值化，保留字符串匹配。与前端对齐。
 */
const isZhipuThinkingModel = (modelId: string): boolean => {
  const id = modelId.toLowerCase();
  if (id.includes('glm-z1')) return true;
  const match = /glm-(\d+)[.-](\d+)/.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > 4 || (major === 4 && minor >= 5);
};

/**
 * 豆包 / 方舟：Seed major.minor >= 1.6（1.6/未来 1.7、2.0...），或显式
 * thinking/reasoner 关键字兜底。与前端对齐。
 */
const isDoubaoThinkingModel = (modelId: string): boolean => {
  const id = modelId.toLowerCase();
  if (id.includes('doubao-1.5-thinking') || id.includes('doubao-thinking')) return true;
  if (
    (id.includes('doubao') || id.includes('seed')) &&
    (id.includes('thinking') || id.includes('reasoner'))
  ) {
    return true;
  }
  const match = /seed-(\d+)[.-](\d+)/.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > 1 || (major === 1 && minor >= 6);
};

/** Qwen：major >= 3（qwen3、未来 qwen4...）或 qwq / thinking / reasoner 关键字。与前端对齐。 */
const isQwenThinkingModel = (modelId: string): boolean => {
  const id = modelId.toLowerCase();
  if (id.includes('qwq') || id.includes('thinking') || id.includes('reasoner')) return true;
  const match = /qwen-?(\d+)/.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  return Number.isFinite(major) && major >= 3;
};

// o 系列（o1/o3/o4/未来 o5...）统一用 `o\d+` 匹配；GPT-4.1 仍精确匹配
// （4.1 是唯一支持 reasoning 的 4.x 版本，无法泛化成数值区间）。
const OPENAI_REASONING_MODEL_RE = /(?:^|\/)(?:gpt-(?:4\.1|5)(?:[.-]|$)|o\d+(?:[.-]|$))/;

function isOpenAIReasoningModel(modelId: string): boolean {
  return OPENAI_REASONING_MODEL_RE.test(modelId.toLowerCase());
}

// Anthropic：opus/sonnet 系列 major >= 4 视为支持思考；3.7 是版本号之外的显式
// 例外（3.x 系列里只有 3.7 支持，无法用数值区间泛化，需保留字符串匹配）。
function isAnthropicThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.includes('claude-3-7-sonnet')) return true;
  const match = /claude-(?:opus|sonnet)-(\d+)/.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  return Number.isFinite(major) && major >= 4;
}

// Gemini：major.minor >= 2.5 视为支持 thinking_config（2.5 / 3.x / 未来 4.x...）。
function isGeminiThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  const match = /gemini-(\d+)(?:\.(\d+))?/.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] !== undefined ? Number(match[2]) : 0;
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > 2 || (major === 2 && minor >= 5);
}

/** OpenRouter：仅对已知推理系列下发 reasoning，避免 gpt-4o 等误开。 */
const isOpenRouterReasoningModel = (modelId: string): boolean => {
  const id = modelId.toLowerCase();
  return (
    isOpenAIReasoningModel(id) ||
    isAnthropicThinkingModel(id) ||
    isGeminiThinkingModel(id) ||
    id.includes('deepseek-r') ||
    id.includes('reasoner') ||
    id.includes('thinking')
  );
};

// xAI：grok major >= 2（grok-2/3/4/未来 grok-5...）。
function isXaiThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  const match = /grok-(\d+)/.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  return Number.isFinite(major) && major >= 2;
}

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
    defaultModels: CATALOG_DEFAULT_MODELS['anthropic'],
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
    defaultModels: CATALOG_DEFAULT_MODELS['openai'],
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
    defaultModels: CATALOG_DEFAULT_MODELS['deepseek'],
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
    modelsDevIds: ['google'],
    upstreams: [
      {
        label: 'Gemini (OpenAI 兼容)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        isDefault: true,
      },
    ],
    thinkingStyle: 'gemini_thinking',
    defaultModels: CATALOG_DEFAULT_MODELS['gemini'],
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
    defaultModels: CATALOG_DEFAULT_MODELS['ollama'],
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
    thinkingModelMatcher: isOpenRouterReasoningModel,
    defaultModels: CATALOG_DEFAULT_MODELS['openrouter'],
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
    modelsDevIds: ['alibaba-cn', 'alibaba'],
    upstreams: [
      {
        label: 'DashScope (OpenAI 兼容)',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        isDefault: true,
      },
    ],
    thinkingStyle: 'qwen_enable_thinking',
    thinkingModelMatcher: isQwenThinkingModel,
    defaultModels: CATALOG_DEFAULT_MODELS['qwen'],
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
    modelsDevIds: ['moonshotai-cn', 'moonshotai'],
    upstreams: [{ label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', isDefault: true }],
    thinkingStyle: 'body_thinking_type',
    thinkingModelMatcher: isMoonshotThinkingModel,
    defaultModels: CATALOG_DEFAULT_MODELS['moonshot'],
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
    modelsDevIds: ['xiaomi'],
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
    defaultModels: CATALOG_DEFAULT_MODELS['mimo'],
  },
  {
    type: 'mistral',
    displayName: 'Mistral',
    enabledByDefault: false,
    apiKeyEnv: 'MISTRAL_API_KEY',
    hostnames: ['api.mistral.ai'],
    ui: {
      logoUrl: '/logo-mistralai.svg',
      fallbackGlyph: 'M',
      aliases: ['mistralai'],
      modelIdPrefixes: ['mistral', 'mixtral', 'codestral', 'pixtral'],
    },
    upstreams: [{ label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', isDefault: true }],
    thinkingStyle: 'none',
    defaultModels: CATALOG_DEFAULT_MODELS['mistral'],
  },
  {
    type: 'zhipu',
    displayName: '智谱 GLM',
    enabledByDefault: false,
    apiKeyEnv: 'ZHIPU_API_KEY',
    hostnames: ['open.bigmodel.cn'],
    ui: {
      fallbackGlyph: '智',
      aliases: ['zhipuai', 'glm', 'bigmodel'],
      modelIdPrefixes: ['glm'],
    },
    modelsDevIds: ['zhipuai'],
    upstreams: [
      {
        label: '智谱 OpenAI 兼容',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        isDefault: true,
      },
    ],
    thinkingStyle: 'body_thinking_type',
    thinkingModelMatcher: isZhipuThinkingModel,
    defaultModels: CATALOG_DEFAULT_MODELS['zhipu'],
  },
  {
    type: 'doubao',
    displayName: '豆包 / 火山方舟',
    enabledByDefault: false,
    apiKeyEnv: 'ARK_API_KEY',
    hostnames: ['ark.cn-beijing.volces.com'],
    ui: {
      fallbackGlyph: '豆',
      aliases: ['volcengine', 'ark', 'volces'],
      modelIdPrefixes: ['doubao', 'ep-'],
    },
    modelsDevIds: ['volcengine'],
    upstreams: [
      {
        label: '火山方舟',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        isDefault: true,
      },
    ],
    // 方舟 OpenAI 兼容：thinking 模型走 body.thinking.type 开关。
    thinkingStyle: 'body_thinking_type',
    thinkingModelMatcher: isDoubaoThinkingModel,
    defaultModels: CATALOG_DEFAULT_MODELS['doubao'],
  },
  {
    type: 'groq',
    displayName: 'Groq',
    enabledByDefault: false,
    apiKeyEnv: 'GROQ_API_KEY',
    hostnames: ['api.groq.com'],
    ui: {
      fallbackGlyph: 'Gq',
      modelIdPrefixes: ['llama', 'mixtral', 'gemma'],
    },
    upstreams: [
      {
        label: 'Groq OpenAI 兼容',
        baseUrl: 'https://api.groq.com/openai/v1',
        isDefault: true,
      },
    ],
    thinkingStyle: 'none',
    defaultModels: CATALOG_DEFAULT_MODELS['groq'],
  },
  {
    type: 'siliconflow',
    displayName: 'SiliconFlow',
    enabledByDefault: false,
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    hostnames: ['api.siliconflow.cn'],
    ui: {
      fallbackGlyph: 'Si',
      aliases: ['silicon'],
    },
    upstreams: [
      {
        label: 'SiliconFlow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        isDefault: true,
      },
    ],
    thinkingStyle: 'none',
    defaultModels: CATALOG_DEFAULT_MODELS['siliconflow'],
  },
  {
    type: 'azure',
    displayName: 'Azure OpenAI',
    enabledByDefault: false,
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
    ui: {
      fallbackGlyph: 'Az',
    },
    upstreams: [
      {
        label: 'Azure OpenAI（请填写资源 endpoint）',
        baseUrl: '',
        protocol: 'chat_completions',
        isDefault: true,
      },
    ],
    thinkingStyle: 'openai_effort',
    // Azure 部署名各异；仅对 GPT-5 / o 系列等 reasoning 模型下发 effort。
    thinkingModelMatcher: isOpenAIReasoningModel,
    defaultModels: CATALOG_DEFAULT_MODELS['azure'],
  },
  {
    type: 'xai',
    displayName: 'xAI (Grok)',
    enabledByDefault: false,
    apiKeyEnv: 'XAI_API_KEY',
    hostnames: ['api.x.ai'],
    ui: {
      fallbackGlyph: 'x',
      aliases: ['grok'],
      modelIdPrefixes: ['grok'],
    },
    upstreams: [{ label: 'xAI', baseUrl: 'https://api.x.ai/v1', isDefault: true }],
    thinkingStyle: 'openai_effort',
    thinkingModelMatcher: isXaiThinkingModel,
    defaultModels: CATALOG_DEFAULT_MODELS['xai'],
  },
  {
    type: 'minimax',
    displayName: 'MiniMax',
    enabledByDefault: false,
    apiKeyEnv: 'MINIMAX_API_KEY',
    hostnames: ['api.minimax.chat'],
    ui: {
      fallbackGlyph: 'MM',
      modelIdPrefixes: ['minimax', 'MiniMax', 'abab'],
    },
    upstreams: [
      {
        label: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        isDefault: true,
      },
    ],
    thinkingStyle: 'none',
    defaultModels: CATALOG_DEFAULT_MODELS['minimax'],
  },
  {
    type: 'baichuan',
    displayName: '百川',
    enabledByDefault: false,
    apiKeyEnv: 'BAICHUAN_API_KEY',
    hostnames: ['api.baichuan-ai.com'],
    ui: {
      fallbackGlyph: '百',
      modelIdPrefixes: ['Baichuan', 'baichuan'],
    },
    upstreams: [
      {
        label: '百川',
        baseUrl: 'https://api.baichuan-ai.com/v1',
        isDefault: true,
      },
    ],
    thinkingStyle: 'none',
    defaultModels: CATALOG_DEFAULT_MODELS['baichuan'],
  },
  {
    type: 'hunyuan',
    displayName: '腾讯混元',
    enabledByDefault: false,
    apiKeyEnv: 'HUNYUAN_API_KEY',
    hostnames: ['api.hunyuan.cloud.tencent.com'],
    ui: {
      fallbackGlyph: '混',
      aliases: ['tencent-hunyuan'],
      modelIdPrefixes: ['hunyuan'],
    },
    upstreams: [
      {
        label: '混元 OpenAI 兼容',
        baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
        isDefault: true,
      },
    ],
    thinkingStyle: 'none',
    defaultModels: CATALOG_DEFAULT_MODELS['hunyuan'],
  },
  {
    type: 'qianfan',
    displayName: '百度千帆 / 文心',
    enabledByDefault: false,
    apiKeyEnv: 'QIANFAN_API_KEY',
    hostnames: ['qianfan.baidubce.com'],
    ui: {
      fallbackGlyph: '千',
      aliases: ['wenxin', 'baidu'],
      modelIdPrefixes: ['ernie'],
    },
    upstreams: [
      {
        label: '千帆 OpenAI 兼容',
        baseUrl: 'https://qianfan.baidubce.com/v2',
        isDefault: true,
      },
    ],
    thinkingStyle: 'none',
    defaultModels: CATALOG_DEFAULT_MODELS['qianfan'],
  },
  {
    type: 'opencode-go',
    displayName: 'OpenCode Go',
    enabledByDefault: false,
    apiKeyEnv: 'OPENCODE_API_KEY',
    hostnames: ['opencode.ai'],
    ui: {
      fallbackGlyph: 'Go',
      aliases: ['opencode', 'opencode-go', 'zen-go'],
      // 刻意不填 modelIdPrefixes：这些模型 id 是裸名(如 deepseek-v4-flash)，
      // 填了会把用量页的厂商反推与第三方代理的模型归属错误地劫持到本平台。
    },
    upstreams: [
      {
        // 同一个 baseUrl 下按模型混用三种协议(responses / chat_completions /
        // anthropic_messages)，因此这里刻意不写死 protocol——交由
        // 网关 `plugins/opencode-go.ts` 的 `resolve.protocol` hook 按模型路由。
        label: 'OpenCode Go',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        isDefault: true,
      },
    ],
    // 各模型中思维控制语义不一致(GLM/Kimi/DeepSeek/Qwen/MiniMax 各不相同)，
    // 统一不下发 thinking 选项，避免误开。
    thinkingStyle: 'none',
    // 模型清单与协议归属来自官方端点表：https://opencode.ai/docs/go/#endpoints
    // 该列表会随上游测试进度变动，用户亦可在设置里手动增删模型。
    defaultModels: CATALOG_DEFAULT_MODELS['opencode-go'],
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

function modelIdCandidates(modelId: string): string[] {
  const normalized = modelId.toLowerCase();
  const slash = normalized.indexOf('/');
  if (slash <= 0 || slash === normalized.length - 1) {
    return [normalized];
  }
  return [normalized, normalized.slice(slash + 1)];
}

function findCatalogEntryByModelId(
  modelId: string,
  options?: { includeOpenAI?: boolean },
): ProviderCatalogEntry | undefined {
  const candidates = modelIdCandidates(modelId);
  for (const entry of PROVIDER_CATALOG) {
    if (options?.includeOpenAI !== true && entry.type === 'openai') {
      continue;
    }
    if (
      entry.ui.modelIdPrefixes?.some((prefix) =>
        candidates.some((candidate) => candidate.startsWith(prefix)),
      )
    ) {
      return entry;
    }
  }
  return undefined;
}

function findCatalogModelConfig(
  entry: ProviderCatalogEntry,
  modelId: string,
): AIModelConfig | undefined {
  const candidates = new Set(modelIdCandidates(modelId));
  return entry.defaultModels.find((model) => candidates.has(model.id.toLowerCase()));
}

function inferModelThinkingSupport(entry: ProviderCatalogEntry, modelId: string): boolean {
  const explicitModel = findCatalogModelConfig(entry, modelId);
  if (typeof explicitModel?.supportsThinking === 'boolean') {
    return explicitModel.supportsThinking;
  }
  if (entry.thinkingModelMatcher) {
    return entry.thinkingModelMatcher(modelId);
  }
  if (entry.type === 'anthropic') {
    return isAnthropicThinkingModel(modelId);
  }
  if (entry.type === 'openai' || entry.type === 'azure') {
    return isOpenAIReasoningModel(modelId);
  }
  if (entry.type === 'xai') {
    return isXaiThinkingModel(modelId);
  }
  // DeepSeek 全系（含 SiliconFlow 上的 DeepSeek-V3）可接受 thinking 开关。
  if (entry.thinkingStyle === 'deepseek_thinking') {
    return true;
  }
  // Gemini 2.5+ 系列支持 thinking_config。
  if (entry.thinkingStyle === 'gemini_thinking') {
    return isGeminiThinkingModel(modelId);
  }
  return false;
}

/**
 * thinking 风格解析：把 providerType(含 'claude' 这种别名)映射到风格。
 * 网关 provider-options.ts 用它替代原先的 `switch(providerType)`，使新增平台
 * 复用已有风格时无需改网关代码。
 *
 * 当 providerType 是 'openai' 或 'custom'（用户通过第三方代理使用非 OpenAI 模型）
 * 时，通过 modelId 前缀推断真实厂商的 thinking 风格。例如用户配了一个 OpenAI
 * 兼容的代理来访问 MiMo 模型，modelId 是 'mimo-v2.5-pro'，此时应使用
 * 'body_thinking_type' 风格而非 'openai_effort'。
 */
/**
 * OpenCode Go 的思考形态由官方 models.dev `reasoning_options` 决定：
 * 官方 opencode 对 OpenAI 兼容端点统一下发 `reasoning_effort`（见其
 * `ProviderTransform` 的 OpenAI-compatible 分支），而对没有 effort 变体的模型
 * 完全不发 reasoning 参数。这里据此返回 `openai_effort` 或 `none`，不做厂商猜测。
 * 数据在 `catalog-models.ts` 静态镜像，并由 models.dev 同步刷新。
 */
const inferOpencodeGoStyleFromOptions = (modelId?: string): ProviderThinkingStyle => {
  const entry = getCatalogEntry('opencode-go');
  const model = entry && modelId ? findCatalogModelConfig(entry, modelId) : undefined;
  const hasEffort = (model?.reasoningOptions ?? []).some((option) => option.type === 'effort');
  return hasEffort ? 'openai_effort' : 'none';
};

export const resolveThinkingStyle = (
  providerType: string,
  modelId?: string,
): ProviderThinkingStyle => {
  const normalized = providerType.toLowerCase();
  if (normalized === 'claude') {
    return 'anthropic_budget';
  }

  // OpenCode Go 在同一个 baseUrl 下按模型混用三种协议：协议为 anthropic_messages /
  // responses 的模型，网关已把 providerType 改写为 anthropic / openai，走不到这里；
  // 能走到这里的必然跑 chat_completions。故按 modelId 反推真实厂商风格，推不出来
  // 就保持 none——不对未知模型乱发参数。
  if (normalized === 'opencode-go') {
    return inferOpencodeGoStyleFromOptions(modelId);
  }

  // 对 'openai' / 'custom' / 聚合平台，先尝试通过 modelId 前缀推断真实厂商——
  // 用户可能通过 OpenAI 兼容代理或 SiliconFlow 使用 MiMo/Qwen/DeepSeek 等模型。
  // 只有推断失败时才 fallback。
  if (normalized === 'openai' || normalized === 'custom' || normalized === 'siliconflow') {
    if (modelId) {
      const catalogEntry = findCatalogEntryByModelId(modelId, {
        includeOpenAI: true,
      });
      if (catalogEntry) {
        return catalogEntry.thinkingStyle;
      }
    }
    // 推断失败：
    // - openai / custom：默认按 OpenAI 兼容 reasoningEffort 下发
    //   （自定义渠道用户勾选 supportsThinking 后必须有可执行风格，不能是 none）
    // - siliconflow：无前缀时保持 none，避免对未知模型乱发参数
    return normalized === 'siliconflow' ? 'none' : 'openai_effort';
  }

  const entry = getCatalogEntry(normalized);
  if (entry) {
    return entry.thinkingStyle;
  }

  return 'none';
};

/** 该平台下某模型是否真正支持下发 thinking(用于 moonshot 这种部分模型场景)。 */
export const catalogModelSupportsThinking = (providerType: string, modelId: string): boolean => {
  const normalized = providerType.toLowerCase();

  // OpenCode Go：先读本平台条目里为该模型显式声明的 supportsThinking（Qwen/MiniMax
  // 等走 anthropic 协议、MiMo 目录无 matcher，厂商反推判不出来，只能靠显式声明），
  // 未声明时再按 modelId 反推真实厂商。
  if (normalized === 'opencode-go') {
    const entry = getCatalogEntry(normalized);
    const explicitModel = entry ? findCatalogModelConfig(entry, modelId) : undefined;
    if (typeof explicitModel?.supportsThinking === 'boolean') {
      return explicitModel.supportsThinking;
    }
    const vendorEntry = modelId
      ? findCatalogEntryByModelId(modelId, { includeOpenAI: true })
      : undefined;
    return vendorEntry ? inferModelThinkingSupport(vendorEntry, modelId) : false;
  }

  // 对 'openai' / 'custom' / siliconflow，先尝试通过 modelId 前缀推断真实厂商
  // （与 resolveThinkingStyle 对齐）。
  if (normalized === 'openai' || normalized === 'custom' || normalized === 'siliconflow') {
    if (modelId) {
      const catalogEntry = findCatalogEntryByModelId(modelId, {
        includeOpenAI: true,
      });
      if (catalogEntry) {
        return inferModelThinkingSupport(catalogEntry, modelId);
      }
    }
    // 推断失败：providerType 明确是 openai 时，直接按 isOpenAIReasoningModel
    // 判断而不是彻底判否——避免 modelIdPrefixes 白名单滞后于新模型发布（如
    // 未来的 o5、gpt-5.7）导致新模型被误判为不支持思考。
    // custom / siliconflow 场景无法确定真实厂商，保持保守返回 false。
    if (normalized === 'openai' && modelId) {
      return isOpenAIReasoningModel(modelId);
    }
    return false;
  }

  const entry = getCatalogEntry(normalized);
  if (entry) {
    return inferModelThinkingSupport(entry, modelId);
  }

  return false;
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
  return findCatalogEntryByModelId(modelId, { includeOpenAI: true })?.displayName;
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
