import { useEffect } from 'react';
import type { MCPServerStatus } from '@openAwork/shared-ui';
import type { WorkspaceFileMentionItem, WorkspaceTreeNode } from './support.js';
import { flattenWorkspaceFiles } from './support.js';

interface WorkspaceLike {
  fetchTree: (path: string, depth: number) => Promise<unknown>;
}

export interface ChatDataLoadersDeps {
  effectiveWorkingDirectory: string | null;
  workspace: WorkspaceLike;
  workspaceTreeVersion: number;
  setWorkspaceFileItems: (value: WorkspaceFileMentionItem[]) => void;
  token: string | null;
  gatewayUrl: string;
  rightOpen: boolean;
  rightTab: string;
  setMcpServers: (value: MCPServerStatus[]) => void;
}

export function useChatDataLoaders(deps: ChatDataLoadersDeps): void {
  const {
    effectiveWorkingDirectory,
    workspace,
    workspaceTreeVersion,
    setWorkspaceFileItems,
    token,
    gatewayUrl,
    rightOpen,
    rightTab,
    setMcpServers,
  } = deps;

  useEffect(() => {
    let cancelled = false;
    void workspaceTreeVersion;

    if (!effectiveWorkingDirectory) {
      setWorkspaceFileItems([]);
      return;
    }

    void (async () => {
      try {
        const nodes = (await workspace.fetchTree(
          effectiveWorkingDirectory,
          2,
        )) as WorkspaceTreeNode[];
        const files = flattenWorkspaceFiles(nodes, effectiveWorkingDirectory);

        if (!cancelled) {
          setWorkspaceFileItems(files);
        }
      } catch {
        if (!cancelled) {
          setWorkspaceFileItems([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveWorkingDirectory, workspace.fetchTree, workspaceTreeVersion, setWorkspaceFileItems]);

  useEffect(() => {
    if (!token || !rightOpen || rightTab !== 'mcp') return;
    let cancelled = false;
    void fetch(`${gatewayUrl}/settings/mcp-status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fail'))))
      .then(
        (data: {
          servers?: Array<{
            id: string;
            name: string;
            type?: string;
            status?: string;
            enabled?: boolean;
          }>;
        }) => {
          if (!cancelled) {
            setMcpServers(
              (data.servers ?? []).map((server) => ({
                id: server.id,
                name: server.name,
                status:
                  server.status === 'connected' ||
                  server.status === 'connecting' ||
                  server.status === 'error'
                    ? server.status
                    : server.enabled === false
                      ? 'disconnected'
                      : 'connecting',
                toolCount: 0,
                authType: server.type,
              })),
            );
          }
        },
      )
      .catch(() => {
        if (!cancelled) setMcpServers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rightOpen, rightTab, token, gatewayUrl, setMcpServers]);
}
