// @vitest-environment jsdom
/**
 * TeamUserJumpRail smoke：≤1 条用户输入时不渲染；≥2 条时渲染上/下跳转按钮，
 * 点击触发 onPrev / onNext。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { TeamUserJumpRail } from './TeamUserJumpRail.js';

afterEach(() => cleanup());

describe('TeamUserJumpRail', () => {
  it('用户输入 <=1 条时不渲染', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <TeamUserJumpRail scrollRegionRef={ref} userCount={1} onPrev={vi.fn()} onNext={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('用户输入 >=2 条时渲染跳转控件并响应点击', () => {
    const ref = createRef<HTMLDivElement>();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <TeamUserJumpRail scrollRegionRef={ref} userCount={3} onPrev={onPrev} onNext={onNext} />,
    );

    const prev = screen.getByLabelText('跳到上一条我的输入');
    const next = screen.getByLabelText('跳到下一条我的输入');
    fireEvent.click(prev);
    fireEvent.click(next);
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    // 显示总数
    expect(screen.getByText('/3')).toBeTruthy();
  });
});
