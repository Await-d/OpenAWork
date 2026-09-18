// @vitest-environment jsdom
/**
 * TeamViewModeToggle · 控件态契约
 *
 * 内联 background / border-color / transition 会压掉 `.team-v2-control` 的
 * hover / active / focus-visible 规则（按钮退化成「hover 无反馈」的静态色块）。
 * jsdom 不做伪类与布局计算，这里断言 class 变体 + 无内联 background 的契约，
 * 真实 hover / active / focus-visible 反馈由浏览器 QA 验证。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TeamViewModeToggle } from './TeamViewModeToggle.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function assertControlContracts(container: HTMLElement): void {
  const buttons = [...container.querySelectorAll('button')];
  expect(buttons.length).toBeGreaterThan(0);

  for (const button of buttons) {
    expect(button.classList.contains('team-v2-control')).toBe(true);
    expect(
      button.classList.contains('team-v2-control--accent-soft') ||
        button.classList.contains('team-v2-control--transparent'),
    ).toBe(true);

    const inlineStyle = (button.getAttribute('style') ?? '').toLowerCase();
    expect(inlineStyle).not.toContain('background');
    expect(inlineStyle).not.toContain('border-color');
    expect(inlineStyle).not.toContain('transition');
  }
}

describe('TeamViewModeToggle', () => {
  it('按钮全部携带 team-v2-control 变体类且没有内联 background / border-color / transition', () => {
    const { container } = render(
      <TeamViewModeToggle
        viewMode="dual"
        multiLayerMode="cards"
        onViewModeChange={vi.fn()}
        onMultiLayerModeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '单栏视图' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '分层并排视图' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /角色窗口墙/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /汇总流/ })).toBeTruthy();
    assertControlContracts(container);
  });

  it('选中态使用 --accent-soft，未选中态使用 --transparent', () => {
    render(
      <TeamViewModeToggle
        viewMode="dual"
        multiLayerMode="feed"
        onViewModeChange={vi.fn()}
        onMultiLayerModeChange={vi.fn()}
      />,
    );

    const single = screen.getByRole('button', { name: '单栏视图' });
    const dual = screen.getByRole('button', { name: '分层并排视图' });
    const cards = screen.getByRole('button', { name: /角色窗口墙/ });
    const feed = screen.getByRole('button', { name: /汇总流/ });

    expect(dual.classList.contains('team-v2-control--accent-soft')).toBe(true);
    expect(feed.classList.contains('team-v2-control--accent-soft')).toBe(true);
    expect(single.classList.contains('team-v2-control--transparent')).toBe(true);
    expect(cards.classList.contains('team-v2-control--transparent')).toBe(true);
  });

  it('单一视图模式下只有单栏按钮是选中态', () => {
    render(
      <TeamViewModeToggle
        viewMode="single"
        multiLayerMode="cards"
        onViewModeChange={vi.fn()}
        onMultiLayerModeChange={vi.fn()}
      />,
    );

    const single = screen.getByRole('button', { name: '单栏视图' });
    const dual = screen.getByRole('button', { name: '分层并排视图' });

    expect(single.classList.contains('team-v2-control--accent-soft')).toBe(true);
    expect(dual.classList.contains('team-v2-control--transparent')).toBe(true);
    expect(screen.queryByRole('button', { name: /汇总流/ })).toBeNull();
  });

  it('点击仍然触发对应回调', () => {
    const onViewModeChange = vi.fn();
    const onMultiLayerModeChange = vi.fn();
    render(
      <TeamViewModeToggle
        viewMode="dual"
        multiLayerMode="cards"
        onViewModeChange={onViewModeChange}
        onMultiLayerModeChange={onMultiLayerModeChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '单栏视图' }));
    fireEvent.click(screen.getByRole('button', { name: /汇总流/ }));

    expect(onViewModeChange).toHaveBeenCalledWith('single');
    expect(onMultiLayerModeChange).toHaveBeenCalledWith('feed');
  });
});
