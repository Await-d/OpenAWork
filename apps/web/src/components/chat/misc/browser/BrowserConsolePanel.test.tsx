// @vitest-environment jsdom
/**
 * 控制台面板的复制 / 引用能力覆盖。
 *
 * 重点验证三件事：错误日志能一键复制/引用；网络请求能分别复制请求与响应
 * （含 cURL）；点详情能展开看到请求/响应全文。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConsoleEntry } from './browser-console-types.js';
import { CONSOLE_STACK_LOCATION_MAX_CHARS } from './browser-console-stack.js';
import { COMPOSER_INSERT_EVENT } from './browser-clipboard.js';
import { BrowserConsolePanel } from './BrowserConsolePanel.js';

function makeErrorEntry(message = 'Uncaught TypeError: x is not a function'): ConsoleEntry {
  return {
    id: 'err-1',
    level: 'error',
    message,
    timestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
  };
}

function makeNetworkEntry(status = 200): ConsoleEntry {
  return {
    id: 'net-net-7',
    level: 'network',
    message: `⟵ ${status} POST http://localhost:3000/api/login · 18ms`,
    timestamp: Date.UTC(2026, 0, 2, 3, 4, 6),
    network: {
      networkId: 'net-7',
      source: 'fetch',
      method: 'POST',
      url: 'http://localhost:3000/api/login',
      requestHeaders: { 'content-type': 'application/json', authorization: '***' },
      requestBody: '{"user":"ada"}',
      status,
      statusText: status === 200 ? 'OK' : 'Internal Server Error',
      ok: status < 400,
      durationMs: 18,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{"token":"abc"}',
    },
  };
}

function renderPanel(logs: ConsoleEntry[]) {
  return render(
    <BrowserConsolePanel
      logs={logs}
      endRef={{ current: null }}
      onClear={() => {}}
      onClose={() => {}}
    />,
  );
}

function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  vi.restoreAllMocks();
});

describe('BrowserConsolePanel 复制与引用', () => {
  it('错误日志提供复制与引用入口', () => {
    renderPanel([makeErrorEntry()]);

    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '引用到输入框' })).toBeTruthy();
  });

  it('复制错误日志写入剪贴板并给出回执', async () => {
    const writeText = stubClipboard();
    renderPanel([makeErrorEntry('boom')]);

    fireEvent.click(screen.getByRole('button', { name: '复制' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('[error] boom');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已复制'));
  });

  it('引用错误日志会派发输入框插入事件', async () => {
    const details: unknown[] = [];
    const handler = (event: Event): void => {
      details.push((event as CustomEvent).detail);
    };
    window.addEventListener(COMPOSER_INSERT_EVENT, handler);
    try {
      renderPanel([makeErrorEntry('bad thing')]);
      fireEvent.click(screen.getByRole('button', { name: '引用到输入框' }));
    } finally {
      window.removeEventListener(COMPOSER_INSERT_EVENT, handler);
    }

    expect(details.length).toBe(1);
    expect((details[0] as { text: string }).text).toContain('控制台 error：bad thing');
  });

  it('网络条目提供请求 / 响应 / cURL 三个复制入口', () => {
    renderPanel([makeNetworkEntry()]);

    expect(screen.getByRole('button', { name: '复制请求' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制响应' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制为 cURL' })).toBeTruthy();
  });

  it('复制请求内容包含方法与请求体', async () => {
    const writeText = stubClipboard();
    renderPanel([makeNetworkEntry()]);

    fireEvent.click(screen.getByRole('button', { name: '复制请求' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('POST http://localhost:3000/api/login');
    expect(copied).toContain('{"user":"ada"}');
  });

  it('复制响应内容包含状态码与响应体', async () => {
    const writeText = stubClipboard();
    renderPanel([makeNetworkEntry(500)]);

    fireEvent.click(screen.getByRole('button', { name: '复制响应' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('状态 500');
    expect(copied).toContain('{"token":"abc"}');
  });

  it('复制为 cURL 生成可直接复现的命令', async () => {
    const writeText = stubClipboard();
    renderPanel([makeNetworkEntry()]);

    fireEvent.click(screen.getByRole('button', { name: '复制为 cURL' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('curl');
    expect(copied).toContain('-X POST');
    expect(copied).toContain('--data-raw');
  });

  it('查看详情展开请求/响应全文，并可分块复制', () => {
    renderPanel([makeNetworkEntry()]);

    // 折叠时只有列表行，没有请求/响应分区。
    expect(screen.queryByText('请求')).toBeNull();
    expect(screen.queryByText('响应')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));

    expect(screen.getByText('请求')).toBeTruthy();
    expect(screen.getByText('响应')).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制请求全文' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制响应全文' })).toBeTruthy();

    // 折叠回去后详情消失，避免面板被长文本撑满。
    fireEvent.click(screen.getByRole('button', { name: '收起详情' }));
    expect(screen.queryByText('请求')).toBeNull();
  });

  it('搜索能命中接口 URL 与响应体', () => {
    renderPanel([makeNetworkEntry(), makeErrorEntry('unrelated failure')]);

    fireEvent.change(screen.getByLabelText('搜索控制台日志'), {
      target: { value: 'login' },
    });

    expect(screen.getByText(/POST http:\/\/localhost:3000\/api\/login/)).toBeTruthy();
    expect(screen.queryByText(/unrelated failure/)).toBeNull();
  });
});

describe('BrowserConsolePanel 调用栈展开', () => {
  const BUNDLE_URL = 'http://localhost:5173/assets/bundle.js';

  function makeStackEntry(overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
    return {
      id: 'stack-1',
      level: 'error',
      message: 'mapped-boom',
      timestamp: Date.UTC(2026, 0, 2, 3, 4, 7),
      stack: [{ url: BUNDLE_URL, line: 0, column: 8, functionName: 'boom' }],
      sourceMappedStack: [
        {
          url: BUNDLE_URL,
          line: 0,
          column: 8,
          functionName: 'boom',
          source: 'console.error',
          sourceLine: 0,
          sourceColumn: 8,
          sourceName: 'original.ts',
          mapped: true,
        },
      ],
      ...overrides,
    };
  }

  it('有栈的条目折叠展示入口，展开后按 1-based 展示源码位置', () => {
    renderPanel([makeStackEntry()]);

    const toggle = screen.getByTestId('console-stack-toggle');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('堆栈 · 1 帧');
    expect(toggle.getAttribute('data-mapped')).toBe('true');
    expect(screen.queryByTestId('console-stack-panel')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByTestId('console-stack-panel');
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(screen.getByTestId('console-stack-location').textContent).toBe('original.ts:1:9');
    expect(screen.getByTestId('console-stack-frame').textContent).toContain('boom');
    expect(screen.queryByTestId('console-stack-unmapped')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('console-stack-panel')).toBeNull();
  });

  it('未映射帧展示打包后位置并带「未映射」标记', () => {
    renderPanel([makeStackEntry({ sourceMappedStack: undefined })]);
    fireEvent.click(screen.getByTestId('console-stack-toggle'));

    expect(screen.getByTestId('console-stack-frame').getAttribute('data-unmapped')).toBe('true');
    expect(screen.getByTestId('console-stack-unmapped').textContent).toBe('未映射');
    expect(screen.getByTestId('console-stack-location').textContent).toBe(`${BUNDLE_URL}:1:9`);
  });

  it('没有栈的条目不渲染展开入口', () => {
    renderPanel([makeErrorEntry()]);

    expect(screen.queryByTestId('console-stack-toggle')).toBeNull();
    expect(screen.queryByTestId('console-stack-panel')).toBeNull();
  });

  it('仅注入 logs 即可挂载（harness 场景），清空禁用、关闭隐藏', () => {
    render(<BrowserConsolePanel logs={[makeStackEntry()]} />);

    expect(screen.getByTestId('console-stack-toggle')).toBeTruthy();
    expect(screen.getByRole('button', { name: '清空' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: '关闭控制台' })).toBeNull();
  });

  it('sourceMappedStack 为空数组时回落原始栈', () => {
    renderPanel([makeStackEntry({ sourceMappedStack: [] })]);
    fireEvent.click(screen.getByTestId('console-stack-toggle'));

    expect(screen.getByTestId('console-stack-unmapped').textContent).toBe('未映射');
    expect(screen.getByTestId('console-stack-location').textContent).toBe(`${BUNDLE_URL}:1:9`);
  });

  it('长 URL 截断展示，悬停与复制保留完整值', async () => {
    const writeText = stubClipboard();
    const longUrl = `http://localhost:5173/${'chunk/'.repeat(30)}bundle.js`;
    renderPanel([
      makeStackEntry({
        sourceMappedStack: undefined,
        stack: [{ url: longUrl, line: 11, column: 3 }],
      }),
    ]);
    fireEvent.click(screen.getByTestId('console-stack-toggle'));

    const location = screen.getByTestId('console-stack-location');
    expect(location.textContent?.startsWith('…')).toBe(true);
    expect(location.textContent?.length).toBe(CONSOLE_STACK_LOCATION_MAX_CHARS);
    expect(location.textContent?.includes('http://localhost:5173/chunk/')).toBe(false);
    expect(location.textContent?.endsWith('bundle.js:12:4')).toBe(true);
    expect(location.getAttribute('title')).toBe(`${longUrl}:12:4`);

    fireEvent.click(screen.getByTestId('console-stack-frame-copy'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0]?.[0])).toBe(`${longUrl}:12:4`);
  });

  it('复制帧写入 file:line:col 并给出回执', async () => {
    const writeText = stubClipboard();
    renderPanel([makeStackEntry()]);
    fireEvent.click(screen.getByTestId('console-stack-toggle'));

    fireEvent.click(screen.getByTestId('console-stack-frame-copy'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0]?.[0])).toBe('original.ts:1:9');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已复制'));
  });

  it('超过 12 帧时截断展示并提示剩余帧数', () => {
    const frames = Array.from({ length: 15 }, (_, index) => ({
      url: `http://localhost:5173/f${index}.js`,
      line: index,
      column: 0,
    }));
    renderPanel([makeStackEntry({ sourceMappedStack: undefined, stack: frames })]);
    fireEvent.click(screen.getByTestId('console-stack-toggle'));

    expect(screen.getAllByTestId('console-stack-frame').length).toBe(12);
    expect(screen.getByTestId('console-stack-hidden').textContent).toContain('另有 3 帧未展示');
  });
});

describe('BrowserConsolePanel 瀑布视图', () => {
  it('可在列表与瀑布视图之间切换，并与列表共用同一份网络状态', () => {
    renderPanel([makeErrorEntry(), makeNetworkEntry()]);

    // 默认仍是列表视图：既有行为不变。
    expect(screen.queryByTestId('network-waterfall')).toBeNull();
    expect(screen.getAllByTestId('console-entry').length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: '瀑布' }));

    expect(screen.getByTestId('network-waterfall')).toBeTruthy();
    expect(screen.getAllByTestId('waterfall-row').length).toBe(1);
    expect(screen.queryByLabelText('搜索控制台日志')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '列表' }));

    expect(screen.queryByTestId('network-waterfall')).toBeNull();
    expect(screen.getByLabelText('搜索控制台日志')).toBeTruthy();
    expect(screen.getAllByTestId('console-entry').length).toBe(2);
  });

  it('把「无实时引擎」采集状态透传给瀑布视图', () => {
    render(
      <BrowserConsolePanel
        logs={[]}
        endRef={{ current: null }}
        onClear={() => {}}
        onClose={() => {}}
        networkCaptureStatus="unavailable"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '瀑布' }));

    expect(screen.getByTestId('waterfall-notice').textContent).toContain('未开始录制');
  });
});

describe('BrowserConsolePanel 元素检查器视图', () => {
  const inspectorProps = {
    dom: {
      truncated: false,
      root: {
        nodeId: 1,
        backendNodeId: 10,
        nodeName: '#document',
        attributes: {},
        childCount: 1,
        children: [
          {
            nodeId: 2,
            backendNodeId: 20,
            nodeName: 'BODY',
            attributes: { class: 'page' },
            childCount: 0,
          },
        ],
      },
    },
    a11y: null,
    node: null,
    onRequestDom: () => {},
    onRequestA11y: () => {},
    onRequestFullStyles: () => {},
    onArmPick: () => {},
  };

  it('未接线时不渲染「元素」pill，既有两视图不受影响', () => {
    renderPanel([makeErrorEntry()]);

    expect(screen.queryByRole('button', { name: '元素' })).toBeNull();
    expect(screen.queryByTestId('browser-inspector')).toBeNull();
  });

  it('接线后「元素」pill 在同一面板内挂载检查器，信封原样透传', () => {
    render(
      <BrowserConsolePanel
        logs={[makeErrorEntry()]}
        endRef={{ current: null }}
        onClear={() => {}}
        onClose={() => {}}
        inspector={inspectorProps}
      />,
    );

    expect(screen.queryByTestId('browser-inspector')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '元素' }));

    expect(screen.getByTestId('browser-inspector')).toBeTruthy();
    expect(screen.getAllByTestId('inspector-dom-row').length).toBe(2);
    expect(screen.getByTestId('inspector-summary').textContent).toBe('2 个节点');

    fireEvent.click(screen.getByRole('button', { name: '列表' }));
    expect(screen.queryByTestId('browser-inspector')).toBeNull();
    expect(screen.getAllByTestId('console-entry').length).toBe(1);
  });
});

describe('BrowserConsolePanel 空态文案', () => {
  function renderEmptyState(props: {
    logs?: ConsoleEntry[];
    tauriMode?: boolean;
    liveAvailable?: boolean;
  }) {
    return render(
      <BrowserConsolePanel
        logs={props.logs ?? []}
        endRef={{ current: null }}
        onClear={() => {}}
        onClose={() => {}}
        tauriMode={props.tauriMode}
        liveAvailable={props.liveAvailable}
      />,
    );
  }

  it('无实时引擎时保留跨域无法注入的说明', () => {
    renderEmptyState({ liveAvailable: false });

    expect(screen.getByText(/跨域页面\(非 localhost\)无法注入/)).toBeTruthy();
  });

  it('实时引擎可用时不再声称跨域无法注入', () => {
    renderEmptyState({ liveAvailable: true });

    expect(screen.queryByText(/无法注入/)).toBeNull();
    expect(screen.getByText(/日志由网关侧实时引擎采集/)).toBeTruthy();
  });

  it('Tauri 原生窗口在实时引擎可用时沿用采集说明并标记采集来源', () => {
    renderEmptyState({ tauriMode: true, liveAvailable: true });

    expect(screen.getByText(/日志由网关侧实时引擎采集/)).toBeTruthy();
    expect(screen.queryByText(/Tauri 原生窗口/)).toBeNull();
    expect(screen.getByTestId('console-capture-badge')).toBeTruthy();
  });

  it('Tauri 原生窗口在引擎不可用时说明采集依赖网关侧引擎', () => {
    renderEmptyState({ tauriMode: true, liveAvailable: false });

    expect(screen.getByText(/Tauri 原生窗口本身无法注入采集/)).toBeTruthy();
    expect(screen.getByText(/改用浏览器\(Web\)模式查看/)).toBeTruthy();
    expect(screen.queryByTestId('console-capture-badge')).toBeNull();
  });

  it('已有日志但被过滤掉时提示过滤条件无匹配（Tauri 下同样优先）', () => {
    renderEmptyState({ logs: [makeErrorEntry()], tauriMode: true, liveAvailable: true });

    fireEvent.click(screen.getByRole('button', { name: '警告' }));

    expect(screen.getByText('当前过滤条件下无匹配')).toBeTruthy();
    expect(screen.queryByText(/Tauri 原生窗口/)).toBeNull();
  });
});
