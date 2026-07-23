/**
 * Provider Catalog 的前端 UI 注册表(单一事实来源的浏览器侧投影)。
 *
 * 目标：消灭散落在多个组件里的 `Record<type, logo/name/glyph>` 手工映射。
 * 组件统一通过 `resolveProviderVisual()` / `getProviderUiList()` 读取，新增平台
 * 时不再需要改任何前端映射表——只要：
 *   1. 网关 catalog 里有该平台(后端单一事实来源)；
 *   2. 前端启动时调用 `hydrateProviderCatalogUi()` 从 `/settings/providers/catalog`
 *      拉取并注入。
 *
 * 设计要点：
 *   - 渲染期需要「同步」拿到 logo/名称，所以这里维持一个模块级缓存 + 内置静态
 *     兜底(STATIC_FALLBACK)。首屏/离线/接口失败时退回兜底，不会白屏。
 *   - 运行时 `hydrate` 用接口数据覆盖兜底,使新增平台无需改前端即可显示。
 */

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

/**
 * 内置静态兜底：与后端 `agent-core/provider/catalog.ts` 的 UI 元数据保持一致。
 * 仅作首屏/离线兜底；运行时会被接口数据覆盖。新增平台后端加 catalog 即可，
 * 这里不补也能在 hydrate 后正常显示(只是首屏可能短暂用通用回退样式)。
 */
const STATIC_FALLBACK: readonly ProviderCatalogUiEntry[] = [
  {
    type: 'anthropic',
    displayName: 'Anthropic',
    logoUrl: '/logo-anthropic.svg',
    fallbackGlyph: '◌',
    aliases: ['claude'],
    modelIdPrefixes: ['claude'],
  },
  {
    type: 'openai',
    displayName: 'OpenAI',
    logoUrl: '/logo-openai.svg',
    fallbackGlyph: '◎',
    modelIdPrefixes: ['gpt', 'o1', 'o3', 'o4'],
  },
  {
    type: 'deepseek',
    displayName: 'DeepSeek',
    logoUrl: '/logo-deepseek.svg',
    fallbackGlyph: '◇',
    modelIdPrefixes: ['deepseek'],
  },
  {
    type: 'gemini',
    displayName: 'Google Gemini',
    logoUrl: '/logo-gemini.svg',
    fallbackGlyph: '✦',
    aliases: ['google', 'googlegemini'],
    modelIdPrefixes: ['gemini'],
  },
  {
    type: 'ollama',
    displayName: 'Ollama',
    logoUrl: '/logo-ollama.svg',
    fallbackGlyph: '◒',
  },
  {
    type: 'openrouter',
    displayName: 'OpenRouter',
    logoUrl: '/logo-openrouter.svg',
    fallbackGlyph: '↗',
  },
  {
    type: 'qwen',
    displayName: 'Qwen',
    logoUrl: '/logo-qwen.svg',
    fallbackGlyph: 'Q',
    modelIdPrefixes: ['qwen', 'qwq'],
  },
  {
    type: 'moonshot',
    displayName: 'Moonshot (Kimi)',
    logoUrl: '/logo-moonshot.svg',
    fallbackGlyph: '☾',
    aliases: ['moonshotai', 'moonshotai-cn', 'kimi'],
    modelIdPrefixes: ['moonshot', 'kimi'],
  },
  {
    type: 'mimo',
    displayName: 'Xiaomi MiMo',
    logoUrl: '/logo-mimo.svg',
    fallbackGlyph: 'Mi',
    aliases: ['xiaomi', 'xiaomimimo'],
    modelIdPrefixes: ['mimo'],
  },
  // 'claude' 作为 anthropic 的别名变体，单独登记便于某些按 'claude' 直查的路径。
  {
    type: 'claude',
    displayName: 'Claude',
    logoUrl: '/logo-claude.svg',
    fallbackGlyph: '◌',
    aliases: ['anthropic'],
    modelIdPrefixes: ['claude'],
  },
  // mistral 已是一等公民，与后端 catalog 对齐。
  {
    type: 'mistral',
    displayName: 'Mistral',
    logoUrl: '/logo-mistralai.svg',
    fallbackGlyph: 'M',
    aliases: ['mistralai'],
    modelIdPrefixes: ['mistral', 'mixtral', 'codestral', 'pixtral'],
  },
  {
    type: 'zhipu',
    displayName: '智谱 GLM',
    fallbackGlyph: '智',
    aliases: ['glm', 'bigmodel'],
    modelIdPrefixes: ['glm'],
  },
  {
    type: 'doubao',
    displayName: '豆包 / 火山方舟',
    fallbackGlyph: '豆',
    aliases: ['volcengine', 'ark', 'volces'],
    modelIdPrefixes: ['doubao', 'ep-'],
  },
  {
    type: 'groq',
    displayName: 'Groq',
    fallbackGlyph: 'Gq',
    modelIdPrefixes: ['llama', 'mixtral', 'gemma'],
  },
  {
    type: 'siliconflow',
    displayName: 'SiliconFlow',
    fallbackGlyph: 'Si',
    aliases: ['silicon'],
  },
  {
    type: 'azure',
    displayName: 'Azure OpenAI',
    fallbackGlyph: 'Az',
  },
  {
    type: 'xai',
    displayName: 'xAI (Grok)',
    fallbackGlyph: 'x',
    aliases: ['grok'],
    modelIdPrefixes: ['grok'],
  },
  {
    type: 'minimax',
    displayName: 'MiniMax',
    fallbackGlyph: 'MM',
    modelIdPrefixes: ['minimax', 'MiniMax', 'abab'],
  },
  {
    type: 'baichuan',
    displayName: '百川',
    fallbackGlyph: '百',
    modelIdPrefixes: ['Baichuan', 'baichuan'],
  },
  {
    type: 'hunyuan',
    displayName: '腾讯混元',
    fallbackGlyph: '混',
    aliases: ['tencent-hunyuan'],
    modelIdPrefixes: ['hunyuan'],
  },
  {
    type: 'qianfan',
    displayName: '百度千帆 / 文心',
    fallbackGlyph: '千',
    aliases: ['wenxin', 'baidu'],
    modelIdPrefixes: ['ernie'],
  },
  {
    type: 'custom',
    displayName: '自定义渠道',
    fallbackGlyph: '✦',
    aliases: ['custom-provider', 'self-hosted', 'openai-compatible'],
  },
];

const normalizeKey = (value: string): string => value.trim().toLowerCase();

function modelIdCandidates(modelId: string): string[] {
  const normalized = normalizeKey(modelId);
  const slash = normalized.indexOf('/');
  if (slash <= 0 || slash === normalized.length - 1) {
    return [normalized];
  }
  return [normalized, normalized.slice(slash + 1)];
}

let catalogEntries: ProviderCatalogUiEntry[] = [...STATIC_FALLBACK];
let byKey = new Map<string, ProviderCatalogUiEntry>();

function rebuildIndex(): void {
  const next = new Map<string, ProviderCatalogUiEntry>();
  for (const entry of catalogEntries) {
    const typeKey = normalizeKey(entry.type);
    if (!next.has(typeKey)) {
      next.set(typeKey, entry);
    }
    // compact key(去掉非字母数字)，匹配 'googlegemini' 这类
    const compact = typeKey.replace(/[^a-z0-9]/g, '');
    if (compact && !next.has(compact)) {
      next.set(compact, entry);
    }
    for (const alias of entry.aliases ?? []) {
      const aliasKey = normalizeKey(alias);
      if (aliasKey && !next.has(aliasKey)) {
        next.set(aliasKey, entry);
      }
    }
  }
  byKey = next;
}

rebuildIndex();

/**
 * 用接口(/settings/providers/catalog)返回的数据覆盖前端注册表。
 * 静态兜底里有、但接口没返回的条目(如 'claude' 这类纯 UI 别名)会被保留。
 */
export function hydrateProviderCatalogUi(entries: ProviderCatalogUiEntry[]): void {
  if (!Array.isArray(entries) || entries.length === 0) {
    return;
  }
  const merged = new Map<string, ProviderCatalogUiEntry>();
  for (const fallback of STATIC_FALLBACK) {
    merged.set(normalizeKey(fallback.type), fallback);
  }
  for (const entry of entries) {
    if (entry && typeof entry.type === 'string') {
      merged.set(normalizeKey(entry.type), entry);
    }
  }
  catalogEntries = Array.from(merged.values());
  rebuildIndex();
}

/** 列出全部 catalog 条目(用于设置页「新增供应商」平台下拉等)。 */
export function getProviderUiList(): ProviderCatalogUiEntry[] {
  // 仅过滤纯 UI 别名；mistral 已是一等公民，不再排除。
  return catalogEntries.filter((entry) => entry.type !== 'claude');
}

/** 按 type / 别名 / name 查 catalog 条目。 */
export function lookupProviderEntry(
  ...candidates: Array<string | null | undefined>
): ProviderCatalogUiEntry | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = normalizeKey(candidate);
    const direct = byKey.get(key);
    if (direct) return direct;
    const compact = key.replace(/[^a-z0-9]/g, '');
    if (compact) {
      const viaCompact = byKey.get(compact);
      if (viaCompact) return viaCompact;
    }
    // token 拆分兜底(如 "claude-3" → claude)
    for (const token of key.split(/[^a-z0-9]+/).filter(Boolean)) {
      const viaToken = byKey.get(token);
      if (viaToken) return viaToken;
    }
  }
  return undefined;
}

export interface ResolvedProviderVisual {
  type?: string;
  displayName: string;
  logoUrl?: string;
  fallbackGlyph?: string;
}

/**
 * 由 providerType / providerId / providerName 解析出统一的视觉信息。
 * 优先级：providerType → providerId → providerName。
 */
export function resolveProviderVisual(input: {
  providerType?: string | null;
  providerId?: string | null;
  providerName?: string | null;
}): ResolvedProviderVisual {
  const entry = lookupProviderEntry(input.providerType, input.providerId, input.providerName);
  if (entry) {
    return {
      type: entry.type,
      displayName: input.providerName?.trim() || entry.displayName,
      ...(entry.logoUrl ? { logoUrl: entry.logoUrl } : {}),
      ...(entry.fallbackGlyph ? { fallbackGlyph: entry.fallbackGlyph } : {}),
    };
  }
  // 未知平台：用 name/type 生成可读名，无 logo(交由调用方走通用回退)。
  const raw = (input.providerName || input.providerType || input.providerId || '').trim();
  return { displayName: raw || '助手' };
}

/** 由 modelId 前缀反推厂商显示名(用量页)。 */
export function inferProviderLabelFromModelId(modelId: string): string | undefined {
  const candidates = modelIdCandidates(modelId);
  for (const entry of catalogEntries) {
    if (
      entry.modelIdPrefixes?.some((prefix) =>
        candidates.some((candidate) => candidate.startsWith(prefix)),
      )
    ) {
      return entry.displayName;
    }
  }
  return undefined;
}
