// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { BackgroundTaskRow } from './background-task-model.js';
import { SubAgentRunList, type SubAgentRunItem } from './sub-agent-run-list.js';

afterEach(() => {
  cleanup();
  // 折叠状态会写入 localStorage；测试之间必须清理，避免污染后续渲染的初始态。
  window.localStorage.clear();
});

function makeItem(input: {
  sessionId: string;
  status: SubAgentRunItem['status'];
  title: string;
}): SubAgentRunItem {
  return {
    sessionId: input.sessionId,
    shortSessionId: input.sessionId.slice(0, 6),
    status: input.status,
    taskLabel: input.title,
    title: input.title,
    messageCount: 0,
  };
}

function makeShellRow(overrides: Partial<BackgroundTaskRow> = {}): BackgroundTaskRow {
  return {
    key: 'term-abcdef123456',
    kind: 'shell',
    state: 'running',
    title: 'npm run dev',
    command: 'npm run dev -- --host 0.0.0.0',
    terminalId: 'term-abcdef123456',
    startedAtMs: 1_790_000_000_000,
    ...overrides,
  };
}

describe('SubAgentRunList 停止按钮', () => {
  it('未提供 onStopSession 时不渲染停止按钮', () => {
    render(
      <SubAgentRunList
        items={[makeItem({ sessionId: 's-1', status: 'running', title: '子任务一' })]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('停止子代理 子任务一')).toBeNull();
  });

  it('仅为活跃项渲染停止按钮，终态项不渲染', () => {
    render(
      <SubAgentRunList
        items={[
          makeItem({ sessionId: 's-1', status: 'running', title: '运行中任务' }),
          makeItem({ sessionId: 's-2', status: 'paused', title: '等待中任务' }),
          makeItem({ sessionId: 's-3', status: 'completed', title: '已完成任务' }),
          makeItem({ sessionId: 's-4', status: 'cancelled', title: '已取消任务' }),
        ]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        onStopSession={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('停止子代理 运行中任务')).toBeTruthy();
    expect(screen.getByLabelText('停止子代理 等待中任务')).toBeTruthy();
    expect(screen.queryByLabelText('停止子代理 已完成任务')).toBeNull();
    expect(screen.queryByLabelText('停止子代理 已取消任务')).toBeNull();
  });

  it('点击停止只触发 onStopSession，不触发行选中', () => {
    const onSelectSession = vi.fn();
    const onStopSession = vi.fn();
    render(
      <SubAgentRunList
        items={[makeItem({ sessionId: 's-1', status: 'running', title: '子任务一' })]}
        selectedSessionId={null}
        onSelectSession={onSelectSession}
        onStopSession={onStopSession}
      />,
    );

    fireEvent.click(screen.getByLabelText('停止子代理 子任务一'));

    expect(onStopSession).toHaveBeenCalledTimes(1);
    expect(onStopSession).toHaveBeenCalledWith('s-1');
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it('stoppingSessionIds 命中时禁用并显示停止中', () => {
    render(
      <SubAgentRunList
        items={[makeItem({ sessionId: 's-1', status: 'running', title: '子任务一' })]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        onStopSession={vi.fn()}
        stoppingSessionIds={new Set(['s-1'])}
      />,
    );

    const stopButton = screen.getByLabelText('停止子代理 子任务一');
    expect(stopButton.hasAttribute('disabled')).toBe(true);
    expect(stopButton.getAttribute('aria-busy')).toBe('true');
    expect(stopButton.textContent).toBe('停止中');
  });

  it('没有子代理时不渲染列表', () => {
    const { container } = render(
      <SubAgentRunList items={[]} selectedSessionId={null} onSelectSession={vi.fn()} />,
    );

    expect(container.innerHTML).toBe('');
  });
});

describe('SubAgentRunList 折叠', () => {
  it('默认展开：开关标记 aria-expanded=true，卡片列表可见', () => {
    render(
      <SubAgentRunList
        items={[makeItem({ sessionId: 's-1', status: 'running', title: '运行中任务' })]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
      />,
    );

    const toggle = screen.getByLabelText('折叠子代理列表');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(list?.style.display).toBe('flex');
    expect(screen.getByText('运行中任务')).toBeTruthy();
  });

  it('点击后收起为迷你胶囊：总数保留、运行中转脉冲点；再次点击恢复展开', () => {
    render(
      <SubAgentRunList
        items={[
          makeItem({ sessionId: 's-1', status: 'running', title: '运行中任务' }),
          makeItem({ sessionId: 's-2', status: 'completed', title: '已完成任务' }),
        ]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('折叠子代理列表'));

    const collapsedToggle = screen.getByLabelText('展开子代理列表');
    expect(collapsedToggle.getAttribute('aria-expanded')).toBe('false');

    const section = collapsedToggle.closest('section');
    expect(section?.style.bottom).toBe('auto');
    // 宽度收成内容宽（迷你胶囊），不再占满 200px 固定栏位。
    expect(section?.style.width).toBe('auto');

    const list = document.getElementById(collapsedToggle.getAttribute('aria-controls') ?? '');
    expect(list?.style.display).toBe('none');

    // 折叠不隐藏信息：总数徽标保留；运行中改以脉冲点提示（title 标注数量）；
    // 「子代理」文字标签让位给迷你形态。
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByTitle('1 个运行中')).toBeTruthy();
    expect(screen.queryByText('子代理')).toBeNull();
    expect(screen.queryByText('1 活跃')).toBeNull();

    fireEvent.click(collapsedToggle);

    const expandedToggle = screen.getByLabelText('折叠子代理列表');
    expect(expandedToggle.getAttribute('aria-expanded')).toBe('true');
    expect(section?.style.bottom).toBe('0px');
    expect(section?.style.width).toBe('200px');
    expect(screen.getByText('1 活跃')).toBeTruthy();
    expect(
      document.getElementById(expandedToggle.getAttribute('aria-controls') ?? '')?.style.display,
    ).toBe('flex');
  });

  it('折叠状态持久化：写入 localStorage，重新挂载后保持折叠', () => {
    const items = [makeItem({ sessionId: 's-1', status: 'running', title: '运行中任务' })];
    const { unmount } = render(
      <SubAgentRunList items={items} selectedSessionId={null} onSelectSession={vi.fn()} />,
    );

    fireEvent.click(screen.getByLabelText('折叠子代理列表'));
    expect(window.localStorage.getItem('chat.subagentRunList.collapsed')).toBe('1');

    // 模拟刷新 / 重新挂载：初始态从 localStorage 恢复为折叠。
    unmount();
    render(<SubAgentRunList items={items} selectedSessionId={null} onSelectSession={vi.fn()} />);
    const collapsedToggle = screen.getByLabelText('展开子代理列表');
    expect(collapsedToggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(collapsedToggle);
    expect(window.localStorage.getItem('chat.subagentRunList.collapsed')).toBe('0');
  });

  it('localStorage 不可读时回落默认展开', () => {
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    try {
      render(
        <SubAgentRunList
          items={[makeItem({ sessionId: 's-1', status: 'completed', title: '已完成任务' })]}
          selectedSessionId={null}
          onSelectSession={vi.fn()}
        />,
      );

      expect(screen.getByLabelText('折叠子代理列表').getAttribute('aria-expanded')).toBe('true');
    } finally {
      getItem.mockRestore();
    }
  });

  it('localStorage 不可写时折叠交互仍生效', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      render(
        <SubAgentRunList
          items={[makeItem({ sessionId: 's-1', status: 'completed', title: '已完成任务' })]}
          selectedSessionId={null}
          onSelectSession={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByLabelText('折叠子代理列表'));
      expect(screen.getByLabelText('展开子代理列表').getAttribute('aria-expanded')).toBe('false');
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('SubAgentRunList 后台命令分组', () => {
  it('不传 shellItems 时保持现状：无命令行、无分组标题、表头仍为「子代理」', () => {
    render(
      <SubAgentRunList
        items={[makeItem({ sessionId: 's-1', status: 'running', title: '运行中任务' })]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        onStopSession={vi.fn()}
      />,
    );

    expect(screen.getByText('子代理')).toBeTruthy();
    expect(screen.getByText('1 活跃')).toBeTruthy();
    expect(screen.getByLabelText('折叠子代理列表')).toBeTruthy();
    expect(screen.queryAllByTestId('sub-agent-run-list-shell-item')).toHaveLength(0);
    expect(screen.queryAllByTestId('sub-agent-run-list-group-header')).toHaveLength(0);
  });

  it('仅有后台命令时渲染紧凑卡：command 单行 + 短 terminalId，单组不显示分组标题', () => {
    render(
      <SubAgentRunList
        items={[]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        shellItems={[makeShellRow()]}
        onPreviewShell={vi.fn()}
        onKillShell={vi.fn()}
      />,
    );

    // 单组时表头即组标题，不额外渲染分组标题。
    expect(screen.getByText('后台命令')).toBeTruthy();
    expect(screen.queryAllByTestId('sub-agent-run-list-group-header')).toHaveLength(0);
    // command 单行展示，全文在 title。
    expect(screen.getByText('npm run dev -- --host 0.0.0.0')).toBeTruthy();
    expect(screen.getByTitle('npm run dev -- --host 0.0.0.0')).toBeTruthy();
    // terminalId 只显示短号，全文在 title。
    expect(screen.getByText('term-abc')).toBeTruthy();
    expect(screen.getByTitle('term-abcdef123456')).toBeTruthy();
    // 状态以文本编码（状态点 aria-hidden）。
    expect(screen.getByText('运行中')).toBeTruthy();
    expect(screen.getByLabelText('折叠后台命令列表')).toBeTruthy();
  });

  it('未提供回调时不渲染对应操作按钮', () => {
    render(
      <SubAgentRunList
        items={[]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        shellItems={[makeShellRow()]}
      />,
    );

    expect(screen.queryByLabelText('查看后台命令 term-abcdef123456')).toBeNull();
    expect(screen.queryByLabelText('终止后台命令 term-abcdef123456')).toBeNull();
  });

  it('「查看」直接调用 onPreviewShell，不弹确认', () => {
    const onPreviewShell = vi.fn();
    const onKillShell = vi.fn();
    render(
      <SubAgentRunList
        items={[]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        shellItems={[makeShellRow()]}
        onPreviewShell={onPreviewShell}
        onKillShell={onKillShell}
      />,
    );

    fireEvent.click(screen.getByLabelText('查看后台命令 term-abcdef123456'));

    expect(onPreviewShell).toHaveBeenCalledTimes(1);
    expect(onPreviewShell).toHaveBeenCalledWith('term-abcdef123456');
    expect(onKillShell).not.toHaveBeenCalled();
    expect(screen.queryByTestId('background-task-confirm-kill')).toBeNull();
  });

  it('「终止」必须走共用确认弹窗：确认后调用 onKillShell，取消不调用', () => {
    const onKillShell = vi.fn();
    render(
      <SubAgentRunList
        items={[]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        shellItems={[makeShellRow()]}
        onPreviewShell={vi.fn()}
        onKillShell={onKillShell}
      />,
    );

    fireEvent.click(screen.getByLabelText('终止后台命令 term-abcdef123456'));

    // 共用弹窗（kill-shell 语义）：确认前不得触发回调。
    expect(screen.getByTestId('background-task-confirm-kill')).toBeTruthy();
    expect(screen.getByText('终止后台命令')).toBeTruthy();
    expect(onKillShell).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onKillShell).not.toHaveBeenCalled();
    expect(screen.queryByTestId('background-task-confirm-kill')).toBeNull();

    fireEvent.click(screen.getByLabelText('终止后台命令 term-abcdef123456'));
    fireEvent.click(screen.getByTestId('background-task-confirm-kill'));
    expect(onKillShell).toHaveBeenCalledTimes(1);
    expect(onKillShell).toHaveBeenCalledWith('term-abcdef123456');
    expect(screen.queryByTestId('background-task-confirm-kill')).toBeNull();
  });

  it('仅运行中命令渲染「终止」；pendingKillShellIds 命中时禁用并显示「终止中」', () => {
    const { unmount } = render(
      <SubAgentRunList
        items={[]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        shellItems={[
          makeShellRow({ key: 'term-run', terminalId: 'term-run-1', state: 'running' }),
          makeShellRow({ key: 'term-pending', terminalId: 'term-pending-1', state: 'pending' }),
          makeShellRow({ key: 'term-done', terminalId: 'term-done-1', state: 'succeeded' }),
          makeShellRow({ key: 'term-failed', terminalId: 'term-failed-1', state: 'failed' }),
        ]}
        onPreviewShell={vi.fn()}
        onKillShell={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('终止后台命令 term-run-1')).toBeTruthy();
    expect(screen.queryByLabelText('终止后台命令 term-pending-1')).toBeNull();
    expect(screen.queryByLabelText('终止后台命令 term-done-1')).toBeNull();
    expect(screen.queryByLabelText('终止后台命令 term-failed-1')).toBeNull();
    // 终态行仍可查看。
    expect(screen.getByLabelText('查看后台命令 term-done-1')).toBeTruthy();

    unmount();

    render(
      <SubAgentRunList
        items={[]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        shellItems={[makeShellRow({ key: 'term-run', terminalId: 'term-run-1' })]}
        onPreviewShell={vi.fn()}
        onKillShell={vi.fn()}
        pendingKillShellIds={new Set(['term-run-1'])}
      />,
    );

    const killButton = screen.getByLabelText('终止后台命令 term-run-1');
    expect(killButton.hasAttribute('disabled')).toBe(true);
    expect(killButton.getAttribute('aria-busy')).toBe('true');
    expect(killButton.textContent).toBe('终止中');
  });

  it('两组共存时渲染带计数的分组标题，总数徽标含两组', () => {
    render(
      <SubAgentRunList
        items={[
          makeItem({ sessionId: 's-1', status: 'running', title: '子任务一' }),
          makeItem({ sessionId: 's-2', status: 'completed', title: '子任务二' }),
        ]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        shellItems={[makeShellRow()]}
        onPreviewShell={vi.fn()}
        onKillShell={vi.fn()}
      />,
    );

    expect(screen.getByText('后台任务')).toBeTruthy();
    expect(screen.getByText('子代理 2')).toBeTruthy();
    expect(screen.getByText('后台命令 1')).toBeTruthy();
    // 总数 = 子代理 2 + 命令 1。
    expect(screen.getByText('3')).toBeTruthy();
    // 子代理卡片的既有交互不受影响。
    expect(screen.getByText('子任务一')).toBeTruthy();
  });

  it('子代理与后台命令都为空时不渲染', () => {
    const { container } = render(
      <SubAgentRunList
        items={[]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        shellItems={[]}
        onPreviewShell={vi.fn()}
        onKillShell={vi.fn()}
      />,
    );

    expect(container.innerHTML).toBe('');
  });
});

describe('SubAgentRunList 折叠态后台计数', () => {
  it('折叠态显示「后台 N 运行中」（子代理活跃 + 运行中命令），总数含两组', () => {
    const { unmount } = render(
      <SubAgentRunList
        items={[
          makeItem({ sessionId: 's-1', status: 'running', title: '运行中任务' }),
          makeItem({ sessionId: 's-2', status: 'completed', title: '已完成任务' }),
        ]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        shellItems={[
          makeShellRow({ key: 'term-run', terminalId: 'term-run-1' }),
          makeShellRow({ key: 'term-done', terminalId: 'term-done-1', state: 'succeeded' }),
        ]}
        onPreviewShell={vi.fn()}
        onKillShell={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('折叠后台任务列表'));

    expect(screen.getByText('后台 2 运行中')).toBeTruthy();
    expect(screen.getByTitle('2 个运行中')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.queryByText('2 活跃')).toBeNull();

    unmount();
    // 折叠偏好已写入 localStorage：第二段渲染前清掉，确保从默认展开态开始。
    window.localStorage.clear();

    render(
      <SubAgentRunList
        items={[makeItem({ sessionId: 's-3', status: 'completed', title: '已完成任务' })]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        shellItems={[
          makeShellRow({ key: 'term-done', terminalId: 'term-done-1', state: 'succeeded' }),
        ]}
        onPreviewShell={vi.fn()}
        onKillShell={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('折叠后台任务列表'));

    // 无活跃项：不显示「N 运行中」，只保留总数徽标。
    expect(screen.queryByText('后台 0 运行中')).toBeNull();
    expect(screen.queryByTitle(/个运行中/)).toBeNull();
    expect(screen.getByText('2')).toBeTruthy();
  });
});
