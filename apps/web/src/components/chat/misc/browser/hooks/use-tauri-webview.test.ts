// @vitest-environment jsdom
/**
 * `useTauriWebview` 原生 webview 生命周期竞态覆盖。
 *
 * 原生子 webview 是永远盖在 HTML 之上的表面，最危险的失效模式是「创建了却没人
 * 再持有句柄」——它会一直挡在 UI 前面，只能重启应用。这里把三条已知竞态钉死：
 * a. `hidden` 先于 `tauri://created` 到达时，创建完成的表面必须立刻离屏；
 * b. 在 `new Webview(...)` 之后、`tauri://created` 之前卸载时，created 仍要 close；
 * c. `tauri://error` 之后必须真的关闭句柄，而不是只把 ref 置空；
 * d. 正常显隐切换：离屏 ↔ 恢复容器矩形。
 *
 * 全部走 mock：不启动真实 Tauri，也不触碰 Rust。
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTauriWebview } from './use-tauri-webview.js';

const mocks = vi.hoisted(() => {
  type CreatedHandler = () => void;
  type ErrorHandler = (event: unknown) => void;

  /** `@tauri-apps/api/webview` 的 Webview 替身：手动驱动 created / error 事件。 */
  class FakeWebview {
    static instances: FakeWebview[] = [];
    readonly label: string;
    readonly options: Record<string, unknown>;
    readonly createdHandlers: CreatedHandler[] = [];
    readonly errorHandlers: ErrorHandler[] = [];
    readonly close = vi.fn(async (): Promise<void> => undefined);
    readonly setPosition = vi.fn(async (_position: unknown): Promise<void> => undefined);
    readonly setSize = vi.fn(async (_size: unknown): Promise<void> => undefined);

    constructor(_window: unknown, label: string, options: Record<string, unknown>) {
      this.label = label;
      this.options = options;
      FakeWebview.instances.push(this);
    }

    once(event: string, handler: unknown): Promise<() => void> {
      if (event === 'tauri://created') this.createdHandlers.push(handler as CreatedHandler);
      if (event === 'tauri://error') this.errorHandlers.push(handler as ErrorHandler);
      return Promise.resolve(() => undefined);
    }

    emitCreated(): void {
      for (const handler of this.createdHandlers) handler();
    }

    emitError(payload: unknown): void {
      for (const handler of this.errorHandlers) handler({ payload });
    }
  }

  return {
    FakeWebview,
    invoke: vi.fn(async (_command: string, _args?: unknown): Promise<boolean> => true),
  };
});

vi.mock('@tauri-apps/api/webview', () => ({ Webview: mocks.FakeWebview }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/api/dpi', () => ({
  LogicalPosition: class LogicalPosition {
    constructor(
      public readonly x: number,
      public readonly y: number,
    ) {}
  },
  LogicalSize: class LogicalSize {
    constructor(
      public readonly width: number,
      public readonly height: number,
    ) {}
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

const CONTAINER_RECT = { x: 40, y: 50, width: 800, height: 600 };

function makeContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.getBoundingClientRect = () =>
    ({
      x: CONTAINER_RECT.x,
      y: CONTAINER_RECT.y,
      width: CONTAINER_RECT.width,
      height: CONTAINER_RECT.height,
      top: CONTAINER_RECT.y,
      left: CONTAINER_RECT.x,
      right: CONTAINER_RECT.x + CONTAINER_RECT.width,
      bottom: CONTAINER_RECT.y + CONTAINER_RECT.height,
      toJSON: () => ({}),
    }) as DOMRect;
  return container;
}

/** jsdom 没有 ResizeObserver：给 hook 的 observe/disconnect 调用一个无害替身。 */
function installResizeObserverStub(): void {
  class TestResizeObserver {
    observe(): void {
      return undefined;
    }
    unobserve(): void {
      return undefined;
    }
    disconnect(): void {
      return undefined;
    }
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
}

/** 冲刷 create() 里并行动态 import 的微任务。 */
async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

type FakeWebviewInstance = InstanceType<typeof mocks.FakeWebview>;

function lastWebview(): FakeWebviewInstance {
  const instance = mocks.FakeWebview.instances.at(-1);
  if (!instance) throw new Error('webview 尚未创建');
  return instance;
}

function lastPosition(instance: FakeWebviewInstance): { x: number; y: number } {
  const call = instance.setPosition.mock.calls.at(-1);
  if (!call) throw new Error('setPosition 未被调用');
  const position = call[0] as { x: number; y: number };
  return { x: position.x, y: position.y };
}

function setup() {
  const container = makeContainer();
  const containerRef: { current: HTMLDivElement | null } = { current: container };
  const internalNavRef: { current: { tabId: string; url: string } | null } = { current: null };
  const activeTabIdRef = { current: 'tab-1' };
  const generationRef = { current: 0 };
  const baseParams = {
    isTauri: true,
    activeUrl: 'https://example.test/',
    refreshKey: 0,
    hidden: false,
    containerRef,
    internalNavRef,
    activeTabIdRef,
    generationRef,
  };

  const rendered = renderHook((props: typeof baseParams) => useTauriWebview(props), {
    initialProps: baseParams,
  });

  return { ...rendered, baseParams };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.FakeWebview.instances.length = 0;
  mocks.invoke.mockClear();
  installResizeObserverStub();
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useTauriWebview', () => {
  it('a. hidden 在 tauri://created 之前置为 true：创建的 webview 立刻离屏，绝不落到容器矩形', async () => {
    const { rerender, result, baseParams } = setup();
    await flushAsync();

    const instance = lastWebview();

    // 创建尚未完成时切到 hidden：此刻没有句柄，visibility effect 会直接返回。
    act(() => {
      rerender({ ...baseParams, hidden: true });
    });
    expect(instance.setPosition).not.toHaveBeenCalled();

    act(() => {
      instance.emitCreated();
    });

    expect(result.current.webviewReady).toBe(true);
    expect(lastPosition(instance)).toEqual({ x: -9999, y: -9999 });
    // 全程没有按容器 x=40 定位过——否则表面会盖在 UI 上。
    const xs = instance.setPosition.mock.calls.map((call) => (call[0] as { x: number }).x);
    expect(xs).not.toContain(CONTAINER_RECT.x);
    expect(instance.setSize).not.toHaveBeenCalled();
  });

  it('b. 在 Webview 之后、tauri://created 之前卸载：created 触发时仍会 close，不留孤儿', async () => {
    const { unmount } = setup();
    await flushAsync();

    const instance = lastWebview();

    unmount();
    // 清理阶段已拿到句柄并发起 close。
    expect(instance.close).toHaveBeenCalledTimes(1);
    expect(instance.setPosition).not.toHaveBeenCalled();

    // created 晚于卸载到达：必须用保留的句柄再关一次。
    await act(async () => {
      instance.emitCreated();
      await Promise.resolve();
    });

    expect(instance.close).toHaveBeenCalledTimes(2);
    expect(instance.setPosition).not.toHaveBeenCalled();
  });

  it('c. tauri://error 在句柄存在时触发：close 被调用，而非只清空 ref', async () => {
    const { result } = setup();
    await flushAsync();

    const instance = lastWebview();

    await act(async () => {
      instance.emitError({ message: 'create failed' });
      await Promise.resolve();
    });

    expect(instance.close).toHaveBeenCalledTimes(1);
    expect(result.current.webviewError).toBe('create failed');
    expect(mocks.invoke).not.toHaveBeenCalledWith('close_stale_browser_webviews');
  });

  it('d. 正常切换：hidden=false→true 离屏，true→false 恢复容器矩形', async () => {
    const { rerender, baseParams } = setup();
    await flushAsync();

    const instance = lastWebview();

    act(() => {
      instance.emitCreated();
    });
    expect(lastPosition(instance)).toEqual({ x: CONTAINER_RECT.x, y: CONTAINER_RECT.y });

    act(() => {
      rerender({ ...baseParams, hidden: true });
    });
    expect(lastPosition(instance)).toEqual({ x: -9999, y: -9999 });

    act(() => {
      rerender({ ...baseParams, hidden: false });
    });
    expect(lastPosition(instance)).toEqual({ x: CONTAINER_RECT.x, y: CONTAINER_RECT.y });
    expect(instance.setSize).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: CONTAINER_RECT.width, height: CONTAINER_RECT.height }),
    );
  });

  it('e. close 失败时按 label 调用 Rust close_browser_webview 兜底（且不盲目 reaper）', async () => {
    const { unmount } = setup();
    await flushAsync();

    const instance = lastWebview();
    instance.close.mockRejectedValueOnce(new Error('IPC 通道未就绪'));

    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(instance.label.startsWith('browser-')).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith('close_browser_webview', { label: instance.label });
    expect(mocks.invoke).not.toHaveBeenCalledWith('close_stale_browser_webviews');
  });

  it('f. 同一毫秒内重建：label 仍唯一，避免同名创建失败或误关', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const { rerender, baseParams } = setup();
      await flushAsync();
      const first = lastWebview();

      rerender({ ...baseParams, activeUrl: 'https://example.test/next' });
      await flushAsync();
      const second = lastWebview();

      expect(second).not.toBe(first);
      expect(second.label).not.toBe(first.label);
      expect(second.label.startsWith('browser-')).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
