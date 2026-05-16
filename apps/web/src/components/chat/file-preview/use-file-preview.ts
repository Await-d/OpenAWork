import { useEffect, useState } from 'react';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth.js';
import { extractSnippet, type FileSnippet } from './extract-snippet.js';

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

async function fetchFileContent(gatewayUrl: string, token: string, path: string): Promise<string> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.content;
  }
  const existing = inflight.get(path);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const data = await createWorkspaceClient(gatewayUrl).readFile(token, path);
      cache.set(path, { content: data.content, ts: Date.now() });
      return data.content;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, promise);
  return promise;
}

export type FilePreviewState =
  | { status: 'loading' }
  | { status: 'ready'; snippet: FileSnippet }
  | { status: 'error'; error: string };

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
  const [state, setState] = useState<FilePreviewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    if (!token) {
      setState({ status: 'error', error: '未登录' });
      return;
    }

    void (async () => {
      try {
        const content = await fetchFileContent(gatewayUrl, token, path);
        if (cancelled) return;
        setState({
          status: 'ready',
          snippet: extractSnippet(content, line),
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : '加载失败';
        setState({ status: 'error', error: message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path, line, token, gatewayUrl]);

  return state;
}
