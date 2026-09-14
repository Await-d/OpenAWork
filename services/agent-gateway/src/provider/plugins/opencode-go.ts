/**
 * OpenCode Go Provider Plugin
 *
 * 按模型解析上游协议：OpenCode Go 在同一个 baseUrl(`/zen/go/v1`)下混用
 * `/responses`、`/messages`、`/chat/completions` 三种端点，映射见
 * `provider/opencode-go.ts`。
 *
 * catalog 的 upstream 刻意不声明 `protocol`：一旦声明，预设会把
 * `provider.upstreamProtocol` 写进 provider 配置，而 model-router 里
 * `provider.upstreamProtocol` 的优先级高于本 hook，会让非 chat 模型被打到
 * 错误端点。
 */
import { resolveOpencodeGoProtocol } from '../opencode-go.js';
import { registerProviderPlugin } from '../provider-plugin.js';

registerProviderPlugin({
  providerType: 'opencode-go',
  name: 'opencode-go',
  hooks: {
    'resolve.protocol': ({ model }) => resolveOpencodeGoProtocol(model),
  },
});
