// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/auth.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
let failNextShareCreate = false;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });
  failNextShareCreate = false;

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

    if (url.pathname.endsWith('/team/session-shares') && method === 'GET') {
      return {
        ok: true,
        json: async () => [
          {
            id: 'share-1',
            sessionId: 'session-1',
            sessionLabel: '设计讨论',
            workspacePath: '/repo/apps/web',
            memberId: 'member-1',
            memberName: '林雾',
            memberEmail: 'linwu@openawork.local',
            permission: 'comment',
            createdAt: '2026-04-04T00:00:00.000Z',
            updatedAt: '2026-04-04T01:00:00.000Z',
          },
        ],
      } as Response;
    }

    if (url.pathname.endsWith('/team/audit-logs') && method === 'GET') {
      return {
        ok: true,
        json: async () => [
          {
            id: 'audit-1',
            action: 'share_created',
            entityType: 'session_share',
            entityId: 'share-1',
            summary: '已将“设计讨论”共享给 林雾（comment）',
            detail: '会话：设计讨论；工作区：/repo/apps/web；成员：林雾；权限：comment',
            createdAt: '2026-04-04T02:00:00.000Z',
          },
        ],
      } as Response;
    }

    if (url.pathname.endsWith('/sessions') && method === 'GET') {
      return {
        ok: true,
        json: async () => ({
          sessions: [
            {
              id: 'session-1',
              title: '设计讨论',
              metadata_json: JSON.stringify({ workingDirectory: '/repo/apps/web' }),
            },
          ],
        }),
      } as Response;
    }

    if (url.pathname.endsWith('/sessions/shared-with-me') && method === 'GET') {
      return {
        ok: true,
        json: async () => ({
          sessions: [
            {
              sessionId: 'shared-session-1',
              title: '上线回顾',
              stateStatus: 'paused',
              workspacePath: '/repo/apps/api',
              sharedByEmail: 'owner@openawork.local',
              permission: 'comment',
              createdAt: '2026-04-04T03:00:00.000Z',
              updatedAt: '2026-04-04T03:30:00.000Z',
              shareCreatedAt: '2026-04-04T04:00:00.000Z',
              shareUpdatedAt: '2026-04-04T04:15:00.000Z',
            },
          ],
        }),
      } as Response;
    }

    if (url.pathname.endsWith('/sessions/shared-with-me/shared-session-1') && method === 'GET') {
      return {
        ok: true,
        json: async () => ({
          share: {
            sessionId: 'shared-session-1',
            title: '上线回顾',
            stateStatus: 'paused',
            workspacePath: '/repo/apps/api',
            sharedByEmail: 'owner@openawork.local',
            permission: 'comment',
            createdAt: '2026-04-04T03:00:00.000Z',
            updatedAt: '2026-04-04T03:30:00.000Z',
            shareCreatedAt: '2026-04-04T04:00:00.000Z',
            shareUpdatedAt: '2026-04-04T04:15:00.000Z',
          },
          comments: [
            {
              id: 'c-1',
              sessionId: 'shared-session-1',
              authorEmail: 'viewer@openawork.local',
              content: '我补充了事故发生时间线。',
              createdAt: '2026-04-04T05:00:00.000Z',
            },
          ],
          session: {
            id: 'shared-session-1',
            title: '上线回顾',
            state_status: 'paused',
            metadata_json: JSON.stringify({ workingDirectory: '/repo/apps/api' }),
            created_at: '2026-04-04T03:00:00.000Z',
            updated_at: '2026-04-04T03:30:00.000Z',
            messages: [
              { id: 'm-1', role: 'user', content: '请帮我复盘今天的上线。' },
              { id: 'm-2', role: 'assistant', content: '好的，我先总结问题与时间线。' },
            ],
            runEvents: [],
            todos: [],
            fileChangesSummary: {
              totalAdditions: 0,
              totalDeletions: 0,
              totalFileDiffs: 0,
              snapshotCount: 0,
              sourceKinds: [],
            },
          },
        }),
      } as Response;
    }

    if (
      url.pathname.endsWith('/sessions/shared-with-me/shared-session-1/comments') &&
      method === 'POST'
    ) {
      return {
        ok: true,
        json: async () => ({
          comment: {
            id: 'c-2',
            sessionId: 'shared-session-1',
            authorEmail: 'viewer@openawork.local',
            content: '我来补一条协作评论。',
            createdAt: '2026-04-04T05:10:00.000Z',
          },
        }),
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

    if (url.pathname.endsWith('/team/session-shares') && method === 'POST') {
      if (failNextShareCreate) {
        failNextShareCreate = false;
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: 'Share already exists' }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          id: 'share-2',
          sessionId: 'session-1',
          sessionLabel: '设计讨论',
          workspacePath: '/repo/apps/web',
          memberId: 'member-1',
          memberName: '林雾',
          memberEmail: 'linwu@openawork.local',
          permission: 'operate',
          createdAt: '2026-04-04T00:00:00.000Z',
          updatedAt: '2026-04-04T00:10:00.000Z',
        }),
      } as Response;
    }

    if (url.pathname.includes('/team/session-shares/') && method === 'PATCH') {
      return {
        ok: true,
        json: async () => ({
          id: 'share-1',
          sessionId: 'session-1',
          sessionLabel: '设计讨论',
          workspacePath: '/repo/apps/web',
          memberId: 'member-1',
          memberName: '林雾',
          memberEmail: 'linwu@openawork.local',
          permission: 'operate',
          createdAt: '2026-04-04T00:00:00.000Z',
          updatedAt: '2026-04-04T02:10:00.000Z',
        }),
      } as Response;
    }

    if (url.pathname.includes('/team/session-shares/') && method === 'DELETE') {
      return { ok: true, status: 204 } as Response;
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
    expect(container?.textContent).toContain('共享会话');
    expect(container?.textContent).toContain('设计讨论');
    expect(container?.textContent).toContain('工作区：/repo/apps/web');
    expect(container?.textContent).toContain('共享给我的会话');
    expect(container?.textContent).toContain('上线回顾');
    expect(container?.textContent).toContain('owner@openawork.local');
    expect(container?.textContent).toContain('请帮我复盘今天的上线。');
    expect(container?.textContent).toContain('我补充了事故发生时间线。');
    expect(container?.textContent).toContain('发送协作评论');
    expect(container?.textContent).toContain('协作审计流');
    expect(container?.textContent).toContain('已将“设计讨论”共享给 林雾（comment）');
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

  it('creates a new team session share from the collaboration panel', async () => {
    await renderPage();

    const selects = Array.from(container?.querySelectorAll('select') ?? []);
    const sessionSelect = selects.at(-3) as HTMLSelectElement | undefined;
    const memberSelect = selects.at(-2) as HTMLSelectElement | undefined;
    const permissionSelect = selects.at(-1) as HTMLSelectElement | undefined;
    const submitButton = Array.from(container?.querySelectorAll('button') ?? [])
      .filter((button) => button.textContent?.includes('共享会话'))
      .at(-1);

    expect(sessionSelect).toBeTruthy();
    expect(memberSelect).toBeTruthy();
    expect(permissionSelect).toBeTruthy();
    expect(submitButton).toBeTruthy();

    await act(async () => {
      if (sessionSelect) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(sessionSelect, 'session-1');
        sessionSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (memberSelect) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(memberSelect, 'member-1');
        memberSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (permissionSelect) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(permissionSelect, 'operate');
        permissionSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    const refreshedSubmitButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.includes('共享会话'),
    ) as HTMLButtonElement | undefined;

    expect(refreshedSubmitButton?.disabled).toBe(false);
    expect(sessionSelect?.textContent).toContain('设计讨论 · /repo/apps/web');

    await act(async () => {
      refreshedSubmitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          input === 'http://localhost:3000/team/session-shares' &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('updates a shared session permission from the collaboration panel', async () => {
    await renderPage();

    const permissionSelect = container?.querySelector(
      'select[aria-label="共享权限-share-1"]',
    ) as HTMLSelectElement | null;
    expect(permissionSelect).toBeTruthy();

    await act(async () => {
      if (permissionSelect) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(permissionSelect, 'operate');
        permissionSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          input === 'http://localhost:3000/team/session-shares/share-1' &&
          (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toBe(true);
  });

  it('keeps the share form selections when creating a session share fails', async () => {
    failNextShareCreate = true;
    await renderPage();

    const selects = Array.from(container?.querySelectorAll('select') ?? []);
    const sessionSelect = selects.at(-3) as HTMLSelectElement | undefined;
    const memberSelect = selects.at(-2) as HTMLSelectElement | undefined;
    const permissionSelect = selects.at(-1) as HTMLSelectElement | undefined;
    const submitButton = Array.from(container?.querySelectorAll('button') ?? [])
      .filter((button) => button.textContent?.includes('共享会话'))
      .at(-1);

    await act(async () => {
      if (sessionSelect) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(sessionSelect, 'session-1');
        sessionSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (memberSelect) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(memberSelect, 'member-1');
        memberSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (permissionSelect) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(permissionSelect, 'operate');
        permissionSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sessionSelect?.value).toBe('session-1');
    expect(memberSelect?.value).toBe('member-1');
    expect(permissionSelect?.value).toBe('operate');
    expect(container?.textContent).toContain('Failed to create session share: 409');
  });

  it('creates a shared session comment from the shared preview panel', async () => {
    await renderPage();

    const textarea = container?.querySelector(
      'textarea[aria-label="共享会话评论输入框"]',
    ) as HTMLTextAreaElement | null;
    const submitButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('发送协作评论'),
    );

    expect(textarea).toBeTruthy();
    expect(submitButton).toBeTruthy();

    await act(async () => {
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(textarea, '我来补一条协作评论。');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          input === 'http://localhost:3000/sessions/shared-with-me/shared-session-1/comments' &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
  });
});
