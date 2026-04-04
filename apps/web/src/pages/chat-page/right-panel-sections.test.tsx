// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHistoryTabContent, ChatOverviewTabContent } from './right-panel-sections.js';

vi.mock('@openAwork/shared-ui', () => ({
  PlanHistoryPanel: () => null,
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

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
});

describe('right panel todo sections', () => {
  const sessionTodos = [
    {
      content: 'Inspect gateway sandbox',
      lane: 'main' as const,
      status: 'in_progress' as const,
      priority: 'high' as const,
    },
    {
      content: 'Add tests',
      lane: 'temp' as const,
      status: 'completed' as const,
      priority: 'medium' as const,
    },
  ];

  it('renders the session todo panel in history mode', async () => {
    await act(async () => {
      root!.render(
        <ChatHistoryTabContent
          childSessions={[]}
          compactions={[]}
          pendingPermissions={[]}
          planHistory={[]}
          sessionTodos={sessionTodos}
          sessionTasks={[]}
          onOpenSession={() => undefined}
          sharedUiThemeVars={{}}
        />,
      );
    });

    expect(container?.textContent).toContain('主待办');
    expect(container?.textContent).toContain('临时待办');
    expect(container?.textContent).toContain('Inspect gateway sandbox');
    expect(container?.textContent).toContain('Add tests');
    expect(container?.textContent).toContain('进行中');
    expect(container?.textContent).toContain('高优先级');
  });

  it('renders todo counts in overview mode', async () => {
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <ChatOverviewTabContent
            attachmentItems={[]}
            artifactsWorkspaceHref="/artifacts?sessionId=session-1"
            childSessions={[]}
            compactions={[]}
            contentArtifactCount={3}
            contentArtifactCountStatus="ready"
            currentSessionId="session-1"
            dialogueMode="coding"
            effectiveWorkingDirectory="/workspace"
            messages={[]}
            pendingPermissions={[]}
            sessionTodos={sessionTodos}
            sessionTasks={[]}
            workspaceFileItems={[]}
            yoloMode={false}
          />
        </MemoryRouter>,
      );
    });

    expect(container?.textContent).toContain('待办');
    expect(container?.textContent).toContain('主待办');
    expect(container?.textContent).toContain('临时待办');
    expect(container?.textContent).toContain('1/1 项');
    expect(container?.textContent).toContain('当前会话 · 3 个');
    expect(container?.textContent).toContain('打开产物工作区');

    const workspaceLink = container?.querySelector('a');
    expect(workspaceLink?.getAttribute('href')).toBe('/artifacts?sessionId=session-1');
  });
});
