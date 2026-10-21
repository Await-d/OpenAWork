// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { base64ToBlob, canDecodeFrameOffThread, decodeFrame } from './frame-decode.js';

/** 一段合法 base64（内容不重要，只验证搬运与回落路径）。 */
const VALID_BASE64 = btoa('jpeg-bytes');
const MIME = 'image/jpeg';

/** 记录被构造出来的假 `<img>`：回退路径断言 src 与尺寸都靠它。 */
const createdImages: FakeImage[] = [];
/** 置位后下一次加载走 `error` 分支（模拟坏帧）。 */
let failNextImageLoad = false;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 320;
  naturalHeight = 200;
  private source = '';

  constructor() {
    createdImages.push(this);
  }

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    this.source = value;
    // 真实浏览器在解码完成后触发 load；这里用微任务替身。
    queueMicrotask(() => {
      if (failNextImageLoad) {
        this.onerror?.();
        return;
      }
      this.onload?.();
    });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  createdImages.length = 0;
  failNextImageLoad = false;
});

describe('base64ToBlob', () => {
  it('按 mimeType 还原原始字节', async () => {
    const blob = base64ToBlob(VALID_BASE64, MIME);

    expect(blob.type).toBe(MIME);
    expect(blob.size).toBe('jpeg-bytes'.length);
  });
});

describe('decodeFrame', () => {
  /**
   * 首选路径的回归：base64 → 字节由浏览器解析（data URL + fetch），主线程不再做
   * `atob` + 逐字节搬运。断言请求的就是原始 base64，且位图直接来自 blob。
   */
  it('fetch 可用时把 base64 交给浏览器解析，不手工搬运字节', async () => {
    const close = vi.fn();
    const bitmap = { width: 400, height: 300, close };
    const createImageBitmapMock = vi.fn(() => Promise.resolve(bitmap));
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        requested.push(input);
        return {
          ok: true,
          blob: async () => new Blob(['jpeg-bytes'], { type: MIME }),
        } as unknown as Response;
      }),
    );

    const decoded = await decodeFrame({ base64: VALID_BASE64, mimeType: MIME });

    expect(requested[0]).toBe(`data:${MIME};base64,${VALID_BASE64}`);
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    expect(decoded?.source).toBe(bitmap);
    expect(decoded?.width).toBe(400);
    expect(decoded?.height).toBe(300);
  });

  it('有 createImageBitmap 时走离主线程解码，带上位图尺寸与释放句柄', async () => {
    const close = vi.fn();
    const bitmap = { width: 640, height: 360, close };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(bitmap)),
    );

    const decoded = await decodeFrame({ base64: VALID_BASE64, mimeType: MIME });

    expect(canDecodeFrameOffThread()).toBe(true);
    expect(decoded?.width).toBe(640);
    expect(decoded?.height).toBe(360);
    expect(decoded?.source).toBe(bitmap);

    decoded?.release();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('位图尺寸为 0 时按解码失败处理，并释放位图', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 0, height: 0, close })),
    );

    await expect(decodeFrame({ base64: VALID_BASE64, mimeType: MIME })).resolves.toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('没有 createImageBitmap 时回落到 <img> + data URL', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('Image', FakeImage);

    const decoded = await decodeFrame({ base64: VALID_BASE64, mimeType: MIME });

    expect(canDecodeFrameOffThread()).toBe(false);
    expect(decoded?.width).toBe(320);
    expect(decoded?.height).toBe(200);
    expect(createdImages[0]?.src).toBe(`data:${MIME};base64,${VALID_BASE64}`);

    decoded?.release();
    expect(createdImages[0]?.onload).toBeNull();
  });

  it('回退路径加载失败时返回 null', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('Image', FakeImage);
    failNextImageLoad = true;

    await expect(decodeFrame({ base64: VALID_BASE64, mimeType: MIME })).resolves.toBeNull();
  });
});
