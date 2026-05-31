// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import {
  __clearBareFilenameResolutionCacheForTest,
} from './resolve-bare-filename.js';
import { invalidateFilePreviewCache } from './use-file-preview.js';
import { useFilePreview } from './use-file-preview.js';

const GATEWAY_URL = 'https://gw.test';
const FILE_PATH = '/workspace/demo/src/index.ts';

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

async function flushAsyncWork(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  localStorage.clear();
  setNavigatorOnline(true);
  __clearBareFilenameResolutionCacheForTest();
  invalidateFilePreviewCache(FILE_PATH);
  useAuthStore.setState({
    accessToken: 'token-test',
    email: 'qa@example.com',
    gatewayUrl: GATEWAY_URL,
    refreshToken: null,
    tokenExpiresAt: null,
    webAccessEnabled: false,
    webExposeLan: false,
    webPort: 3000,
  });
  useUIStateStore.setState({
    ...useUIStateStore.getState(),
    selectedWorkspacePath: '/workspace/demo',
    fileTreeRootPath: '/workspace/demo',
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setNavigatorOnline(true);
  __clearBareFilenameResolutionCacheForTest();
});

describe('useFilePreview', () => {
  it('失败时保留旧 snippet，并在联网恢复后自动补拉', async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url.includes('/workspace/file?')) {
          requestCount += 1;
          if (requestCount === 2) {
            return new Response(JSON.stringify({ error: 'file unavailable' }), {
              status: 503,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response(
            JSON.stringify({ content: 'line1\nline2\nline3\nline4\nline5\nline6' }),
            {
            status: 200,
            headers: { 'content-type': 'application/json' },
            },
          );
        }
        if (url.includes('/workspace/find-by-name')) {
          return new Response(JSON.stringify({ results: [{ path: FILE_PATH }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result, rerender } = renderHook(
      ({ targetPath, line }: { targetPath: string; line: number | null }) =>
        useFilePreview(targetPath, line),
      {
        initialProps: { targetPath: FILE_PATH, line: 2 },
      },
    );

    await flushAsyncWork();
    expect(result.current.status).toBe('ready');

    invalidateFilePreviewCache(FILE_PATH);
    rerender({ targetPath: FILE_PATH, line: 4 });
    await flushAsyncWork();

    expect(result.current.status).toBe('error');
    if (result.current.status === 'error') {
      // 503 响应体携带 { error: 'file unavailable' }，会被 extractJsonErrorMessage
      // 提取为错误文案（优先于 HTTP 状态码兜底）。
      expect(result.current.error).toContain('file unavailable');
      expect(result.current.staleSnippet).toBeTruthy();
    }

    setNavigatorOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await flushAsyncWork();

    expect(result.current.status).toBe('ready');
    if (result.current.status === 'ready') {
      expect(result.current.snippet.highlightLine).toBe(4);
    }
  });
});
