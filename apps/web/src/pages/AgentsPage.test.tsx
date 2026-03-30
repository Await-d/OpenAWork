// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentsPage from './AgentsPage.js';
import { useAuthStore } from '../stores/auth.js';

const requestLog: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const rawUrl =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(rawUrl, 'http://localhost:3000');
  const method = init?.method ?? 'GET';

  if (url.pathname === '/agents' && method === 'GET') {
    return {
      ok: true,
      json: async () => ({
        agents: [
          {
            id: 'oracle',
            origin: 'builtin',
            source: 'builtin',
            enabled: true,
            removable: false,
            resettable: true,
            hasOverrides: true,
            createdAt: '1970-01-01T00:00:00.000Z',
            updatedAt: new Date().toISOString(),
            label: '架构顾问',
            description: '只读顾问 agent',
            aliases: ['architect', 'debugger'],
            canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
            model: 'gpt-5.4',
            variant: 'high',
            fallbackModels: ['claude-opus-4-6', 'kimi-k2.5'],
            note: '优先用于方案评审',
            systemPrompt: 'Review architecture carefully',
          },
          {
            id: 'custom-reviewer',
            origin: 'custom',
            source: 'custom',
            enabled: false,
            removable: true,
            resettable: true,
            hasOverrides: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            label: '自定义评审员',
            description: '自定义评审 agent',
            aliases: ['review-bot'],
            canonicalRole: { coreRole: 'reviewer', preset: 'critic', confidence: 'medium' },
            model: 'claude-sonnet-4-6',
            note: '已禁用',
          },
        ],
      }),
    } as Response;
  }

  if (url.pathname === '/agents' && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestLog.push({ method, path: url.pathname, body });
    return {
      ok: true,
      json: async () => ({
        agent: {
          id: 'custom-debugger',
          origin: 'custom',
          source: 'custom',
          enabled: body['enabled'] ?? true,
          removable: true,
          resettable: false,
          hasOverrides: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          label: body['label'],
          description: body['description'] ?? '',
          aliases: body['aliases'] ?? [],
          canonicalRole: body['canonicalRole'],
          model: body['model'],
          variant: body['variant'],
          fallbackModels: body['fallbackModels'] ?? [],
          systemPrompt: body['systemPrompt'],
          note: body['note'],
        },
      }),
    } as Response;
  }

  if (url.pathname === '/agents/oracle' && method === 'PUT') {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestLog.push({ method, path: url.pathname, body });
    return {
      ok: true,
      json: async () => ({
        agent: {
          id: 'oracle',
          origin: 'builtin',
          source: 'builtin',
          enabled: body['enabled'] ?? true,
          removable: false,
          resettable: true,
          hasOverrides: true,
          createdAt: '1970-01-01T00:00:00.000Z',
          updatedAt: new Date().toISOString(),
          label: body['label'] ?? '架构顾问',
          description: body['description'] ?? '只读顾问 agent',
          aliases: body['aliases'] ?? ['architect', 'debugger'],
          canonicalRole: body['canonicalRole'] ?? {
            coreRole: 'planner',
            preset: 'architect',
            confidence: 'medium',
          },
          model: body['model'] ?? 'gpt-5.4',
          variant: body['variant'] ?? 'high',
          fallbackModels: body['fallbackModels'] ?? ['claude-opus-4-6', 'kimi-k2.5'],
          systemPrompt: body['systemPrompt'] ?? 'Review architecture carefully',
          note: body['note'] ?? '优先用于方案评审',
        },
      }),
    } as Response;
  }

  if (url.pathname === '/agents/custom-reviewer' && method === 'DELETE') {
    requestLog.push({ method, path: url.pathname });
    return { ok: true, status: 204, json: async () => ({}) } as Response;
  }

  if (url.pathname === '/agents/oracle/reset' && method === 'POST') {
    requestLog.push({ method, path: url.pathname });
    return {
      ok: true,
      json: async () => ({
        agent: {
          id: 'oracle',
          origin: 'builtin',
          source: 'builtin',
          enabled: true,
          removable: false,
          resettable: false,
          hasOverrides: false,
          createdAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '1970-01-01T00:00:00.000Z',
          label: 'oracle',
          description: '只读顾问 agent',
          aliases: ['architect', 'debugger', 'code-reviewer', 'init-architect'],
          canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
          model: 'gpt-5.4',
          variant: 'high',
          fallbackModels: ['claude-opus-4-6', 'kimi-k2.5'],
        },
      }),
    } as Response;
  }

  if (url.pathname === '/agents/reset-all' && method === 'POST') {
    requestLog.push({ method, path: url.pathname });
    return {
      ok: true,
      json: async () => ({
        agents: [
          {
            id: 'oracle',
            origin: 'builtin',
            source: 'builtin',
            enabled: true,
            removable: false,
            resettable: false,
            hasOverrides: false,
            createdAt: '1970-01-01T00:00:00.000Z',
            updatedAt: '1970-01-01T00:00:00.000Z',
            label: 'oracle',
            description: '只读顾问 agent',
            aliases: ['architect', 'debugger', 'code-reviewer', 'init-architect'],
            canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
          },
        ],
      }),
    } as Response;
  }

  throw new Error(`Unhandled fetch path: ${method} ${url.pathname}`);
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  requestLog.length = 0;
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

describe('AgentsPage', () => {
  it('loads agents, updates a builtin agent, and resets it to default', async () => {
    await act(async () => {
      root!.render(<AgentsPage />);
    });
    await flushEffects();

    const rendered = container!;
    expect(rendered.textContent).toContain('Agent 管理');
    expect(rendered.textContent).toContain('架构顾问');
    expect(rendered.textContent).toContain('规划 / 架构');
    expect(rendered.textContent).toContain('默认模型 gpt-5.4');

    const nameInput = rendered.querySelector(
      'input[placeholder="例如：架构顾问"]',
    ) as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(nameInput, '首席架构顾问');
      nameInput!.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const modelInput = rendered.querySelector(
      'input[placeholder="例如：openai/gpt-5.4 或 gpt-5.4"]',
    ) as HTMLInputElement | null;
    expect(modelInput).not.toBeNull();
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(modelInput, 'openai/gpt-5.4-mini');
      modelInput!.dispatchEvent(new Event('input', { bubbles: true }));
      modelInput!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const fallbackInput = rendered.querySelector(
      'textarea[placeholder="例如：claude-opus-4-6, gpt-5.4, kimi-k2.5"]',
    ) as HTMLTextAreaElement | null;
    expect(fallbackInput).not.toBeNull();
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      descriptor?.set?.call(fallbackInput, 'claude-opus-4-6, kimi-k2.5');
      fallbackInput!.dispatchEvent(new Event('input', { bubbles: true }));
      fallbackInput!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('保存 Agent 实体'),
    );
    expect(saveButton).not.toBeNull();
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushEffects();

    expect(
      requestLog.some((entry) => entry.method === 'PUT' && entry.path === '/agents/oracle'),
    ).toBe(true);
    expect(
      requestLog.some(
        (entry) =>
          entry.method === 'PUT' &&
          entry.path === '/agents/oracle' &&
          entry.body?.['model'] === 'openai/gpt-5.4-mini' &&
          JSON.stringify(entry.body?.['fallbackModels']) ===
            JSON.stringify(['claude-opus-4-6', 'kimi-k2.5']),
      ),
    ).toBe(true);
    expect(rendered.textContent).toContain('首席架构顾问');

    const resetButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '恢复默认',
    );
    expect(resetButton).not.toBeNull();
    await act(async () => {
      resetButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushEffects();

    expect(
      requestLog.some((entry) => entry.method === 'POST' && entry.path === '/agents/oracle/reset'),
    ).toBe(true);
    expect(rendered.textContent).toContain('oracle');
  });

  it('creates a custom agent and removes an existing custom agent', async () => {
    await act(async () => {
      root!.render(<AgentsPage />);
    });
    await flushEffects();

    const rendered = container!;
    const newButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('新增自定义 Agent'),
    );
    expect(newButton).not.toBeNull();
    await act(async () => {
      newButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushEffects();

    const nameInput = rendered.querySelector(
      'input[placeholder="例如：架构顾问"]',
    ) as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(nameInput, '自定义调试助手');
      nameInput!.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const createButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('创建 Agent'),
    );
    expect(createButton).not.toBeNull();
    await act(async () => {
      createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushEffects();

    expect(requestLog.some((entry) => entry.method === 'POST' && entry.path === '/agents')).toBe(
      true,
    );
    expect(rendered.textContent).toContain('custom-debugger');

    const customAgentButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) =>
        button.textContent?.includes('自定义评审员') &&
        button.textContent?.includes('custom-reviewer'),
    );
    expect(customAgentButton).not.toBeNull();
    await act(async () => {
      customAgentButton!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    await flushEffects();

    const removeButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('移除 Agent'),
    );
    expect(removeButton).not.toBeNull();
    await act(async () => {
      removeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushEffects();

    expect(
      requestLog.some(
        (entry) => entry.method === 'DELETE' && entry.path === '/agents/custom-reviewer',
      ),
    ).toBe(true);
  });

  it('toggles builtin enabled state and triggers reset-all action', async () => {
    await act(async () => {
      root!.render(<AgentsPage />);
    });
    await flushEffects();

    const rendered = container!;
    const toggleButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('禁用 Agent'),
    );
    expect(toggleButton).not.toBeNull();

    await act(async () => {
      toggleButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushEffects();

    expect(
      requestLog.some((entry) => entry.method === 'PUT' && entry.path === '/agents/oracle'),
    ).toBe(true);
    expect(rendered.textContent).toContain('已禁用');

    const resetAllButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('全部恢复默认'),
    );
    expect(resetAllButton).not.toBeNull();

    await act(async () => {
      resetAllButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushEffects();

    expect(
      requestLog.some((entry) => entry.method === 'POST' && entry.path === '/agents/reset-all'),
    ).toBe(true);
    expect(rendered.textContent).toContain('oracle');
  });
});
