// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHistoryTabContent, ChatOverviewTabContent } from './right-panel-sections.js';

vi.mock('@openAwork/shared-ui', () => ({
  ContextPanel: ({
    items,
    totalTokens,
    tokenLimit,
  }: {
    items: Array<{ label: string }>;
    totalTokens?: number;
    tokenLimit?: number;
  }) => (
    <div data-testid="mock-context-panel">
      {items.map((item) => item.label).join('|')}|{totalTokens ?? 0}|{tokenLimit ?? 0}
    </div>
  ),
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
            contextUsageSnapshot={{ estimated: true, maxTokens: 200_000, usedTokens: 50_000 }}
            contentArtifactCount={3}
            contentArtifactCountStatus="ready"
            currentSessionId="session-1"
            dialogueMode="coding"
            effectiveWorkingDirectory="/workspace"
            messages={[]}
            onCompactSession={() => undefined}
            onOpenRecoveryStrategy={() => undefined}
            pendingPermissions={[]}
            pendingQuestionsCount={0}
            sessionStateStatus="running"
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
    expect(container?.textContent).toContain('恢复策略');
    expect(container?.textContent).toContain('运行恢复已就绪');
    expect(container?.textContent).toContain('上下文窗口');
    expect(container?.textContent).toContain('估算用量 25%');
    expect(container?.textContent).toContain('立即压缩会话');

    const workspaceLink = container?.querySelector('a');
    expect(workspaceLink?.getAttribute('href')).toBe('/artifacts?sessionId=session-1');
  });

  it('does not count cancelled todos as active in lane badges', async () => {
    await act(async () => {
      root!.render(
        <ChatHistoryTabContent
          childSessions={[]}
          compactions={[]}
          pendingPermissions={[]}
          planHistory={[]}
          sessionTodos={[
            {
              content: '继续推进主任务',
              lane: 'main' as const,
              status: 'in_progress' as const,
              priority: 'high' as const,
            },
            {
              content: '取消的临时想法',
              lane: 'temp' as const,
              status: 'cancelled' as const,
              priority: 'low' as const,
            },
          ]}
          sessionTasks={[]}
          onOpenSession={() => undefined}
          sharedUiThemeVars={{}}
        />,
      );
    });

    expect(container?.textContent).toContain('主待办1/1');
    expect(container?.textContent).toContain('临时待办0/1');
  });

  it('does not count cancelled todos as active in overview mode', async () => {
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <ChatOverviewTabContent
            attachmentItems={[]}
            artifactsWorkspaceHref={null}
            childSessions={[]}
            compactions={[]}
            contextUsageSnapshot={{ estimated: true, maxTokens: 200_000, usedTokens: 50_000 }}
            contentArtifactCount={0}
            contentArtifactCountStatus="ready"
            currentSessionId="session-1"
            dialogueMode="coding"
            effectiveWorkingDirectory="/workspace"
            messages={[]}
            onCompactSession={() => undefined}
            onOpenRecoveryStrategy={() => undefined}
            pendingPermissions={[]}
            pendingQuestionsCount={0}
            sessionStateStatus="running"
            sessionTodos={[
              {
                content: '继续推进主任务',
                lane: 'main' as const,
                status: 'in_progress' as const,
                priority: 'high' as const,
              },
              {
                content: '取消的临时想法',
                lane: 'temp' as const,
                status: 'cancelled' as const,
                priority: 'low' as const,
              },
            ]}
            sessionTasks={[]}
            workspaceFileItems={[]}
            yoloMode={false}
          />
        </MemoryRouter>,
      );
    });

    expect(container?.textContent).toContain('主待办1/1 项');
    expect(container?.textContent).toContain('临时待办0/1 项');
  });

  it('triggers compact action from the overview context section', async () => {
    const onCompactSession = vi.fn();
    const onOpenRecoveryStrategy = vi.fn();

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <ChatOverviewTabContent
            attachmentItems={[]}
            artifactsWorkspaceHref={null}
            childSessions={[]}
            compactions={[]}
            contextUsageSnapshot={{ estimated: false, maxTokens: 200_000, usedTokens: 182_000 }}
            contentArtifactCount={0}
            contentArtifactCountStatus="ready"
            currentSessionId="session-1"
            dialogueMode="clarify"
            effectiveWorkingDirectory="/workspace"
            messages={[]}
            onCompactSession={onCompactSession}
            onOpenRecoveryStrategy={onOpenRecoveryStrategy}
            pendingPermissions={[]}
            pendingQuestionsCount={1}
            sessionStateStatus="paused"
            sessionTodos={[]}
            sessionTasks={[]}
            workspaceFileItems={[]}
            yoloMode={false}
          />
        </MemoryRouter>,
      );
    });

    const compactButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('立即压缩会话'),
    );
    expect(compactButton).toBeTruthy();

    act(() => {
      compactButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onCompactSession).toHaveBeenCalledTimes(1);

    const recoveryButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('打开恢复详情'),
    );
    expect(recoveryButton).toBeTruthy();

    act(() => {
      recoveryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onOpenRecoveryStrategy).toHaveBeenCalledTimes(1);
  });

  it('renders timeout terminal reasons in the session task section', async () => {
    await act(async () => {
      root!.render(
        <ChatHistoryTabContent
          childSessions={[]}
          compactions={[]}
          pendingPermissions={[]}
          planHistory={[]}
          sessionTodos={[]}
          sessionTasks={[
            {
              id: 'task-timeout-1',
              title: '等待子代理首响应',
              status: 'failed',
              blockedBy: [],
              completedSubtaskCount: 0,
              readySubtaskCount: 0,
              priority: 'high',
              tags: ['task-tool'],
              createdAt: 1,
              updatedAt: 2,
              depth: 0,
              subtaskCount: 0,
              unmetDependencyCount: 0,
              terminalReason: 'timeout',
            },
          ]}
          onOpenSession={() => undefined}
          sharedUiThemeVars={{}}
        />,
      );
    });

    expect(container?.textContent).toContain('执行超时');
    expect(container?.textContent).toContain('子任务执行超时');
  });
});
