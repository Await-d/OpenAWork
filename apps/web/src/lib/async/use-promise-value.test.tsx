// @vitest-environment jsdom
/**
 * `usePromiseValue` 覆盖。
 *
 * 核心要验证的是「不会陷入无限 Suspense 循环」——即父级重渲染、以及 `load`
 * 引用每次渲染都变化时，取数仍只发生一次。这是 `use()` 最容易踩的坑，
 * 也是本模块存在的唯一理由。
 *
 * ⚠️ 本环境（React 19 + jsdom）的两条硬约束，改测试时别踩：
 *   1. `render()` **必须**包在 `await act(async () => ...)` 里。组件在 act 内挂起
 *      而未 await 时，React 19 会直接报 "A component suspended inside an act scope…"；
 *   2. Suspense 的重试需要**宏任务**才会落地，只 await 微任务会一直停在 fallback，
 *      `findByText` / `waitFor` 也救不回来。必须用 flushSuspense() 两次 setImmediate。
 */

import { Component, Suspense, useState, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPromiseCache } from './promise-cache.js';
import { usePromiseValue } from './use-promise-value.js';

afterEach(cleanup);

/** 在 act 内完成初始渲染（组件会挂起并停在 Suspense fallback）。 */
async function renderSuspended(ui: ReactElement): Promise<void> {
  await act(async () => {
    render(ui);
  });
}

/** 推进挂起中的 Suspense 直到其重试落地。 */
async function flushSuspense(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  });
}

/** 最小错误边界：捕获子树的抛错，并允许手动重置以验证重试路径。 */
class TestErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  private readonly reset = (): void => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <button type="button" onClick={this.reset}>
          重试
        </button>
      );
    }
    return this.props.children;
  }
}

describe('usePromiseValue', () => {
  it('先渲染 Suspense fallback，promise 结算后渲染内容', async () => {
    const cache = createPromiseCache<string>();
    // 用可控 deferred：否则 promise 会在 renderSuspended 的 act 内就结算，
    // fallback 根本没机会出现在 DOM 里，断言会假失败。
    let resolveLoad!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      resolveLoad = resolve;
    });
    const load = vi.fn(() => pending);

    function View() {
      const value = usePromiseValue(cache, 'greeting', load);
      return <div>{value}</div>;
    }

    await renderSuspended(
      <Suspense fallback={<div>loading</div>}>
        <View />
      </Suspense>,
    );
    expect(screen.getByText('loading')).toBeTruthy();

    resolveLoad('hello');
    await flushSuspense();

    expect(screen.getByText('hello')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('父级反复重渲染不会重新取数，也不会无限挂起', async () => {
    const cache = createPromiseCache<string>();
    const fetchValue = vi.fn(() => Promise.resolve('stable'));

    function View() {
      // load 每次渲染都是新的箭头函数：命中缓存时不得因此触发额外请求。
      const value = usePromiseValue(cache, 'key', () => fetchValue());
      return <div>{value}</div>;
    }

    function Parent() {
      const [count, setCount] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setCount((c) => c + 1)}>
            bump
          </button>
          <span data-testid="count">{count}</span>
          <Suspense fallback={<div>loading</div>}>
            <View />
          </Suspense>
        </>
      );
    }

    await renderSuspended(<Parent />);
    await flushSuspense();
    expect(screen.getByText('stable')).toBeTruthy();

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        fireEvent.click(screen.getByText('bump'));
      });
    }

    expect(screen.getByTestId('count').textContent).toBe('3');
    expect(screen.getByText('stable')).toBeTruthy();
    expect(fetchValue).toHaveBeenCalledTimes(1);
  });

  it('多个组件共用同一 key 时只取数一次', async () => {
    const cache = createPromiseCache<number>();
    const fetchValue = vi.fn(() => Promise.resolve(7));

    function View({ label }: { label: string }) {
      const value = usePromiseValue(cache, 'shared', () => fetchValue());
      return (
        <div>
          {label}:{value}
        </div>
      );
    }

    await renderSuspended(
      <Suspense fallback={<div>loading</div>}>
        <View label="a" />
        <View label="b" />
      </Suspense>,
    );
    await flushSuspense();

    expect(screen.getByText('a:7')).toBeTruthy();
    expect(screen.getByText('b:7')).toBeTruthy();
    expect(fetchValue).toHaveBeenCalledTimes(1);
  });

  it('首次失败不会把 rejection 缓存住：重试能取到值', async () => {
    const cache = createPromiseCache<string>();
    let attempt = 0;
    const fetchValue = vi.fn(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('首次失败')) : Promise.resolve('重试成功');
    });

    function View() {
      const value = usePromiseValue(cache, 'k', () => fetchValue());
      return <div>{value}</div>;
    }

    // 外层错误边界只是兜底：真正的恢复来自「失败即失效」——缓存里没有存住那个
    // rejection，React 重试时拿到的是新 promise（第二次会成功）。
    await renderSuspended(
      <TestErrorBoundary>
        <Suspense fallback={<div>loading</div>}>
          <View />
        </Suspense>
      </TestErrorBoundary>,
    );

    for (let i = 0; i < 5 && screen.queryByText('重试成功') === null; i += 1) {
      await flushSuspense();
    }

    expect(screen.getByText('重试成功')).toBeTruthy();
    expect(fetchValue).toHaveBeenCalledTimes(2);
  });
});
