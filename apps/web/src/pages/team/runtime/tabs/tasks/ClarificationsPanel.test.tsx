// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClarificationsPanel } from './ClarificationsPanel.js';

const submitMock = vi.hoisted(() => vi.fn());
const dismissClarificationMock = vi.hoisted(() => vi.fn());

const storeState = vi.hoisted(() => ({
  dismiss: vi.fn(),
  items: [
    {
      id: 'clarification-1',
      sessionId: 'session-pm1',
      fromSessionId: 'session-pm1',
      question: '需要确认导出格式',
      context: 'spec.md 第 12 行',
      createdAt: Date.now(),
      status: 'pending' as const,
    },
  ],
  markAnswered: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createTeamInboundClient: () => ({
    submit: submitMock,
    dismissClarification: dismissClarificationMock,
  }),
}));

vi.mock('../../../../../stores/auth/auth.js', () => ({
  useAuthStore: () => ({
    accessToken: 'token-test',
    gatewayUrl: 'https://gateway.test',
  }),
}));

vi.mock('../../../../../stores/team/team-events.js', () => ({
  useClarificationStore: (
    selector: (state: {
      items: typeof storeState.items;
      markAnswered: typeof storeState.markAnswered;
      dismiss: typeof storeState.dismiss;
    }) => unknown,
  ) =>
    selector({
      items: storeState.items,
      markAnswered: storeState.markAnswered,
      dismiss: storeState.dismiss,
    }),
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  submitMock.mockRejectedValue(new Error('提交失败：网络异常'));
  dismissClarificationMock.mockRejectedValue(new Error('忽略失败：服务暂不可用'));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ClarificationsPanel', () => {
  it('提交回答失败时会在卡片内显示错误信息', async () => {
    render(<ClarificationsPanel filterSessionId="session-pm1" />);

    fireEvent.change(
      screen.getByPlaceholderText('请输入你的回答（提交后 PM1 会在下一轮规划时使用）...'),
      {
        target: { value: '请导出为 markdown' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('提交失败：网络异常');
    });
    expect(storeState.markAnswered).not.toHaveBeenCalled();
  });

  it('忽略失败时会在卡片内显示错误信息', async () => {
    render(<ClarificationsPanel filterSessionId="session-pm1" />);

    fireEvent.click(screen.getByRole('button', { name: '忽略' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('忽略失败：服务暂不可用');
    });
    expect(storeState.dismiss).not.toHaveBeenCalled();
  });
});
