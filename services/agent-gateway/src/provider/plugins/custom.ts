/**
 * Custom (OpenAI-compatible) Provider Plugin
 *
 * 通用兜底插件，处理所有 type='custom' 的 provider。
 * - 协议：默认 chat_completions
 * - API Key：仅从 provider 配置读取（不读环境变量）
 */
import { registerProviderPlugin, type ResolveApiKeyContext } from '../provider-plugin.js';

registerProviderPlugin({
  providerType: 'custom',
  name: 'custom',
  hooks: {
    'resolve.protocol': () => 'chat_completions',

    'resolve.apiKey': ({ provider }: ResolveApiKeyContext) => {
      // Custom providers 只从显式配置读取 key
      return provider.apiKey ?? undefined;
    },
  },
});
