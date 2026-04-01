// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NavRail from './NavRail.js';
import { useUIStateStore } from '../../stores/uiState.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';

vi.mock('../../routes/preloadable-route-modules.js', () => ({
  preloadRouteModuleByPath: vi.fn(() => null),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  useUIStateStore.setState({
    lastChatPath: '/chat/session-7',
    leftSidebarOpen: true,
    sidebarTab: 'sessions',
    chatView: 'home',
    pinnedSessions: [],
    expandedDirs: [],
    fileTreeRootPath: null,
    workspaceTreeVersion: 0,
    savedWorkspacePaths: [],
    selectedWorkspacePath: null,
    activeSessionWorkspace: null,
    editorMode: false,
    splitPos: 50,
    openFilePaths: [],
    activeFilePath: null,
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
  vi.restoreAllMocks();
});

async function renderNavRail(initialEntry = '/settings') {
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <NavRail clearAuth={() => undefined} />
      </MemoryRouter>,
    );
  });

  return container!;
}

describe('NavRail route preloading', () => {
  it('does not render removed workflow-related rail items', async () => {
    const rendered = await renderNavRail('/chat');

    expect(rendered.textContent).not.toContain('工作流');
    expect(rendered.textContent).not.toContain('Prompt 优化');
    expect(rendered.textContent).not.toContain('翻译工作流');
    expect(rendered.textContent).not.toContain('团队');
  });

  it('preloads the resolved chat route on pointer intent', async () => {
    const rendered = await renderNavRail();
    const chatLink = Array.from(rendered.querySelectorAll('a')).find(
      (link) => link.textContent?.trim() === '对话',
    );

    act(() => {
      chatLink?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

    expect(preloadRouteModuleByPath).toHaveBeenCalledWith('/chat/session-7');
  });

  it('preloads settings when the settings rail item receives focus', async () => {
    const rendered = await renderNavRail('/chat');
    const settingsLink = Array.from(rendered.querySelectorAll('a')).find(
      (link) => link.textContent?.trim() === '设置',
    );

    act(() => {
      settingsLink?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });

    expect(preloadRouteModuleByPath).toHaveBeenCalledWith('/settings');
  });
});
