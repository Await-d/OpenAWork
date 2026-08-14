/**
 * OpenAI Provider Plugin
 *
 * - 协议：官方 API 用 responses，代理/兼容端点用 chat_completions
 * - API Key：优先 provider 配置，fallback 到环境变量
 */
import {
  registerProviderPlugin,
  type ResolveProtocolContext,
  type ResolveApiKeyContext,
} from '../provider-plugin.js';

const OPENAI_OFFICIAL_HOSTS = new Set(['api.openai.com']);

function isOfficialOpenAI(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return OPENAI_OFFICIAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

registerProviderPlugin({
  providerType: 'openai',
  name: 'openai',
  hooks: {
    'resolve.protocol': ({ baseUrl }: ResolveProtocolContext) => {
      // 临时方案：强制使用 Chat Completions API
      // 原因：@ai-sdk/openai 的 Responses API 存在 bug (Issue #13439, #8572, #7854)
      //      providerOptions 中的 reasoning_effort 参数不会被传递到上游
      //
      // 一旦 SDK 修复此 bug，可以恢复原逻辑：
      // if (!baseUrl || isOfficialOpenAI(baseUrl)) {
      //   return 'responses';
      // }
      return 'chat_completions';
    },

    'resolve.apiKey': ({ provider }: ResolveApiKeyContext) => {
      if (provider.apiKey) return provider.apiKey;
      const envKey =
        globalThis.process?.env['OPENAI_API_KEY'] ?? globalThis.process?.env['AI_API_KEY'];
      if (envKey) return envKey;
      return undefined;
    },
  },
});
