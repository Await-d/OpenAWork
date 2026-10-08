import { useEffect, useRef } from 'react';
import { createSettingsClient } from '@openAwork/web-client';
import type { MCPServerStatus } from '@openAwork/shared-ui';
import type {
  WorkspaceFileMentionItem,
  WorkspaceTreeNode,
} from '../../../../components/conversation-runtime/messages/support.js';
import { flattenWorkspaceFiles } from '../../../../components/conversation-runtime/messages/support.js';

interface WorkspaceLike {
  fetchTree: (path: string, depth: number) => Promise<unknown>;
}

export interface ChatDataLoadersDeps {
  currentSessionId: string | null;
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

/**
 * 工作目录为空时的宽限期：切换会话中转的 null 会在工作区解析落定后自动
 * 撤销，只有超过该窗口仍为 null 才认定为「确实没有工作区」。
 */
const WORKSPACE_TREE_NULL_GRACE_MS = 1500;

export function useChatDataLoaders(deps: ChatDataLoadersDeps): void {
  const {
    currentSessionId,
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

  /** 手上已经取到的树：目录 + 取它时的树版本。null 表示手上没有有效树。 */
  const fetchedTreeRef = useRef<{ path: string; version: number } | null>(null);

  // `workspace.fetchTree` 的引用随 `sessionId` 变化（它把 sessionId 作为身份
  // 映射参数传给网关），若直接进依赖数组，每切一次会话都会重打一遍文件树。
  // `setWorkspaceFileItems` 同理：引用一旦不稳定，effect 重跑会连带取消下面
  // 的空路径宽限定时器。两者都走 ref 拿最新实现，effect 只依赖语义量。
  const fetchTreeRef = useRef(workspace.fetchTree);
  const setWorkspaceFileItemsRef = useRef(setWorkspaceFileItems);
  useEffect(() => {
    fetchTreeRef.current = workspace.fetchTree;
    setWorkspaceFileItemsRef.current = setWorkspaceFileItems;
  }, [setWorkspaceFileItems, workspace.fetchTree]);

  useEffect(() => {
    let cancelled = false;
    void workspaceTreeVersion;
    // 仅用于让「切换会话」重新评估下面的空路径宽限逻辑，不参与判断。
    void currentSessionId;

    const path = effectiveWorkingDirectory;

    if (!path) {
      // 切换会话中转：工作区要等 `GET /sessions/:id` 回来才落定，期间
      // effectiveWorkingDirectory 会短暂为 null（见 useWorkspace 的
      // `resolvedWorkingDirectory` —— 切到别的会话时立刻回落 null 以避免身份
      // 串味）。此路径若跟着清空，左栏文件树会闪一下空列表；因此只要手上已经
      // 有过一棵树，就保留它，等宽限期过后仍为 null 才认定为「无工作区会话」。
      if (fetchedTreeRef.current === null) {
        setWorkspaceFileItemsRef.current([]);
        return;
      }

      const handle = window.setTimeout(() => {
        if (cancelled) {
          return;
        }
        fetchedTreeRef.current = null;
        setWorkspaceFileItemsRef.current([]);
      }, WORKSPACE_TREE_NULL_GRACE_MS);

      return () => {
        cancelled = true;
        window.clearTimeout(handle);
      };
    }

    // 目录与树版本都没变 → 手上这棵树仍然有效，不重取。
    // 这是同工作区切会话省下 /workspace/tree 的关键。
    const fetched = fetchedTreeRef.current;
    if (fetched !== null && fetched.path === path && fetched.version === workspaceTreeVersion) {
      return;
    }

    void (async () => {
      try {
        const nodes = (await fetchTreeRef.current(path, 2)) as WorkspaceTreeNode[];
        const files = flattenWorkspaceFiles(nodes, path);

        if (!cancelled) {
          fetchedTreeRef.current = { path, version: workspaceTreeVersion };
          setWorkspaceFileItemsRef.current(files);
        }
      } catch {
        if (!cancelled) {
          // 失败不写入 ref：保留重试能力。
          fetchedTreeRef.current = null;
          setWorkspaceFileItemsRef.current([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentSessionId, effectiveWorkingDirectory, workspaceTreeVersion]);

  useEffect(() => {
    if (!token || !rightOpen || rightTab !== 'mcp') return;
    let cancelled = false;
    void createSettingsClient(gatewayUrl)
      .getMcpStatus(token, { includeTools: true })
      .then((rawData) => {
        const data = rawData as {
          servers?: Array<{
            id: string;
            name: string;
            type?: string;
            status?: string;
            enabled?: boolean;
            builtin?: boolean;
            error?: string;
            disabledTools?: string[];
            tools?: Array<{ description?: string; name: string }>;
          }>;
        };
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
              toolCount: server.tools?.length ?? 0,
              authType: server.type,
              builtin: server.builtin === true,
              disabledTools: server.disabledTools ?? [],
              error: server.error,
              tools: server.tools ?? [],
            })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setMcpServers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rightOpen, rightTab, token, gatewayUrl, setMcpServers]);
}
