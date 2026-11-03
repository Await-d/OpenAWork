/**
 * Office document preview — currently supports:
 *   - DOCX → mammoth.js → HTML in a sandboxed div
 *   - XLSX/XLS → SheetJS → HTML <table> per sheet, switchable
 *   - PDF → pdfjs-dist → canvas（复用消息内 `PdfPreview`，按需加载）
 *   - PPTX / DOC → "not yet supported" notice (with download
 *     guidance). PPTX has no good pure-JS renderer; DOC (legacy binary)
 *     is unsupported by mammoth.
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
import { useUIStateStore, useWorkspaceReadIdentity } from '../../stores/ui/uiState.js';
import { describeFileReadError } from '../../utils/file/file-too-large.js';
import {
  buildPreviewReadAttempts,
  runWithReadIdentityFallback,
} from '../../utils/file/preview-read-identity.js';
import { PdfPreview } from '../chat/media/pdf-preview.js';

const DocxPreview = lazy(() => import('./DocxPreview.js'));
const XlsxPreview = lazy(() => import('./XlsxPreview.js'));

type OfficeKind = 'docx' | 'xlsx' | 'doc' | 'xls' | 'ppt' | 'pptx' | 'pdf';

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
    // 旧版 .ppt 必须显式列出：`getFilePreviewKind` 把 ppt 归为 binary-office
    // 并交给本组件，早期这里没有对应 case 走到 `return null`，预览面板会渲染
    // 成空白（连提示都没有），比给出「请另存为 .pptx」更糟。
    case 'ppt':
      return 'ppt';
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

function useOfficeFile(path: string, enabled: boolean): OfficePreviewState {
  const [state, setState] = useState<OfficePreviewState>({ status: 'loading' });
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const selectedRoot = useUIStateStore((s) => s.selectedWorkspacePath);
  const treeRoot = useUIStateStore((s) => s.fileTreeRootPath);
  const workspaceRoot = selectedRoot ?? treeRoot ?? null;
  const identity = useWorkspaceReadIdentity();

  useEffect(() => {
    // 不渲染的类型（pptx/doc/xls）根本不需要字节流；PDF 走 pdfjs 需要字节。
    // 旧实现的早退判断写在 hook 之后，注释与代码相反，每个这类文件都会白拉一次。
    if (!enabled) return;
    let cancelled = false;
    setState({ status: 'loading' });
    if (!token) {
      setState({ status: 'error', error: '未登录' });
      return;
    }
    void (async () => {
      try {
        const attempts = buildPreviewReadAttempts(workspaceRoot, identity);
        const data = await runWithReadIdentityFallback(attempts, (options) =>
          createWorkspaceClient(gatewayUrl).readFileBinary(token, path, options),
        );
        if (cancelled) return;
        setState({ status: 'ready', buffer: data.buffer, contentType: data.contentType });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          // 超过 10MB 时网关回 413，统一成明确的中文提示。
          error: describeFileReadError(err, '加载失败'),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, enabled, token, gatewayUrl, workspaceRoot, identity]);

  return state;
}

function UnsupportedKindNotice({ kind, path }: { kind: OfficeKind; path: string }) {
  const filename = path.split('/').pop() ?? path;
  const tip = useMemo(() => {
    switch (kind) {
      case 'pptx':
        return 'PowerPoint 演示文稿暂不支持在线渲染。请下载后用 PowerPoint / WPS / Keynote 打开。';
      case 'ppt':
        return '旧版 .ppt 二进制格式无法在浏览器中渲染。请用 Office 转换为 .pptx 后再预览。';
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

/**
 * PDF 渲染适配层：把已拉到的字节转成 object URL，交给消息内共用的
 * `PdfPreview`（pdfjs 按需加载的那一份，避免重复维护加载逻辑）。
 *
 * 字节非空但不一定是合法 PDF：`contentType` 交给 Blob，pdfjs 解析失败时
 * `PdfPreview` 自己会落到错误态，这里无需额外校验。卸载 / 换文件必须
 * `revokeObjectURL`，否则每打开一个 PDF 就泄漏一份常驻内存。
 */
function PdfPreviewRenderer({
  buffer,
  contentType,
  path,
}: {
  buffer: ArrayBuffer;
  contentType?: string;
  path: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(
      new Blob([buffer], { type: contentType ?? 'application/pdf' }),
    );
    setSrc(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [buffer, contentType]);

  const fileName = path.split('/').pop() ?? path;

  if (!src) return <LoadingState />;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg-overlay)' }}>
      <PdfPreview src={src} fileName={fileName} />
    </div>
  );
}

export function OfficePreview({ path }: { path: string }) {
  const kind = getOfficeKindFromPath(path);
  const renderable = kind === 'docx' || kind === 'xlsx' || kind === 'pdf';
  const fileState = useOfficeFile(path, renderable);

  if (!kind) return null;

  // 早退必须发生在请求之前：这些类型直接给提示，不下载字节。
  if (!renderable) {
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
  if (kind === 'pdf') {
    return (
      <PdfPreviewRenderer
        buffer={fileState.buffer}
        contentType={fileState.contentType}
        path={path}
      />
    );
  }
  return null;
}
