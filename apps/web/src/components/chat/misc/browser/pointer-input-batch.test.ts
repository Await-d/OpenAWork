import { describe, expect, it } from 'vitest';
import type { BrowserLiveClientMessage } from '@openAwork/shared';

import { createPointerInputBatch, type PointerFrameScheduler } from './pointer-input-batch.js';

/** 手动驱动的调度器：由测试显式决定「这一帧什么时候结束」。 */
function createManualScheduler(): {
  scheduler: PointerFrameScheduler;
  pendingCount: () => number;
  flush: () => void;
} {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  return {
    scheduler: {
      request: (callback) => {
        const handle = nextHandle;
        nextHandle += 1;
        callbacks.set(handle, callback);
        return handle;
      },
      cancel: (handle) => {
        callbacks.delete(handle);
      },
    },
    pendingCount: () => callbacks.size,
    flush: () => {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) callback();
    },
  };
}

function setup(): {
  sent: BrowserLiveClientMessage[];
  batch: ReturnType<typeof createPointerInputBatch>;
  pendingCount: () => number;
  flush: () => void;
} {
  const driver = createManualScheduler();
  const sent: BrowserLiveClientMessage[] = [];
  const batch = createPointerInputBatch((message) => {
    sent.push(message);
  }, driver.scheduler);
  return { sent, batch, pendingCount: driver.pendingCount, flush: driver.flush };
}

describe('createPointerInputBatch', () => {
  it('同一帧内多次移动只下发最后一次坐标', () => {
    const { batch, sent, flush } = setup();

    batch.move({ x: 1, y: 1 });
    batch.move({ x: 20, y: 30 });
    batch.move({ x: 40, y: 50 });
    flush();

    expect(sent).toEqual([{ ch: 'input', kind: 'mouse', type: 'mouseMoved', x: 40, y: 50 }]);
  });

  it('坐标与上一次下发相同则不再发', () => {
    const { batch, sent, flush } = setup();

    batch.move({ x: 10, y: 10 });
    flush();
    batch.move({ x: 10, y: 10 });
    flush();

    expect(sent).toHaveLength(1);

    batch.move({ x: 11, y: 10 });
    flush();
    expect(sent).toHaveLength(2);
  });

  it('同一帧内的滚轮增量累加为一条，零增量不下发', () => {
    const { batch, sent, flush } = setup();

    batch.wheel({ x: 5, y: 6 }, { x: 0, y: 40 });
    batch.wheel({ x: 5, y: 6 }, { x: 4, y: 60 });
    flush();

    expect(sent).toEqual([{ ch: 'input', kind: 'wheel', x: 5, y: 6, deltaX: 4, deltaY: 100 }]);

    batch.wheel({ x: 5, y: 6 }, { x: 0, y: 0 });
    flush();
    expect(sent).toHaveLength(1);
  });

  it('同一帧内移动与滚轮各下发一条，移动在前', () => {
    const { batch, sent, flush } = setup();

    batch.wheel({ x: 7, y: 8 }, { x: 0, y: 10 });
    batch.move({ x: 7, y: 8 });
    flush();

    expect(sent.map((message) => (message.ch === 'input' ? message.kind : message.ch))).toEqual([
      'mouse',
      'wheel',
    ]);
  });

  /**
   * 亚像素抖动不值得上行：每发一次 `mouseMoved`，远端页面都会重新命中测试并产出一帧
   * 全量 JPEG，而位移在 1px 以内时用户根本看不出画面变化。
   */
  it('位移不足阈值时不重复上行', () => {
    const { batch, sent, flush } = setup();

    batch.move({ x: 100, y: 100 });
    flush();
    expect(sent).toHaveLength(1);

    // 同一像素内的小幅抖动：丢弃。
    batch.move({ x: 100.2, y: 100.1 });
    flush();
    batch.move({ x: 100.5, y: 100.4 });
    flush();
    expect(sent).toHaveLength(1);

    // 跨过 1px：必须上行。
    batch.move({ x: 102, y: 100 });
    flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ ch: 'input', kind: 'mouse', type: 'mouseMoved', x: 102, y: 100 });
  });

  it('首帧移动不需要历史坐标也会上行', () => {
    const { batch, sent, flush } = setup();

    batch.move({ x: 0, y: 0 });
    flush();

    expect(sent).toEqual([{ ch: 'input', kind: 'mouse', type: 'mouseMoved', x: 0, y: 0 }]);
  });

  it('滚轮不参与阈值判定：每一分增量都必须送达', () => {
    const { batch, sent, flush } = setup();

    batch.wheel({ x: 10, y: 10 }, { x: 0, y: 0.5 });
    flush();

    // 增量为 0.5 也是真实位移，不能因为「幅度小」丢掉（否则滚动距离会缩水）。
    expect(sent).toEqual([{ ch: 'input', kind: 'wheel', x: 10, y: 10, deltaX: 0, deltaY: 0.5 }]);
  });

  it('一个动画帧只调度一次，dispose 后丢弃挂起的输入', () => {
    const { batch, sent, pendingCount, flush } = setup();

    batch.move({ x: 1, y: 2 });
    batch.move({ x: 3, y: 4 });
    expect(pendingCount()).toBe(1);

    batch.dispose();
    expect(pendingCount()).toBe(0);
    flush();

    expect(sent).toHaveLength(0);
  });

  it('moveImmediate 不等动画帧，当帧立即上行（拖动跟手）', () => {
    const { batch, sent, pendingCount } = setup();

    batch.moveImmediate({ x: 5, y: 6 });

    // 关键：一行 flush 都没调用就已经发出去了。
    expect(sent).toEqual([{ ch: 'input', kind: 'mouse', type: 'mouseMoved', x: 5, y: 6 }]);
    expect(pendingCount()).toBe(0);
  });

  it('moveImmediate 会作废已挂起的合并任务，避免同一坐标发两次', () => {
    const { batch, sent, pendingCount, flush } = setup();

    batch.move({ x: 1, y: 1 });
    expect(pendingCount()).toBe(1);

    batch.moveImmediate({ x: 9, y: 9 });
    expect(sent).toEqual([{ ch: 'input', kind: 'mouse', type: 'mouseMoved', x: 9, y: 9 }]);

    // 挂起的 rAF 已被取消：flush 不会再补发一次。
    flush();
    expect(sent).toHaveLength(1);
  });

  it('moveImmediate 仍然过位移阈值：同一像素内的抖动不产帧', () => {
    const { batch, sent, flush } = setup();

    batch.moveImmediate({ x: 10, y: 10 });
    expect(sent).toHaveLength(1);

    // 亚像素抖动对远端毫无意义，却会白白产出一帧全量 JPEG。
    batch.moveImmediate({ x: 10, y: 10 });
    expect(sent).toHaveLength(1);

    batch.moveImmediate({ x: 12, y: 10 });
    flush();
    expect(sent).toHaveLength(2);
  });

  it('拖动期间连续移动只保留最新坐标，避免以硬件频率洪泛 CDP', () => {
    const { batch, sent, pendingCount, flush } = setup();

    batch.moveImmediate({ x: 10, y: 10 });
    batch.moveImmediate({ x: 20, y: 20 });
    batch.moveImmediate({ x: 30, y: 30 });

    expect(sent).toHaveLength(1);
    expect(pendingCount()).toBe(1);

    flush();
    expect(sent).toEqual([
      { ch: 'input', kind: 'mouse', type: 'mouseMoved', x: 10, y: 10 },
      { ch: 'input', kind: 'mouse', type: 'mouseMoved', x: 30, y: 30 },
    ]);
  });
});
