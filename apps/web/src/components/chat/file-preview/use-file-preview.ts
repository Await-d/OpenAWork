import { useEffect, useRef, useState } from 'react';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { getFilePreviewKind, isBinaryPreviewKind } from '../../../utils/file/file-preview.js';
import { extractSnippet, type FileSnippet } from './extract-snippet.js';
import { resolveBareFilename } from './resolve-bare-filename.js';

/**
 * Cache & inflight registry used by `useFilePreview` so hovering the
 * same path repeatedly inside one session only fetches once. The
 * cache is intentionally process-wide (not per-component) — file
 * contents at this granularity rarely change inside a single chat
 * exchange and saving a few hundred ms on re-hover matters more.
 *
 * TTL is short (60s) to bound staleness if the user edits the file
 * out-of-band; for a "what does this look like right now" preview
 * this is well within tolerance.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { content: string; ts: number }>();
const inflight = new Map<string, Promise<string>>();

/** Drop a path from the cache (used when an edit is observed). */
export function invalidateFilePreviewCache(path: string): void {
  cache.delete(path);
}

async function fetchFileContent(
  gatewayUrl: string,
  token: string,
  path: string,
  workspaceRoot: string | null,
): Promise<string> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.content;
  }
  const existing = inflight.get(path);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const readOptions: { workspaceRoot?: string } = {};
      if (workspaceRoot && workspaceRoot.trim().length > 0) {
        readOptions.workspaceRoot = workspaceRoot;
      }
      const data = await createWorkspaceClient(gatewayUrl).readFile(token, path, readOptions);
      cache.set(path, { content: data.content, ts: Date.now() });
      return data.content;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, promise);
  return promise;
}

/**
 * Read the active workspace root from the UI state store. Hook-shaped
 * so the popover can subscribe and re-resolve when the user switches
 * workspaces while a popover is open.
 */
function useActiveWorkspaceRoot(): string | null {
  // Prefer the explicit selection (sidebar workspace switch) over the
  // file-tree root (which is sometimes a sub-directory).
  const selected = useUIStateStore((s) => s.selectedWorkspacePath);
  const treeRoot = useUIStateStore((s) => s.fileTreeRootPath);
  return selected ?? treeRoot ?? null;
}

export type FilePreviewState =
  | { status: 'loading' }
  | { status: 'ready'; snippet: FileSnippet }
  | { status: 'error'; error: string; staleSnippet?: FileSnippet };

/**
 * React hook that fetches `path` and slices a snippet centred on
 * `line`. Re-renders the consumer once with `loading`, then once
 * with `ready` or `error`. Cancels its setState if the consumer
 * unmounts before the fetch resolves so we don't update detached
 * components when a hover popover closes mid-flight.
 *
 * The hook is only invoked when the popover is actually open, so
 * we never fetch for paths the user merely scrolled past.
 */
export function useFilePreview(path: string, line: number | null): FilePreviewState {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const workspaceRoot = useActiveWorkspaceRoot();
  const [state, setState] = useState<FilePreviewState>({ status: 'loading' });
  const [retryTick, setRetryTick] = useState(0);
  const lastSuccessfulSnippetsRef = useRef<Map<string, FileSnippet>>(new Map());
  const currentResolvedPathRef = useRef<string>(path);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    if (!token) {
      setState({ status: 'error', error: '未登录' });
      return;
    }

    void (async () => {
      try {
        currentResolvedPathRef.current = path;
        // Mirror the click-to-open flow: bare filenames need a search
        // resolution against the active workspace root before
        // `/workspace/file` is willing to read them.
        const client = createWorkspaceClient(gatewayUrl);
        const resolvedPath = await resolveBareFilename({
          client,
          token,
          workspaceRoot,
          rawPath: path,
        });
        // Binary file kinds (Office docs, PDFs, archives) — surface
        // a "binary, no text preview" message instead of fetching
        // the bytes and feeding mojibake to extractSnippet.
        const previewKind = getFilePreviewKind(resolvedPath);
        if (isBinaryPreviewKind(previewKind)) {
          if (cancelled) return;
          setState({
            status: 'error',
            error: '该文件为二进制内容,无法以文本方式预览',
            staleSnippet: lastSuccessfulSnippetsRef.current.get(resolvedPath),
          });
          return;
        }
        const content = await fetchFileContent(gatewayUrl, token, resolvedPath, workspaceRoot);
        if (cancelled) return;
        const snippet = extractSnippet(content, line);
        lastSuccessfulSnippetsRef.current.set(resolvedPath, snippet);
        setState({
          status: 'ready',
          snippet,
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : '加载失败';
        setState({
          status: 'error',
          error: message,
          staleSnippet: lastSuccessfulSnippetsRef.current.get(currentResolvedPathRef.current),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path, line, token, gatewayUrl, workspaceRoot, retryTick]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      if (state.status === 'error') {
        setRetryTick((current) => current + 1);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [state.status]);

  return state;
}
