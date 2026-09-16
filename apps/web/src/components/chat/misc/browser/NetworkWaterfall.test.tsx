// @vitest-environment jsdom
/**
 * 瀑布视图的渲染 / 筛选 / 状态 / 导出覆盖，以及几何与格式化纯函数的单测。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ConsoleEntry, NetworkExchange } from './browser-console-types.js';
import {
  NetworkWaterfall,
  classifyNetworkStatus,
  computeWaterfallLayout,
  formatWaterfallDuration,
  normalizeDurationMs,
} from './NetworkWaterfall.js';

const T0 = Date.UTC(2026, 0, 2, 3, 4, 5);

function makeNetworkEntry(
  id: string,
  network: Partial<NetworkExchange>,
  timestamp: number = T0,
): ConsoleEntry {
  return {
    id,
    level: 'network',
    message: `⟵ ${network.status ?? '—'} ${network.method ?? 'GET'} ${network.url ?? id}`,
    timestamp,
    network: {
      networkId: id,
      source: 'fetch',
      method: 'GET',
      url: `http://localhost:3000/${id}`,
      ...network,
    },
  };
}

function makeFixtureEntries(): ConsoleEntry[] {
  return [
    makeNetworkEntry(
      'net-ok',
      {
        method: 'POST',
        url: 'http://localhost:3000/api/login?next=%2Fhome',
        status: 200,
        statusText: 'OK',
        durationMs: 18,
        resourceType: 'fetch',
        requestHeaders: { authorization: '***' },
        responseHeaders: { 'content-type': 'application/json' },
      },
      T0,
    ),
    makeNetworkEntry(
      'net-redirect',
      { status: 302, statusText: 'Found', durationMs: 6, resourceType: 'document' },
      T0 + 20,
    ),
    makeNetworkEntry(
      'net-500',
      {
        status: 500,
        statusText: 'Internal Server Error',
        durationMs: 42,
        resourceType: 'fetch',
      },
      T0 + 40,
    ),
    makeNetworkEntry(
      'net-failed',
      { errorMessage: 'net::ERR_CONNECTION_REFUSED', durationMs: 3, resourceType: 'xhr' },
      T0 + 60,
    ),
    makeNetworkEntry('net-pending', { resourceType: 'fetch' }, T0 + 80),
  ];
}

function renderWaterfall(
  entries: ConsoleEntry[],
  props: Omit<Parameters<typeof NetworkWaterfall>[0], 'entries'> = {},
): ReturnType<typeof render> {
  return render(<NetworkWaterfall entries={entries} {...props} />);
}

function rowAt(index: number): HTMLElement {
  const row = screen.getAllByTestId('waterfall-row')[index];
  if (row === undefined) throw new Error(`缺少第 ${index} 条瀑布行`);
  return row;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NetworkWaterfall 渲染', () => {
  it('每个网络请求一行，忽略非网络条目', () => {
    const entries: ConsoleEntry[] = [
      { id: 'log-1', level: 'error', message: 'boom', timestamp: T0 },
      ...makeFixtureEntries(),
    ];
    renderWaterfall(entries);

    expect(screen.getAllByTestId('waterfall-row').length).toBe(5);
    const first = rowAt(0);
    expect(first.textContent).toContain('POST');
    expect(first.textContent).toContain('localhost:3000/api/login?next=%2Fhome');
    expect(first.textContent).toContain('200');
    expect(first.textContent).toContain('18ms');
  });

  it('失败行标 failed 并用 danger 语义色；未记录耗时走不确定态', () => {
    renderWaterfall(makeFixtureEntries());

    const failedRow = rowAt(3);
    expect(failedRow.getAttribute('data-status-class')).toBe('failed');
    const failedBar = within(failedRow).getByTestId('waterfall-bar');
    expect(failedBar.getAttribute('style')).toContain('var(--danger)');
    expect(failedBar.getAttribute('data-indeterminate')).toBeNull();

    const pendingRow = rowAt(4);
    expect(pendingRow.getAttribute('data-status-class')).toBe('pending');
    const pendingBar = within(pendingRow).getByTestId('waterfall-bar');
    expect(pendingBar.getAttribute('data-indeterminate')).toBe('true');
  });

  it('状态类与 4xx-5xx 行颜色分别落在 success / warning token 上', () => {
    renderWaterfall(makeFixtureEntries());

    expect(within(rowAt(0)).getByTestId('waterfall-bar').getAttribute('style')).toContain(
      'var(--success)',
    );
    expect(within(rowAt(2)).getByTestId('waterfall-bar').getAttribute('style')).toContain(
      'var(--warning)',
    );
  });

  it('行是 <button>（键盘可达），点击后展示详情：URL / 头部 / 未采集响应体', () => {
    renderWaterfall(makeFixtureEntries());
    const first = rowAt(0);
    expect(first.tagName).toBe('BUTTON');
    expect(screen.queryByTestId('waterfall-detail')).toBeNull();

    fireEvent.click(first);

    const detail = screen.getByTestId('waterfall-detail');
    expect(detail.textContent).toContain('POST');
    expect(detail.textContent).toContain('http://localhost:3000/api/login?next=%2Fhome');
    expect(detail.textContent).toContain('200 OK');
    expect(detail.textContent).toContain('18ms');
    expect(detail.textContent).toContain('fetch');
    expect(detail.textContent).toContain('authorization: ***');
    expect(detail.textContent).toContain('content-type: application/json');
    expect(screen.getByTestId('waterfall-body-note').textContent).toContain('未采集响应体');

    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
    expect(screen.queryByTestId('waterfall-detail')).toBeNull();
  });

  it('汇总行给出请求数、失败数与总耗时（未记录耗时单独计数）', () => {
    renderWaterfall(makeFixtureEntries());

    const summary = screen.getByTestId('waterfall-summary').textContent ?? '';
    expect(summary).toContain('5 个请求');
    expect(summary).toContain('1 个失败');
    expect(summary).toContain('总耗时 69ms');
    expect(summary).toContain('1 条未记录耗时');
  });

  it('筛选不重算几何：302 行保持相对整段采集的偏移（20/82 ≈ 24.39%）', () => {
    renderWaterfall(makeFixtureEntries());

    fireEvent.click(screen.getByTestId('waterfall-status-redirect'));

    expect(within(rowAt(0)).getByTestId('waterfall-bar').getAttribute('style')).toContain(
      'left: 24.39%',
    );
  });
});

describe('NetworkWaterfall 筛选', () => {
  it('按状态类筛选只保留该类请求', () => {
    renderWaterfall(makeFixtureEntries());

    fireEvent.click(screen.getByTestId('waterfall-status-error'));
    expect(screen.getAllByTestId('waterfall-row').length).toBe(1);
    expect(rowAt(0).textContent).toContain('500');

    fireEvent.click(screen.getByTestId('waterfall-status-ok'));
    expect(screen.getAllByTestId('waterfall-row').length).toBe(1);
    expect(rowAt(0).textContent).toContain('200');
  });

  it('「仅失败」只保留网络层失败的请求', () => {
    renderWaterfall(makeFixtureEntries());

    fireEvent.click(screen.getByTestId('waterfall-failures-toggle'));

    expect(screen.getAllByTestId('waterfall-row').length).toBe(1);
    expect(rowAt(0).getAttribute('data-status-class')).toBe('failed');
    expect(screen.getByTestId('waterfall-summary').textContent).toContain('1 个失败');
  });

  it('按资源类型筛选只保留该类型的请求', () => {
    renderWaterfall(makeFixtureEntries());

    fireEvent.click(screen.getByTestId('waterfall-type-document'));
    expect(screen.getAllByTestId('waterfall-row').length).toBe(1);
    expect(rowAt(0).textContent).toContain('302');

    fireEvent.click(screen.getByTestId('waterfall-type-all'));
    expect(screen.getAllByTestId('waterfall-row').length).toBe(5);
  });

  it('筛选后无匹配时给出空态与重置入口提示，而不是空白区域', () => {
    renderWaterfall(makeFixtureEntries());

    fireEvent.click(screen.getByTestId('waterfall-status-redirect'));
    fireEvent.click(screen.getByTestId('waterfall-failures-toggle'));

    expect(screen.queryAllByTestId('waterfall-row').length).toBe(0);
    expect(screen.getByTestId('waterfall-notice').textContent).toContain('当前筛选条件下无匹配');
  });
});

describe('NetworkWaterfall 状态', () => {
  it('没有任何网络记录时展示空态', () => {
    renderWaterfall([]);

    expect(screen.getByTestId('waterfall-notice').textContent).toContain('暂无网络请求');
    expect(screen.queryAllByTestId('waterfall-row').length).toBe(0);
  });

  it('无实时引擎 / 未录制时展示对应状态而不是空态', () => {
    renderWaterfall([], { captureStatus: 'unavailable' });

    expect(screen.getByTestId('waterfall-notice').textContent).toContain('未开始录制');
  });

  it('等待首批事件时展示加载骨架屏', () => {
    renderWaterfall([], { captureStatus: 'loading' });

    expect(screen.getByTestId('waterfall-loading').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('waterfall-notice')).toBeNull();
  });
});

describe('NetworkWaterfall 导出 HAR', () => {
  it('导出按钮把当前筛选结果写成 HAR 1.2 文件', async () => {
    const createdBlobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob);
      return 'blob:mock';
    });
    URL.revokeObjectURL = vi.fn();
    const clickedAnchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedAnchors.push(this);
    });

    renderWaterfall(makeFixtureEntries(), {
      context: { url: 'http://localhost:3000/', title: '首页' },
    });
    fireEvent.click(screen.getByTestId('waterfall-status-error'));
    fireEvent.click(screen.getByTestId('waterfall-export'));

    const blob = createdBlobs[0];
    expect(blob).toBeDefined();
    const text = (await blob?.text()) ?? '';
    const parsed = JSON.parse(text) as {
      log: { version: string; pages: Array<{ title: string }>; entries: unknown[] };
    };
    expect(parsed.log.version).toBe('1.2');
    expect(parsed.log.pages[0]?.title).toBe('首页');
    expect(parsed.log.entries.length).toBe(1);
    expect(clickedAnchors[0]?.download).toMatch(/\.har$/);
  });

  it('筛选后没有可导出的请求时导出按钮禁用', () => {
    renderWaterfall(makeFixtureEntries());
    fireEvent.click(screen.getByTestId('waterfall-status-redirect'));
    fireEvent.click(screen.getByTestId('waterfall-failures-toggle'));

    const button = screen.getByTestId('waterfall-export');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('computeWaterfallLayout', () => {
  it('以最早开始时刻为原点计算偏移与宽度，百分比保留两位小数', () => {
    const layout = computeWaterfallLayout([
      { id: 'a', startedAt: 0, durationMs: 0 },
      { id: 'b', startedAt: 100, durationMs: 100 },
      { id: 'c', startedAt: 300, durationMs: 0 },
    ]);

    expect(layout.spanMs).toBe(300);
    expect(layout.items[0]).toEqual({ id: 'a', leftPct: 0, durationMs: 0, widthPct: 1 });
    expect(layout.items[1]).toEqual({ id: 'b', leftPct: 33.33, durationMs: 100, widthPct: 33.33 });
    // 零耗时也必须可见：宽度兜底为最小条宽。
    expect(layout.items[2]?.widthPct).toBe(1);
  });

  it('整段采集同刻且零耗时时跨度兜底为 1ms，不出现除零', () => {
    const layout = computeWaterfallLayout([
      { id: 'a', startedAt: 5_000, durationMs: 0 },
      { id: 'b', startedAt: 5_000, durationMs: 0 },
    ]);

    expect(layout.spanMs).toBe(1);
    expect(layout.items).toEqual([
      { id: 'a', leftPct: 0, durationMs: 0, widthPct: 1 },
      { id: 'b', leftPct: 0, durationMs: 0, widthPct: 1 },
    ]);
  });

  it('混合缺失耗时：未记录的条宽度为 null（不确定态），起点贴边时向内收 1%', () => {
    const layout = computeWaterfallLayout([
      { id: 'a', startedAt: 1_000, durationMs: 0 },
      { id: 'b', startedAt: 1_250, durationMs: 250 },
      { id: 'c', startedAt: 2_000 },
    ]);

    expect(layout.spanMs).toBe(1_000);
    expect(layout.items[2]).toEqual({ id: 'c', leftPct: 99, durationMs: null, widthPct: null });
  });

  it('空输入返回空布局', () => {
    expect(computeWaterfallLayout([])).toEqual({ items: [], spanMs: 0 });
  });
});

describe('formatWaterfallDuration / classifyNetworkStatus / normalizeDurationMs', () => {
  it('格式化跨度：毫秒 / 秒 / 分钟，未记录是 —', () => {
    expect(formatWaterfallDuration(0)).toBe('0ms');
    expect(formatWaterfallDuration(999)).toBe('999ms');
    expect(formatWaterfallDuration(1_240)).toBe('1.24s');
    expect(formatWaterfallDuration(12_400)).toBe('12.4s');
    expect(formatWaterfallDuration(65_000)).toBe('1.08min');
    expect(formatWaterfallDuration(undefined)).toBe('—');
    expect(formatWaterfallDuration(null)).toBe('—');
    expect(formatWaterfallDuration(-5)).toBe('—');
    expect(formatWaterfallDuration(Number.NaN)).toBe('—');
  });

  it('状态归类：网络层失败优先于状态码，未返回的请求是 pending', () => {
    expect(classifyNetworkStatus({ status: 204 })).toBe('ok');
    expect(classifyNetworkStatus({ status: 301 })).toBe('redirect');
    expect(classifyNetworkStatus({ status: 404 })).toBe('error');
    expect(classifyNetworkStatus({ status: 503 })).toBe('error');
    expect(classifyNetworkStatus({})).toBe('pending');
    expect(classifyNetworkStatus({ status: 200, errorMessage: 'aborted' })).toBe('failed');
  });

  it('耗时归一：负数 / 非有限值 / 缺省都视为未记录', () => {
    expect(normalizeDurationMs(0)).toBe(0);
    expect(normalizeDurationMs(12.5)).toBe(12.5);
    expect(normalizeDurationMs(undefined)).toBeNull();
    expect(normalizeDurationMs(-1)).toBeNull();
    expect(normalizeDurationMs(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeDurationMs(Number.NaN)).toBeNull();
  });
});
