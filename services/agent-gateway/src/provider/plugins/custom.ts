/**
 * Custom (OpenAI-compatible) Provider Plugin
 *
 * 通用兜底插件，处理所有 type='custom' 的 provider。
 * - 协议：默认 chat_completions；若 baseUrl 指向 OpenCode 端点，则按模型路由
 *   (OpenCode Go 同一 baseUrl 下混用三种协议，见 `provider/opencode-go.ts`)
 * - API Key：仅从 provider 配置读取（不读环境变量）
 */
import { isOpencodeGoEndpoint, resolveOpencodeGoProtocol } from '../opencode-go.js';
import {
  registerProviderPlugin,
  type ResolveApiKeyContext,
  type ResolveProtocolContext,
} from '../provider-plugin.js';

registerProviderPlugin({
  providerType: 'custom',
  name: 'custom',
  hooks: {
    'resolve.protocol': ({ model, provider, baseUrl }: ResolveProtocolContext) => {
      if (isOpencodeGoEndpoint(baseUrl) || isOpencodeGoEndpoint(provider.baseUrl)) {
        return resolveOpencodeGoProtocol(model);
      }
      return 'chat_completions';
    },

    'resolve.apiKey': ({ provider }: ResolveApiKeyContext) => {
      // Custom providers 只从显式配置读取 key
      return provider.apiKey ?? undefined;
    },
  },
});
