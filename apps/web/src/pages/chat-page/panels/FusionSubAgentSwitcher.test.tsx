// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FusionSubAgentSwitcher } from './FusionSubAgentSwitcher.js';
import type { SubAgentRunItem } from './sub-agent-run-list.js';

afterEach(() => {
  cleanup();
});

function makeItem(sessionId: string, overrides: Partial<SubAgentRunItem> = {}): SubAgentRunItem {
  return {
    sessionId,
    shortSessionId: sessionId.slice(0, 8),
    status: 'running',
    taskLabel: `任务 ${sessionId}`,
    title: `子代理 ${sessionId}`,
    messageCount: 0,
    ...overrides,
  };
}

interface RenderSwitcherOptions {
  readonly selectedSessionId?: string | null;
  readonly onSelectSession?: (id: string) => void;
}

function renderSwitcher(items: readonly SubAgentRunItem[], options: RenderSwitcherOptions = {}) {
  return render(
    <FusionSubAgentSwitcher
      items={items}
      onSelectSession={options.onSelectSession ?? (() => undefined)}
      selectedSessionId={options.selectedSessionId ?? null}
    />,
  );
}

describe('FusionSubAgentSwitcher', () => {
  it('0 个或 1 个子代理时不渲染任何内容', () => {
    const { container: emptyContainer } = renderSwitcher([]);
    expect(emptyContainer.querySelector('.fusion-sub-agent-switcher')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();

    cleanup();

    const { container: singleContainer } = renderSwitcher([makeItem('child-1')]);
    expect(singleContainer.querySelector('.fusion-sub-agent-switcher')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('N 个子代理渲染 N 枚 chip，标签取标题且带上完整标题属性', () => {
    renderSwitcher([makeItem('child-1'), makeItem('child-2'), makeItem('child-3')]);

    const tablist = screen.getByRole('tablist', { name: '子代理切换' });
    const chips = screen.getAllByRole('tab');

    expect(tablist).not.toBeNull();
    expect(chips).toHaveLength(3);
    expect(chips.map((chip) => chip.textContent)).toEqual([
      '子代理 child-1运行中',
      '子代理 child-2运行中',
      '子代理 child-3运行中',
    ]);
    expect(chips[0]?.getAttribute('title')).toBe('子代理 child-1');
  });

  it('选中的 chip 标记 aria-selected / data-active 且是唯一的 tabIndex=0', () => {
    renderSwitcher([makeItem('child-1'), makeItem('child-2')], { selectedSessionId: 'child-2' });

    const [firstChip, secondChip] = screen.getAllByRole('tab');

    expect(firstChip?.getAttribute('aria-selected')).toBe('false');
    expect(firstChip?.getAttribute('data-active')).toBe('false');
    expect(firstChip?.getAttribute('tabindex')).toBe('-1');
    expect(secondChip?.getAttribute('aria-selected')).toBe('true');
    expect(secondChip?.getAttribute('data-active')).toBe('true');
    expect(secondChip?.getAttribute('tabindex')).toBe('0');
  });

  it('点击 chip 以对应会话 id 调用 onSelectSession', () => {
    const onSelectSession = vi.fn();

    renderSwitcher([makeItem('child-1'), makeItem('child-2')], {
      onSelectSession,
      selectedSessionId: 'child-1',
    });

    fireEvent.click(screen.getByRole('tab', { name: /子代理 child-2/ }));

    expect(onSelectSession).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith('child-2');
  });

  it('ArrowLeft / ArrowRight / Home / End 切换选中并移动焦点', () => {
    const onSelectSession = vi.fn();

    renderSwitcher([makeItem('child-1'), makeItem('child-2'), makeItem('child-3')], {
      onSelectSession,
      selectedSessionId: 'child-1',
    });

    const [firstChip, secondChip, thirdChip] = screen.getAllByRole('tab');
    if (!firstChip || !secondChip || !thirdChip) {
      throw new Error('切换器未渲染出预期的 3 枚 chip');
    }

    fireEvent.keyDown(firstChip, { key: 'ArrowRight' });
    expect(onSelectSession).toHaveBeenLastCalledWith('child-2');
    expect(document.activeElement).toBe(secondChip);

    fireEvent.keyDown(secondChip, { key: 'End' });
    expect(onSelectSession).toHaveBeenLastCalledWith('child-3');
    expect(document.activeElement).toBe(thirdChip);

    fireEvent.keyDown(thirdChip, { key: 'ArrowRight' });
    expect(onSelectSession).toHaveBeenLastCalledWith('child-1');
    expect(document.activeElement).toBe(firstChip);

    fireEvent.keyDown(firstChip, { key: 'ArrowLeft' });
    expect(onSelectSession).toHaveBeenLastCalledWith('child-3');
    expect(document.activeElement).toBe(thirdChip);

    fireEvent.keyDown(thirdChip, { key: 'Home' });
    expect(onSelectSession).toHaveBeenLastCalledWith('child-1');
    expect(document.activeElement).toBe(firstChip);
  });

  it('横向溢出时鼠标滚轮纵向增量驱动 chip 行横向滚动', () => {
    renderSwitcher([makeItem('child-1'), makeItem('child-2'), makeItem('child-3')]);

    const tablist = screen.getByRole('tablist', { name: '子代理切换' });
    let scrollLeft = 0;

    // jsdom 不实现布局：手动补上溢出判定与位移所需的三个度量。
    Object.defineProperty(tablist, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(tablist, 'clientWidth', { configurable: true, value: 200 });
    Object.defineProperty(tablist, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (next: number) => {
        scrollLeft = next;
      },
    });

    const notPrevented = fireEvent.wheel(tablist, { deltaY: 100 });

    expect(notPrevented).toBe(false);
    expect(scrollLeft).toBe(100);
  });

  it('状态圆点与状态文案跟随 item.status', () => {
    renderSwitcher([
      makeItem('child-running', { status: 'running' }),
      makeItem('child-pending', { status: 'pending' }),
      makeItem('child-completed', { status: 'completed' }),
      makeItem('child-failed', { status: 'failed' }),
      makeItem('child-cancelled', { status: 'cancelled' }),
    ]);

    const chips = screen.getAllByRole('tab');

    expect(chips.map((chip) => chip.getAttribute('data-status'))).toEqual([
      'running',
      'pending',
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(
      chips.map((chip) => chip.querySelector('.fusion-sub-agent-switcher__dot')),
    ).not.toContain(null);
    expect(
      ['运行中', '待执行', '已完成', '失败', '已取消'].map((label) => screen.getByText(label)),
    ).toHaveLength(5);
  });

  it('标签回退顺序：标题 → 任务标签 → 指派 Agent → 短会话 id', () => {
    renderSwitcher([
      makeItem('child-1', { title: '   ', taskLabel: '任务标签' }),
      makeItem('child-2', { title: '', taskLabel: ' ', assignedAgent: 'explore' }),
    ]);

    const chips = screen.getAllByRole('tab');

    expect(chips[0]?.textContent).toContain('任务标签');
    expect(chips[1]?.textContent).toContain('explore');
  });
});
