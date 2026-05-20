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

export interface RequestHeadersContext {
  model: string;
  provider: AIProvider;
  headers: Record<string, string>;
}

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
