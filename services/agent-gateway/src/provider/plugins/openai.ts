/**
 * OpenAI Provider Plugin
 *
 * - 协议：默认使用 chat_completions，显式配置可覆盖为 responses
 * - API Key：优先 provider 配置，fallback 到环境变量
 */
import {
  registerProviderPlugin,
  type ResolveProtocolContext,
  type ResolveApiKeyContext,
} from '../provider-plugin.js';

registerProviderPlugin({
  providerType: 'openai',
  name: 'openai',
  hooks: {
    'resolve.protocol': (_context: ResolveProtocolContext) => {
      // 临时方案：强制使用 Chat Completions API
      // 原因：旧 Responses 适配层存在 bug (Issue #13439, #8572, #7854)
      //      providerOptions 中的 reasoning_effort 参数不会被传递到上游
      //
      // 显式 provider.upstreamProtocol 仍会在模型路由中优先于此默认值。
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
