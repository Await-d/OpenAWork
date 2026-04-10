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
let failNextInteractionProcessing = false;
let slowSharedSessionOneDetail = false;
let teamMessages: Array<{
  content: string;
  id: string;
  memberId: string;
  timestamp: number;
  type: 'update' | 'question' | 'result' | 'error';
}> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });
  failNextShareCreate = false;
  failNextInteractionProcessing = false;
  slowSharedSessionOneDetail = false;
  teamMessages = [
    {
      id: 'msg-1',
      memberId: 'member-1',
      content: '我先认领协作页面。',
      type: 'update',
      timestamp: Date.parse('2026-04-04T00:00:00.000Z'),
    },
  ];

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
        json: async () => teamMessages,
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
            action: 'shared_permission_replied',
            actorEmail: 'viewer@openawork.local',
            actorUserId: 'viewer-1',
            entityType: 'permission_request',
            entityId: 'perm-1',
            summary: 'viewer@openawork.local 处理了“上线回顾”的权限请求（once）',
            detail:
              '会话：上线回顾；工作区：/repo/apps/api；工具：read_file；范围：/repo/apps/api；决策：once',
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
              permission: 'operate',
              createdAt: '2026-04-04T03:00:00.000Z',
              updatedAt: '2026-04-04T03:30:00.000Z',
              shareCreatedAt: '2026-04-04T04:00:00.000Z',
              shareUpdatedAt: '2026-04-04T04:15:00.000Z',
            },
            {
              sessionId: 'shared-session-2',
              title: '交接验证',
              stateStatus: 'paused',
              workspacePath: '/repo/apps/api',
              sharedByEmail: 'owner@openawork.local',
              permission: 'operate',
              createdAt: '2026-04-04T06:00:00.000Z',
              updatedAt: '2026-04-04T06:30:00.000Z',
              shareCreatedAt: '2026-04-04T06:35:00.000Z',
              shareUpdatedAt: '2026-04-04T06:45:00.000Z',
            },
          ],
        }),
      } as Response;
    }

    if (url.pathname.endsWith('/sessions/shared-with-me/shared-session-1') && method === 'GET') {
      if (slowSharedSessionOneDetail) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 40));
      }

      return {
        ok: true,
        json: async () => ({
          share: {
            sessionId: 'shared-session-1',
            title: '上线回顾',
            stateStatus: 'paused',
            workspacePath: '/repo/apps/api',
            sharedByEmail: 'owner@openawork.local',
            permission: 'operate',
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
          presence: [
            {
              viewerUserId: 'viewer-1',
              viewerEmail: 'viewer@openawork.local',
              firstSeenAt: '2026-04-04T04:45:00.000Z',
              lastSeenAt: '2026-04-04T05:30:00.000Z',
              active: true,
            },
            {
              viewerUserId: 'viewer-2',
              viewerEmail: 'observer@openawork.local',
              firstSeenAt: '2026-04-04T03:45:00.000Z',
              lastSeenAt: '2026-04-04T04:20:00.000Z',
              active: false,
            },
          ],
          pendingPermissions: [
            {
              requestId: 'perm-1',
              sessionId: 'shared-session-1',
              toolName: 'read_file',
              scope: '/repo/apps/api',
              reason: '需要读取配置',
              riskLevel: 'medium',
              previewAction: 'read package.json',
              status: 'pending',
              createdAt: '2026-04-04T05:20:00.000Z',
            },
          ],
          pendingQuestions: [
            {
              requestId: 'question-1',
              sessionId: 'shared-session-1',
              toolName: 'Question',
              title: '请选择下一步',
              questions: [
                {
                  header: '下一步',
                  question: '你希望我先处理什么？',
                  options: [{ label: '修复', description: '先修问题' }],
                },
              ],
              status: 'pending',
              createdAt: '2026-04-04T05:25:00.000Z',
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

    if (url.pathname.endsWith('/sessions/shared-with-me/shared-session-2') && method === 'GET') {
      return {
        ok: true,
        json: async () => ({
          share: {
            sessionId: 'shared-session-2',
            title: '交接验证',
            stateStatus: 'paused',
            workspacePath: '/repo/apps/api',
            sharedByEmail: 'owner@openawork.local',
            permission: 'operate',
            createdAt: '2026-04-04T06:00:00.000Z',
            updatedAt: '2026-04-04T06:30:00.000Z',
            shareCreatedAt: '2026-04-04T06:35:00.000Z',
            shareUpdatedAt: '2026-04-04T06:45:00.000Z',
          },
          comments: [],
          presence: [],
          pendingPermissions: [],
          pendingQuestions: [
            {
              requestId: 'question-2',
              sessionId: 'shared-session-2',
              toolName: 'Question',
              title: '请选择新的验证路径',
              questions: [
                {
                  header: '验证动作',
                  question: '你希望我接下来重点验证哪一项？',
                  options: [{ label: '继续验证', description: '继续跑验收验证' }],
                },
              ],
              status: 'pending',
              createdAt: '2026-04-04T06:50:00.000Z',
            },
          ],
          session: {
            id: 'shared-session-2',
            title: '交接验证',
            state_status: 'paused',
            metadata_json: JSON.stringify({ workingDirectory: '/repo/apps/api' }),
            created_at: '2026-04-04T06:00:00.000Z',
            updated_at: '2026-04-04T06:30:00.000Z',
            messages: [
              { id: 'm-3', role: 'user', content: '请继续做交接验证。' },
              { id: 'm-4', role: 'assistant', content: '好的，我先收拢剩余验证项。' },
            ],
            runEvents: [],
            todos: [],
            fileChangesSummary: {
              totalAdditions: 1,
              totalDeletions: 0,
              totalFileDiffs: 1,
              snapshotCount: 1,
              sourceKinds: ['session_snapshot'],
            },
          },
        }),
      } as Response;
    }

    if (
      url.pathname.endsWith('/sessions/shared-with-me/shared-session-1/presence') &&
      method === 'POST'
    ) {
      return {
        ok: true,
        json: async () => ({
          presence: [
            {
              viewerUserId: 'viewer-1',
              viewerEmail: 'viewer@openawork.local',
              firstSeenAt: '2026-04-04T04:45:00.000Z',
              lastSeenAt: '2026-04-04T05:31:00.000Z',
              active: true,
            },
            {
              viewerUserId: 'viewer-2',
              viewerEmail: 'observer@openawork.local',
              firstSeenAt: '2026-04-04T03:45:00.000Z',
              lastSeenAt: '2026-04-04T04:20:00.000Z',
              active: false,
            },
          ],
        }),
      } as Response;
    }

    if (
      url.pathname.endsWith('/sessions/shared-with-me/shared-session-1/permissions/reply') &&
      method === 'POST'
    ) {
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }

    if (
      url.pathname.endsWith('/sessions/shared-with-me/shared-session-1/questions/reply') &&
      method === 'POST'
    ) {
      return { ok: true, json: async () => ({ ok: true }) } as Response;
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
      const payload = JSON.parse(String(init?.body ?? '{}')) as {
        content?: string;
        senderId?: string;
        type?: 'update' | 'question' | 'result' | 'error';
      };

      if (
        failNextInteractionProcessing &&
        payload.content === '【interaction-agent/处理中】已接收该请求，正在整理下一步动作。'
      ) {
        failNextInteractionProcessing = false;
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'processing write failed' }),
        } as Response;
      }

      const nextMessage = {
        id: `msg-${teamMessages.length + 1}`,
        memberId: payload.senderId ?? '',
        content: payload.content ?? '',
        type: payload.type ?? 'update',
        timestamp: Date.now(),
      };
      teamMessages = [...teamMessages, nextMessage];

      return {
        ok: true,
        json: async () => nextMessage,
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

async function clickTab(label: string) {
  const button = Array.from(container?.querySelectorAll('[role="tab"]') ?? []).find((candidate) =>
    candidate.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;

  expect(button).toBeTruthy();

  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

async function clickWorkspace(label: string) {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find((candidate) =>
    candidate.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;

  expect(button).toBeTruthy();

  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

describe('TeamPage', () => {
  it('renders the runtime shell, workspace cards, and tabbed collaboration data', async () => {
    await renderPage();

    expect(container?.textContent).toContain('Team Runtime');
    expect(container?.textContent).toContain('全部工作区');
    expect(container?.textContent).toContain('/repo/apps/api');
    expect(container?.textContent).toContain('Buddy / Hubby runtime');
    expect(container?.textContent).toContain('林雾');
    expect(container?.textContent).toContain('落地团队协作台');

    await clickTab('消息时间线');

    expect(container?.textContent).toContain('我先认领协作页面。');
    expect(container?.textContent).toContain('协作审计流');
    expect(container?.textContent).toContain(
      'viewer@openawork.local 处理了“上线回顾”的权限请求（once）',
    );
    expect(container?.textContent).toContain('执行人：viewer@openawork.local');

    await clickTab('会话 / Agent');
    await clickWorkspace('上线回顾');

    expect(container?.textContent).toContain('共享给我的会话');
    expect(container?.textContent).toContain('上线回顾');
    expect(container?.textContent).toContain('owner@openawork.local');
    expect(container?.textContent).toContain('请帮我复盘今天的上线。');
    expect(container?.textContent).toContain('我补充了事故发生时间线。');
    expect(container?.textContent).toContain('在线查看者');
    expect(container?.textContent).toContain('viewer@openawork.local');
    expect(container?.textContent).toContain('observer@openawork.local');
    expect(container?.textContent).toContain('发送协作评论');

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          input === 'http://localhost:3000/sessions/shared-with-me/shared-session-1/presence' &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('creates a new team task from the composer', async () => {
    await renderPage();
    await clickTab('任务看板');

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
    await clickTab('文件上下文');

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
    await clickTab('文件上下文');

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
    await clickTab('文件上下文');

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
    await clickTab('会话 / Agent');
    await clickWorkspace('上线回顾');

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

  it('replies to a shared permission request from the operate panel', async () => {
    await renderPage();
    await clickTab('会话 / Agent');
    await clickWorkspace('上线回顾');

    const approveButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('同意本次'),
    );
    expect(approveButton).toBeTruthy();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          input ===
            'http://localhost:3000/sessions/shared-with-me/shared-session-1/permissions/reply' &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('answers a shared pending question from the operate panel', async () => {
    await renderPage();
    await clickTab('会话 / Agent');

    const answerOption = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('继续验证'),
    );
    const submitAnswerButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.includes('提交回答'),
    );
    expect(answerOption).toBeTruthy();
    expect(submitAnswerButton).toBeTruthy();

    await act(async () => {
      answerOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      submitAnswerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          input ===
            'http://localhost:3000/sessions/shared-with-me/shared-session-2/questions/reply' &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('resets pending question answers when switching to another shared session', async () => {
    await renderPage();
    await clickTab('会话 / Agent');
    await clickWorkspace('上线回顾');

    const firstAnswerOption = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.includes('修复'),
    );
    expect(firstAnswerOption).toBeTruthy();

    await act(async () => {
      firstAnswerOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    let submitAnswerButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.includes('提交回答'),
    ) as HTMLButtonElement | undefined;
    expect(submitAnswerButton?.disabled).toBe(false);

    const switchSessionButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.includes('交接验证'),
    );
    expect(switchSessionButton).toBeTruthy();

    await act(async () => {
      switchSessionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('请选择新的验证路径');
    submitAnswerButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('提交回答'),
    ) as HTMLButtonElement | undefined;
    expect(submitAnswerButton?.disabled).toBe(true);
  });

  it('renders workspace-scoped change projection in the changes tab', async () => {
    await renderPage();
    await clickTab('Git / 变更');

    expect(container?.textContent).toContain('工作区变更投影');
    expect(container?.textContent).toContain('最近快照');
    expect(container?.textContent).toContain('来源类型');
    expect(container?.textContent).toContain('快照');
    expect(container?.textContent).toContain('工作区共享运行清单');
    expect(container?.textContent).toContain('交接验证');
  });

  it('shows empty change projection when workspace has no shared runs', async () => {
    await renderPage();
    await clickWorkspace('/repo/apps/web');
    await clickTab('Git / 变更');

    expect(container?.textContent).toContain('当前工作区没有共享运行可用于变更投影。');
    expect(container?.textContent).toContain('暂无变更摘要');
  });

  it('clears the selected shared run when switching to a workspace without shared sessions', async () => {
    await renderPage();

    await clickWorkspace('/repo/apps/web');

    expect(container?.textContent).toContain('尚未选中共享运行');
    expect(container?.textContent).toContain('当前工作区外壳已按工作区过滤共享运行');
  });

  it('keeps interaction-agent draft isolated from the timeline composer', async () => {
    await renderPage();

    const interactionTextarea = container?.querySelector(
      'textarea[aria-label="interaction-agent 输入区"]',
    ) as HTMLTextAreaElement | null;
    expect(interactionTextarea).toBeTruthy();

    await act(async () => {
      if (interactionTextarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(interactionTextarea, '让 interaction-agent 先改写这条需求');
        interactionTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    await clickTab('消息时间线');

    const messageTextarea = container?.querySelector(
      'textarea[name="team-message-content"]',
    ) as HTMLTextAreaElement | null;
    expect(messageTextarea?.value ?? '').toBe('');
  });

  it('submits the interaction-agent draft into the team timeline', async () => {
    await renderPage();

    const interactionTextarea = container?.querySelector(
      'textarea[aria-label="interaction-agent 输入区"]',
    ) as HTMLTextAreaElement | null;
    const submitButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('交由 interaction-agent'),
    ) as HTMLButtonElement | undefined;

    expect(interactionTextarea).toBeTruthy();
    expect(submitButton).toBeTruthy();

    await act(async () => {
      if (interactionTextarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(interactionTextarea, '请先梳理当前阻塞并给出下一步建议');
        interactionTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('消息时间线');
    expect(container?.textContent).toContain('interaction-agent');
    expect(container?.textContent).toContain('发起');
    expect(container?.textContent).toContain('处理中');
    expect(container?.textContent).toContain('请先梳理当前阻塞并给出下一步建议');
    expect(container?.textContent).toContain('已接收该请求，正在整理下一步动作。');
    expect(container?.textContent).toContain('question');
    expect(interactionTextarea?.value ?? '').toBe('');
    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        if (
          input !== 'http://localhost:3000/team/messages' ||
          (init as RequestInit | undefined)?.method !== 'POST'
        ) {
          return false;
        }
        const payload = JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')) as {
          content?: string;
          type?: string;
        };
        return (
          payload.content === '【interaction-agent/发起】请先梳理当前阻塞并给出下一步建议' &&
          payload.type === 'question'
        );
      }),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        if (
          input !== 'http://localhost:3000/team/messages' ||
          (init as RequestInit | undefined)?.method !== 'POST'
        ) {
          return false;
        }
        const payload = JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')) as {
          content?: string;
          type?: string;
        };
        return (
          payload.content === '【interaction-agent/处理中】已接收该请求，正在整理下一步动作。' &&
          payload.type === 'update'
        );
      }),
    ).toBe(true);
  });

  it('keeps the interaction-agent draft when the processing status write fails', async () => {
    failNextInteractionProcessing = true;
    await renderPage();

    const interactionTextarea = container?.querySelector(
      'textarea[aria-label="interaction-agent 输入区"]',
    ) as HTMLTextAreaElement | null;
    const submitButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('交由 interaction-agent'),
    ) as HTMLButtonElement | undefined;

    expect(interactionTextarea).toBeTruthy();
    expect(submitButton).toBeTruthy();

    await act(async () => {
      if (interactionTextarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(interactionTextarea, '请帮我继续补充失败路径');
        interactionTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(interactionTextarea?.value ?? '').toBe('请帮我继续补充失败路径');
    expect(container?.textContent).not.toContain('已接收该请求，正在整理下一步动作。');
    expect(container?.textContent).toContain('Failed to create team message: 500');
  });

  it('ignores stale shared-session detail responses after switching sessions', async () => {
    slowSharedSessionOneDetail = true;
    await renderPage();
    await clickTab('会话 / Agent');
    await clickWorkspace('上线回顾');
    await clickWorkspace('交接验证');

    await act(async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 80));
    });

    expect(container?.textContent).toContain('交接验证');
    expect(container?.textContent).toContain('请继续做交接验证。');
    expect(container?.textContent).not.toContain('请帮我复盘今天的上线。');
  });
});
