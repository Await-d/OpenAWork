/**
 * 260530-team-page · Wave 2 · useTeamFilePreview（F5 文件内联预览取数）
 *
 * 单击文件树节点 → 拉取文件内容用于内联预览。
 *
 * 复用 `@openAwork/web-client` 的 workspaceClient.readFile（与 useFileEditor
 * 同一路径），二进制类型不读取（避免 utf-8 解码乱码），交由
 * FilePreviewPane 的 binary notice 渲染。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { getFilePreviewKind, isBinaryPreviewKind } from '../../../../../utils/file/file-preview.js';

export interface TeamFilePreviewState {
  /** 当前预览的文件路径（null 表示无预览）。 */
  path: string | null;
  content: string;
  loading: boolean;
  error: string | null;
  /** 打开某文件的预览。 */
  preview: (path: string) => void;
  /** 关闭预览。 */
  close: () => void;
}

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024; // 2MB 文本上限，超过给提示

export function useTeamFilePreview(workspacePath?: string | null): TeamFilePreviewState {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const close = useCallback(() => {
    reqIdRef.current += 1;
    setPath(null);
    setContent('');
    setError(null);
    setLoading(false);
  }, []);

  const preview = useCallback(
    (target: string) => {
      const reqId = ++reqIdRef.current;
      setPath(target);
      setError(null);

      // 二进制类型：不拉取内容，FilePreviewPane 会渲染 binary notice。
      const kind = getFilePreviewKind(target);
      if (kind && isBinaryPreviewKind(kind)) {
        setContent('');
        setLoading(false);
        return;
      }

      if (!token || !gatewayUrl) {
        setError('未连接到网关，无法预览文件。');
        setLoading(false);
        return;
      }

      setLoading(true);
      const client = createWorkspaceClient(gatewayUrl);
      const readOptions: { workspaceRoot?: string } = {};
      if (workspacePath && workspacePath.trim().length > 0) {
        readOptions.workspaceRoot = workspacePath;
      }
      void client
        .readFile(token, target, readOptions)
        .then((data) => {
          if (reqIdRef.current !== reqId) return; // 被后续请求/关闭取代
          const text = data.content ?? '';
          if (text.length > MAX_PREVIEW_BYTES) {
            setContent(text.slice(0, MAX_PREVIEW_BYTES));
            setError('文件较大，仅预览前 2MB 内容。');
          } else {
            setContent(text);
          }
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (reqIdRef.current !== reqId) return;
          setError(err instanceof Error ? err.message : '读取文件失败。');
          setContent('');
          setLoading(false);
        });
    },
    [token, gatewayUrl, workspacePath],
  );

  // workspace 切换时清空预览，避免跨工作区串内容。
  useEffect(() => {
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  return { path, content, loading, error, preview, close };
}
