import type { ToolDefinition } from '@openAwork/agent-core';
import {
  searchMultiProvider,
  webSearchTool,
  WEB_SEARCH_PROVIDER_API_KEY_ENV,
  WEB_SEARCH_PROVIDER_BASE_URL_ENV,
  type WebSearchMultiConfig,
  type WebSearchMultiEntry,
  type WebSearchProvider,
} from '@openAwork/agent-core';
import { registerKeylessWebSearchProviders } from './websearch-keyless-providers.js';

const WEBSEARCH_DESCRIPTION =
  '在互联网上搜索实时信息、新闻和事实 —— 这是**联网搜索的唯一入口**。检索近期信息时请在 query 中带上当前年份。' +
  '如需读取某个具体网页的正文，用 open_websearch/fetch_web；如需读取 GitHub 仓库 README，用 open_websearch/fetch_github_readme。';

// 免密钥中文引擎（baidu / sogou）由本包注册进 agent-core 的 provider 插槽。
// 放在模块加载处：任何能拿到 `websearch` 工具的路径都自动具备这两个 provider。
registerKeylessWebSearchProviders();

/**
 * Static gateway alias kept for non-user-aware callers (verification
 * scripts, the alias used by `tool-definitions.ts` for shape /
 * permission catalog parity). Production execution paths route via
 * `createWebsearchTool()` so a per-user multi-provider rollout can
 * take over (P2-WEBSEARCH workflow 260509).
 */
export const websearchTool: ToolDefinition<
  typeof webSearchTool.inputSchema,
  typeof webSearchTool.outputSchema
> = {
  ...webSearchTool,
  name: 'websearch',
  description: WEBSEARCH_DESCRIPTION,
};

export interface WebsearchToolFactoryOptions {
  /**
   * Per-call resolver for the user's persisted multi-provider rollout
   * policy. Returning `null` (or providing no resolver) keeps the
   * legacy single-call behaviour — the LLM-facing schema is unchanged
   * either way, so this stays purely a gateway-side decision.
   */
  resolveMultiConfig?: () => WebSearchMultiConfig | null;
}

/**
 * 从宿主环境变量按优先级读取一个配置值；空串 / 纯空白视为未配置。
 */
function readEnvValue(names: readonly string[]): string | undefined {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  }
  return undefined;
}

/**
 * 判定模型入参是否**缺少该提供商必需的凭据**。
 *
 * 只有确实缺凭据时才去读用户设置 / 环境变量：这样「模型指定 provider」的调用
 * 既不会被 rollout 策略改写，也不会为了一次凭据查询平白多打一次库——无需
 * 密钥的 duckduckgo 走的是零副作用路径。
 */
function missingCredentials(
  provider: WebSearchProvider,
  input: { apiKey?: string; baseUrl?: string },
): { apiKey: boolean; baseUrl: boolean } {
  const needsKey = WEB_SEARCH_PROVIDER_API_KEY_ENV[provider].length > 0;
  const needsBaseUrl = WEB_SEARCH_PROVIDER_BASE_URL_ENV[provider].length > 0;
  return {
    apiKey: needsKey && !input.apiKey?.trim(),
    baseUrl: needsBaseUrl && !input.baseUrl?.trim(),
  };
}

/**
 * 补齐一个提供商条目缺失的 apiKey / baseUrl：用户设置优先，环境变量兜底。
 * 返回新对象，绝不改写调用方传入的配置。
 */
function withCredentialBackfill(entry: WebSearchMultiEntry): WebSearchMultiEntry {
  const apiKey =
    entry.apiKey?.trim() || readEnvValue(WEB_SEARCH_PROVIDER_API_KEY_ENV[entry.provider]);
  const baseUrl =
    entry.baseUrl?.trim() || readEnvValue(WEB_SEARCH_PROVIDER_BASE_URL_ENV[entry.provider]);
  return {
    ...entry,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

/**
 * Factory variant of `websearchTool` that consults the gateway-side
 * `WebsearchPolicy` before deciding whether to run the legacy
 * single-provider path or the parallel `searchMultiProvider` rollout.
 *
 * Decision rules (kept tight on purpose so non-opted-in users see the
 * exact same behaviour as before):
 *   1. The LLM did not pin a `provider` in the call AND
 *   2. the user has at least one configured `providers[*]` entry AND
 *   3. either `rolloutMode !== 'sequential'` OR there are 2+ providers.
 * In every other case the call falls through to the static tool's
 * own `execute` (duckduckgo default + LLM-supplied fields).
 *
 * 凭据补全（2026-10-12 排障回归）：`apiKey` 虽在模型可见的入参里，但密钥本身
 * 属于宿主 / 用户配置——模型读不到 `process.env`，也不该被要求携带。因此凡是
 * 生效提供商缺少必需凭据，就在这里按「用户设置 → 环境变量」补齐；补齐失败则
 * 由 agent-core 抛出可操作的中文错误，而不是旧的裸英文 `X API key is required`。
 */
export function createWebsearchTool(
  opts: WebsearchToolFactoryOptions = {},
): ToolDefinition<typeof webSearchTool.inputSchema, typeof webSearchTool.outputSchema> {
  const { resolveMultiConfig } = opts;
  return {
    ...webSearchTool,
    name: 'websearch',
    description: WEBSEARCH_DESCRIPTION,
    execute: async (input, signal) => {
      const llmPickedProvider = typeof input.provider === 'string' && input.provider.length > 0;
      // 显式标注联合类型：`webSearchTool` 在 agent-core 侧以不带泛型参数的
      // `ToolDefinition` 声明，`input` 因而是 `any`；运行时该值已由 sandbox
      // 按 `inputSchema` 校验过，这里补回精确类型以便下标访问环境变量表。
      const provider: WebSearchProvider = input.provider ?? 'duckduckgo';
      const missing = missingCredentials(provider, input);

      // 惰性读取持久化策略：rollout 决策需要它，凭据补全也可能需要它。
      // 用容器对象而非裸 `let`：闭包内的赋值不会被 TS 的控制流分析追踪，
      // 裸变量会在下方的 `policy &&` 处被收窄成 `never`。
      const policyRef: { loaded: boolean; value: WebSearchMultiConfig | null } = {
        loaded: false,
        value: null,
      };
      const loadPolicy = (): WebSearchMultiConfig | null => {
        if (!policyRef.loaded) {
          policyRef.loaded = true;
          policyRef.value = resolveMultiConfig ? resolveMultiConfig() : null;
        }
        return policyRef.value;
      };

      // 只有确实需要时才去读取策略：无需密钥的 provider（如 duckduckgo）
      // 被模型指定时走零副作用路径，不碰用户设置。
      const needsPolicy = !llmPickedProvider || missing.apiKey || missing.baseUrl;
      const policy = needsPolicy ? loadPolicy() : null;

      // 生效提供商缺凭据时先补齐，再决定走多提供商还是单提供商路径。
      // 优先级固定为「模型显式入参 > 用户设置 > 环境变量」：模型偶尔会真的
      // 带上一个有效密钥，不能被用户设置反向覆盖；缺失的部分才向后兜底。
      let effectiveInput = input;
      if (missing.apiKey || missing.baseUrl) {
        const fromPolicy = policy?.providers.find((entry) => entry.provider === provider);
        const apiKey =
          input.apiKey?.trim() ||
          fromPolicy?.apiKey?.trim() ||
          readEnvValue(WEB_SEARCH_PROVIDER_API_KEY_ENV[provider]);
        const baseUrl =
          input.baseUrl?.trim() ||
          fromPolicy?.baseUrl?.trim() ||
          readEnvValue(WEB_SEARCH_PROVIDER_BASE_URL_ENV[provider]);
        effectiveInput = {
          ...input,
          ...(apiKey ? { apiKey } : {}),
          ...(baseUrl ? { baseUrl } : {}),
        };
      }

      if (!llmPickedProvider && policy && policy.providers.length > 0) {
        // Honour the policy iff it actually adds something over the
        // legacy single-call (multi-mode OR more than one provider).
        const triggersMulti =
          (policy.rolloutMode && policy.rolloutMode !== 'sequential') ||
          policy.providers.length >= 2;
        if (triggersMulti) {
          return searchMultiProvider(
            input.query,
            {
              // 策略条目同样按「用户设置 → 环境变量」补齐凭据：用户可能只
              // 在设置里选了提供商，而把密钥留在宿主环境变量里。
              providers: policy.providers.map(withCredentialBackfill),
              rolloutMode: policy.rolloutMode,
              ...(policy.timeoutMs !== undefined ? { timeoutMs: policy.timeoutMs } : {}),
              ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
            },
            signal,
          );
        }
      }
      // Legacy path — preserves current behaviour for everyone who
      // hasn't opted in. We delegate to the original tool's `execute`
      // rather than reimplementing the dispatch table here.
      return webSearchTool.execute(effectiveInput, signal);
    },
  };
}
