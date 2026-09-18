import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ScreencastConvergence,
  readJpegDimensions,
  type ScreencastFrameDimensions,
} from './screencast-convergence.js';

const TARGET = { width: 1280, height: 800 };

function convergedFrame(): ScreencastFrameDimensions {
  return { metadataWidth: 1280, metadataHeight: 800, bitmapWidth: 1280, bitmapHeight: 800 };
}

/** 元数据已是目标尺寸，但位图仍缩放在旧视口（真实故障形态：1280×800 → 768×480）。 */
function bitmapLaggingFrame(): ScreencastFrameDimensions {
  return { metadataWidth: 1280, metadataHeight: 800, bitmapWidth: 768, bitmapHeight: 480 };
}

/** 元数据与位图都是旧视口（重开前的陈旧帧）。 */
function staleFrame(): ScreencastFrameDimensions {
  return { metadataWidth: 768, metadataHeight: 1024, bitmapWidth: 768, bitmapHeight: 1024 };
}

function createHarness(options: { active?: boolean; rearm?: () => Promise<void> } = {}) {
  const rearm = vi.fn(options.rearm ?? (() => Promise.resolve()));
  let active = options.active ?? true;
  const convergence = new ScreencastConvergence({
    target: TARGET,
    rearm,
    isActive: () => active,
  });
  return {
    convergence,
    rearm,
    deactivate: () => {
      active = false;
    },
  };
}

describe('ScreencastConvergence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start 立即重开一次 screencast', () => {
    const { convergence, rearm } = createHarness();
    convergence.start();
    expect(rearm).toHaveBeenCalledTimes(1);
    convergence.dispose();
  });

  it('位图落后于元数据时继续重开，直到帧完全命中目标', async () => {
    const { convergence, rearm } = createHarness();
    convergence.start();
    expect(rearm).toHaveBeenCalledTimes(1);

    convergence.noteFrame(bitmapLaggingFrame());
    await vi.advanceTimersByTimeAsync(150);
    expect(rearm).toHaveBeenCalledTimes(2);

    convergence.noteFrame(bitmapLaggingFrame());
    await vi.advanceTimersByTimeAsync(150);
    expect(rearm).toHaveBeenCalledTimes(3);

    convergence.noteFrame(convergedFrame());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rearm).toHaveBeenCalledTimes(3);
  });

  it('元数据仍在旧视口时同样继续重开', async () => {
    const { convergence, rearm } = createHarness();
    convergence.start();

    convergence.noteFrame(staleFrame());
    await vi.advanceTimersByTimeAsync(150);
    expect(rearm).toHaveBeenCalledTimes(2);

    convergence.noteFrame(convergedFrame());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rearm).toHaveBeenCalledTimes(2);
  });

  it('位图解析失败（null）按未收敛处理', async () => {
    const { convergence, rearm } = createHarness();
    convergence.start();

    convergence.noteFrame({
      metadataWidth: 1280,
      metadataHeight: 800,
      bitmapWidth: null,
      bitmapHeight: null,
    });
    await vi.advanceTimersByTimeAsync(150);
    expect(rearm).toHaveBeenCalledTimes(2);
    convergence.dispose();
  });

  it('始终不收敛时按次数上限停止，不再重开', async () => {
    const { convergence, rearm } = createHarness();
    convergence.start();

    for (let i = 0; i < 16; i += 1) {
      convergence.noteFrame(bitmapLaggingFrame());
      await vi.advanceTimersByTimeAsync(150);
    }

    expect(rearm).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rearm).toHaveBeenCalledTimes(8);
  });

  it('重开失败不抛出，并在 retryDelay 后重试', async () => {
    let failures = 1;
    const { convergence, rearm } = createHarness({
      rearm: () => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error('rearm failed'));
        }
        return Promise.resolve();
      },
    });
    convergence.start();
    expect(rearm).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(150);
    expect(rearm).toHaveBeenCalledTimes(2);

    convergence.noteFrame(convergedFrame());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rearm).toHaveBeenCalledTimes(2);
  });

  it('会话失活后停止重开', async () => {
    const { convergence, rearm, deactivate } = createHarness();
    convergence.start();
    expect(rearm).toHaveBeenCalledTimes(1);

    deactivate();
    convergence.noteFrame(staleFrame());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rearm).toHaveBeenCalledTimes(1);
  });

  it('dispose 之后不再重开也不再响应帧', async () => {
    const { convergence, rearm } = createHarness();
    convergence.start();
    convergence.dispose();
    convergence.noteFrame(bitmapLaggingFrame());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rearm).toHaveBeenCalledTimes(1);
  });
});

describe('readJpegDimensions', () => {
  function buildJpeg(width: number, height: number): string {
    const app0 = Buffer.from([
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00,
      0x01, 0x00, 0x00,
    ]);
    const sof0 = Buffer.alloc(11);
    sof0[0] = 0xff;
    sof0[1] = 0xc0;
    sof0.writeUInt16BE(9, 2);
    sof0[4] = 8;
    sof0.writeUInt16BE(height, 5);
    sof0.writeUInt16BE(width, 7);
    const eoi = Buffer.from([0xff, 0xd9]);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0, eoi]).toString('base64');
  }

  it('从 SOF0 读出宽高', () => {
    expect(readJpegDimensions(buildJpeg(768, 480))).toEqual({ width: 768, height: 480 });
  });

  it('读取 progressive SOF2', () => {
    const bytes = Buffer.from(buildJpeg(1280, 800), 'base64');
    const sof0Index = bytes.indexOf(Buffer.from([0xff, 0xc0]));
    bytes[sof0Index + 1] = 0xc2;
    expect(readJpegDimensions(bytes.toString('base64'))).toEqual({ width: 1280, height: 800 });
  });

  it('非 JPEG 或截断数据返回 null', () => {
    expect(readJpegDimensions('')).toBeNull();
    expect(readJpegDimensions(Buffer.from('not-a-jpeg').toString('base64'))).toBeNull();
    expect(
      readJpegDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00]).toString('base64')),
    ).toBeNull();
  });
});
