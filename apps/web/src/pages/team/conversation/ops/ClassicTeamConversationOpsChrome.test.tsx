// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClassicTeamConversationOpsChrome } from './ClassicTeamConversationOpsChrome.js';

afterEach(() => {
  cleanup();
});

describe('ClassicTeamConversationOpsChrome', () => {
  it('renders failed attention when fail handoff exists', () => {
    render(
      <ClassicTeamConversationOpsChrome
        failedHandoffs={[
          {
            id: 'h1',
            state: 'failed',
            fromRoleLayer: 'pm2',
            toRoleLayer: 'executor',
            summary: 'callback 校验失败',
            failureReason: 'timeout',
            updatedAt: Date.now(),
          },
        ]}
      />,
    );

    expect(screen.getByText('待你处理')).toBeTruthy();
    expect(screen.getByText('callback 校验失败')).toBeTruthy();
  });

  it('澄清 attention 只报数量并跳转面板，不重复渲染问题正文', () => {
    const onFocusClarifications = vi.fn();
    render(
      <ClassicTeamConversationOpsChrome
        pendingClarifications={[
          {
            id: 'c1',
            nodeId: 'c1',
            sessionId: 's1',
            fromSessionId: 'pm1',
            question: '使用 localhost callback？',
            context: '',
            createdAt: Date.now(),
            status: 'pending',
          },
        ]}
        onFocusClarifications={onFocusClarifications}
      />,
    );

    expect(screen.getByText('待你处理')).toBeTruthy();
    expect(screen.getByText('1 项澄清待你回答')).toBeTruthy();
    expect(screen.queryByText('使用 localhost callback？')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(onFocusClarifications).toHaveBeenCalledTimes(1);
  });

  it('calls onFocusFail from attention jump', () => {
    const onFocusFail = vi.fn();
    render(
      <ClassicTeamConversationOpsChrome
        failedHandoffs={[
          {
            id: 'h1',
            state: 'failed',
            fromRoleLayer: 'pm2',
            toRoleLayer: 'executor',
            summary: 'fail',
            updatedAt: Date.now(),
          },
        ]}
        onFocusFail={onFocusFail}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(onFocusFail).toHaveBeenCalledTimes(1);
  });

  it('returns null when nothing to show', () => {
    const { container } = render(<ClassicTeamConversationOpsChrome />);
    expect(container.querySelector('[data-team-classic-ops-chrome]')).toBeNull();
  });
});
