// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './stores/auth.js';

vi.mock('./components/Layout.js', () => ({
  default: function MockLayout() {
    return (
      <div data-testid="layout-shell">
        <Outlet />
      </div>
    );
  },
}));

vi.mock('./components/OnboardingModal.js', () => ({
  default: () => null,
}));

vi.mock('./components/ToastNotification.js', () => ({
  ToastContainer: () => null,
}));

vi.mock('./components/UpdateBanner.js', () => ({
  default: () => null,
}));

vi.mock('./components/SplashScreen.js', () => ({
  default: () => null,
}));

vi.mock('@openAwork/shared-ui', async () => {
  const actual =
    await vi.importActual<typeof import('@openAwork/shared-ui')>('@openAwork/shared-ui');
  return {
    ...actual,
    TelemetryConsentModal: () => null,
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let createTemplateCalls = 0;
let workflowTemplates: Array<{
  category: string;
  description: string | null;
  edges: Array<{ id: string; source: string; target: string }>;
  id: string;
  name: string;
  nodes: Array<{ id: string; label: string; type: string; x: number; y: number }>;
}> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  createTemplateCalls = 0;
  workflowTemplates = [
    {
      id: 'workflow-1',
      name: '审批流模板',
      description: '用于多人协作审批。',
      category: 'team-playbook',
      nodes: [
        { id: 'start', label: '开始', type: 'start', x: 40, y: 40 },
        { id: 'end', label: '结束', type: 'end', x: 320, y: 40 },
      ],
      edges: [{ id: 'edge-1', source: 'start', target: 'end' }],
    },
  ];
  useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: light)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl, 'http://localhost:3000');
      const method = input instanceof Request ? input.method : (init?.method ?? 'GET');
      const bodyText =
        input instanceof Request
          ? await input.text()
          : typeof init?.body === 'string'
            ? init.body
            : '';

      if (url.pathname.endsWith('/channels')) {
        return {
          ok: true,
          json: async () => ({ channels: [] }),
        } as Response;
      }

      if (url.pathname.endsWith('/channels/descriptors')) {
        return {
          ok: true,
          json: async () => ({ descriptors: [] }),
        } as Response;
      }

      if (url.pathname.endsWith('/agents')) {
        return {
          ok: true,
          json: async () => ({
            agents: [
              {
                id: 'oracle',
                origin: 'builtin',
                source: 'reference',
                enabled: true,
                removable: false,
                resettable: false,
                hasOverrides: false,
                createdAt: '1970-01-01T00:00:00.000Z',
                updatedAt: '1970-01-01T00:00:00.000Z',
                label: 'oracle',
                description: '只读顾问 agent',
                aliases: ['architect'],
                canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
              },
            ],
          }),
        } as Response;
      }

      if (url.pathname.endsWith('/capabilities')) {
        return {
          ok: true,
          json: async () => ({ capabilities: [] }),
        } as Response;
      }

      if (url.pathname.endsWith('/team/runtime')) {
        return {
          ok: true,
          json: async () => ({
            auditLogs: [
              {
                id: 'audit-1',
                action: 'share_created',
                actorEmail: 'linwu@openawork.local',
                actorUserId: 'member-1',
                entityType: 'session_share',
                entityId: 'share-1',
                summary: '已共享研究团队运行到 Team 页面',
                detail: '当前共享运行已进入 Team Runtime。',
                createdAt: '2026-04-04T00:00:00.000Z',
              },
            ],
            members: [
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
            messages: [
              {
                id: 'msg-1',
                memberId: 'member-1',
                content: '我先认领协作页面。',
                type: 'update',
                timestamp: Date.parse('2026-04-04T00:00:00.000Z'),
              },
            ],
            runtimeTaskGroups: [],
            sessionShares: [],
            sessions: [
              {
                id: 'team-session-1',
                metadataJson: '{}',
                parentSessionId: null,
                title: '研究团队-2026-03-31',
                updatedAt: '2026-04-04T00:00:00.000Z',
                workspacePath: '/home/await/project/OpenAWork',
              },
            ],
            sharedSessions: [
              {
                sessionId: 'team-session-1',
                title: '研究团队-2026-03-31',
                stateStatus: 'running',
                workspacePath: '/home/await/project/OpenAWork',
                sharedByEmail: 'linwu@openawork.local',
                permission: 'operate',
                createdAt: '2026-04-04T00:00:00.000Z',
                updatedAt: '2026-04-04T00:00:00.000Z',
                shareCreatedAt: '2026-04-04T00:00:00.000Z',
                shareUpdatedAt: '2026-04-04T00:00:00.000Z',
              },
            ],
            tasks: [
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
          }),
        } as Response;
      }

      if (url.pathname.endsWith('/sessions/shared-with-me/team-session-1')) {
        return {
          ok: true,
          json: async () => ({
            comments: [],
            pendingPermissions: [],
            pendingQuestions: [],
            presence: [
              {
                clientId: 'viewer-1',
                userId: 'member-1',
                email: 'linwu@openawork.local',
                active: true,
                lastSeenAt: '2026-04-04T00:00:00.000Z',
              },
            ],
            share: {
              sessionId: 'team-session-1',
              title: '研究团队-2026-03-31',
              stateStatus: 'running',
              workspacePath: '/home/await/project/OpenAWork',
              sharedByEmail: 'linwu@openawork.local',
              permission: 'operate',
              createdAt: '2026-04-04T00:00:00.000Z',
              updatedAt: '2026-04-04T00:00:00.000Z',
              shareCreatedAt: '2026-04-04T00:00:00.000Z',
              shareUpdatedAt: '2026-04-04T00:00:00.000Z',
            },
            session: {
              id: 'team-session-1',
              title: '研究团队-2026-03-31',
              state_status: 'running',
              metadata: {},
              fileChangesSummary: undefined,
            },
          }),
        } as Response;
      }

      if (url.pathname.endsWith('/sessions/shared-with-me/team-session-1/presence')) {
        return {
          ok: true,
          json: async () => ({
            presence: [
              {
                clientId: 'viewer-1',
                userId: 'member-1',
                email: 'linwu@openawork.local',
                active: true,
                lastSeenAt: '2026-04-04T00:00:00.000Z',
              },
            ],
          }),
        } as Response;
      }

      if (url.pathname.endsWith('/sessions/team-session-1/tasks')) {
        return {
          ok: true,
          json: async () => ({ tasks: [] }),
        } as Response;
      }

      if (url.pathname.endsWith('/team/members')) {
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

      if (url.pathname.endsWith('/team/tasks')) {
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

      if (url.pathname.endsWith('/team/messages')) {
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

      if (url.pathname.endsWith('/team/session-shares')) {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }

      if (url.pathname.startsWith('/team/audit-logs')) {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }

      if (url.pathname.endsWith('/sessions')) {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }

      if (url.pathname.endsWith('/workflows/templates')) {
        if (method === 'POST') {
          const body = bodyText.length > 0 ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
          const created = {
            id: 'workflow-created',
            name: String(body.name ?? '未命名模板'),
            description: typeof body.description === 'string' ? body.description : null,
            category: typeof body.category === 'string' ? body.category : 'team-playbook',
            nodes: Array.isArray(body.nodes)
              ? (body.nodes as Array<{
                  id: string;
                  label: string;
                  type: string;
                  x: number;
                  y: number;
                }>)
              : [],
            edges: Array.isArray(body.edges)
              ? (body.edges as Array<{ id: string; source: string; target: string }>)
              : [],
          };
          workflowTemplates = [created, ...workflowTemplates];
          createTemplateCalls += 1;
          return {
            ok: true,
            json: async () => created,
          } as Response;
        }

        return {
          ok: true,
          json: async () => workflowTemplates,
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          records: [],
          budgetUsd: 10,
          channels: [],
          servers: [],
          diagnostics: [],
          models: [],
          decisions: [],
          logs: [],
          workers: [],
        }),
      } as Response;
    }),
  );

  vi.spyOn(useAuthStore.persist, 'hasHydrated').mockReturnValue(true);
  vi.spyOn(useAuthStore.persist, 'onFinishHydration').mockImplementation(() => () => undefined);

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

async function waitForText(text: string, attempts = 30): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (container?.textContent?.includes(text)) {
      return;
    }

    await act(async () => {
      await vi.dynamicImportSettled();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  throw new Error(`Timed out waiting for text: ${text}`);
}

describe('App routing', () => {
  it('redirects /channels to the settings channels tab', async () => {
    const { default: App } = await import('./App.js');

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/channels']}>
          <App />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForText('渠道模板库');
    expect(container?.textContent).toContain('消息频道');
    expect(container?.textContent).toContain('渠道模板库');
  });

  it.each(['/prompt-optimizer', '/translation'])(
    'redirects legacy route %s back to /chat',
    async (initialEntry) => {
      const { default: App } = await import('./App.js');
      let pathname = '';

      function LocationProbe() {
        const location = useLocation();

        pathname = location.pathname;
        return null;
      }

      await act(async () => {
        root?.render(
          <MemoryRouter initialEntries={[initialEntry]}>
            <App />
            <LocationProbe />
          </MemoryRouter>,
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(pathname).toBe('/chat');
    },
  );

  it('renders the agents page on /agents', async () => {
    const { default: App } = await import('./App.js');

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/agents']}>
          <App />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForText('oracle');
    expect(container?.textContent).toContain('Agent 管理');
    expect(container?.textContent).toContain('oracle');
  });

  it('renders the workflows page on /workflows', async () => {
    const { default: App } = await import('./App.js');

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/workflows']}>
          <App />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForText('审批流模板');
    expect(container?.textContent).toContain('工作流工作台');
    expect(container?.textContent).toContain('审批流模板');
  });

  it('renders the team page on /team', async () => {
    const { default: App } = await import('./App.js');

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/team']}>
          <App />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForText('研究团队-2026-03-31');
    expect(container?.querySelector('[data-testid="layout-shell"]')).toBeTruthy();
    expect(container?.textContent).toContain('AGENT TEAMS');
    expect(container?.textContent).toContain('已接入真实 Team Runtime');
    expect(container?.textContent).toContain('林雾');
  });

  it('creates a team template through the Team page modal', async () => {
    const { default: App } = await import('./App.js');

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/team']}>
          <App />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForText('AGENT TEAMS');

    const openTemplateButton = container?.querySelector(
      'button[title="选择模板后新建团队"]',
    ) as HTMLButtonElement | null;
    expect(openTemplateButton).toBeTruthy();

    await act(async () => {
      openTemplateButton?.click();
      await Promise.resolve();
    });

    const templateNameInput = container?.querySelector(
      '#team-template-name-input',
    ) as HTMLInputElement | null;
    expect(templateNameInput).toBeTruthy();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(templateNameInput, '研究协作剧本');
      templateNameInput!.dispatchEvent(new Event('input', { bubbles: true }));
      templateNameInput!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    const roleButtons = Array.from(container?.querySelectorAll('button') ?? []).filter((button) =>
      ['团队负责人', '研究员A'].includes(button.textContent?.trim() ?? ''),
    ) as HTMLButtonElement[];

    await act(async () => {
      roleButtons.at(-2)?.click();
      roleButtons.at(-1)?.click();
      await Promise.resolve();
    });

    const createButton = [...Array.from(container?.querySelectorAll('button') ?? [])]
      .reverse()
      .find((button: Element) => button.textContent?.includes('创建模板')) as
      | HTMLButtonElement
      | undefined;
    expect(createButton).toBeTruthy();

    await act(async () => {
      createButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createTemplateCalls).toBe(1);
    expect(workflowTemplates.some((template) => template.name === '研究协作剧本')).toBe(true);
  });
});
