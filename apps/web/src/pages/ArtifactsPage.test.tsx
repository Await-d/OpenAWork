// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArtifactsPage from './ArtifactsPage.js';
import { useAuthStore } from '../stores/auth.js';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value?: string; onChange?: (value: string) => void }) => (
    <textarea
      aria-label="artifact-editor"
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
}));

const baseArtifact = {
  id: 'artifact-1',
  sessionId: 'session-1',
  userId: 'user-a',
  type: 'markdown',
  title: '设计稿.md',
  content: '# 初始内容\n\n- 第一版',
  version: 1,
  parentVersionId: null,
  metadata: {},
  createdAt: '2026-04-04T10:00:00.000Z',
  updatedAt: '2026-04-04T10:00:00.000Z',
} as const;

const targetedArtifact = {
  ...baseArtifact,
  id: 'artifact-2',
  sessionId: 'session-2',
  title: '定向产物.md',
  content: '# 定向内容\n\n- 第二会话',
  updatedAt: '2026-04-04T11:00:00.000Z',
} as const;

describe('ArtifactsPage', () => {
  let container: HTMLDivElement;
  let root: Root;
  let saved = false;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://localhost:3000');

    if (url.pathname === '/sessions' && (!init?.method || init.method === 'GET')) {
      return {
        ok: true,
        json: async () => ({
          sessions: [
            {
              id: 'session-1',
              title: 'Artifact 设计会话',
              updated_at: '2026-04-04T10:00:00.000Z',
            },
            {
              id: 'session-2',
              title: '定向产物会话',
              updated_at: '2026-04-04T11:00:00.000Z',
            },
          ],
        }),
      } as Response;
    }

    if (url.pathname === '/sessions/session-1/artifacts') {
      return {
        ok: true,
        json: async () => ({
          contentArtifacts: [
            {
              ...baseArtifact,
              content: saved ? '# 已保存内容\n\n- 第二版' : baseArtifact.content,
              version: saved ? 2 : 1,
              updatedAt: saved ? '2026-04-04T10:10:00.000Z' : baseArtifact.updatedAt,
            },
          ],
        }),
      } as Response;
    }

    if (url.pathname === '/sessions/session-2/artifacts') {
      return {
        ok: true,
        json: async () => ({
          contentArtifacts: [targetedArtifact],
        }),
      } as Response;
    }

    if (
      url.pathname === '/artifacts/artifact-1/versions' &&
      (!init?.method || init.method === 'GET')
    ) {
      return {
        ok: true,
        json: async () => ({
          artifact: {
            ...baseArtifact,
            content: saved ? '# 已保存内容\n\n- 第二版' : baseArtifact.content,
            version: saved ? 2 : 1,
            updatedAt: saved ? '2026-04-04T10:10:00.000Z' : baseArtifact.updatedAt,
          },
          versions: saved
            ? [
                {
                  id: 'version-2',
                  artifactId: 'artifact-1',
                  versionNumber: 2,
                  content: '# 已保存内容\n\n- 第二版',
                  diffFromPrevious: [],
                  createdBy: 'user',
                  createdByNote: null,
                  createdAt: '2026-04-04T10:10:00.000Z',
                },
                {
                  id: 'version-1',
                  artifactId: 'artifact-1',
                  versionNumber: 1,
                  content: baseArtifact.content,
                  diffFromPrevious: [],
                  createdBy: 'agent',
                  createdByNote: null,
                  createdAt: '2026-04-04T10:00:00.000Z',
                },
              ]
            : [
                {
                  id: 'version-1',
                  artifactId: 'artifact-1',
                  versionNumber: 1,
                  content: baseArtifact.content,
                  diffFromPrevious: [],
                  createdBy: 'agent',
                  createdByNote: null,
                  createdAt: '2026-04-04T10:00:00.000Z',
                },
              ],
        }),
      } as Response;
    }

    if (
      url.pathname === '/artifacts/artifact-2/versions' &&
      (!init?.method || init.method === 'GET')
    ) {
      return {
        ok: true,
        json: async () => ({
          artifact: targetedArtifact,
          versions: [
            {
              id: 'version-21',
              artifactId: 'artifact-2',
              versionNumber: 1,
              content: targetedArtifact.content,
              diffFromPrevious: [],
              createdBy: 'agent',
              createdByNote: null,
              createdAt: targetedArtifact.updatedAt,
            },
          ],
        }),
      } as Response;
    }

    if (url.pathname === '/artifacts/artifact-1' && init?.method === 'PUT') {
      saved = true;
      return {
        ok: true,
        json: async () => ({
          artifact: {
            ...baseArtifact,
            content: '# 已保存内容\n\n- 第二版',
            version: 2,
            updatedAt: '2026-04-04T10:10:00.000Z',
          },
        }),
      } as Response;
    }

    throw new Error(`Unhandled fetch: ${init?.method ?? 'GET'} ${url.pathname}`);
  });

  beforeEach(() => {
    saved = false;
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({
      accessToken: 'token-123',
      gatewayUrl: 'http://localhost:3000',
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function renderPage(initialEntry = '/artifacts'): Promise<void> {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <ArtifactsPage />
        </MemoryRouter>,
      );
    });
  }

  it('loads real session-backed artifacts into the workbench', async () => {
    await renderPage();
    await flush();
    await flush();

    expect(container.textContent).toContain('Artifact 设计会话');
    expect(container.textContent).toContain('设计稿.md');
    expect(container.textContent).toContain('版本历史');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });

  it('saves edited artifact drafts through the new update API', async () => {
    await renderPage();
    await flush();
    await flush();

    const titleInput = container.querySelector(
      'input[name="artifact-title"]',
    ) as HTMLInputElement | null;
    expect(titleInput).toBeTruthy();
    await act(async () => {
      if (titleInput) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(titleInput, '设计稿-已更新.md');
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await flush();

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '保存更改',
    );
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    await flush();

    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).includes('/artifacts/artifact-1') &&
        (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(putCall).toBeTruthy();
    expect(JSON.parse(String((putCall?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      content: '# 初始内容\n\n- 第一版',
      title: '设计稿-已更新.md',
      createdBy: 'user',
    });
    expect(container.textContent).toContain('v2');
  });

  it('honors the sessionId query param when opening the workspace', async () => {
    await renderPage('/artifacts?sessionId=session-2');
    await flush();
    await flush();

    expect(container.textContent).toContain('定向产物会话');
    expect(container.textContent).toContain('定向产物.md');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/sessions/session-2/artifacts',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });
});
