/**
 * DeepSeek Provider Plugin
 *
 * - 协议：chat_completions（DeepSeek API 兼容 OpenAI chat completions）
 * - API Key：优先 provider 配置，fallback 到环境变量
 */
import { registerProviderPlugin, type ResolveApiKeyContext } from '../provider-plugin.js';

registerProviderPlugin({
  providerType: 'deepseek',
  name: 'deepseek',
  hooks: {
    'resolve.protocol': () => 'chat_completions',

    'resolve.apiKey': ({ provider }: ResolveApiKeyContext) => {
      if (provider.apiKey) return provider.apiKey;
      const envKey = globalThis.process?.env['DEEPSEEK_API_KEY'];
      if (envKey) return envKey;
      return undefined;
    },
  },
});
