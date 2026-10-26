import { useCallback } from 'react';

import { createSettingsClient } from '@openAwork/web-client';

import type { useChatUiState } from './use-chat-ui-state.js';

type SetMcpServers = ReturnType<typeof useChatUiState>['setMcpServers'];

type UseMcpServerRetryDeps = {
  readonly gatewayUrl: string;
  readonly setMcpServers: SetMcpServers;
  readonly token: string | null;
};

/**
 * 单个 MCP server 的重连：先置 pending 反馈，再按网关返回的终态就地更新卡片。
 *
 * 从 `ChatPage` 下沉，行为与依赖数组逐字保留。
 */
export function useMcpServerRetry(deps: UseMcpServerRetryDeps) {
  const { gatewayUrl, setMcpServers, token } = deps;

  return useCallback(
    (serverId: string) => {
      if (!token) return;
      setMcpServers((prev) =>
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
          setMcpServers((prev) =>
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
          setMcpServers((prev) =>
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
    [gatewayUrl, setMcpServers, token],
  );
}
