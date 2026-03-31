// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkillsPage from './SkillsPage.js';
import { useAuthStore } from '../stores/auth.js';

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const rawUrl =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(rawUrl, 'http://localhost:3000');

  if (url.pathname.endsWith('/skills/search')) {
    return {
      ok: true,
      json: async () => ({
        skills: [
          {
            id: 'skill-1',
            displayName: '高阶调试技能',
            version: '1.0.0',
            description: '用于复杂调试工作流',
            category: 'engineering',
            tags: ['debug'],
            downloads: 12,
            verified: true,
            sourceId: 'community-source',
          },
        ],
        total: 1,
      }),
    } as Response;
  }

  if (url.pathname.endsWith('/skills/installed')) {
    return {
      ok: true,
      json: async () => ({
        skills: [
          {
            skillId: 'installed-skill',
            manifest: { name: '已安装技能', version: '2.0.0' },
            sourceId: 'builtin',
            enabled: true,
          },
        ],
      }),
    } as Response;
  }

  if (url.pathname.endsWith('/skills/registry-sources')) {
    return {
      ok: true,
      json: async () => ({
        sources: [
          {
            id: 'community-source',
            name: '社区源',
            url: 'https://registry.example.com',
            type: 'community',
            enabled: true,
            trust: 'verified',
          },
        ],
      }),
    } as Response;
  }

  if (url.pathname.endsWith('/skills/registry-sources/sync')) {
    return { ok: true, json: async () => ({}) } as Response;
  }

  if (url.pathname.endsWith('/skills/local/discover')) {
    return {
      ok: true,
      json: async () => ({
        skills: [
          {
            id: 'skill-1',
            displayName: '工作区技能',
            version: '0.1.0',
            description: '来自当前工作区的本地技能',
            category: 'other',
            tags: ['workspace'],
            sourceId: 'local-workspace',
            dirPath: '/workspace/skills/local-skill',
            manifestPath: '/workspace/skills/local-skill/skill.yaml',
            workspaceRelativePath: 'skills/local-skill',
          },
        ],
      }),
    } as Response;
  }

  if (url.pathname.endsWith('/skills/install') && init?.method === 'POST') {
    return { ok: true, json: async () => ({ installed: true }) } as Response;
  }

  if (url.pathname.endsWith('/skills/local/install') && init?.method === 'POST') {
    return { ok: true, json: async () => ({ installed: true }) } as Response;
  }

  throw new Error(`Unhandled fetch path: ${url.pathname}`);
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SkillsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
    useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });

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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it('renders hero stats and installed workspace with the new layout shell', async () => {
    await act(async () => {
      root!.render(<SkillsPage />);
    });
    await flush();

    const rendered = container!;
    expect(rendered.textContent).toContain('技能市场');
    expect(rendered.textContent).toContain('市场技能');
    expect(rendered.textContent).toContain('已安装');
    expect(rendered.textContent).toContain('注册源');

    const installedTab = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('已安装'),
    );
    expect(installedTab).not.toBeNull();

    await act(async () => {
      installedTab!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(120);
    });
    await flush();

    expect(rendered.textContent).toContain('已安装技能');
    expect(rendered.textContent).toContain('注册源管理');

    const localTab = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('本地'),
    );
    expect(localTab).not.toBeNull();

    await act(async () => {
      localTab!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(120);
    });
    await flush();

    expect(rendered.textContent).toContain('本地工作区技能');
    expect(rendered.textContent).toContain('工作区技能');
  });

  it('installs market skills through the market endpoint even when a local skill shares the same id', async () => {
    await act(async () => {
      root!.render(<SkillsPage />);
    });
    await flush();

    const marketInstallButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent === '安装',
    );
    expect(marketInstallButton).not.toBeNull();

    await act(async () => {
      marketInstallButton!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    const installCalls = fetchMock.mock.calls.filter(([request, options]) => {
      const rawUrl =
        typeof request === 'string'
          ? request
          : request instanceof URL
            ? request.toString()
            : request.url;
      return rawUrl.includes('/skills/install') && options?.method === 'POST';
    });
    const localInstallCalls = fetchMock.mock.calls.filter(([request, options]) => {
      const rawUrl =
        typeof request === 'string'
          ? request
          : request instanceof URL
            ? request.toString()
            : request.url;
      return rawUrl.includes('/skills/local/install') && options?.method === 'POST';
    });

    expect(installCalls).toHaveLength(1);
    expect(localInstallCalls).toHaveLength(0);
  });
});
