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

    if (url.pathname.endsWith('/workflows/templates') && method === 'GET') {
      return {
        ok: true,
        json: async () => [
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
        ],
      } as Response;
    }

    if (url.pathname.endsWith('/workflows/templates') && method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          id: 'workflow-2',
          name: '新模板',
          description: '保存后的流程模板',
          category: 'team-playbook',
          nodes: [
            { id: 'node-start', label: '开始', type: 'start' },
            { id: 'node-end', label: '结束', type: 'end' },
          ],
          edges: [{ id: 'edge-start-end', source: 'node-start', target: 'node-end' }],
        }),
      } as Response;
    }

    if (url.pathname.includes('/workflows/templates/') && method === 'DELETE') {
      return { ok: true, status: 204 } as Response;
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
  const { default: WorkflowsPage } = await import('./WorkflowsPage.js');
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/workflows']}>
        <WorkflowsPage />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('WorkflowsPage', () => {
  it('renders existing workflow templates and the canvas workspace', async () => {
    await renderPage();

    expect(container?.textContent).toContain('工作流工作台');
    expect(container?.textContent).toContain('审批流模板');
    expect(container?.textContent).toContain('节点检查器');
    const launchLink = Array.from(container?.querySelectorAll('a') ?? []).find((anchor) =>
      anchor.textContent?.includes('在 Team 中发起'),
    ) as HTMLAnchorElement | undefined;
    expect(launchLink?.getAttribute('href')).toContain('/team?workflowTemplateId=workflow-1');
  });

  it('saves the current draft as a template', async () => {
    await renderPage();

    const saveToggle = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('另存为模板'),
    );
    expect(saveToggle).toBeTruthy();

    await act(async () => {
      saveToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const nameInput = Array.from(container?.querySelectorAll('input') ?? []).find(
      (input) => input.getAttribute('placeholder') === '模板名称',
    ) as HTMLInputElement | undefined;
    const saveButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('保存'),
    );
    expect(nameInput).toBeTruthy();
    expect(saveButton).toBeTruthy();

    await act(async () => {
      if (nameInput) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(nameInput, '新模板');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/workflows/templates',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
