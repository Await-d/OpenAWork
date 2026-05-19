/**
 * Office document preview — currently supports:
 *   - DOCX → mammoth.js → HTML in a sandboxed div
 *   - XLSX/XLS → SheetJS → HTML <table> per sheet, switchable
 *   - PPTX / PDF / DOC → "not yet supported" notice (with download
 *     guidance). PPTX has no good pure-JS renderer; PDF needs
 *     pdfjs-dist which is heavy; DOC (legacy binary) is unsupported
 *     by mammoth.
 *
 * The component fetches the file via `/workspace/file/binary` (raw
 * bytes) and lazy-loads the renderer libs so users not opening
 * Office docs don't pay the bundle tax.
 *
 * All rendering happens locally in the browser — bytes never leave
 * the workspace.
 */

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';

const DocxPreview = lazy(() => import('./DocxPreview.js'));
const XlsxPreview = lazy(() => import('./XlsxPreview.js'));

type OfficeKind = 'docx' | 'xlsx' | 'doc' | 'xls' | 'pptx' | 'pdf';

function getOfficeKindFromPath(path: string): OfficeKind | null {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'docx':
      return 'docx';
    case 'xlsx':
      return 'xlsx';
    case 'pptx':
      return 'pptx';
    case 'pdf':
      return 'pdf';
    case 'doc':
      return 'doc';
    case 'xls':
      return 'xls';
    default:
      return null;
  }
}

interface OfficePreviewState {
  status: 'loading' | 'ready' | 'error';
  buffer?: ArrayBuffer;
  contentType?: string;
  error?: string;
}

function useOfficeFile(path: string): OfficePreviewState {
  const [state, setState] = useState<OfficePreviewState>({ status: 'loading' });
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const selectedRoot = useUIStateStore((s) => s.selectedWorkspacePath);
  const treeRoot = useUIStateStore((s) => s.fileTreeRootPath);
  const workspaceRoot = selectedRoot ?? treeRoot ?? null;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    if (!token) {
      setState({ status: 'error', error: '未登录' });
      return;
    }
    void (async () => {
      try {
        const options: { workspaceRoot?: string } = {};
        if (workspaceRoot) options.workspaceRoot = workspaceRoot;
        const data = await createWorkspaceClient(gatewayUrl).readFileBinary(token, path, options);
        if (cancelled) return;
        setState({ status: 'ready', buffer: data.buffer, contentType: data.contentType });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : '加载失败',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, token, gatewayUrl, workspaceRoot]);

  return state;
}

function UnsupportedKindNotice({ kind, path }: { kind: OfficeKind; path: string }) {
  const filename = path.split('/').pop() ?? path;
  const tip = useMemo(() => {
    switch (kind) {
      case 'pptx':
        return 'PowerPoint 演示文稿暂不支持在线渲染。请下载后用 PowerPoint / WPS / Keynote 打开。';
      case 'pdf':
        return 'PDF 在线预览正在规划中。请下载后用 PDF 阅读器打开。';
      case 'doc':
        return '旧版 .doc 二进制格式无法在浏览器中渲染。请用 Office 转换为 .docx 后再预览。';
      case 'xls':
        return '旧版 .xls 二进制格式不支持在线预览。请保存为 .xlsx 后再预览。';
      default:
        return '该文件类型暂不支持在线预览。';
    }
  }, [kind]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 32,
        background: 'var(--bg-overlay)',
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: 'color-mix(in oklch, var(--accent) 14%, var(--bg-overlay))',
          color: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
        }}
      >
        📄
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
        {kind.toUpperCase()} 文件
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--fg-muted)',
          fontFamily: 'var(--font-mono, monospace)',
          maxWidth: 420,
          wordBreak: 'break-all',
        }}
      >
        {filename}
      </div>
      <div style={{ maxWidth: 420, fontSize: 12, color: 'var(--fg-default)', lineHeight: 1.6 }}>
        {tip}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--fg-muted)',
        fontSize: 12,
      }}
    >
      加载预览…
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--danger)',
        fontSize: 12,
        padding: 24,
        textAlign: 'center',
      }}
    >
      预览加载失败:{error}
    </div>
  );
}

export function OfficePreview({ path }: { path: string }) {
  const kind = getOfficeKindFromPath(path);
  const fileState = useOfficeFile(path);

  if (!kind) return null;

  // Kinds we don't render in-browser get the notice immediately —
  // no need to fetch bytes for those.
  if (kind === 'pptx' || kind === 'pdf' || kind === 'doc' || kind === 'xls') {
    return <UnsupportedKindNotice kind={kind} path={path} />;
  }

  if (fileState.status === 'loading') return <LoadingState />;
  if (fileState.status === 'error') return <ErrorState error={fileState.error ?? '未知错误'} />;
  if (!fileState.buffer) return <ErrorState error="文件内容为空" />;

  if (kind === 'docx') {
    return (
      <Suspense fallback={<LoadingState />}>
        <DocxPreview buffer={fileState.buffer} />
      </Suspense>
    );
  }
  if (kind === 'xlsx') {
    return (
      <Suspense fallback={<LoadingState />}>
        <XlsxPreview buffer={fileState.buffer} />
      </Suspense>
    );
  }
  return null;
}
