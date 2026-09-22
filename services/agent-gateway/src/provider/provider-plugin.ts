/**
 * 方案 5：Provider 插件化框架
 *
 * 定义 provider 插件接口和注册表。每个 provider 通过 hook 注入
 * 自己的特有逻辑（协议选择、header 注入、认证方式等），
 * 而不是在 model-router.ts 的大函数里 if/else。
 */
import type { AIProvider, AIModelConfig } from '@openAwork/agent-core';
import type { UpstreamProtocol } from '../routes/upstream-protocol.js';

// ─── Hook 上下文类型 ───────────────────────────────────────────

export interface ResolveProtocolContext {
  model: string;
  provider: AIProvider;
  baseUrl: string;
}

/**
 * `request.headers` — 就地改写 `headers` 注入平台特有请求头。
 *
 * 派发点：`provider/model-router.ts` 的 `applyProviderRequestHooks`（env 回退 /
 * provider 选择 / 压缩三条解析路径共用），结果合并进 `RequestOverrides.headers`，
 * 再由各上游 runner 作为 HTTP 头发出。
 *
 * 不变量：所有出站模型请求必须经过同一条 hook 链，新增路径不得绕过路由解析。
 */
export interface RequestHeadersContext {
  model: string;
  provider: AIProvider;
  headers: Record<string, string>;
}

/**
 * `request.body` — 就地改写 `body` 覆盖平台特有 JSON 请求字段。
 *
 * 派发点与 `request.headers` 相同（同一条 hook 链），结果合并进
 * `RequestOverrides.body`，由各上游 runner 作为 `http.body` 覆盖到协议请求体上；
 * 协议自有字段（messages / temperature / max_tokens 等）会被
 * `@openAwork/opencode-llm` 的 overlay denylist 拒绝。
 *
 * 不变量：与 `request.headers` 一致——所有出站模型请求都必须经过该 hook，
 * 不允许存在静默失效的路径。
 */
export interface RequestBodyContext {
  model: string;
  provider: AIProvider;
  body: Record<string, unknown>;
}

export interface ResolveApiKeyContext {
  provider: AIProvider;
}

export interface ModelsFilterContext {
  provider: AIProvider;
  models: AIModelConfig[];
}

// ─── Hook 接口 ─────────────────────────────────────────────────

export interface ProviderPluginHooks {
  'resolve.protocol'?: (ctx: ResolveProtocolContext) => UpstreamProtocol | undefined;
  'request.headers'?: (ctx: RequestHeadersContext) => void;
  'request.body'?: (ctx: RequestBodyContext) => void;
  'resolve.apiKey'?: (ctx: ResolveApiKeyContext) => string | undefined;
  'models.filter'?: (ctx: ModelsFilterContext) => AIModelConfig[];
}

// ─── 插件定义 ───────────────────────────────────────────────────

export interface ProviderPlugin {
  readonly providerType: string;
  readonly name: string;
  readonly hooks: ProviderPluginHooks;
}

// ─── 注册表 ─────────────────────────────────────────────────────

const pluginRegistry: ProviderPlugin[] = [];

export function registerProviderPlugin(plugin: ProviderPlugin): void {
  pluginRegistry.push(plugin);
}

export function getPluginsForProvider(providerType: string): ProviderPlugin[] {
  return pluginRegistry.filter((p) => p.providerType === providerType || p.providerType === '*');
}

export function runHookFirst<K extends keyof ProviderPluginHooks>(
  hookName: K,
  providerType: string,
  ctx: Parameters<NonNullable<ProviderPluginHooks[K]>>[0],
): ReturnType<NonNullable<ProviderPluginHooks[K]>> | undefined {
  for (const plugin of getPluginsForProvider(providerType)) {
    const fn = plugin.hooks[hookName] as ((c: typeof ctx) => unknown) | undefined;
    if (!fn) continue;
    try {
      const result = fn(ctx);
      if (result !== undefined) return result as ReturnType<NonNullable<ProviderPluginHooks[K]>>;
    } catch (err) {
      console.warn(
        `[provider-plugin] ${plugin.name}.${hookName} threw:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return undefined;
}

export function runHookAll<K extends keyof ProviderPluginHooks>(
  hookName: K,
  providerType: string,
  ctx: Parameters<NonNullable<ProviderPluginHooks[K]>>[0],
): void {
  for (const plugin of getPluginsForProvider(providerType)) {
    const fn = plugin.hooks[hookName] as ((c: typeof ctx) => void) | undefined;
    if (!fn) continue;
    try {
      fn(ctx);
    } catch (err) {
      console.warn(
        `[provider-plugin] ${plugin.name}.${hookName} threw:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export function listRegisteredPlugins(): readonly ProviderPlugin[] {
  return pluginRegistry;
}

/** @internal Test only */
export function _resetPluginsForTest(): void {
  pluginRegistry.length = 0;
}
