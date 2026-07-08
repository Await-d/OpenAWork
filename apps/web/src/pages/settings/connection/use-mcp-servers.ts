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

  useEffect(() => {
    if (!token || !active) return;
    const client = createSettingsClient(gatewayUrl);
    void client
      .listMcpServers(token)
      .then((data) => {
        const payload = data as McpServersPayload;
        setBuiltinMcpServers(payload.builtinServers ?? []);
        setMcpServersState(mergeUserAndBuiltinServers(payload));
      })
      .catch(() => undefined);
    void client
      .getMcpStatus(token, { includeTools: true })
      .then((data) =>
        setMcpStatuses(((data as McpStatusPayload).servers ?? []).map(toMcpServerStatus)),
      )
      .catch(() => undefined);
  }, [gatewayUrl, token, active]);

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
          void createSettingsClient(gatewayUrl).putMcpServers(token, {
            servers: persistedServers,
          });
        }
        return next;
      });
    },
    [token, gatewayUrl, builtinMcpServers],
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
    [token, gatewayUrl],
  );

  return { mcpServers, setMcpServers, mcpStatuses, onRetryMcp };
}
