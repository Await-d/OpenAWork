/**
 * NVIDIA Provider Plugin
 *
 * - 协议：chat_completions
 * - Headers：注入 origin header（参考 opencode feat(provider): add NVIDIA endpoints origin header）
 */
import { registerProviderPlugin, type RequestHeadersContext } from '../provider-plugin.js';

registerProviderPlugin({
  providerType: 'nvidia',
  name: 'nvidia',
  hooks: {
    'resolve.protocol': () => 'chat_completions',

    'request.headers': ({ headers, provider }: RequestHeadersContext) => {
      // NVIDIA endpoints require origin header
      if (provider.baseUrl) {
        try {
          const url = new URL(provider.baseUrl);
          headers['origin'] = url.origin;
        } catch {
          // ignore invalid URL
        }
      }
    },
  },
});
