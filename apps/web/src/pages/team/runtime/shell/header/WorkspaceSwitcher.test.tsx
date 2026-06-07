// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamWorkspaceSummary } from '@openAwork/web-client';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';

const SINGLE_WORKSPACE: TeamWorkspaceSummary = {
  id: 'ws-1',
  name: '唯一工作区',
  description: null,
  visibility: 'private',
  defaultWorkingRoot: '/repo',
  defaultTeamRoster: [],
  createdByUserId: 'user-1',
  createdAt: '2026-06-05T00:00:00.000Z',
  updatedAt: '2026-06-05T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WorkspaceSwitcher', () => {
  it('只有一个工作区且无任何治理能力时退化为静态标签', () => {
    render(
      <WorkspaceSwitcher
        workspaces={[SINGLE_WORKSPACE]}
        activeWorkspaceId={SINGLE_WORKSPACE.id}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByText(/唯一工作区/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /唯一工作区/ })).toBeNull();
  });

  it('只有一个工作区但仍有重命名能力时，保留下拉入口而不是静态标签', () => {
    render(
      <WorkspaceSwitcher
        workspaces={[SINGLE_WORKSPACE]}
        activeWorkspaceId={SINGLE_WORKSPACE.id}
        onSelect={() => {}}
        onRename={async () => true}
      />,
    );

    const trigger = screen.getByRole('button', { name: /唯一工作区/ });
    fireEvent.click(trigger);

    expect(screen.getByRole('listbox', { name: '切换工作区' })).toBeTruthy();
  });
});
