// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClassicTeamConversationInlineCards } from './ClassicTeamConversationInlineCards.js';

afterEach(() => {
  cleanup();
});

describe('ClassicTeamConversationInlineCards', () => {
  it('renders fail and clarification cards', () => {
    render(
      <ClassicTeamConversationInlineCards
        failedHandoffs={[
          {
            id: 'h-fail',
            state: 'failed',
            fromRoleLayer: 'pm2',
            toRoleLayer: 'executor',
            summary: 'callback 超时',
            failureReason: 'token exchange timeout',
            updatedAt: Date.now(),
          },
        ]}
        pendingClarifications={[
          {
            id: 'c1',
            sessionId: 's1',
            fromSessionId: 'pm1',
            question: 'callback 用 localhost 吗？',
            context: 'http://localhost:3000/callback',
            createdAt: Date.now(),
            status: 'pending',
          },
        ]}
      />,
    );

    expect(screen.getByText('需要你确认')).toBeTruthy();
    expect(screen.getByText('callback 用 localhost 吗？')).toBeTruthy();
    expect(screen.getByText('callback 超时')).toBeTruthy();
    expect(screen.getByText('token exchange timeout')).toBeTruthy();
  });

  it('invokes retry and fill composer actions', () => {
    const onRetryFailed = vi.fn();
    const onFillComposer = vi.fn();
    render(
      <ClassicTeamConversationInlineCards
        failedHandoffs={[
          {
            id: 'h-fail',
            state: 'failed',
            fromRoleLayer: 'executor',
            toRoleLayer: 'executor',
            summary: 'fail',
            updatedAt: Date.now(),
          },
        ]}
        pendingClarifications={[
          {
            id: 'c1',
            sessionId: 's1',
            fromSessionId: 'pm1',
            question: '确认范围？',
            context: '',
            createdAt: Date.now(),
            status: 'pending',
          },
        ]}
        onRetryFailed={onRetryFailed}
        onFillComposer={onFillComposer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '重试失败' }));
    fireEvent.click(screen.getByRole('button', { name: '填入回复' }));
    expect(onRetryFailed).toHaveBeenCalledTimes(1);
    expect(onFillComposer).toHaveBeenCalledWith('确认范围？');
  });

  it('returns null when no cards', () => {
    const { container } = render(<ClassicTeamConversationInlineCards />);
    expect(container.querySelector('[data-team-classic-inline-cards]')).toBeNull();
  });
});
