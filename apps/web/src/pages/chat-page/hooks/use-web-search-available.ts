/**
 * `useWebSearchAvailable` — 检测设置页中 Web 搜索插件的全局可用状态。
 *
 * 判定逻辑与 `plugins-tab-content.tsx` 中 `websearch` 插件的 `enabled` 字段一致：
 *   - 搜索 MCP 服务器列表中存在 enabled !== false 的条目，或
 *   - websearch policy 中配置了至少一个 provider
 *
 * 聊天输入框中的网络搜索开关会引用此状态：当全局不可用时隐藏按钮，
 * 避免用户开启了一个实际不生效的开关。
 */

import { useEffect, useState } from 'react';
import { createSettingsClient } from '@openAwork/web-client';

interface UseWebSearchAvailableInput {
  gatewayUrl: string;
  token: string | null;
}

interface UseWebSearchAvailableResult {
  /** 全局 Web 搜索是否可用 */
  webSearchAvailable: boolean;
  /** 是否已完成首次加载 */
  loaded: boolean;
}

const SEARCH_MANAGED_MCP_IDS = new Set(['open_websearch', 'websearch']);

type McpServersPayload = {
  builtinServers?: Array<{ id: string; enabled?: boolean }>;
  servers?: Array<{ id: string; enabled?: boolean }>;
};

type WebsearchPolicyPayload = {
  providers?: unknown[];
};

/**
 * MCP 里是否有「搜索托管」服务启用；列表加载失败时保守认为可用（不影响默认行为）。
 *
 * 必须留在模块级：try 内的展开 / `??` / `.some(...)` 都是值块，会让编译器报
 * "Support value blocks … within a try/catch statement" 并放弃优化整个 hook（实测）。
 */
async function hasEnabledSearchMcpOnce(
  client: ReturnType<typeof createSettingsClient>,
  token: string,
): Promise<boolean> {
  try {
    const mcpData = (await client.listMcpServers(token)) as McpServersPayload;
    const allServers = [...(mcpData.servers ?? []), ...(mcpData.builtinServers ?? [])];
    const searchServers = allServers.filter((server) => SEARCH_MANAGED_MCP_IDS.has(server.id));
    return searchServers.some((server) => server.enabled !== false);
  } catch {
    return true;
  }
}

/** 是否配置了 websearch provider；policy 加载失败时不改变判定（MCP 可用即可）。 */
async function hasWebsearchProviderOnce(
  client: ReturnType<typeof createSettingsClient>,
  token: string,
): Promise<boolean> {
  try {
    const policy = (await client.getWebsearch(token)) as WebsearchPolicyPayload;
    return Array.isArray(policy.providers) && policy.providers.length > 0;
  } catch {
    return false;
  }
}

export function useWebSearchAvailable(
  input: UseWebSearchAvailableInput,
): UseWebSearchAvailableResult {
  const { gatewayUrl, token } = input;
  const [webSearchAvailable, setWebSearchAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    const client = createSettingsClient(gatewayUrl);

    void (async () => {
      // 两处 try/catch 下沉到模块级助手（见其注释）。
      const hasEnabledMcp = await hasEnabledSearchMcpOnce(client, token);
      const hasProvider = await hasWebsearchProviderOnce(client, token);

      if (!cancelled) {
        setWebSearchAvailable(hasEnabledMcp || hasProvider);
        setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, token]);

  return { webSearchAvailable, loaded };
}
