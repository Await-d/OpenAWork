/**
 * OpenRouter Provider Plugin
 *
 * - 协议：chat_completions
 * - Headers：注入 X-Title 和 HTTP-Referer
 * - API Key：优先 provider 配置，fallback 到环境变量
 */
import { registerProviderPlugin, type RequestHeadersContext, type ResolveApiKeyContext } from '../provider-plugin.js';

registerProviderPlugin({
  providerType: 'openrouter',
  name: 'openrouter',
  hooks: {
    'resolve.protocol': () => 'chat_completions',

    'request.headers': ({ headers }: RequestHeadersContext) => {
      headers['X-Title'] = 'OpenAWork';
      headers['HTTP-Referer'] = 'https://openAwork.local';
    },

    'resolve.apiKey': ({ provider }: ResolveApiKeyContext) => {
      if (provider.apiKey) return provider.apiKey;
      const envKey = globalThis.process?.env['OPENROUTER_API_KEY'];
      if (envKey) return envKey;
      return undefined;
    },
  },
});
