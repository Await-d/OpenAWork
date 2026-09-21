import { useEffect, useState } from 'react';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useUIStateStore, useWorkspaceReadIdentity } from '../../../../stores/ui/uiState.js';
import { loadPreviewContent } from '../../../../utils/file/load-preview-content.js';
import { useGenerateImageArtifact } from '../generate-image/use-artifact.js';
import type { ToolCallImageSource } from '../shared/tool-call-image-source.js';

export interface ToolCallImagePreviewState {
  imageSrc: string | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

type WorkspacePreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; src: string }
  | { status: 'error'; message: string };

/**
 * 把「工具调用的图片源」解析成可渲染的图片地址。
 *
 * - `inline` / `remote`：地址已在入参里，直接返回，不发请求；
 * - `workspace`：走 `loadPreviewContent` 读工作区文件（图片返回 objectURL，
 *   必须在依赖变化 / 卸载时 dispose，避免内存泄漏）；
 * - `artifact`：复用 `useGenerateImageArtifact`（generate_image 卡片的同一
 *   产物读取 hook），把它的状态字段映射成统一返回结构。
 */
export function useToolCallImagePreview(
  source: ToolCallImageSource | null,
): ToolCallImagePreviewState {
  // hooks 不能条件调用：非 artifact 源传 undefined，artifact hook 内部判空后
  // 不会发起任何请求（折叠态也因此不会触发网络访问）。
  const artifactId = source?.kind === 'artifact' ? source.artifactId : undefined;
  const artifact = useGenerateImageArtifact(artifactId);

  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const identity = useWorkspaceReadIdentity();
  const selectedWorkspacePath = useUIStateStore((s) => s.selectedWorkspacePath);
  const fileTreeRootPath = useUIStateStore((s) => s.fileTreeRootPath);
  const workspaceRoot = selectedWorkspacePath ?? fileTreeRootPath ?? null;

  const [workspaceState, setWorkspaceState] = useState<WorkspacePreviewState>({ status: 'idle' });
  const [retryNonce, setRetryNonce] = useState(0);

  const workspacePath = source?.kind === 'workspace' ? source.path : null;

  useEffect(() => {
    if (!workspacePath) {
      // 非工作区源：回到 idle，且不制造无意义的重渲染。
      setWorkspaceState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
      return;
    }
    // 未连接网关时给出可读中文错误，而不是让读取请求抛出 401。
    if (!token) {
      setWorkspaceState({ status: 'error', message: '未登录，无法读取工作区图片' });
      return;
    }
    if (!gatewayUrl) {
      setWorkspaceState({ status: 'error', message: '未配置网关地址，无法读取工作区图片' });
      return;
    }

    let cancelled = false;
    let dispose: (() => void) | null = null;
    setWorkspaceState({ status: 'loading' });

    void (async () => {
      try {
        const loaded = await loadPreviewContent({
          client: createWorkspaceClient(gatewayUrl),
          token,
          path: workspacePath,
          workspaceRoot,
          identity,
        });
        if (cancelled) {
          // 请求落地前依赖已切换 / 组件已卸载：立刻释放 objectURL。
          loaded.dispose();
          return;
        }
        dispose = loaded.dispose;
        setWorkspaceState({ status: 'ready', src: loaded.content });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setWorkspaceState({ status: 'error', message: message || '图片加载失败' });
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [workspacePath, token, gatewayUrl, workspaceRoot, identity, retryNonce]);

  const retry = () => setRetryNonce((n) => n + 1);

  if (source === null) {
    return { imageSrc: null, loading: false, error: null, retry };
  }

  if (source.kind === 'inline' || source.kind === 'remote') {
    return { imageSrc: source.src, loading: false, error: null, retry };
  }

  if (source.kind === 'artifact') {
    // 未登录时 artifact hook 不会发起请求也不会给错误，这里补一条可读提示，
    // 避免组件落到「无图、无 loading、无错误」的空白态。
    const authError = token ? null : '未登录，无法加载图片产物';
    return {
      imageSrc: artifact.imageSrc,
      loading: artifact.imageLoading,
      error: artifact.fetchError ?? authError,
      retry: artifact.retry,
    };
  }

  return {
    imageSrc: workspaceState.status === 'ready' ? workspaceState.src : null,
    loading: workspaceState.status === 'loading',
    error: workspaceState.status === 'error' ? workspaceState.message : null,
    retry,
  };
}
