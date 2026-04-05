// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage.js';
import { useAuthStore } from '../stores/auth.js';

const jsonResponse = (body: unknown, ok = true) =>
  ({
    ok,
    json: async () => body,
  }) as Response;

const defaultProviders = [
  {
    id: 'openai',
    type: 'openai',
    name: 'OpenAI',
    enabled: true,
    apiKey: 'sk-test-openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModels: [{ id: 'gpt-5', label: 'GPT-5', enabled: true }],
  },
];

const defaultActiveSelection = {
  chat: { providerId: 'openai', modelId: 'gpt-5' },
  fast: { providerId: 'openai', modelId: 'gpt-5' },
};

function createFetchMock(options?: {
  providers?: typeof defaultProviders;
  activeSelection?: typeof defaultActiveSelection | null;
  endpointResponses?: Record<
    string,
    | { body: unknown; ok?: boolean }
    | ((context: { path: string; init?: RequestInit }) => { body: unknown; ok?: boolean })
  >;
  onSaveProviders?: (body: {
    providers: typeof defaultProviders;
    activeSelection?: typeof defaultActiveSelection;
  }) => void;
  onSaveNotificationPreferences?: (body: {
    channel?: 'web';
    preferences: Array<{
      enabled: boolean;
      eventType: 'permission_asked' | 'question_asked' | 'task_update';
    }>;
  }) => void;
  onSaveUpstreamRetry?: (body: { maxRetries: number }) => void;
}) {
  const providers = options?.providers ?? [];
  const activeSelection = options?.activeSelection ?? null;

  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://localhost:3000');
    const path = url.pathname;
    const endpointOverride = Object.entries(options?.endpointResponses ?? {}).find(([endpoint]) =>
      path.endsWith(endpoint),
    )?.[1];

    if (endpointOverride) {
      const resolvedOverride =
        typeof endpointOverride === 'function'
          ? endpointOverride({ path, init })
          : endpointOverride;
      return jsonResponse(resolvedOverride.body, resolvedOverride.ok ?? true);
    }

    if (path.endsWith('/settings/providers')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as {
          providers: typeof defaultProviders;
          activeSelection?: typeof defaultActiveSelection;
        };
        options?.onSaveProviders?.(body);
        return jsonResponse({
          providers: body.providers,
          activeSelection: body.activeSelection ?? null,
        });
      }

      return jsonResponse({ providers, activeSelection });
    }
    if (path.endsWith('/agent-profiles')) {
      return jsonResponse({ profiles: [] });
    }
    if (path.endsWith('/settings/mcp-servers')) {
      return jsonResponse({ servers: [] });
    }
    if (path.endsWith('/settings/upstream-retry')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { maxRetries: number };
        options?.onSaveUpstreamRetry?.(body);
        return jsonResponse(body);
      }

      return jsonResponse({ maxRetries: 3 });
    }
    if (path.endsWith('/usage/records')) {
      return jsonResponse({ records: [], budgetUsd: 10 });
    }
    if (path.endsWith('/usage/breakdown')) {
      return jsonResponse({ monthlyCostUsd: 8.5, breakdown: [] });
    }
    if (path.endsWith('/settings/permissions')) {
      return jsonResponse({ decisions: [] });
    }
    if (path.endsWith('/notifications/preferences')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as {
          channel?: 'web';
          preferences: Array<{
            enabled: boolean;
            eventType: 'permission_asked' | 'question_asked' | 'task_update';
          }>;
        };
        options?.onSaveNotificationPreferences?.(body);
        return jsonResponse({
          preferences: body.preferences.map((preference) => ({
            channel: body.channel ?? 'web',
            enabled: preference.enabled,
            eventType: preference.eventType,
            updatedAt: '2026-04-05T00:00:00.000Z',
          })),
        });
      }

      return jsonResponse({
        preferences: [
          {
            channel: 'web',
            enabled: true,
            eventType: 'permission_asked',
            updatedAt: '2026-04-05T00:00:00.000Z',
          },
          {
            channel: 'web',
            enabled: true,
            eventType: 'question_asked',
            updatedAt: '2026-04-05T00:00:00.000Z',
          },
          {
            channel: 'web',
            enabled: true,
            eventType: 'task_update',
            updatedAt: '2026-04-05T00:00:00.000Z',
          },
        ],
      });
    }
    if (path.endsWith('/settings/dev-logs')) {
      return jsonResponse({
        logs: [
          {
            level: 'info',
            message: 'Tool called',
            toolName: 'web_search',
            createdAt: '2026-03-21T00:00:00.000Z',
          },
        ],
      });
    }
    if (path.endsWith('/settings/mcp-status')) {
      return jsonResponse({ servers: [] });
    }
    if (path.endsWith('/settings/workers')) {
      return jsonResponse({ workers: [] });
    }
    if (path.endsWith('/settings/diagnostics')) {
      return jsonResponse({
        diagnostics: [
          {
            filePath: 'web_search',
            toolName: 'web_search',
            requestId: 'req-web-search',
            sessionId: 'session-web-search',
            durationMs: 183,
            message: 'Tool error: web_search',
            severity: 'error',
            input: { query: 'site:example.com openAWork' },
            output: { stderr: 'DNS lookup failed' },
          },
        ],
      });
    }
    if (path.endsWith('/settings/model-prices')) {
      return jsonResponse({ models: [] });
    }
    if (path.endsWith('/settings/version')) {
      return jsonResponse({
        currentVersion: '0.0.1',
        latestVersion: null,
        updateAvailable: false,
        checkError: null,
        checkedAt: '2026-03-21T00:00:00.000Z',
      });
    }
    if (path.endsWith('/desktop-automation/status')) {
      return jsonResponse({ enabled: false });
    }
    if (path.endsWith('/ssh/connections')) {
      return jsonResponse({ connections: [] });
    }
    if (path.endsWith('/channels')) {
      return jsonResponse({ channels: [] });
    }
    if (path.endsWith('/channels/descriptors')) {
      return jsonResponse({ descriptors: [] });
    }

    throw new Error(`Unhandled fetch path: ${path}`);
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });
  vi.stubGlobal('fetch', createFetchMock());
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });

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
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  vi.unstubAllGlobals();
});

async function renderAt(tab: 'connection' | 'usage' | 'security' | 'devtools' | 'channels') {
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[`/settings/${tab}`]}>
        <Routes>
          <Route path="/settings/:tab" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await flushEffects();
  return container!;
}

describe('SettingsPage', () => {
  it('saves provider enabled state when the provider toggle is clicked', async () => {
    const savedBodies: Array<{
      providers: typeof defaultProviders;
      activeSelection?: typeof defaultActiveSelection;
    }> = [];
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        providers: defaultProviders,
        activeSelection: defaultActiveSelection,
        onSaveProviders: (body) => {
          savedBodies.push(body);
        },
      }),
    );

    const rendered = await renderAt('connection');
    const toggleButton = rendered.querySelector('button[title="禁用提供商"]');
    expect(toggleButton).not.toBeNull();

    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(savedBodies).toHaveLength(1);
    expect(savedBodies[0]?.providers[0]?.enabled).toBe(false);
    expect(rendered.querySelector('button[title="启用提供商"]')).not.toBeNull();
  });

  it('renders real budget data on the usage tab', async () => {
    const rendered = await renderAt('usage');
    expect(rendered.textContent).toContain('接近预算：$8.5000 / $10.0000');
    expect(rendered.textContent).not.toContain('5.3300');
  });

  it('saves upstream retry settings from the connection tab', async () => {
    const savedBodies: Array<{ maxRetries: number }> = [];
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        onSaveUpstreamRetry: (body) => {
          savedBodies.push(body);
        },
      }),
    );

    const rendered = await renderAt('connection');
    const retryOptionButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '1 次',
    );
    const applyButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '已应用',
    );

    expect(retryOptionButton).not.toBeUndefined();
    expect(applyButton).not.toBeUndefined();

    await act(async () => {
      retryOptionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const nextApplyButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '应用策略',
    );
    expect(nextApplyButton).not.toBeUndefined();

    await act(async () => {
      nextApplyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(savedBodies).toEqual([{ maxRetries: 1 }]);
  });

  it('maps gateway model price payloads for the usage tab table', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/model-prices': {
            body: {
              models: [{ modelName: 'gpt-5', inputPer1m: 1.25, outputPer1m: 5 }],
            },
          },
        },
      }),
    );

    const rendered = await renderAt('usage');
    expect(rendered.textContent).toContain('gpt-5');
    expect(rendered.textContent).toContain('OpenAI');
    expect(rendered.textContent).toContain('$1.25');
    expect(rendered.textContent).toContain('$5.00');
  });

  it('shows an explicit usage records error on the usage tab when loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/usage/records': {
            ok: false,
            body: { error: '用量服务暂不可用' },
          },
        },
      }),
    );

    const rendered = await renderAt('usage');
    expect(rendered.textContent).toContain('用量记录加载失败');
    expect(rendered.textContent).toContain('用量服务暂不可用');
    expect(rendered.textContent).not.toContain('暂无用量数据。');
  });

  it('shows an explicit breakdown error on the usage tab when loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/usage/breakdown': {
            ok: false,
            body: { error: '费用明细暂不可用' },
          },
        },
      }),
    );

    const rendered = await renderAt('usage');
    expect(rendered.textContent).toContain('费用明细加载失败');
    expect(rendered.textContent).toContain('费用明细暂不可用');
    expect(rendered.textContent).not.toContain('No usage recorded this month.');
  });

  it('renders channel descriptors from the gateway on the channels tab', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/channels/descriptors': {
            body: {
              descriptors: [
                {
                  type: 'feishu',
                  displayName: '飞书 Bot',
                  description: '飞书渠道描述',
                  icon: 'feishu',
                  category: 'china',
                  configSchema: [],
                  tools: [],
                },
              ],
            },
          },
        },
      }),
    );

    const rendered = await renderAt('channels');
    expect(rendered.textContent).toContain('渠道模板库');
    expect(rendered.textContent).toContain('飞书 Bot');
    expect(rendered.textContent).toContain('飞书渠道描述');
  });

  it('renders real diagnostics on the security tab', async () => {
    const rendered = await renderAt('security');
    expect(rendered.textContent).toContain('Tool error: web_search');
    expect(rendered.textContent).not.toContain('src/app.ts');
  });

  it('shows an explicit diagnostics error on the security tab when loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/diagnostics': {
            ok: false,
            body: { error: '诊断服务暂时不可用' },
          },
        },
      }),
    );

    const rendered = await renderAt('security');
    expect(rendered.textContent).toContain('诊断信息加载失败');
    expect(rendered.textContent).toContain('诊断服务暂时不可用');
    expect(rendered.textContent).not.toContain('暂无诊断数据');
  });

  it('saves notification preferences on the security tab', async () => {
    const savedBodies: Array<{
      channel?: 'web';
      preferences: Array<{
        enabled: boolean;
        eventType: 'permission_asked' | 'question_asked' | 'task_update';
      }>;
    }> = [];
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        onSaveNotificationPreferences: (body) => {
          savedBodies.push(body);
        },
      }),
    );

    const rendered = await renderAt('security');
    const taskUpdateCheckbox = Array.from(rendered.querySelectorAll('input')).find(
      (input) =>
        input instanceof HTMLInputElement &&
        input.type === 'checkbox' &&
        input.getAttribute('aria-label') === '任务状态',
    ) as HTMLInputElement | undefined;
    expect(taskUpdateCheckbox?.checked).toBe(true);

    await act(async () => {
      taskUpdateCheckbox?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const saveButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('保存通知偏好'),
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(savedBodies).toHaveLength(1);
    expect(savedBodies[0]).toEqual({
      channel: 'web',
      preferences: [
        { eventType: 'permission_asked', enabled: true },
        { eventType: 'question_asked', enabled: true },
        { eventType: 'task_update', enabled: false },
      ],
    });
    expect(rendered.textContent).toContain('通知偏好已同步');
  });

  it('shows source overview and real diagnostics on the devtools tab when sources are healthy', async () => {
    const rendered = await renderAt('devtools');
    expect(rendered.textContent).toContain('数据源概览');
    expect(rendered.textContent).toContain('Tool called');
    expect(rendered.textContent).toContain('Tool error: web_search');
    expect(rendered.textContent).toContain('GitHub 触发器配置尚未接入真实配置源');
    expect(rendered.textContent).not.toContain('my-org');
    expect(rendered.textContent).not.toContain('my-repo');
  });

  it('renders a structured diagnostics workspace on the devtools tab', async () => {
    const rendered = await renderAt('devtools');

    expect(rendered.textContent).toContain('错误浏览器');
    expect(rendered.textContent).toContain('按文件聚合');
    expect(rendered.textContent).toContain('错误列表');
    expect(rendered.textContent).toContain('错误详情');
  });

  it('supports quick navigation inside the devtools page', async () => {
    const rendered = await renderAt('devtools');
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    scrollIntoView.mockClear();

    const logsNavButton = Array.from(rendered.querySelectorAll('button')).find((button) => {
      const label = button.textContent ?? '';
      return label.includes('日志') && label.includes('条可见日志');
    });

    expect(logsNavButton).not.toBeNull();

    await act(async () => {
      logsNavButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('supports worker filtering, details, and copying on the devtools tab', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/workers': {
            body: {
              workers: [
                {
                  id: 'worker-error',
                  name: 'Worker Error',
                  mode: 'cloud_worker',
                  status: 'error',
                  endpoint: 'https://worker-error.internal',
                },
                {
                  id: 'worker-idle',
                  name: 'Worker Idle',
                  mode: 'local',
                  status: 'idle',
                  endpoint: 'http://localhost:9000',
                },
              ],
            },
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    const workerSearchInput = Array.from(rendered.querySelectorAll('input')).find(
      (input) =>
        input instanceof HTMLInputElement &&
        input.placeholder === '搜索 Worker 名称 / id / endpoint…',
    ) as HTMLInputElement | undefined;
    expect(workerSearchInput).toBeDefined();

    await act(async () => {
      if (workerSearchInput) {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setValue?.call(workerSearchInput, 'worker-error');
        workerSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('当前可见：1');
    expect(rendered.textContent).toContain('Worker Error');
    expect(rendered.textContent).toContain('当前 Worker 处于错误态');

    const copyVisibleWorkersButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('复制可见 Worker'),
    );
    expect(copyVisibleWorkersButton).not.toBeNull();

    await act(async () => {
      copyVisibleWorkersButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const writeText = vi.mocked(globalThis.navigator.clipboard.writeText);
    const copiedPayload = writeText.mock.calls.at(-1)?.[0] ?? '';
    expect(copiedPayload).toContain('worker-error');
    expect(copiedPayload).toContain('https://worker-error.internal');
    expect(copiedPayload).not.toContain('worker-idle');
  });

  it('keeps the same selected worker after worker metadata changes on refresh', async () => {
    let workerCallCount = 0;
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/workers': () => {
            workerCallCount += 1;
            if (workerCallCount === 1) {
              return {
                body: {
                  workers: [
                    {
                      id: 'worker-error',
                      name: 'Worker Error',
                      mode: 'cloud_worker',
                      status: 'error',
                      endpoint: 'https://worker-error.internal',
                    },
                    {
                      id: 'worker-idle',
                      name: 'Worker Idle',
                      mode: 'local',
                      status: 'idle',
                      endpoint: 'http://localhost:9000',
                    },
                  ],
                },
              };
            }

            return {
              body: {
                workers: [
                  {
                    id: 'worker-idle',
                    name: 'Worker Idle',
                    mode: 'local',
                    status: 'idle',
                    endpoint: 'http://localhost:9000',
                  },
                  {
                    id: 'worker-error',
                    name: 'Worker Error v2',
                    mode: 'cloud_worker',
                    status: 'error',
                    endpoint: 'https://worker-error-v2.internal',
                  },
                ],
              },
            };
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    const workerErrorButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Worker Error'),
    );
    expect(workerErrorButton).not.toBeNull();

    await act(async () => {
      workerErrorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const refreshWorkerButton = rendered.querySelector(
      'button[aria-label="刷新Worker 状态"]',
    ) as HTMLButtonElement | null;
    expect(refreshWorkerButton).not.toBeNull();

    await act(async () => {
      refreshWorkerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('当前 Worker：Worker Error v2');
    expect(rendered.textContent).toContain('https://worker-error-v2.internal');
  });

  it('refreshes devtools sources after a failed initial load', async () => {
    let devLogsCallCount = 0;
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/dev-logs': () => {
            devLogsCallCount += 1;
            if (devLogsCallCount === 1) {
              return {
                ok: false,
                body: { error: '开发日志首次拉取失败' },
              };
            }

            return {
              body: {
                logs: [
                  {
                    level: 'info',
                    message: 'Recovered after retry',
                    toolName: 'web_search',
                    requestId: 'req-retry',
                    createdAt: '2026-03-21T00:00:01.000Z',
                  },
                ],
              },
            };
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    expect(rendered.textContent).toContain('开发日志首次拉取失败');

    const refreshAllButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('刷新'),
    );
    expect(refreshAllButton).not.toBeNull();

    await act(async () => {
      refreshAllButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('Recovered after retry');
    expect(devLogsCallCount).toBeGreaterThanOrEqual(2);
  });

  it('retries a single devtools source without reloading unrelated sources', async () => {
    let devLogsCallCount = 0;
    let diagnosticsCallCount = 0;

    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/dev-logs': () => {
            devLogsCallCount += 1;
            if (devLogsCallCount === 1) {
              return {
                ok: false,
                body: { error: '开发日志首次拉取失败' },
              };
            }

            return {
              body: {
                logs: [
                  {
                    level: 'info',
                    message: 'Recovered single source retry',
                    toolName: 'web_search',
                    requestId: 'req-single-retry',
                    createdAt: '2026-03-21T00:00:03.000Z',
                  },
                ],
              },
            };
          },
          '/settings/diagnostics': () => {
            diagnosticsCallCount += 1;
            return {
              body: {
                diagnostics: [
                  {
                    filePath: 'web_search',
                    toolName: 'web_search',
                    requestId: 'req-web-search',
                    sessionId: 'session-web-search',
                    durationMs: 183,
                    message: 'Tool error: web_search',
                    severity: 'error',
                    input: { query: 'site:example.com openAWork' },
                    output: { stderr: 'DNS lookup failed' },
                  },
                ],
              },
            };
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    expect(rendered.textContent).toContain('开发日志首次拉取失败');

    const refreshDevLogsButton = rendered.querySelector(
      'button[aria-label="刷新开发日志"]',
    ) as HTMLButtonElement | null;
    expect(refreshDevLogsButton).not.toBeNull();

    await act(async () => {
      refreshDevLogsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('Recovered single source retry');
    expect(devLogsCallCount).toBe(2);
    expect(diagnosticsCallCount).toBe(1);
  });

  it('shows detailed diagnostics after clicking an error item on the devtools tab', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/diagnostics': {
            body: {
              diagnostics: [
                {
                  filePath: 'web_search',
                  toolName: 'web_search',
                  requestId: 'req-web-search',
                  sessionId: 'session-web-search',
                  durationMs: 183,
                  message: 'Tool error: web_search',
                  severity: 'error',
                  input: { query: 'site:example.com openAWork' },
                  output: { stderr: 'DNS lookup failed' },
                },
                {
                  filePath: 'ssh',
                  toolName: 'ssh',
                  requestId: 'req-ssh',
                  sessionId: 'session-ssh',
                  durationMs: 812,
                  message: 'Tool error: ssh',
                  severity: 'error',
                  input: { host: 'example.internal' },
                  output: { stderr: 'Connection refused' },
                },
              ],
            },
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    const detailButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Tool error: ssh'),
    );

    expect(detailButton).not.toBeNull();

    await act(async () => {
      detailButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('请求 ID：req-ssh');
    expect(rendered.textContent).toContain('Connection refused');
    expect(rendered.textContent).toContain('example.internal');
  });

  it('supports filtering and copying visible diagnostics on the devtools tab', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/diagnostics': {
            body: {
              diagnostics: [
                {
                  filePath: 'web_search',
                  toolName: 'web_search',
                  requestId: 'req-web-search',
                  sessionId: 'session-web-search',
                  durationMs: 183,
                  message: 'Tool error: web_search',
                  severity: 'error',
                  input: { query: 'site:example.com openAWork' },
                  output: { stderr: 'DNS lookup failed' },
                },
                {
                  filePath: 'ssh',
                  toolName: 'ssh',
                  requestId: 'req-ssh',
                  sessionId: 'session-ssh',
                  durationMs: 812,
                  message: 'Tool error: ssh',
                  severity: 'error',
                  input: { host: 'example.internal' },
                  output: { stderr: 'Connection refused' },
                },
              ],
            },
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    const searchInput = rendered.querySelector('input[type="search"]') as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();

    await act(async () => {
      if (searchInput) {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setValue?.call(searchInput, 'req-ssh');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('当前可见：1');

    const copyVisibleButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('复制可见错误'),
    );
    expect(copyVisibleButton).not.toBeNull();

    await act(async () => {
      copyVisibleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const writeText = vi.mocked(globalThis.navigator.clipboard.writeText);
    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedPayload = writeText.mock.calls[0]?.[0] ?? '';
    expect(copiedPayload).toContain('req-ssh');
    expect(copiedPayload).toContain('Connection refused');
    expect(copiedPayload).not.toContain('req-web-search');
  });

  it('copies the selected diagnostic and individual payload fields on the devtools tab', async () => {
    const rendered = await renderAt('devtools');

    const copyCurrentButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('复制当前错误'),
    );
    const copyInputButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('复制输入 payload'),
    );
    const copyOutputButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('复制输出 payload'),
    );

    expect(copyCurrentButton).not.toBeNull();
    expect(copyInputButton).not.toBeNull();
    expect(copyOutputButton).not.toBeNull();

    await act(async () => {
      copyCurrentButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      copyInputButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      copyOutputButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const writeText = vi.mocked(globalThis.navigator.clipboard.writeText);
    expect(writeText).toHaveBeenCalledTimes(3);
    expect(writeText.mock.calls[0]?.[0] ?? '').toContain('req-web-search');
    expect(writeText.mock.calls[1]?.[0] ?? '').toContain('site:example.com openAWork');
    expect(writeText.mock.calls[2]?.[0] ?? '').toContain('DNS lookup failed');
  });

  it('keeps selection in sync after filtering and shows clipboard failure feedback', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/diagnostics': {
            body: {
              diagnostics: [
                {
                  filePath: 'web_search',
                  toolName: 'web_search',
                  requestId: 'req-web-search',
                  sessionId: 'session-web-search',
                  durationMs: 183,
                  message: 'Tool error: web_search',
                  severity: 'error',
                  input: { query: 'site:example.com openAWork' },
                  output: { stderr: 'DNS lookup failed' },
                },
                {
                  filePath: 'ssh',
                  toolName: 'ssh',
                  requestId: 'req-ssh',
                  sessionId: 'session-ssh',
                  durationMs: 812,
                  message: 'Tool error: ssh',
                  severity: 'error',
                  input: { host: 'example.internal' },
                  output: { stderr: 'Connection refused' },
                },
              ],
            },
          },
        },
      }),
    );
    vi.mocked(globalThis.navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));

    const rendered = await renderAt('devtools');
    const sshButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Tool error: ssh'),
    );
    const searchInput = rendered.querySelector('input[type="search"]') as HTMLInputElement | null;

    expect(sshButton).not.toBeNull();
    expect(searchInput).not.toBeNull();

    await act(async () => {
      sshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('请求 ID：req-ssh');

    await act(async () => {
      if (searchInput) {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setValue?.call(searchInput, 'req-web-search');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('当前可见：1');
    expect(rendered.textContent).toContain('请求 ID：req-web-search');
    expect(rendered.textContent).not.toContain('请求 ID：req-ssh');

    const copyCurrentButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('复制当前错误'),
    );
    expect(copyCurrentButton).not.toBeNull();

    await act(async () => {
      copyCurrentButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('复制失败：浏览器拒绝了剪贴板写入');
  });

  it('links diagnostics to related logs and lets developers copy the selected log', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/diagnostics': {
            body: {
              diagnostics: [
                {
                  filePath: 'web_search',
                  toolName: 'web_search',
                  requestId: 'req-web-search',
                  sessionId: 'session-web-search',
                  durationMs: 183,
                  message: 'Tool error: web_search',
                  severity: 'error',
                  input: { query: 'site:example.com openAWork' },
                  output: { stderr: 'DNS lookup failed' },
                },
                {
                  filePath: 'ssh',
                  toolName: 'ssh',
                  requestId: 'req-ssh',
                  sessionId: 'session-ssh',
                  durationMs: 812,
                  message: 'Tool error: ssh',
                  severity: 'error',
                  input: { host: 'example.internal' },
                  output: { stderr: 'Connection refused' },
                },
              ],
            },
          },
          '/settings/dev-logs': {
            body: {
              logs: [
                {
                  level: 'error',
                  message: 'SSH connect failed',
                  toolName: 'ssh',
                  requestId: 'req-ssh',
                  sessionId: 'session-ssh',
                  durationMs: 820,
                  input: { host: 'example.internal' },
                  output: { stderr: 'Connection refused' },
                  createdAt: '2026-03-21T00:00:02.000Z',
                },
                {
                  level: 'info',
                  message: 'Tool called',
                  toolName: 'web_search',
                  requestId: 'req-web-search',
                  sessionId: 'session-web-search',
                  durationMs: 183,
                  input: { query: 'site:example.com openAWork' },
                  output: { resultCount: 0 },
                  createdAt: '2026-03-21T00:00:00.000Z',
                },
              ],
            },
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    const sshButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Tool error: ssh'),
    );
    expect(sshButton).not.toBeNull();

    await act(async () => {
      sshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('查看关联日志 (1)');
    expect(rendered.textContent).toContain('当前请求：req-ssh');
    expect(rendered.textContent).toContain('Connection refused');

    const copyCurrentLogButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('复制当前日志'),
    );
    expect(copyCurrentLogButton).not.toBeNull();

    await act(async () => {
      copyCurrentLogButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const writeText = vi.mocked(globalThis.navigator.clipboard.writeText);
    const copiedPayload = writeText.mock.calls.at(-1)?.[0] ?? '';
    expect(copiedPayload).toContain('req-ssh');
    expect(copiedPayload).toContain('Connection refused');
    expect(copiedPayload).toContain('Connection refused');
  });

  it('filters visible logs and copies only the filtered log set', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/dev-logs': {
            body: {
              logs: [
                {
                  level: 'error',
                  message: 'Connection refused',
                  toolName: 'ssh',
                  requestId: 'req-ssh',
                  sessionId: 'session-ssh',
                  durationMs: 820,
                  input: { host: 'example.internal' },
                  output: { stderr: 'Connection refused' },
                  createdAt: '2026-03-21T00:00:02.000Z',
                },
                {
                  level: 'info',
                  message: 'Tool called',
                  toolName: 'web_search',
                  requestId: 'req-web-search',
                  sessionId: 'session-web-search',
                  durationMs: 183,
                  input: { query: 'site:example.com openAWork' },
                  output: { resultCount: 0 },
                  createdAt: '2026-03-21T00:00:00.000Z',
                },
              ],
            },
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    const logSearchInput = Array.from(rendered.querySelectorAll('input')).find(
      (input) =>
        input instanceof HTMLInputElement &&
        input.placeholder === '搜索日志 message / requestId / payload…',
    ) as HTMLInputElement | undefined;

    expect(logSearchInput).toBeDefined();

    await act(async () => {
      if (logSearchInput) {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setValue?.call(logSearchInput, 'req-ssh');
        logSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    const copyVisibleLogsButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('复制可见日志'),
    );
    expect(copyVisibleLogsButton).not.toBeNull();

    await act(async () => {
      copyVisibleLogsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const writeText = vi.mocked(globalThis.navigator.clipboard.writeText);
    const copiedPayload = writeText.mock.calls.at(-1)?.[0] ?? '';
    expect(copiedPayload).toContain('req-ssh');
    expect(copiedPayload).toContain('Connection refused');
    expect(copiedPayload).not.toContain('req-web-search');
  });

  it('keeps the developer event stream and log list within fixed-height panels', async () => {
    const rendered = await renderAt('devtools');

    const eventStream = rendered.querySelector(
      '[data-testid="devtools-event-stream"]',
    ) as HTMLDivElement | null;
    const logList = rendered.querySelector(
      '[data-testid="devtools-log-list"]',
    ) as HTMLDivElement | null;

    expect(eventStream).not.toBeNull();
    expect(logList).not.toBeNull();
    expect(eventStream?.style.maxHeight).toBe('280px');
    expect(logList?.style.maxHeight).toBe('300px');
  });

  it('exports a debug bundle with the current devtools context', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:debug-bundle');
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      value: clickSpy,
    });

    const rendered = await renderAt('devtools');
    const exportButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('导出 JSON'),
    );
    expect(exportButton).not.toBeNull();

    await act(async () => {
      exportButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const exportedBlob = createObjectURL.mock.calls.at(0)?.[0] as Blob | undefined;
    expect(exportedBlob).toBeDefined();
    const exportedText = await exportedBlob?.text();
    expect(exportedText).toContain('selectedDiagnostic');
    expect(exportedText).toContain('req-web-search');
    expect(exportedText).toContain('visibleLogs');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:debug-bundle');
  });

  it('exports a markdown debug bundle with selected worker context', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:debug-bundle-md');
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      value: clickSpy,
    });

    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/workers': {
            body: {
              workers: [
                {
                  id: 'worker-error',
                  name: 'Worker Error',
                  mode: 'cloud_worker',
                  status: 'error',
                  endpoint: 'https://worker-error.internal',
                },
              ],
            },
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    const exportMarkdownButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('导出 MD'),
    );
    expect(exportMarkdownButton).not.toBeNull();

    await act(async () => {
      exportMarkdownButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const exportedBlob = createObjectURL.mock.calls.at(0)?.[0] as Blob | undefined;
    const exportedText = await exportedBlob?.text();
    expect(exportedText).toContain('# Devtools Debug Bundle');
    expect(exportedText).toContain('## Selected Worker');
    expect(exportedText).toContain('## Visible Workers');
    expect(exportedText).toContain('## Related Logs');
    expect(exportedText).toContain('worker-error');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:debug-bundle-md');
  });

  it('auto refreshes devtools sources when auto refresh is enabled', async () => {
    vi.useFakeTimers();
    let devLogsCallCount = 0;

    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/dev-logs': () => {
            devLogsCallCount += 1;
            return {
              body: {
                logs: [
                  {
                    level: 'info',
                    message:
                      devLogsCallCount === 1 ? 'Initial log state' : 'Auto refreshed log state',
                    toolName: 'web_search',
                    requestId: devLogsCallCount === 1 ? 'req-initial' : 'req-auto-refresh',
                    createdAt: '2026-03-21T00:00:05.000Z',
                  },
                ],
              },
            };
          },
        },
      }),
    );

    try {
      const rendered = await renderAt('devtools');
      expect(rendered.textContent).toContain('Initial log state');

      const autoRefreshButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('自动 关'),
      );
      expect(autoRefreshButton).not.toBeNull();

      await act(async () => {
        autoRefreshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(rendered.textContent).toContain('Auto refreshed log state');
      expect(devLogsCallCount).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the error command center with correct counts on the devtools tab', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/diagnostics': {
            body: {
              diagnostics: [
                {
                  filePath: 'web_search',
                  toolName: 'web_search',
                  requestId: 'req-web-search',
                  sessionId: 'session-web-search',
                  durationMs: 183,
                  message: 'Tool error: web_search',
                  severity: 'error',
                  input: { query: 'site:example.com openAWork' },
                  output: { stderr: 'DNS lookup failed' },
                },
              ],
            },
          },
          '/settings/dev-logs': {
            body: {
              logs: [
                {
                  level: 'error',
                  message: 'Error log entry',
                  toolName: 'web_search',
                  requestId: 'req-web-search',
                  createdAt: '2026-03-21T00:00:00.000Z',
                },
              ],
            },
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    expect(rendered.textContent).toContain('错误指挥台');
    expect(rendered.textContent).toContain('全部错误：1');
    expect(rendered.textContent).toContain('当前可见：1');
    expect(rendered.textContent).toContain('错误日志：1');
    expect(rendered.textContent).toContain('1 条错误');
  });

  it('copies the selected error from the error command center', async () => {
    const rendered = await renderAt('devtools');

    const copyCurrentInCmd = Array.from(rendered.querySelectorAll('button')).find(
      (button) =>
        button.textContent?.trim() === '复制当前错误' &&
        button.closest('[data-testid="error-command-center"]') !== null,
    );
    expect(copyCurrentInCmd).not.toBeNull();

    await act(async () => {
      copyCurrentInCmd?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const writeText = vi.mocked(globalThis.navigator.clipboard.writeText);
    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedPayload = writeText.mock.calls[0]?.[0] ?? '';
    expect(copiedPayload).toContain('req-web-search');
  });

  it('exports error JSON from the error command center', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:error-export-json');
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();

    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      value: clickSpy,
    });

    const rendered = await renderAt('devtools');
    const exportJsonButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) =>
        button.textContent?.trim() === '导出错误 JSON' &&
        button.closest('[data-testid="error-command-center"]') !== null,
    );
    expect(exportJsonButton).not.toBeNull();

    await act(async () => {
      exportJsonButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const exportedBlob = createObjectURL.mock.calls.at(0)?.[0] as Blob | undefined;
    const exportedText = await exportedBlob?.text();
    expect(exportedText).toContain('selectedError');
    expect(exportedText).toContain('visibleErrors');
    expect(exportedText).toContain('req-web-search');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:error-export-json');
  });

  it('exports error Markdown from the error command center', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:error-export-md');
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();

    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      value: clickSpy,
    });

    const rendered = await renderAt('devtools');
    const exportMdButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) =>
        button.textContent?.trim() === '导出错误 MD' &&
        button.closest('[data-testid="error-command-center"]') !== null,
    );
    expect(exportMdButton).not.toBeNull();

    await act(async () => {
      exportMdButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const exportedBlob = createObjectURL.mock.calls.at(0)?.[0] as Blob | undefined;
    const exportedText = await exportedBlob?.text();
    expect(exportedText).toContain('# Error Export');
    expect(exportedText).toContain('## Selected Error');
    expect(exportedText).toContain('## Visible Errors');
    expect(exportedText).toContain('req-web-search');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('quick-selects an error from the error command center pill bar', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/diagnostics': {
            body: {
              diagnostics: [
                {
                  filePath: 'web_search',
                  toolName: 'web_search',
                  requestId: 'req-web-search',
                  sessionId: 'session-web-search',
                  durationMs: 183,
                  message: 'Tool error: web_search',
                  severity: 'error',
                  input: { query: 'site:example.com openAWork' },
                  output: { stderr: 'DNS lookup failed' },
                },
                {
                  filePath: 'ssh',
                  toolName: 'ssh',
                  requestId: 'req-ssh',
                  sessionId: 'session-ssh',
                  durationMs: 812,
                  message: 'Tool error: ssh',
                  severity: 'error',
                  input: { host: 'example.internal' },
                  output: { stderr: 'Connection refused' },
                },
              ],
            },
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    const cmdCenter = rendered.querySelector('[data-testid="error-command-center"]');
    expect(cmdCenter).not.toBeNull();

    const sshPill = Array.from(cmdCenter?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'req-ssh',
    );
    expect(sshPill).not.toBeNull();

    await act(async () => {
      sshPill?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('当前请求：req-ssh');
    expect(rendered.textContent).toContain('Connection refused');
  });

  it('does not auto refresh when auto refresh stays disabled', async () => {
    vi.useFakeTimers();
    let devLogsCallCount = 0;

    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/dev-logs': () => {
            devLogsCallCount += 1;
            return {
              body: {
                logs: [
                  {
                    level: 'info',
                    message: 'Initial log state',
                    toolName: 'web_search',
                    requestId: 'req-initial',
                    createdAt: '2026-03-21T00:00:05.000Z',
                  },
                ],
              },
            };
          },
        },
      }),
    );

    try {
      await renderAt('devtools');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
        await Promise.resolve();
      });

      expect(devLogsCallCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces failing devtools sources and backend error details when requests fail', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        endpointResponses: {
          '/settings/dev-logs': {
            ok: false,
            body: { error: '开发日志服务超时' },
          },
          '/settings/workers': {
            ok: false,
            body: { error: 'Worker 服务暂不可用' },
          },
        },
      }),
    );

    const rendered = await renderAt('devtools');
    expect(rendered.textContent).toContain('开发日志加载失败');
    expect(rendered.textContent).toContain('开发日志服务超时');
    expect(rendered.textContent).toContain('Worker 服务暂不可用');
    expect(rendered.textContent).toContain('诊断信息');
    expect(rendered.textContent).toContain('Tool error: web_search');
  });
});
