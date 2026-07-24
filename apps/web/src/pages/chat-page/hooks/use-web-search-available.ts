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
      let hasEnabledMcp = false;
      let hasProvider = false;

      try {
        const mcpData = (await client.listMcpServers(token)) as McpServersPayload;
        const allServers = [
          ...(mcpData.servers ?? []),
          ...(mcpData.builtinServers ?? []),
        ];
        const searchServers = allServers.filter((server) =>
          SEARCH_MANAGED_MCP_IDS.has(server.id),
        );
        hasEnabledMcp = searchServers.some((server) => server.enabled !== false);
      } catch {
        // 如果 MCP 列表加载失败，保守地认为可用（不影响默认行为）
        hasEnabledMcp = true;
      }

      try {
        const policy = (await client.getWebsearch(token)) as WebsearchPolicyPayload;
        hasProvider = Array.isArray(policy.providers) && policy.providers.length > 0;
      } catch {
        // policy 加载失败不影响判定——MCP 可用即可
      }

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
