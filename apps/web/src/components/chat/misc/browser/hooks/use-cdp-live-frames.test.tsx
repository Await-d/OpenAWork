// @vitest-environment jsdom
/**
 * 画面面的三条硬约束：帧到手必须回 ack（背压信用）、无效帧不回、解码失败也要回。
 * 同时钉住「帧数据不进 React 状态」——渲染只依赖元数据尺寸与 hasFrame。
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLiveClientMessage, BrowserLiveEnvelope } from '@openAwork/shared';

import { computeFrameStats, resolveBackingSize, useCdpLiveFrames } from './use-cdp-live-frames.js';
import type { BrowserLiveSession } from './use-browser-live-session.js';

const originalGetContext = HTMLCanvasElement.prototype.getContext;

/** `createImageBitmap` 替身的最小形状（hook 只读宽高并 close）。 */
interface FakeBitmap {
  width: number;
  height: number;
  close: () => void;
}

function createSessionHarness(): {
  session: BrowserLiveSession;
  sent: BrowserLiveClientMessage[];
  emit: (envelope: BrowserLiveEnvelope) => void;
} {
  const sent: BrowserLiveClientMessage[] = [];
  const listeners = new Set<(envelope: BrowserLiveEnvelope) => void>();
  return {
    sent,
    emit: (envelope) => {
      for (const listener of [...listeners]) listener(envelope);
    },
    session: {
      availability: null,
      phase: 'connected',
      lastError: null,
      unavailableHint: null,
      send: (message) => {
        sent.push(message);
      },
      screenshot: () => Promise.resolve(null),
      close: () => undefined,
      recheckAvailability: () => undefined,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

function frameEnvelope(
  payload: Partial<{
    data: string;
    deviceWidth: number;
    deviceHeight: number;
    frameSessionId: number;
    generation: number;
  }> = {},
): BrowserLiveEnvelope {
  return {
    ch: 'frame',
    seq: 1,
    ts: 0,
    payload: {
      mimeType: 'image/jpeg',
      data: btoa('frame'),
      deviceWidth: 800,
      deviceHeight: 600,
      frameSessionId: 7,
      ...payload,
    },
  };
}

/** 2d 上下文的替身：统计 `drawImage` 与 `clearRect`。 */
function installCanvasStub(): { drawn: unknown[]; cleared: unknown[]; restore: () => void } {
  const drawn: unknown[] = [];
  const cleared: unknown[] = [];
  const context = {
    drawImage: (source: unknown) => {
      drawn.push(source);
    },
    clearRect: (...args: unknown[]) => {
      cleared.push(args);
    },
  };
  HTMLCanvasElement.prototype.getContext = (() =>
    context) as unknown as HTMLCanvasElement['getContext'];
  return {
    drawn,
    cleared,
    restore: () => {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    },
  };
}

/**
 * 记录每次 `getContext` 的调用选项。
 *
 * `getContext` 的选项只在首次创建上下文时生效，所以「谁先建了上下文」直接决定
 * `alpha` / `desynchronized` 有没有真的生效——这里把入参记下来就能钉住这一点。
 */
function installContextOptionsSpy(): {
  calls: Array<CanvasRenderingContext2DSettings | undefined>;
  restore: () => void;
} {
  const calls: Array<CanvasRenderingContext2DSettings | undefined> = [];
  const context = {
    drawImage: () => undefined,
    clearRect: () => undefined,
  };
  HTMLCanvasElement.prototype.getContext = ((
    _type: string,
    options?: CanvasRenderingContext2DSettings,
  ) => {
    calls.push(options);
    return context;
  }) as unknown as HTMLCanvasElement['getContext'];
  return {
    calls,
    restore: () => {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    },
  };
}

function ackIds(sent: BrowserLiveClientMessage[]): number[] {
  return sent
    .filter(
      (message): message is Extract<BrowserLiveClientMessage, { ch: 'ack' }> =>
        message.ch === 'ack',
    )
    .map((message) => message.frameSessionId);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe('useCdpLiveFrames', () => {
  it('收帧后同步更新元数据与 hasFrame，解码完成后绘制并回 ack', async () => {
    const canvas = installCanvasStub();
    const bitmap = { width: 640, height: 360, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(bitmap)),
    );
    const harness = createSessionHarness();
    const { result } = renderHook(() => useCdpLiveFrames({ session: harness.session }));
    // 模拟 React 已经把画布挂上 ref 之后再收帧。
    result.current.canvasRef.current = document.createElement('canvas');

    act(() => harness.emit(frameEnvelope()));

    // 元数据与「已有画面」是同步更新的（坐标换算不等解码）。
    expect(result.current.hasFrame).toBe(true);
    expect(result.current.frameMetrics).toEqual({ deviceWidth: 800, deviceHeight: 600 });
    // `frameRef` 的契约只有尺寸（指针坐标换算用）；帧会话 id 的消费结果由下方 ack 断言。
    expect(result.current.frameRef.current).toEqual({ deviceWidth: 800, deviceHeight: 600 });

    await waitFor(() => {
      expect(ackIds(harness.sent)).toEqual([7]);
    });
    expect(result.current.bitmapMetrics).toEqual({ width: 640, height: 360 });
    expect(canvas.drawn).toEqual([bitmap]);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('未注入显示尺寸时按位图尺寸定档（与改造前行为一致）', async () => {
    installCanvasStub();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 320, height: 180, close: vi.fn() })),
    );
    const harness = createSessionHarness();
    const { result } = renderHook(() => useCdpLiveFrames({ session: harness.session }));

    const canvas = document.createElement('canvas');
    // 模拟 React 把画布挂上 ref 之后再收帧。
    result.current.canvasRef.current = canvas;
    act(() => harness.emit(frameEnvelope()));

    await waitFor(() => {
      expect(canvas.width).toBe(320);
    });
    expect(canvas.height).toBe(180);
  });

  /**
   * 注入显示尺寸后，backing store 必须按「显示尺寸 × DPR」定档：位图可能有 1600 宽，
   * 但只显示在几百像素的盒子里，按位图定档等于每帧都上传并缩放一张大纹理。
   */
  it('注入显示尺寸后按显示尺寸定档，而不是位图尺寸', async () => {
    installCanvasStub();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 1600, height: 1200, close: vi.fn() })),
    );
    const harness = createSessionHarness();
    const displaySizeRef = { current: { width: 400, height: 300 } };
    const zoomRef = { current: 1 };
    const { result } = renderHook(() =>
      useCdpLiveFrames({ session: harness.session, displaySizeRef, zoomRef }),
    );

    const canvas = document.createElement('canvas');
    result.current.canvasRef.current = canvas;
    act(() => harness.emit(frameEnvelope()));

    await waitFor(() => {
      expect(canvas.width).toBe(400);
    });
    expect(canvas.height).toBe(300);
  });

  /**
   * 切标签时 `clear()` 通常执行在首帧之前。如果它用默认选项建了 2d 上下文，后续
   * `paint` 传的 `alpha: false` / `desynchronized: true` 会被静默忽略（选项只在首次
   * 创建时生效）——每帧白做一次透明混合，还丢掉低延迟合成路径。
   */
  it('clear() 建上下文时也用同一组选项', () => {
    const spy = installContextOptionsSpy();
    try {
      const harness = createSessionHarness();
      const { result } = renderHook(() => useCdpLiveFrames({ session: harness.session }));
      result.current.canvasRef.current = document.createElement('canvas');

      act(() => result.current.clear());

      expect(spy.calls).toHaveLength(1);
      expect(spy.calls[0]).toEqual({ alpha: false, desynchronized: true });
    } finally {
      spy.restore();
    }
  });

  it('clear() 清空画布：切标签时避免残留上一个标签的画面', () => {
    const canvas = installCanvasStub();
    const harness = createSessionHarness();
    const { result } = renderHook(() => useCdpLiveFrames({ session: harness.session }));
    const element = document.createElement('canvas');
    element.width = 40;
    element.height = 20;
    result.current.canvasRef.current = element;

    act(() => result.current.clear());

    expect(canvas.cleared).toEqual([[0, 0, 40, 20]]);
  });

  it('闸门拉上时不绘制但仍回 ack（远端还停在旧文档，那些帧不能画上去）', async () => {
    const canvas = installCanvasStub();
    const bitmap = { width: 8, height: 4, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(bitmap)),
    );
    const harness = createSessionHarness();
    const gateRef = { current: true };
    const { result } = renderHook(() => useCdpLiveFrames({ session: harness.session, gateRef }));
    result.current.canvasRef.current = document.createElement('canvas');

    act(() => harness.emit(frameEnvelope({ frameSessionId: 9 })));

    // 不绘制也要放行，否则整条链路要等 watchdog。先等 ack 再断言绘制，
    // 避免「断言早于异步解码执行」造成的假通过。
    await waitFor(() => {
      expect(ackIds(harness.sent)).toEqual([9]);
    });
    expect(canvas.drawn).toHaveLength(0);
    // 闸门在收帧入口就短路了：本帧根本没有进入解码阶段（否则白烧 CPU）。
    expect(bitmap.close).not.toHaveBeenCalled();
    // 也不能污染「已有画面」与尺寸：否则等待文案消失、用户面对无解释的空白。
    expect(result.current.hasFrame).toBe(false);
    expect(result.current.frameMetrics).toBeNull();
  });

  it('闸门放开后恢复绘制', async () => {
    const canvas = installCanvasStub();
    const bitmap = { width: 8, height: 4, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(bitmap)),
    );
    const harness = createSessionHarness();
    const gateRef = { current: true };
    const { result } = renderHook(() => useCdpLiveFrames({ session: harness.session, gateRef }));
    result.current.canvasRef.current = document.createElement('canvas');

    act(() => harness.emit(frameEnvelope({ frameSessionId: 1 })));
    // 等这一帧消费完再断言，否则断言早于异步解码，永远「通过」。
    await waitFor(() => {
      expect(ackIds(harness.sent)).toEqual([1]);
    });
    expect(canvas.drawn).toHaveLength(0);

    gateRef.current = false;
    act(() => harness.emit(frameEnvelope({ frameSessionId: 2 })));

    await waitFor(() => {
      expect(canvas.drawn).toHaveLength(1);
    });
  });

  it('丢弃低于当前代次的帧（快速来回切换时旧页面帧晚到）', async () => {
    const canvas = installCanvasStub();
    const bitmap = { width: 8, height: 4, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(bitmap)),
    );
    const harness = createSessionHarness();
    // 门槛 5：只接受第 5 代及之后的帧。
    const minGenerationRef = { current: 5 };
    const { result } = renderHook(() =>
      useCdpLiveFrames({ session: harness.session, minGenerationRef }),
    );
    result.current.canvasRef.current = document.createElement('canvas');

    // 旧代次的迟到帧：不绘制，但必须回 ack（否则配额要等 watchdog）。
    act(() => harness.emit(frameEnvelope({ frameSessionId: 1, generation: 4 })));
    await waitFor(() => {
      expect(ackIds(harness.sent)).toEqual([1]);
    });
    expect(canvas.drawn).toHaveLength(0);
    expect(result.current.hasFrame).toBe(false);

    // 当前代次：正常绘制。
    act(() => harness.emit(frameEnvelope({ frameSessionId: 2, generation: 5 })));
    await waitFor(() => {
      expect(canvas.drawn).toHaveLength(1);
    });
  });

  it('门槛抬高后立刻生效：先前通过的第 6 代同样被拒收', async () => {
    const canvas = installCanvasStub();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 8, height: 4, close: vi.fn() })),
    );
    const harness = createSessionHarness();
    const minGenerationRef = { current: 5 };
    const { result } = renderHook(() =>
      useCdpLiveFrames({ session: harness.session, minGenerationRef }),
    );
    result.current.canvasRef.current = document.createElement('canvas');

    act(() => harness.emit(frameEnvelope({ frameSessionId: 1, generation: 6 })));
    await waitFor(() => {
      expect(canvas.drawn).toHaveLength(1);
    });

    // 宿主收到第 7 代后抬高门槛：之后到达的第 6 代必须被丢弃。
    minGenerationRef.current = 7;
    act(() => harness.emit(frameEnvelope({ frameSessionId: 2, generation: 6 })));
    await waitFor(() => {
      expect(ackIds(harness.sent)).toEqual([1, 2]);
    });
    expect(canvas.drawn).toHaveLength(1);
  });

  it('老网关不提供 generation 时退回时序判定（帧照常绘制）', async () => {
    const canvas = installCanvasStub();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 8, height: 4, close: vi.fn() })),
    );
    const harness = createSessionHarness();
    const minGenerationRef = { current: 5 };
    const { result } = renderHook(() =>
      useCdpLiveFrames({ session: harness.session, minGenerationRef }),
    );
    result.current.canvasRef.current = document.createElement('canvas');

    act(() => harness.emit(frameEnvelope({ frameSessionId: 1 })));
    await waitFor(() => {
      expect(canvas.drawn).toHaveLength(1);
    });
  });

  it('clear() 复位 hasFrame，让等待文案重新出现', () => {
    installCanvasStub();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 8, height: 4, close: vi.fn() })),
    );
    const harness = createSessionHarness();
    const { result } = renderHook(() => useCdpLiveFrames({ session: harness.session }));
    result.current.canvasRef.current = document.createElement('canvas');

    act(() => harness.emit(frameEnvelope()));
    expect(result.current.hasFrame).toBe(true);

    act(() => result.current.clear());
    expect(result.current.hasFrame).toBe(false);
    expect(result.current.bitmapMetrics).toBeNull();
  });

  it('clear() 使异步解码失效，并立即 ack 尚未开始解码的帧', async () => {
    installCanvasStub();
    let resolveBitmap: ((bitmap: FakeBitmap) => void) | null = null;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        () =>
          new Promise<FakeBitmap>((resolve) => {
            resolveBitmap = resolve;
          }),
      ),
    );
    const harness = createSessionHarness();
    const { result } = renderHook(() => useCdpLiveFrames({ session: harness.session }));
    result.current.canvasRef.current = document.createElement('canvas');

    const binaryFrame = (frameSessionId: number): BrowserLiveEnvelope => ({
      ch: 'frame',
      seq: frameSessionId,
      ts: 0,
      payload: {
        mimeType: 'image/jpeg',
        data: new Uint8Array([1, 2, 3, frameSessionId]).buffer,
        deviceWidth: 800,
        deviceHeight: 600,
        frameSessionId,
      },
    });
    act(() => harness.emit(binaryFrame(41)));
    act(() => harness.emit(binaryFrame(42)));
    act(() => result.current.clear());

    expect(ackIds(harness.sent)).toEqual([42]);
    await act(async () => {
      resolveBitmap?.({ width: 8, height: 4, close: () => undefined });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(ackIds(harness.sent)).toEqual([42, 41]);
    });
  });

  /**
   * 无效帧不绘制、不统计，但**必须**归还配额：网关已把它计入在途列表，漏 ack 会少一个
   * 下发名额直到 watchdog 才回收。
   */
  it('无效帧（空数据 / 尺寸为 0）不更新状态，但仍然回 ack', () => {
    installCanvasStub();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 1, height: 1, close: vi.fn() })),
    );
    const harness = createSessionHarness();
    const { result } = renderHook(() => useCdpLiveFrames({ session: harness.session }));

    act(() => harness.emit(frameEnvelope({ data: '', frameSessionId: 31 })));
    act(() => harness.emit(frameEnvelope({ deviceWidth: 0, frameSessionId: 32 })));

    expect(result.current.hasFrame).toBe(false);
    expect(result.current.frameMetrics).toBeNull();
    expect(ackIds(harness.sent)).toEqual([31, 32]);
  });

  it('解码完成立即回 ack：不叠任何定时器（在途配额立刻归还）', async () => {
    vi.useFakeTimers();
    installCanvasStub();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 8, height: 4, close: () => undefined })),
    );
    const harness = createSessionHarness();
    renderHook(() => useCdpLiveFrames({ session: harness.session }));

    act(() => harness.emit(frameEnvelope({ frameSessionId: 1 })));
    await act(async () => {
      await Promise.resolve();
    });
    expect(ackIds(harness.sent)).toEqual([1]);

    act(() => harness.emit(frameEnvelope({ frameSessionId: 2 })));
    await act(async () => {
      await Promise.resolve();
    });
    // 一毫秒都不推进：第二帧也必须已经 ack。
    expect(ackIds(harness.sent)).toEqual([1, 2]);
  });

  it('解码慢时 ack 自然变慢（帧率 = 消费能力，不额外等待）', async () => {
    vi.useFakeTimers();
    installCanvasStub();
    let resolveBitmap: ((bitmap: FakeBitmap) => void) | null = null;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        () =>
          new Promise<FakeBitmap>((resolve) => {
            resolveBitmap = resolve;
          }),
      ),
    );
    const harness = createSessionHarness();
    renderHook(() => useCdpLiveFrames({ session: harness.session }));

    act(() => harness.emit(frameEnvelope({ frameSessionId: 1 })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    // 解码还没完成 → 不能 ack（否则网关会继续推帧、客户端积压）。
    expect(ackIds(harness.sent)).toEqual([]);

    await act(async () => {
      resolveBitmap?.({ width: 8, height: 4, close: () => undefined });
      await Promise.resolve();
    });
    expect(ackIds(harness.sent)).toEqual([1]);
  });

  it('解码失败不吞帧：仍然回 ack，让背压继续放行', async () => {
    installCanvasStub();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('broken frame'))),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = createSessionHarness();
    renderHook(() => useCdpLiveFrames({ session: harness.session }));

    act(() => harness.emit(frameEnvelope()));

    await waitFor(() => {
      expect(ackIds(harness.sent)).toEqual([7]);
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('卸载后不再往画布上画', async () => {
    const canvas = installCanvasStub();
    const pending: { resolve: ((bitmap: FakeBitmap) => void) | null } = { resolve: null };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        () =>
          new Promise<FakeBitmap>((resolve) => {
            pending.resolve = resolve;
          }),
      ),
    );
    const harness = createSessionHarness();
    const { result, unmount } = renderHook(() => useCdpLiveFrames({ session: harness.session }));

    result.current.canvasRef.current = document.createElement('canvas');
    act(() => harness.emit(frameEnvelope()));
    unmount();

    await act(async () => {
      pending.resolve?.({ width: 640, height: 360, close: () => undefined });
      await Promise.resolve();
    });

    expect(canvas.drawn).toHaveLength(0);
  });
});

describe('串行化解码（只解最新一帧）', () => {
  /**
   * 客户端跟不上时，网关仍会按在途配额继续推几帧。若对每帧都立刻并发解码，除了最新那张
   * 全部会被代次判定丢弃——JPEG 解码是整条链路最贵的一段，白解几次就把帧预算吃光。
   * 这里钉住「同一时刻只有一个解码在飞、排队帧只留最新、被顶掉的帧立刻归还配额」。
   */
  it('解码未完成时到达的新帧顶掉旧帧，且被顶掉的帧立即 ack', async () => {
    installCanvasStub();
    const gates: Array<() => void> = [];
    const decodeCalls: string[] = [];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn((source: Blob) => {
        // 每次解码都挂起，由测试决定何时完成——这样才能观察到并发度。
        decodeCalls.push(String(source.size));
        return new Promise((resolve) => {
          gates.push(() =>
            resolve({ width: 8, height: 4, close: vi.fn() } as unknown as ImageBitmap),
          );
        });
      }),
    );

    const harness = createSessionHarness();
    const { result } = renderHook(() => useCdpLiveFrames({ session: harness.session }));
    result.current.canvasRef.current = document.createElement('canvas');

    // 用二进制帧把解码固定走 `decodeFrameFromBytes`（只经过被 stub 的 createImageBitmap），
    // base64 路径还会先尝试 data-URL fetch，观察不到这里的并发度。
    const binaryFrame = (frameSessionId: number): BrowserLiveEnvelope => ({
      ch: 'frame',
      seq: frameSessionId,
      ts: 0,
      payload: {
        mimeType: 'image/jpeg',
        data: new Uint8Array([1, 2, 3, frameSessionId]).buffer,
        deviceWidth: 800,
        deviceHeight: 600,
        frameSessionId,
      },
    });

    // 第一帧开始解码（挂起）。
    act(() => harness.emit(binaryFrame(1)));
    expect(decodeCalls).toHaveLength(1);

    // 第二、三帧在首帧解完之前到达：只应保留最新的第三帧。
    act(() => harness.emit(binaryFrame(2)));
    act(() => harness.emit(binaryFrame(3)));

    // 并发度必须仍是 1：第二、三帧都还没开始解码。
    expect(decodeCalls).toHaveLength(1);

    // 被顶掉的第二帧应当立即归还配额（网关已把它计入在途列表）。
    await waitFor(() => {
      expect(ackIds(harness.sent).sort((a, b) => a - b)).toEqual([2]);
    });

    // 放行首帧解码：随后只解最新那一帧（第三帧），第二帧永不解码。
    gates[0]?.();
    await waitFor(() => {
      expect(decodeCalls).toHaveLength(2);
    });
    gates[1]?.();
    await waitFor(() => {
      expect(ackIds(harness.sent).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });
    // 总共只解了两次：首帧 + 最新的第三帧。
    expect(decodeCalls).toHaveLength(2);
  });
});

describe('resolveBackingSize', () => {
  it('按显示尺寸 × DPR 定档，而不是按位图尺寸', () => {
    // 位图 1600×1200（帧盒上限下常见），实际只显示在 400×300 的盒子里。
    expect(
      resolveBackingSize({
        bitmapWidth: 1600,
        bitmapHeight: 1200,
        displaySize: { width: 400, height: 300 },
        devicePixelRatio: 1,
      }),
    ).toEqual({ width: 400, height: 300 });

    // 2x 屏：按物理像素定档，清晰度不丢。
    expect(
      resolveBackingSize({
        bitmapWidth: 1600,
        bitmapHeight: 1200,
        displaySize: { width: 400, height: 300 },
        devicePixelRatio: 2,
      }),
    ).toEqual({ width: 800, height: 600 });
  });

  it('不超过位图本身：放大只会更糊且多花插值', () => {
    expect(
      resolveBackingSize({
        bitmapWidth: 320,
        bitmapHeight: 200,
        displaySize: { width: 900, height: 560 },
        devicePixelRatio: 2,
      }),
    ).toEqual({ width: 320, height: 200 });
  });

  it('缩放档位参与定档（放大后需要更多物理像素）', () => {
    expect(
      resolveBackingSize({
        bitmapWidth: 1600,
        bitmapHeight: 1200,
        displaySize: { width: 400, height: 300 },
        zoom: 2,
        devicePixelRatio: 1,
      }),
    ).toEqual({ width: 800, height: 600 });
  });

  it('显示尺寸缺失 / 非法时退回位图尺寸，首帧照常可画', () => {
    const fallback = { width: 1600, height: 1200 };
    expect(resolveBackingSize({ bitmapWidth: 1600, bitmapHeight: 1200 })).toEqual(fallback);
    expect(
      resolveBackingSize({
        bitmapWidth: 1600,
        bitmapHeight: 1200,
        displaySize: { width: 0, height: 0 },
      }),
    ).toEqual(fallback);
    expect(
      resolveBackingSize({
        bitmapWidth: 1600,
        bitmapHeight: 1200,
        displaySize: { width: Number.NaN, height: 300 },
      }),
    ).toEqual(fallback);
  });

  /**
   * 宽高必须**各自**按显示尺寸换算。
   *
   * canvas 的 CSS 尺寸就是 `displaySize`，如果按「先算宽、再按位图宽高比推高」来定
   * backing store，只要显示盒的比例与位图比例不完全一致（letterbox 之外的任何情形），
   * 浏览器就会把 backing store 拉伸到 CSS 盒子 —— 画面直接被拉变形。
   */
  it('宽高各自按显示尺寸换算，不按位图比例推', () => {
    const size = resolveBackingSize({
      bitmapWidth: 1000,
      bitmapHeight: 500,
      displaySize: { width: 333, height: 200 },
      devicePixelRatio: 1,
    });
    // 不是 333×167（按位图 2:1 推出来的），而是各自取整后的 333×200。
    expect(size).toEqual({ width: 333, height: 200 });
  });

  it('显示盒与位图比例一致时退化结果相同', () => {
    const size = resolveBackingSize({
      bitmapWidth: 1000,
      bitmapHeight: 500,
      displaySize: { width: 400, height: 200 },
      devicePixelRatio: 1,
    });
    expect(size).toEqual({ width: 400, height: 200 });
  });
});

describe('computeFrameStats', () => {
  it('按窗口帧数与耗时换算帧率，并带上最近一帧的体量与耗时', () => {
    expect(
      computeFrameStats({
        frames: 20,
        elapsedMs: 1000,
        lastFrameChars: 48_000,
        lastProcessingMs: 7.6,
      }),
    ).toEqual({
      fps: 20,
      frameChars: 48_000,
      processingMs: 8,
      queueMs: 0,
      decodeMs: 0,
      paintMs: 0,
    });
  });

  it('窗口耗时为 0 时帧率为 0（避免除零）', () => {
    expect(
      computeFrameStats({ frames: 3, elapsedMs: 0, lastFrameChars: 10, lastProcessingMs: 0 }).fps,
    ).toBe(0);
  });
});
