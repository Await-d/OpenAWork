// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceGitBadge } from './SidebarHelpers.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('WorkspaceGitBadge', () => {
  it('读取失败时保留旧改动数并展示错误徽记', async () => {
    let requestCount = 0;
    globalThis.fetch = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return {
          ok: true,
          json: async () => ({ changes: [{ path: '/a' }, { path: '/b' }] }),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'review status unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const { rerender } = render(
      <WorkspaceGitBadge
        workspacePath="/workspace/demo"
        gatewayUrl="http://localhost:3000"
        accessToken="token-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('2')).toBeTruthy();
    });

    rerender(
      <WorkspaceGitBadge
        workspacePath="/workspace/demo"
        gatewayUrl="http://localhost:3001"
        accessToken="token-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('! 2')).toBeTruthy();
    });
  });
});
