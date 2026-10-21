import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { DevtoolsTabContent } from './devtools-tab-content.js';
import { createInitialDevtoolsSourceStates } from '../state/settings-derived.js';
import type { DevtoolsSourceKey, DevtoolsSourceState } from '../state/settings-types.js';

/** 全部数据源置为 idle（非 loading），放行自动刷新的空闲守卫。 */
function createIdleSourceStates(): Record<DevtoolsSourceKey, DevtoolsSourceState> {
  const initial = createInitialDevtoolsSourceStates();
  return Object.fromEntries(
    Object.entries(initial).map(([key, state]) => [
      key,
      { ...state, status: 'healthy' as const, error: null, count: 0 },
    ]),
  ) as Record<DevtoolsSourceKey, DevtoolsSourceState>;
}

function createProps(onRefreshAllSources: () => void) {
  return {
    gatewayUrl: 'http://localhost:3000',
    devLogs: [],
    diagnostics: [],
    channelHealthRecords: [],
    channelAuditLogs: [],
    diagnosticsAvailableDates: [],
    diagnosticsDateFilter: null,
    onSetDiagnosticsDateFilter: () => {},
    onClearDiagnostics: () => Promise.resolve(),
    onClearChannelTroubleshooting: () => Promise.resolve(),
    onClearLogs: () => Promise.resolve(),
    sourceStates: createIdleSourceStates(),
    workers: [],
    onExportLogs: () => {},
    onRefreshAllSources,
    onRefreshSource: () => {},
  };
}

describe('DevtoolsTabContent 刷新入口', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // vitest 未启用 globals，RTL 的自动清理不会注册，需手动卸载，
    // 否则上一个用例的 DOM 残留会让 getByRole 命中多个元素。
    cleanup();
    vi.useRealTimers();
  });

  it('手动点击「刷新全部」会触发刷新并记录最后刷新时间', () => {
    const onRefreshAllSources = vi.fn();
    render(<DevtoolsTabContent {...createProps(onRefreshAllSources)} />);

    fireEvent.click(screen.getByRole('button', { name: '刷新全部' }));

    expect(onRefreshAllSources).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/最后刷新/)).toBeTruthy();
  });

  it('刷新回调身份变化不会重置 30 秒自动刷新计时器', () => {
    const firstRefresh = vi.fn();
    const secondRefresh = vi.fn();
    const { rerender } = render(<DevtoolsTabContent {...createProps(firstRefresh)} />);

    fireEvent.click(screen.getByRole('switch', { name: '自动刷新全部数据源（每 30 秒）' }));

    // 走 15 秒后父组件重渲染，并换上新的回调引用（模拟父组件传内联箭头）。
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    rerender(<DevtoolsTabContent {...createProps(secondRefresh)} />);

    // 再走 15 秒：原 interval 累计 30 秒应到点。若 effect 因回调身份变化
    // 销毁重建，新 interval 才走过 15 秒，不会触发——计时器被无限重置。
    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(secondRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/最后刷新/)).toBeTruthy();
  });

  it('关闭自动刷新后计时器不再触发', () => {
    const onRefreshAllSources = vi.fn();
    render(<DevtoolsTabContent {...createProps(onRefreshAllSources)} />);

    const toggle = screen.getByRole('switch', { name: '自动刷新全部数据源（每 30 秒）' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(onRefreshAllSources).not.toHaveBeenCalled();
  });
});
