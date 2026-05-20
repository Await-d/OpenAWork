/**
 * Google Gemini Provider Plugin
 *
 * - 协议：chat_completions（通过 OpenAI-compatible endpoint）
 * - API Key：优先 provider 配置，fallback 到环境变量
 */
import { registerProviderPlugin, type ResolveApiKeyContext } from '../provider-plugin.js';

registerProviderPlugin({
  providerType: 'gemini',
  name: 'gemini',
  hooks: {
    'resolve.protocol': () => 'chat_completions',

    'resolve.apiKey': ({ provider }: ResolveApiKeyContext) => {
      if (provider.apiKey) return provider.apiKey;
      const envKey = globalThis.process?.env['GEMINI_API_KEY'];
      if (envKey) return envKey;
      return undefined;
    },
  },
});
