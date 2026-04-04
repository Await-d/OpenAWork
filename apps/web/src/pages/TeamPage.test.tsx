// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/auth.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });

  fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://localhost:3000');
    const method = init?.method ?? 'GET';

    if (url.pathname.endsWith('/team/members') && method === 'GET') {
      return {
        ok: true,
        json: async () => [
          {
            id: 'member-1',
            name: '林雾',
            email: 'linwu@openawork.local',
            role: 'owner',
            avatarUrl: null,
            status: 'working',
            createdAt: '2026-04-04T00:00:00.000Z',
          },
        ],
      } as Response;
    }

    if (url.pathname.endsWith('/team/tasks') && method === 'GET') {
      return {
        ok: true,
        json: async () => [
          {
            id: 'task-1',
            title: '落地团队协作台',
            assigneeId: 'member-1',
            status: 'in_progress',
            priority: 'high',
            result: '正在推进',
            createdAt: '2026-04-04T00:00:00.000Z',
            updatedAt: '2026-04-04T00:00:00.000Z',
          },
        ],
      } as Response;
    }

    if (url.pathname.endsWith('/team/messages') && method === 'GET') {
      return {
        ok: true,
        json: async () => [
          {
            id: 'msg-1',
            memberId: 'member-1',
            content: '我先认领协作页面。',
            type: 'update',
            timestamp: Date.parse('2026-04-04T00:00:00.000Z'),
          },
        ],
      } as Response;
    }

    if (url.pathname.endsWith('/team/tasks') && method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          id: 'task-2',
          title: '新增任务',
          assigneeId: null,
          status: 'pending',
          priority: 'medium',
          result: null,
        }),
      } as Response;
    }

    if (url.pathname.endsWith('/team/messages') && method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          id: 'msg-2',
          memberId: 'member-1',
          content: '已同步',
          type: 'update',
          timestamp: Date.now(),
        }),
      } as Response;
    }

    if (url.pathname.endsWith('/team/members') && method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          id: 'member-2',
          name: '新成员',
          email: 'new@openawork.local',
          role: 'member',
          avatarUrl: null,
          status: 'idle',
        }),
      } as Response;
    }

    if (url.pathname.includes('/team/tasks/') && method === 'PATCH') {
      return {
        ok: true,
        json: async () => ({ ok: true }),
      } as Response;
    }

    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });

  vi.stubGlobal('fetch', fetchMock);

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderPage() {
  const { default: TeamPage } = await import('./TeamPage.js');
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/team']}>
        <TeamPage />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TeamPage', () => {
  it('renders members, tasks, and messages from the collaboration endpoints', async () => {
    await renderPage();

    expect(container?.textContent).toContain('团队协作');
    expect(container?.textContent).toContain('林雾');
    expect(container?.textContent).toContain('落地团队协作台');
    expect(container?.textContent).toContain('我先认领协作页面。');
  });

  it('creates a new team task from the composer', async () => {
    await renderPage();

    const titleInput = container?.querySelector(
      'input[name="team-task-title"]',
    ) as HTMLInputElement | null;
    const submitButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('新增任务'),
    );
    expect(titleInput).toBeTruthy();
    expect(submitButton).toBeTruthy();

    await act(async () => {
      if (titleInput) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(titleInput, '新增任务');
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/team/tasks',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
