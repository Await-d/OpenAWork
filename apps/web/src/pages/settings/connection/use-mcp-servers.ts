/**
 * MCP 服务器管理 Hook——从网关加载/保存 MCP 服务器配置，并管理运行状态与重试。
 * 从 SettingsPage 提取，供 Plugins 页面独立使用。
 */

import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { MCPServerEntry, MCPServerStatus } from '@openAwork/shared-ui';
import { createSettingsClient } from '@openAwork/web-client';

interface UseMcpServersArgs {
  gatewayUrl: string;
  token: string | null;
  /** 是否激活当前 tab，控制是否加载数据 */
  active: boolean;
}

interface UseMcpServersResult {
  mcpServers: MCPServerEntry[];
  setMcpServers: Dispatch<SetStateAction<MCPServerEntry[]>>;
  mcpStatuses: MCPServerStatus[];
  onRetryMcp: (serverId: string) => void;
}

export function useMcpServers({
  gatewayUrl,
  token,
  active,
}: UseMcpServersArgs): UseMcpServersResult {
  const [mcpServers, setMcpServersState] = useState<MCPServerEntry[]>([]);
  const [mcpStatuses, setMcpStatuses] = useState<MCPServerStatus[]>([]);

  useEffect(() => {
    if (!token || !active) return;
    const client = createSettingsClient(gatewayUrl);
    void client
      .listMcpServers(token)
      .then((data) => setMcpServersState((data as { servers?: MCPServerEntry[] }).servers ?? []))
      .catch(() => undefined);
    void client
      .getMcpStatus(token)
      .then((d) => {
        const typed = d as {
          servers: Array<{
            id: string;
            name: string;
            type?: string;
            status?: string;
            builtin?: boolean;
          }>;
        };
        setMcpStatuses(
          (typed.servers ?? []).map((server) => ({
            id: server.id,
            name: server.name,
            status:
              server.status === 'connected' ||
              server.status === 'connecting' ||
              server.status === 'error'
                ? server.status
                : 'disconnected',
            toolCount: 0,
            authType: server.type,
            builtin: server.builtin === true,
          })),
        );
      })
      .catch(() => undefined);
  }, [gatewayUrl, token, active]);

  const setMcpServers = useCallback(
    (updater: SetStateAction<MCPServerEntry[]>) => {
      setMcpServersState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (token) {
          void createSettingsClient(gatewayUrl).putMcpServers(token, { servers: next });
        }
        return next;
      });
    },
    [token, gatewayUrl],
  );

  const onRetryMcp = useCallback(
    (serverId: string) => {
      if (!token) return;
      setMcpStatuses((prev) =>
        prev.map((server) =>
          server.id === serverId
            ? { ...server, retryFeedback: { kind: 'pending' as const } }
            : server,
        ),
      );

      void (async () => {
        try {
          const data = (await createSettingsClient(gatewayUrl).retryMcpServer(token, serverId)) as {
            status: 'connected' | 'error' | 'disabled';
            toolCount: number;
            durationMs: number;
            error?: string;
          };
          setMcpStatuses((prev) =>
            prev.map((server) => {
              if (server.id !== serverId) return server;
              if (data.status === 'connected') {
                return {
                  ...server,
                  status: 'connected' as const,
                  toolCount: data.toolCount,
                  retryFeedback: {
                    kind: 'ok' as const,
                    toolCount: data.toolCount,
                    durationMs: data.durationMs,
                  },
                };
              }
              if (data.status === 'error') {
                return {
                  ...server,
                  status: 'error' as const,
                  retryFeedback: {
                    kind: 'fail' as const,
                    error: data.error ?? '未知错误',
                  },
                };
              }
              return {
                ...server,
                status: 'disconnected' as const,
                retryFeedback: undefined,
              };
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setMcpStatuses((prev) =>
            prev.map((server) =>
              server.id === serverId
                ? {
                    ...server,
                    status: 'error' as const,
                    retryFeedback: { kind: 'fail' as const, error: message },
                  }
                : server,
            ),
          );
        }
      })();
    },
    [token, gatewayUrl],
  );

  return { mcpServers, setMcpServers, mcpStatuses, onRetryMcp };
}
