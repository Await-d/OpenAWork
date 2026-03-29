// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamPage from './TeamPage.js';
import { useAuthStore } from '../stores/auth.js';

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const rawUrl =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(rawUrl, 'http://localhost:3000');

  if (url.pathname.endsWith('/team/members')) {
    return {
      ok: true,
      json: async () => [
        { id: 'member-1', name: 'Alice', email: 'a@example.com', role: 'member', status: 'idle' },
      ],
    } as Response;
  }
  if (url.pathname.endsWith('/team/tasks')) {
    return {
      ok: true,
      json: async () => [
        { id: 'task-1', title: '实现协同状态流', assignedTo: 'member-1', status: 'in_progress' },
      ],
    } as Response;
  }
  if (url.pathname.endsWith('/team/messages') && (!init?.method || init.method === 'GET')) {
    return {
      ok: true,
      json: async () => [
        {
          id: 'msg-1',
          memberId: 'member-1',
          content: '任务已认领',
          type: 'update',
          timestamp: Date.now(),
        },
      ],
    } as Response;
  }
  if (url.pathname.endsWith('/team/messages') && init?.method === 'POST') {
    return {
      ok: true,
      json: async () => ({
        id: 'msg-2',
        memberId: 'member-1',
        content: '我来认领这个任务',
        type: 'question',
        timestamp: Date.now(),
      }),
    } as Response;
  }

  throw new Error(`Unhandled fetch: ${url.pathname}`);
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', fetchMock);
  useAuthStore.setState({
    accessToken: 'token-123',
    refreshToken: null,
    tokenExpiresAt: Date.now() + 60000,
    email: 'admin@openAwork.local',
    gatewayUrl: 'http://localhost:3000',
    webAccessEnabled: false,
    webPort: 3000,
  });
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  vi.unstubAllGlobals();
});

describe('TeamPage collaboration slice', () => {
  it('shows collaboration state and allows sending a typed message', async () => {
    await act(async () => {
      root!.render(<TeamPage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const rendered = container!;
    expect(rendered.textContent).toContain('任务已认领');
    expect(rendered.textContent).toContain('实现协同状态流');

    const textarea = rendered.querySelector('textarea');
    expect(textarea).not.toBeNull();
  });
});
