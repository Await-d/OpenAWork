// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClarificationsPanel } from './ClarificationsPanel.js';

const submitMock = vi.hoisted(() => vi.fn());
const dismissClarificationMock = vi.hoisted(() => vi.fn());

type PanelItem = {
  answer?: string;
  answeredAt?: number;
  context: string;
  createdAt: number;
  fromSessionId: string;
  id: string;
  nodeId?: string;
  options?: Array<{ label: string; description?: string; recommended?: boolean }>;
  question: string;
  round?: number;
  sessionId: string;
  status: 'pending' | 'answered' | 'dismissed';
};

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
  ] as PanelItem[],
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

function makeItem(
  id: string,
  round?: number,
  options?: PanelItem['options'],
  nodeId?: string,
): PanelItem {
  return {
    id,
    nodeId: nodeId ?? id,
    sessionId: 'session-pm1',
    fromSessionId: 'session-pm1',
    question: `问题 ${id}`,
    context: '',
    createdAt: Date.now(),
    status: 'pending' as const,
    ...(round !== undefined ? { round } : {}),
    ...(options ? { options } : {}),
  };
}

describe('ClarificationsPanel — 轮次分组', () => {
  const originalItems = [...storeState.items];

  afterEach(() => {
    storeState.items.length = 0;
    storeState.items.push(...originalItems);
  });

  it('按 round 渲染轮次 chip（0 基 → 第 1 轮）', () => {
    storeState.items.length = 0;
    storeState.items.push(makeItem('r1-a', 0), makeItem('r2-a', 1));

    render(<ClarificationsPanel filterSessionId="session-pm1" />);

    expect(screen.getByText('第 1 轮澄清')).toBeTruthy();
    expect(screen.getByText('第 2 轮澄清')).toBeTruthy();
  });

  it('无 round 的条目不渲染轮次 chip，但卡片照常显示', () => {
    storeState.items.length = 0;
    storeState.items.push(makeItem('no-round'));

    render(<ClarificationsPanel filterSessionId="session-pm1" />);

    expect(screen.queryByText(/第 \d+ 轮澄清/)).toBeNull();
    expect(screen.getByText('问题 no-round')).toBeTruthy();
  });
});

describe('ClarificationsPanel — 结构化选项', () => {
  const originalItems = [...storeState.items];

  beforeEach(() => {
    storeState.items.length = 0;
  });

  afterEach(() => {
    storeState.items.length = 0;
    storeState.items.push(...originalItems);
  });

  it('带 options 的待答问题渲染选项按钮，不渲染 textarea', () => {
    storeState.items.push(
      makeItem('with-options', undefined, [
        { label: '导出为 Markdown', description: '纯文本，便于评审' },
        { label: '导出为 PDF', recommended: true },
      ]),
    );

    render(<ClarificationsPanel filterSessionId="session-pm1" />);

    expect(screen.getByRole('button', { name: /导出为 Markdown/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /导出为 PDF/ })).toBeTruthy();
    expect(
      screen.queryByPlaceholderText('请输入你的回答（提交后 PM1 会在下一轮规划时使用）...'),
    ).toBeNull();
  });

  it('推荐项置于首位，且只有推荐项带「推荐」徽标', () => {
    storeState.items.push(
      makeItem('recommended-order', undefined, [
        { label: '选项甲' },
        { label: '选项乙', recommended: true },
        { label: '选项丙' },
      ]),
    );

    const { container } = render(<ClarificationsPanel filterSessionId="session-pm1" />);

    const optionButtons = [...container.querySelectorAll('.clarification-option')];
    expect(optionButtons).toHaveLength(3);
    expect(optionButtons[0]?.textContent).toContain('选项乙');
    expect(optionButtons[0]?.textContent).toContain('推荐');
    expect(container.querySelectorAll('.clarification-option__badge')).toHaveLength(1);
  });

  it('点击选项即提交该选项的 label', async () => {
    submitMock.mockResolvedValue(undefined);
    storeState.items.push(
      makeItem('option-submit', undefined, [
        { label: '导出为 Markdown' },
        { label: '导出为 PDF', recommended: true },
      ]),
    );

    render(<ClarificationsPanel filterSessionId="session-pm1" />);

    fireEvent.click(screen.getByRole('button', { name: /导出为 Markdown/ }));

    await waitFor(() => {
      expect(submitMock).toHaveBeenCalledWith(
        'token-test',
        'session-pm1',
        expect.objectContaining({
          messageType: 'clarification_answer',
          payload: expect.objectContaining({
            questionId: 'option-submit',
            answer: '导出为 Markdown',
          }),
        }),
      );
    });
    expect(storeState.markAnswered).toHaveBeenCalledWith('option-submit', '导出为 Markdown');
  });

  it('无 options 的问题回退 textarea 与「提交回答」按钮', () => {
    storeState.items.push(makeItem('legacy-no-options'));

    render(<ClarificationsPanel filterSessionId="session-pm1" />);

    expect(
      screen.getByPlaceholderText('请输入你的回答（提交后 PM1 会在下一轮规划时使用）...'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '提交回答' })).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /自由输入/ })).toHaveLength(0);
  });
});

describe('ClarificationsPanel — 跨轮收敛（同一 nodeId 只保留最新一轮可回答）', () => {
  const originalItems = [...storeState.items];

  beforeEach(() => {
    storeState.items.length = 0;
  });

  afterEach(() => {
    storeState.items.length = 0;
    storeState.items.push(...originalItems);
  });

  it('旧轮次标为「已被新一轮取代」且不再渲染回答入口，计数只算最新一轮', () => {
    storeState.items.push(
      makeItem('__grill_confirm__@r0', 0, undefined, '__grill_confirm__'),
      makeItem('__grill_confirm__@r1', 1, undefined, '__grill_confirm__'),
    );

    render(<ClarificationsPanel filterSessionId="session-pm1" />);

    expect(screen.getByText('已被新一轮取代')).toBeTruthy();
    expect(screen.getByText('问题 __grill_confirm__@r0')).toBeTruthy();
    expect(screen.getByText('1 个澄清待回答（PM1 等待你的输入）')).toBeTruthy();
    expect(
      screen.getAllByPlaceholderText('请输入你的回答（提交后 PM1 会在下一轮规划时使用）...'),
    ).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '忽略' })).toHaveLength(1);
  });

  it('不同 nodeId 的 pending 各自可回答，不互相取代', () => {
    storeState.items.push(
      makeItem('goal', 0, undefined, 'goal'),
      makeItem('constraints', 0, undefined, 'constraints'),
    );

    render(<ClarificationsPanel filterSessionId="session-pm1" />);

    expect(screen.queryByText('已被新一轮取代')).toBeNull();
    expect(screen.getByText('2 个澄清待回答（PM1 等待你的输入）')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '忽略' })).toHaveLength(2);
  });
});
