import { useEffect, useRef, useState } from 'react';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useUIStateStore, useWorkspaceReadIdentity } from '../../../stores/ui/uiState.js';
import type { WorkspaceReadIdentity } from '../../../stores/ui/uiState.js';
import {
  getFilePreviewKind,
  isNonTextPreviewKind,
  WORKSPACE_INDEX_CHANGED_EVENT,
} from '../../../utils/file/file-preview.js';
import { describeFileReadError } from '../../../utils/file/file-too-large.js';
import {
  buildPreviewReadAttempts,
  runWithReadIdentityFallback,
} from '../../../utils/file/preview-read-identity.js';
import { extractSnippet, type FileSnippet } from './extract-snippet.js';
import { resolveBareFilename } from './resolve-bare-filename.js';

/**
 * Cache & inflight registry used by `useFilePreview` so hovering the
 * same path repeatedly inside one session only fetches once. The
 * cache is intentionally process-wide (not per-component) — file
 * contents at this granularity rarely change inside a single chat
 * exchange and saving a few hundred ms on re-hover matters more.
 *
 * TTL bounds staleness when the file is edited out-of-band (e.g. the
 * Agent writes it mid-session). It used to be 60s, which meant a
 * hover right after a write kept showing the pre-write content; 15s
 * keeps the re-hover win while shrinking the stale window.
 */
const CACHE_TTL_MS = 15_000;

/**
 * 缓存条目上限。此前两个进程级 Map 只在读取时判 TTL、从不淘汰，长会话内
 * 每项都持有一份完整文件文本，内存无界增长。
 */
const MAX_CACHE_ENTRIES = 200;

const cache = new Map<string, { content: string; ts: number }>();
const inflight = new Map<string, Promise<string>>();

/** 淘汰过期条目，并在超出上限时按插入序丢弃最旧的一条（Map 保持插入序）。 */
function pruneCache(): void {
  const now = Date.now();
  for (const [key, entry] of [...cache]) {
    if (now - entry.ts >= CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** 清空全部内容缓存。用于工作区索引版本变化时（Agent 写盘后）立即失效。 */
function clearAllFilePreviewCache(): void {
  cache.clear();
  inflight.clear();
}

/**
 * 缓存键带身份命名空间：本地与远端工作区可能给出同形路径
 * （如 `/home/x/a.ts`），不隔离会读到另一侧的内容。
 */
function previewCacheKey(identity: WorkspaceReadIdentity, path: string): string {
  const identityKey = identity.sessionId ?? identity.sshConnectionId ?? 'local';
  return `${identityKey}::${path}`;
}

/** Drop a path from the cache across every identity namespace (used when an edit is observed). */
export function invalidateFilePreviewCache(path: string): void {
  for (const key of [...cache.keys()]) {
    if (key.endsWith(`::${path}`)) {
      cache.delete(key);
    }
  }
}

/**
 * 让工作区索引变化（Agent 写盘 / 用户在编辑器里保存）能立即失效预览缓存。
 *
 * 此前 `invalidateFilePreviewCache` 全仓只被测试调用，生产环境没有任何路径会
 * 清缓存，只能等 TTL 到期。这里挂在窗口自定义事件上，由工作区索引轮询在检测
 * 到版本变化时派发。
 */
function useWorkspaceIndexInvalidation(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      clearAllFilePreviewCache();
    };
    window.addEventListener(WORKSPACE_INDEX_CHANGED_EVENT, handler);
    return () => {
      window.removeEventListener(WORKSPACE_INDEX_CHANGED_EVENT, handler);
    };
  }, []);
}

async function fetchFileContent(
  gatewayUrl: string,
  token: string,
  path: string,
  workspaceRoot: string | null,
  identity: WorkspaceReadIdentity,
): Promise<string> {
  const key = previewCacheKey(identity, path);
  pruneCache();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.content;
  }
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const attempts = buildPreviewReadAttempts(workspaceRoot, identity);
      const data = await runWithReadIdentityFallback(attempts, (options) =>
        createWorkspaceClient(gatewayUrl).readFile(token, path, options),
      );
      cache.set(key, { content: data.content, ts: Date.now() });
      pruneCache();
      return data.content;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
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
  const identity = useWorkspaceReadIdentity();
  const [state, setState] = useState<FilePreviewState>({ status: 'loading' });
  const [retryTick, setRetryTick] = useState(0);
  const lastSuccessfulSnippetsRef = useRef<Map<string, FileSnippet>>(new Map());
  const currentResolvedPathRef = useRef<string>(path);

  useWorkspaceIndexInvalidation();

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
          identity,
        });
        // 记住**解析后**的路径：失败兜底要按同一个键取历史片段。此前 ref 里存的是
        // 原始裸文件名，与成功分支写入的 resolvedPath 不同键，裸文件名场景下
        // 兜底内容永远取不到。
        currentResolvedPathRef.current = resolvedPath;
        // Binary file kinds (Office docs, PDFs, archives) — surface
        // a "binary, no text preview" message instead of fetching
        // the bytes and feeding mojibake to extractSnippet.
        const previewKind = getFilePreviewKind(resolvedPath);
        if (isNonTextPreviewKind(previewKind)) {
          if (cancelled) return;
          setState({
            status: 'error',
            error: '该文件为非文本内容，无法以文本方式预览',
            staleSnippet: lastSuccessfulSnippetsRef.current.get(resolvedPath),
          });
          return;
        }
        const content = await fetchFileContent(
          gatewayUrl,
          token,
          resolvedPath,
          workspaceRoot,
          identity,
        );
        if (cancelled) return;
        const snippet = extractSnippet(content, line);
        lastSuccessfulSnippetsRef.current.set(resolvedPath, snippet);
        setState({
          status: 'ready',
          snippet,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          // 超过 10MB 时网关回 413，统一成明确的中文提示。
          error: describeFileReadError(err, '加载失败'),
          staleSnippet: lastSuccessfulSnippetsRef.current.get(currentResolvedPathRef.current),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path, line, token, gatewayUrl, workspaceRoot, identity, retryTick]);

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
