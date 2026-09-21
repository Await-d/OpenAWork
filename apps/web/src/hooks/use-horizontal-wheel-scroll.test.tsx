// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useHorizontalWheelScroll } from './use-horizontal-wheel-scroll.js';

afterEach(cleanup);

function ScrollHost() {
  const { attachRef } = useHorizontalWheelScroll<HTMLDivElement>();
  return (
    <div data-testid="rail" ref={attachRef}>
      <button type="button">标签</button>
    </div>
  );
}

/**
 * jsdom 不实现布局，scrollWidth / clientWidth 恒为 0、scrollLeft 是只读的，
 * 这里把它们替换成可读写的自有属性，才能断言「溢出判定」与「滚动位移」。
 */
function defineScrollMetrics(
  element: HTMLElement,
  metrics: { scrollWidth: number; clientWidth: number },
): () => number {
  let scrollLeft = 0;

  Object.defineProperty(element, 'scrollWidth', {
    configurable: true,
    value: metrics.scrollWidth,
  });
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: metrics.clientWidth,
  });
  Object.defineProperty(element, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (next: number) => {
      scrollLeft = next;
    },
  });

  return () => scrollLeft;
}

describe('useHorizontalWheelScroll', () => {
  it('横向溢出时把纵向滚轮翻译为 scrollLeft 并阻止默认滚动', () => {
    const { getByTestId } = render(<ScrollHost />);
    const rail = getByTestId('rail');
    const readScrollLeft = defineScrollMetrics(rail, { scrollWidth: 900, clientWidth: 300 });

    const notPrevented = fireEvent.wheel(rail, { deltaY: 120 });

    expect(notPrevented).toBe(false);
    expect(readScrollLeft()).toBe(120);

    fireEvent.wheel(rail, { deltaY: 120 });
    expect(readScrollLeft()).toBe(240);
  });

  it('没有横向溢出时不拦截原生滚动', () => {
    const { getByTestId } = render(<ScrollHost />);
    const rail = getByTestId('rail');
    const readScrollLeft = defineScrollMetrics(rail, { scrollWidth: 300, clientWidth: 300 });

    const notPrevented = fireEvent.wheel(rail, { deltaY: 120 });

    expect(notPrevented).toBe(true);
    expect(readScrollLeft()).toBe(0);
  });

  it('触控板横向滑动（deltaX 不弱于 deltaY）保持原生行为', () => {
    const { getByTestId } = render(<ScrollHost />);
    const rail = getByTestId('rail');
    const readScrollLeft = defineScrollMetrics(rail, { scrollWidth: 900, clientWidth: 300 });

    const notPrevented = fireEvent.wheel(rail, { deltaX: 120, deltaY: 40 });

    expect(notPrevented).toBe(true);
    expect(readScrollLeft()).toBe(0);
  });

  it('deltaY 为 0 时不介入', () => {
    const { getByTestId } = render(<ScrollHost />);
    const rail = getByTestId('rail');
    const readScrollLeft = defineScrollMetrics(rail, { scrollWidth: 900, clientWidth: 300 });

    const notPrevented = fireEvent.wheel(rail, { deltaY: 0 });

    expect(notPrevented).toBe(true);
    expect(readScrollLeft()).toBe(0);
  });

  it('卸载后重新挂载仍能接管滚轮', () => {
    const first = render(<ScrollHost />);
    const firstRail = first.getByTestId('rail');
    defineScrollMetrics(firstRail, { scrollWidth: 900, clientWidth: 300 });

    first.unmount();

    const second = render(<ScrollHost />);
    const secondRail = second.getByTestId('rail');
    const readScrollLeft = defineScrollMetrics(secondRail, { scrollWidth: 900, clientWidth: 300 });

    const notPrevented = fireEvent.wheel(secondRail, { deltaY: 60 });

    expect(notPrevented).toBe(false);
    expect(readScrollLeft()).toBe(60);
  });
});
