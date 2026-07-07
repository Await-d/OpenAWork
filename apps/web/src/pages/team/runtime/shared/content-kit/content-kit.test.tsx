// @vitest-environment jsdom
/**
 * 260530-team-page · content-kit 原子 smoke 测试
 *
 * 覆盖：
 *   - StatCard：值/标签渲染、可点击下钻、active 态 aria-pressed
 *   - MiniBar：percent clamp（>100 / <0）
 *   - EmptyState：标题 + 说明渲染、SVG 图标优先级
 *   - Sparkline：空数组与正常数组都能渲染出 <svg>
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StatCard } from './StatCard.js';
import { MiniBar } from './MiniBar.js';
import { EmptyState } from './EmptyState.js';
import { Sparkline } from './Sparkline.js';

afterEach(() => cleanup());

describe('content-kit · StatCard', () => {
  it('渲染标签与值', () => {
    render(<StatCard label="输入 token" value="26.2k" />);
    expect(screen.getByText('输入 token')).toBeTruthy();
    expect(screen.getByText('26.2k')).toBeTruthy();
  });

  it('可点击时变按钮并触发下钻回调', () => {
    const onClick = vi.fn();
    render(<StatCard label="执行" value="3" onClick={onClick} active />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('不可点击时不是按钮', () => {
    render(<StatCard label="只读" value="1" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('content-kit · MiniBar', () => {
  function findFillWidth(container: HTMLElement): string | undefined {
    const widthDiv = Array.from(container.querySelectorAll('div')).find(
      (el) => el.style.width !== '',
    );
    return widthDiv?.style.width;
  }

  it('percent 超过 100 被 clamp 到 100%', () => {
    const { container } = render(<MiniBar label="provider" percent={250} />);
    expect(findFillWidth(container)).toBe('100%');
  });

  it('percent 小于 0 被 clamp 到 0%', () => {
    const { container } = render(<MiniBar label="provider" percent={-30} />);
    expect(findFillWidth(container)).toBe('0%');
  });
});

describe('content-kit · EmptyState', () => {
  it('渲染标题与说明', () => {
    render(<EmptyState title="暂无用量数据" description="等待后端接入" />);
    expect(screen.getByText('暂无用量数据')).toBeTruthy();
    expect(screen.getByText('等待后端接入')).toBeTruthy();
  });

  it('优先渲染传入的 SVG 图标', () => {
    const { container } = render(
      <EmptyState
        icon={
          <svg data-testid="empty-state-icon" viewBox="0 0 20 20">
            <path d="M4 10h12" />
          </svg>
        }
        title="暂无工具调用数据"
      />,
    );

    expect(screen.getByTestId('empty-state-icon')).toBeTruthy();
    expect(screen.getByText('暂无工具调用数据')).toBeTruthy();
    expect(container.textContent).not.toContain('🗂️');
  });
});

describe('content-kit · Sparkline', () => {
  it('空数组也能渲染 svg', () => {
    const { container } = render(<Sparkline values={[]} ariaLabel="趋势" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('正常数组渲染折线 path', () => {
    const { container } = render(<Sparkline values={[1, 5, 2, 8, 3]} />);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
  });
});
