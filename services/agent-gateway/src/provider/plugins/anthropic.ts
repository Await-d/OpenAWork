/**
 * Anthropic Provider Plugin
 *
 * - 协议：始终使用 anthropic_messages
 * - Headers：注入 anthropic-beta features
 * - API Key：优先 provider 配置，fallback 到环境变量
 */
import {
  registerProviderPlugin,
  type RequestHeadersContext,
  type ResolveApiKeyContext,
} from '../provider-plugin.js';

registerProviderPlugin({
  providerType: 'anthropic',
  name: 'anthropic',
  hooks: {
    'resolve.protocol': () => 'anthropic_messages',

    'request.headers': ({ headers }: RequestHeadersContext) => {
      // Anthropic beta features — 参考 opencode 的 AnthropicPlugin
      const betaFeatures = [
        'interleaved-thinking-2025-05-14',
        'fine-grained-tool-streaming-2025-05-14',
      ];
      headers['anthropic-beta'] = betaFeatures.join(',');
    },

    'resolve.apiKey': ({ provider }: ResolveApiKeyContext) => {
      if (provider.apiKey) return provider.apiKey;
      const envKey = globalThis.process?.env['ANTHROPIC_API_KEY'];
      if (envKey) return envKey;
      return undefined;
    },
  },
});
