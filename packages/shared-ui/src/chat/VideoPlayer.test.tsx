// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoPlayer } from './VideoPlayer.js';

/** hls.js 动态 import 的替身：记录是否被真正加载与初始化。 */
const hlsState = {
  imported: false,
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
};

vi.mock('hls.js', () => {
  hlsState.imported = true;
  class HlsMock {
    static isSupported = () => true;
    static Events = { ERROR: 'hlsError' };
    static ErrorTypes = {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
    };
    loadSource = hlsState.loadSource;
    attachMedia = hlsState.attachMedia;
    destroy = hlsState.destroy;
    on = hlsState.on;
    constructor() {
      /* noop */
    }
  }
  return { default: HlsMock };
});

beforeEach(() => {
  hlsState.imported = false;
  hlsState.loadSource.mockClear();
  hlsState.attachMedia.mockClear();
  hlsState.destroy.mockClear();
  hlsState.on.mockClear();

  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
    /* jsdom 未实现，stub 掉 */
  });
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {
    /* jsdom 未实现，stub 掉 */
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function getVideo(container: HTMLElement): HTMLVideoElement {
  const video = container.querySelector('video');
  expect(video).not.toBeNull();
  return video as HTMLVideoElement;
}

describe('VideoPlayer', () => {
  it('非 HLS 源：video.src 被设为该地址，且不 import hls.js', async () => {
    const { container } = render(<VideoPlayer src="/videos/a.mp4" />);
    const video = getVideo(container);

    expect(video.getAttribute('src')).toBe('/videos/a.mp4');
    expect(screen.queryByText('加载视频中…')).toBeNull();
    // 给动态 import 一个机会，确认非 HLS 分支不会触发它。
    await Promise.resolve();
    expect(hlsState.loadSource).not.toHaveBeenCalled();
    expect(hlsState.attachMedia).not.toHaveBeenCalled();
  });

  it('HLS 源（.m3u8）：走 hls.js 分支', async () => {
    // 让 Safari 原生 HLS 判定为否，强制走 hls.js。
    vi.spyOn(window.HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');

    render(<VideoPlayer src="/videos/stream.m3u8" />);

    await waitFor(() => {
      expect(hlsState.loadSource).toHaveBeenCalledWith('/videos/stream.m3u8');
    });
    expect(hlsState.attachMedia).toHaveBeenCalledTimes(1);
  });

  it('HLS 源时不渲染下载按钮', async () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');

    render(<VideoPlayer src="/videos/stream.m3u8" fileName="stream.m3u8" />);

    await waitFor(() => {
      expect(screen.getByText('HLS')).not.toBeNull();
    });
    expect(screen.queryByTitle('下载')).toBeNull();
  });

  it('非 HLS 源渲染下载按钮，点击创建并点击 a[download]', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      /* 阻断真实跳转 */
    });

    render(<VideoPlayer src="/videos/a.mp4" fileName="a.mp4" />);
    fireEvent.click(screen.getByTitle('下载'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.tagName).toBe('A');
    expect(anchor.download).toBe('a.mp4');
    expect(anchor.href).toContain('/videos/a.mp4');
  });

  it('全屏按钮：stub requestFullscreen 并断言被调用', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<VideoPlayer src="/videos/a.mp4" />);
    const root = container.firstElementChild as HTMLElement;
    // jsdom 的 Element 上没有 requestFullscreen，直接挂到根容器上。
    (root as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen =
      requestFullscreen;

    fireEvent.click(screen.getByTitle('全屏'));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('duration 传入时渲染格式化时长文本', () => {
    render(<VideoPlayer src="/videos/a.mp4" duration={134} />);
    // 134s → 2:14
    expect(screen.getByText('2:14')).not.toBeNull();
  });

  it('渲染文件名与右上角格式标签', () => {
    render(<VideoPlayer src="/videos/a.mp4" fileName="demo.mp4" mimeType="video/mp4" />);

    expect(screen.getByText('demo.mp4')).not.toBeNull();
    expect(screen.getByText('MP4')).not.toBeNull();
  });

  it('播放按钮点击后切换图标', () => {
    const { container } = render(<VideoPlayer src="/videos/a.mp4" />);
    const button = screen.getByText('\u25B6').closest('button')!;

    fireEvent.click(button);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    fireEvent.play(getVideo(container));
    expect(screen.getByText('\u23F8')).not.toBeNull();
  });

  it('悬浮控件栏存在且包含播放 / 全屏 / 下载按钮', () => {
    render(<VideoPlayer src="/videos/a.mp4" />);

    expect(screen.getByText('\u25B6')).not.toBeNull();
    expect(screen.getByTitle('全屏')).not.toBeNull();
    expect(screen.getByTitle('下载')).not.toBeNull();
    // 进度条同时存在（常显，不依赖悬浮）
    expect(screen.getByRole('slider', { name: '播放进度' })).not.toBeNull();
  });

  describe('进度条', () => {
    /** jsdom 不实现布局，getBoundingClientRect 恒为 0；这里给进度条灌入固定尺寸。 */
    function stubProgressRect(slider: HTMLElement): void {
      const rect = { left: 0, top: 0, width: 100, height: 18, right: 100, bottom: 18 };
      slider.getBoundingClientRect = () => ({ ...rect, x: 0, y: 0, toJSON: () => rect }) as DOMRect;
    }

    it('存在且带 role="slider" 与 aria 属性', () => {
      const { container } = render(<VideoPlayer src="/videos/a.mp4" duration={100} />);
      const slider = screen.getByRole('slider', { name: '播放进度' });

      expect(slider.getAttribute('aria-valuemin')).toBe('0');
      expect(slider.getAttribute('aria-valuemax')).toBe('100');
      expect(slider.getAttribute('aria-valuenow')).toBe('0');

      // 进度条与悬浮控件栏是并列的兄弟节点（常显，不在控件栏内部）
      const bar = container.querySelector('.video-player__progress');
      expect(bar).not.toBeNull();
      expect(bar?.contains(screen.getByTitle('全屏'))).toBe(false);
    });

    it('timeupdate 后 aria-valuenow 反映当前时间', () => {
      const { container } = render(<VideoPlayer src="/videos/a.mp4" duration={100} />);
      const video = getVideo(container);

      video.currentTime = 42;
      fireEvent.timeUpdate(video);

      expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('42');
      const fill = container.querySelector('.video-player__progress-fill') as HTMLElement;
      expect(fill.style.width).toBe('42%');
    });

    it('点击（pointerdown）进度条按比例 seek', () => {
      const { container } = render(<VideoPlayer src="/videos/a.mp4" duration={200} />);
      const video = getVideo(container);
      const slider = screen.getByRole('slider');
      stubProgressRect(slider);

      fireEvent.pointerDown(slider, { clientX: 25, pointerId: 1 });

      expect(video.currentTime).toBeCloseTo(50, 5);
      expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('50');
    });

    it('按住拖拽连续 seek：down 25% → move 75% → up 后 move 不再变化', () => {
      const { container } = render(<VideoPlayer src="/videos/a.mp4" duration={200} />);
      const video = getVideo(container);
      const slider = screen.getByRole('slider');
      stubProgressRect(slider);

      const setPointerCapture = vi.fn();
      const releasePointerCapture = vi.fn();
      const hasPointerCapture = vi.fn().mockReturnValue(true);
      Object.assign(slider, { setPointerCapture, releasePointerCapture, hasPointerCapture });

      fireEvent.pointerDown(slider, { clientX: 25, pointerId: 7 });
      expect(video.currentTime).toBeCloseTo(50, 5);
      expect(setPointerCapture).toHaveBeenCalledWith(7);

      fireEvent.pointerMove(slider, { clientX: 75, pointerId: 7 });
      expect(video.currentTime).toBeCloseTo(150, 5);

      fireEvent.pointerUp(slider, { clientX: 75, pointerId: 7 });
      expect(releasePointerCapture).toHaveBeenCalledWith(7);
      expect(hasPointerCapture).toHaveBeenCalledWith(7);

      // 抬起后继续 move 不应再 seek
      fireEvent.pointerMove(slider, { clientX: 10, pointerId: 7 });
      expect(video.currentTime).toBeCloseTo(150, 5);
    });

    it('未按下时 pointermove 不 seek', () => {
      const { container } = render(<VideoPlayer src="/videos/a.mp4" duration={200} />);
      const video = getVideo(container);
      const slider = screen.getByRole('slider');
      stubProgressRect(slider);

      fireEvent.pointerMove(slider, { clientX: 90, pointerId: 3 });
      expect(video.currentTime).toBe(0);
    });

    it('键盘 ArrowRight / ArrowLeft 按 5% 步进', () => {
      const { container } = render(<VideoPlayer src="/videos/a.mp4" duration={100} />);
      const video = getVideo(container);
      const slider = screen.getByRole('slider');

      video.currentTime = 50;
      fireEvent.timeUpdate(video);

      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      expect(video.currentTime).toBeCloseTo(55, 5);

      video.currentTime = 50;
      fireEvent.timeUpdate(video);
      fireEvent.keyDown(slider, { key: 'ArrowLeft' });
      expect(video.currentTime).toBeCloseTo(45, 5);
    });

    it('键盘 Home 归零、End 到总时长', () => {
      const { container } = render(<VideoPlayer src="/videos/a.mp4" duration={100} />);
      const video = getVideo(container);
      const slider = screen.getByRole('slider');

      fireEvent.keyDown(slider, { key: 'End' });
      expect(video.currentTime).toBe(100);

      fireEvent.keyDown(slider, { key: 'Home' });
      expect(video.currentTime).toBe(0);
    });

    it('duration 缺失时进度条不崩溃且 seek 为 no-op', () => {
      const { container } = render(<VideoPlayer src="/videos/a.mp4" />);
      const video = getVideo(container);
      const slider = screen.getByRole('slider');
      stubProgressRect(slider);

      // total 取不到 → 0
      expect(slider.getAttribute('aria-valuemax')).toBe('0');

      fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 });
      expect(video.currentTime).toBe(0);

      fireEvent.keyDown(slider, { key: 'End' });
      expect(video.currentTime).toBe(0);
    });

    it('duration 为 0 时进度条不崩溃且 seek 为 no-op', () => {
      const { container } = render(<VideoPlayer src="/videos/a.mp4" duration={0} />);
      const video = getVideo(container);
      const slider = screen.getByRole('slider');
      stubProgressRect(slider);

      expect(slider.getAttribute('aria-valuemax')).toBe('0');

      fireEvent.pointerDown(slider, { clientX: 80, pointerId: 1 });
      expect(video.currentTime).toBe(0);

      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      expect(video.currentTime).toBe(0);
    });
  });
});
