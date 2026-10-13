/**
 * MCP 服务器管理 Hook——从网关加载/保存 MCP 服务器配置，并管理运行状态与重试。
 * 从 SettingsPage 提取，供 Plugins 页面独立使用。
 */

import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  toPersistedMcpServers,
  type MCPServerEntry,
  type MCPServerStatus,
} from '@openAwork/shared-ui';
import { createSettingsClient } from '@openAwork/web-client';
import { logger } from '../../../utils/log/logger.js';

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
  loadError: string | null;
}

type McpStatusPayload = {
  servers?: Array<{
    builtin?: boolean;
    disabledTools?: string[];
    enabled?: boolean;
    error?: string;
    id: string;
    name: string;
    status?: string;
    toolCount?: number;
    tools?: Array<{ description?: string; name: string }>;
    type?: string;
  }>;
};

type McpStatusServerPayload = NonNullable<McpStatusPayload['servers']>[number];

type McpServersPayload = {
  builtinServers?: MCPServerEntry[];
  servers?: MCPServerEntry[];
};

function toMcpServerStatus(server: McpStatusServerPayload): MCPServerStatus {
  const status =
    server.status === 'connected' ||
    server.status === 'connecting' ||
    server.status === 'error' ||
    server.status === 'disabled'
      ? server.status
      : 'disconnected';

  return {
    id: server.id,
    name: server.name,
    status,
    toolCount: server.toolCount ?? server.tools?.length ?? 0,
    authType: server.type,
    builtin: server.builtin === true,
    disabledTools: server.disabledTools ?? [],
    error: server.error,
    tools: server.tools ?? [],
  };
}

function mergeUserAndBuiltinServers(payload: McpServersPayload): MCPServerEntry[] {
  const builtinServers = payload.builtinServers ?? [];
  const userServers = payload.servers ?? [];
  const builtinIds = new Set(builtinServers.map((server) => server.id));
  const userIds = new Set(userServers.map((server) => server.id));
  return [
    ...userServers.map((server) => ({
      ...server,
      ...(builtinIds.has(server.id) ? { builtin: true } : {}),
      source: server.source === 'system' ? ('system' as const) : ('user' as const),
    })),
    ...builtinServers
      .filter((server) => !userIds.has(server.id))
      .map((server) => ({ ...server, builtin: true, source: 'builtin' as const })),
  ];
}

function serversForPersistence(servers: MCPServerEntry[]): MCPServerEntry[] {
  return toPersistedMcpServers(servers);
}

export function useMcpServers({
  gatewayUrl,
  token,
  active,
}: UseMcpServersArgs): UseMcpServersResult {
  const [mcpServers, setMcpServersState] = useState<MCPServerEntry[]>([]);
  const [mcpStatuses, setMcpStatuses] = useState<MCPServerStatus[]>([]);
  const [builtinMcpServers, setBuiltinMcpServers] = useState<MCPServerEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * 重拉运行状态（含工具明细）。`retryFeedback` 是纯前端字段，重拉后需要由
   * 调用方按需补回。
   */
  const fetchStatuses = useCallback(async (): Promise<MCPServerStatus[] | null> => {
    if (!token) return null;
    try {
      const data = (await createSettingsClient(gatewayUrl).getMcpStatus(token, {
        includeTools: true,
      })) as McpStatusPayload;
      return (data.servers ?? []).map(toMcpServerStatus);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '加载 MCP 服务失败');
      logger.error('failed to load mcp statuses', error);
      return null;
    }
  }, [gatewayUrl, token]);

  useEffect(() => {
    if (!token || !active) return;
    void createSettingsClient(gatewayUrl)
      .listMcpServers(token)
      .then((data) => {
        const payload = data as McpServersPayload;
        setBuiltinMcpServers(payload.builtinServers ?? []);
        setMcpServersState(mergeUserAndBuiltinServers(payload));
        setLoadError(null);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : '加载 MCP 服务失败');
        logger.error('failed to load mcp servers', error);
      });
    void fetchStatuses().then((statuses) => {
      if (statuses) setMcpStatuses(statuses);
    });
  }, [gatewayUrl, token, active, fetchStatuses]);

  const setMcpServers = useCallback(
    (updater: SetStateAction<MCPServerEntry[]>) => {
      setMcpServersState((prev) => {
        const rawNext = typeof updater === 'function' ? updater(prev) : updater;
        const persistedServers = serversForPersistence(rawNext);
        const next = mergeUserAndBuiltinServers({
          servers: persistedServers,
          builtinServers: builtinMcpServers,
        });
        if (token) {
          // 保存会改动 enabled / disabledTools，网关侧保存成功后即断掉旧连接。
          // PUT 完成后再拉一次目录，避免卡片计数与「管理工具」明细停留在
          // 保存前的快照，用户必须手动刷新页面才能对齐。
          void createSettingsClient(gatewayUrl)
            .putMcpServers(token, { servers: persistedServers })
            .then(() => fetchStatuses())
            .then((statuses) => {
              if (statuses) setMcpStatuses(statuses);
            })
            .catch((error: unknown) => {
              logger.error('failed to persist mcp servers', error);
            });
        }
        return next;
      });
    },
    [token, gatewayUrl, builtinMcpServers, fetchStatuses],
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
          if (data.status === 'connected') {
            // 重试成功只回填 toolCount 会让工具明细停留在旧快照——卡片显示
            // 「3 tools」而「管理工具」仍只有 2 行。重拉完整目录，让计数与
            // 明细来自同一次后端快照。
            const refreshed = await fetchStatuses();
            const retryFeedback = {
              kind: 'ok' as const,
              toolCount: data.toolCount,
              durationMs: data.durationMs,
            };
            setMcpStatuses((prev) => {
              if (refreshed) {
                return refreshed.map((server) =>
                  server.id === serverId ? { ...server, retryFeedback } : server,
                );
              }
              // 刷新没成功：退回本地回填，至少保住本次重试的结果。
              return prev.map((server) =>
                server.id === serverId
                  ? {
                      ...server,
                      status: 'connected' as const,
                      toolCount: data.toolCount,
                      retryFeedback,
                    }
                  : server,
              );
            });
            return;
          }
          setMcpStatuses((prev) =>
            prev.map((server) => {
              if (server.id !== serverId) return server;
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
                status: 'disabled' as const,
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
    [token, gatewayUrl, fetchStatuses],
  );

  return { mcpServers, setMcpServers, mcpStatuses, onRetryMcp, loadError };
}
