import { useEffect, useRef, useState } from 'react';
import { createWorkspaceClient, HttpError } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useWorkspaceReadIdentity } from '../../../stores/ui/uiState.js';
import { exportFile, getFileExportLabel } from '../../../utils/export-file.js';
import {
  buildPreviewReadAttempts,
  runWithReadIdentityFallback,
} from '../../../utils/file/preview-read-identity.js';
import { toast } from '../../common/feedback/ToastNotification.js';

export function WorkspaceFileExportButton({
  path,
  workspaceRoot,
}: {
  path: string;
  workspaceRoot: string;
}) {
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const token = useAuthStore((state) => state.accessToken);
  const identity = useWorkspaceReadIdentity();
  const request = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState(false);
  const label = getFileExportLabel();

  useEffect(() => {
    return () => request.current?.abort();
  }, [gatewayUrl, token, path, workspaceRoot, identity]);

  const handleExport = () => {
    if (!token || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setExporting(true);
    const client = createWorkspaceClient(gatewayUrl);
    const attempts = buildPreviewReadAttempts(workspaceRoot, identity);
    void runWithReadIdentityFallback(attempts, (options) => {
      controller.signal.throwIfAborted();
      return client.readFileBinary(token, path, {
        ...options,
        signal: controller.signal,
      });
    })
      .then(({ buffer, contentType }) => {
        if (controller.signal.aborted) return;
        return exportFile({
          blob: new Blob([buffer], { type: contentType }),
          filename: path.split(/[/\\]/).pop() || 'openawork-export',
        });
      })
      .then((result) => {
        if (result?.kind === 'desktop' && !controller.signal.aborted) {
          toast(`已保存到 ${result.path}`, 'success');
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof HttpError && error.status === 413) {
          toast('文件超过 10 MiB，无法从文件编辑器导出。', 'error');
        } else {
          toast(error instanceof Error ? error.message : '导出失败，请重试', 'error');
        }
      })
      .finally(() => {
        request.current = null;
        setExporting(false);
      });
  };

  return (
    <button
      type="button"
      className="min-w-16 rounded-md px-2 py-1 text-xs whitespace-nowrap text-[var(--fg-default)] hover:bg-[var(--bg-base)] active:bg-[var(--bg-overlay)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50"
      title={`${label}工作区中已保存的文件`}
      onClick={handleExport}
      disabled={!token || exporting}
      aria-busy={exporting}
    >
      {exporting ? '导出中…' : label}
    </button>
  );
}
