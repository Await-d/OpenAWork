/**
 * 把免密钥搜索引擎注册到 agent-core 的 `websearch` 工具插槽上。
 *
 * 背景：`open_websearch` MCP 的 `search` 工具默认已被收口（见
 * `builtin-mcps.ts` 的 `open_websearch` 分支），它独有的取正文 / README
 * 能力保留在 MCP 侧，但其免密钥引擎能力不能随之丢失 —— 因此把同一实现
 * 接到原生 `websearch` 的 provider 插槽。实现复用 `open-websearch` 包
 * （本包依赖），agent-core 只定义插槽，依赖方向保持 gateway → agent-core。
 *
 * 注册清单：
 *   - `baidu` / `sogou` / `startpage`：这些引擎没有公开 API，只能抓取。
 *   - `bing`：官方 API 需要 Key（agent-core 侧行为不变）；这里的注册项是
 *     **无 Key 时的回退实现**，由 `bingSearch` 在未配置 Key 时调用。
 */
import { registerWebSearchProvider, type WebSearchProviderExecutor } from '@openAwork/agent-core';
import { loadOpenWebSearchSearchService } from '../mcp/open-websearch-services.js';

/** 免密钥抓取引擎（与 `open_websearch` 的引擎集一致）。 */
type KeylessEngine = 'bing' | 'baidu' | 'sogou' | 'startpage';

function createSingleEngineExecutor(engine: KeylessEngine): WebSearchProviderExecutor {
  return async (query, config, _signal) => {
    const maxResults = config.maxResults ?? 5;
    const service = await loadOpenWebSearchSearchService();
    const response = await service.execute({
      engines: [engine],
      limit: maxResults,
      query,
      searchMode: 'request',
    });
    if (response.results.length === 0) {
      return `No results found for: ${query}`;
    }
    // 输出格式与 agent-core 的 formatResults 对齐（编号 / 摘要 / URL 三行），
    // 保证 merge 模式的结果解析（parseFormattedResults）对两个入口一视同仁。
    return response.results
      .slice(0, maxResults)
      .map(
        (item, index) =>
          `${index + 1}. ${item.title}\n   ${item.description ?? ''}\n   ${item.url}`,
      )
      .join('\n\n');
  };
}

let registered = false;

/** 幂等注册免密钥引擎；在 `tool-aliases` 模块加载时调用一次。 */
export function registerKeylessWebSearchProviders(): void {
  if (registered) return;
  registered = true;
  registerWebSearchProvider('bing', createSingleEngineExecutor('bing'));
  registerWebSearchProvider('baidu', createSingleEngineExecutor('baidu'));
  registerWebSearchProvider('sogou', createSingleEngineExecutor('sogou'));
  registerWebSearchProvider('startpage', createSingleEngineExecutor('startpage'));
}
