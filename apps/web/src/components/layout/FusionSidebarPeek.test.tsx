// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../hooks/workspace/useSessions.js';
import type { WorkspaceSessionTreeNode } from '../../utils/session/session-grouping.js';
import { FusionSidebarPeek } from './FusionSidebarPeek.js';

function createSession(
  id: string,
  title: string,
  state_status: Session['state_status'] = 'idle',
): Session {
  return {
    id,
    state_status,
    title,
    updated_at: '2026-07-07T08:00:00.000Z',
  };
}

function createNode(
  session: Session,
  children: WorkspaceSessionTreeNode<Session>[] = [],
): WorkspaceSessionTreeNode<Session> {
  return { children, session };
}

function renderPeek(
  nodes: readonly WorkspaceSessionTreeNode<Session>[],
  props: Partial<Parameters<typeof FusionSidebarPeek>[0]> = {},
) {
  return render(
    <FusionSidebarPeek
      activeSessionId={null}
      nodes={nodes}
      onCreateSession={vi.fn()}
      onMouseEnter={vi.fn()}
      onMouseLeave={vi.fn()}
      onSelectSession={vi.fn()}
      workspacePath="/home/await/project/OpenAWork"
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('FusionSidebarPeek', () => {
  it('按深度优先展示会话预览，并限制最多 8 条', () => {
    const nodes = [
      createNode(createSession('session-1', 'Session 1'), [
        createNode(createSession('session-2', 'Session 2')),
        createNode(createSession('session-3', 'Session 3')),
      ]),
      createNode(createSession('session-4', 'Session 4')),
      createNode(createSession('session-5', 'Session 5'), [
        createNode(createSession('session-6', 'Session 6')),
        createNode(createSession('session-7', 'Session 7')),
        createNode(createSession('session-8', 'Session 8')),
        createNode(createSession('session-9', 'Session 9')),
      ]),
    ];

    renderPeek(nodes);

    expect(screen.getByRole('complementary', { name: '工作区会话预览' })).not.toBeNull();
    for (const title of [
      'Session 1',
      'Session 2',
      'Session 3',
      'Session 4',
      'Session 5',
      'Session 6',
      'Session 7',
      'Session 8',
    ]) {
      expect(screen.getByRole('button', { name: title })).not.toBeNull();
    }
    expect(screen.queryByRole('button', { name: 'Session 9' })).toBeNull();
  });

  it('点击会话行选择对应 session，并标出当前运行会话', () => {
    const onSelectSession = vi.fn();
    const nodes = [
      createNode(createSession('session-1', 'First')),
      createNode(createSession('session-2', 'Second', 'running')),
    ];

    renderPeek(nodes, { activeSessionId: 'session-2', onSelectSession });

    const activeButton = screen.getByRole('button', { name: /Second/ });
    expect(activeButton.getAttribute('style')).toContain('var(--accent-subtle)');
    expect(screen.getByLabelText('运行中')).not.toBeNull();

    fireEvent.click(activeButton);

    expect(onSelectSession).toHaveBeenCalledWith('session-2');
  });

  it('空预览保留新建会话入口', () => {
    const onCreateSession = vi.fn();

    renderPeek([], { onCreateSession, workspacePath: null });

    expect(screen.getByText('暂无会话')).not.toBeNull();
    expect(screen.getByText('OpenAWork')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });
});
