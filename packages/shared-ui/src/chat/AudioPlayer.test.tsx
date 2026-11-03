// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AudioPlayer } from './AudioPlayer.js';

/**
 * 安全网测试 —— 在「去假波形 / 加进度条」改造**之前**建立基线。
 *
 * jsdom 不实现 HTMLMediaElement 的 play / pause，会抛 "Not implemented"，
 * 因此在每个用例前 stub，避免 unhandled rejection 把测试拖垮。
 */
beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
    /* jsdom 未实现，stub 掉 */
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function getAudio(container: HTMLElement): HTMLAudioElement {
  const audio = container.querySelector('audio');
  expect(audio).not.toBeNull();
  return audio as HTMLAudioElement;
}

/** 统一进度条容器（role="slider"）。 */
function getProgress(container: HTMLElement): HTMLElement {
  const progress = container.querySelector<HTMLElement>('.audio-player__progress');
  expect(progress).not.toBeNull();
  return progress!;
}

/** 进度条填充（宽度反映百分比）。 */
function getProgressFill(container: HTMLElement): HTMLElement {
  const fill = container.querySelector<HTMLElement>('.audio-player__progress-fill');
  expect(fill).not.toBeNull();
  return fill!;
}

describe('AudioPlayer', () => {
  it('渲染播放按钮、时间显示、下载按钮与语速按钮（初值 1x）', () => {
    render(<AudioPlayer src="/audio/a.mp3" fileName="a.mp3" duration={30} />);

    expect(screen.getByText('1x')).not.toBeNull();
    expect(screen.getByText('↓ 下载')).not.toBeNull();
    expect(screen.getByText('0:00 / 0:30')).not.toBeNull();
    // 播放按钮初始为 ▶
    expect(screen.getByText('\u25B6')).not.toBeNull();
  });

  it('点击播放按钮调用 play，再点调用 pause', () => {
    const { container } = render(<AudioPlayer src="/audio/a.mp3" duration={30} />);
    const button = screen.getByText('\u25B6').closest('button')!;

    fireEvent.click(button);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    // play 事件把 playing 置为 true，图标切到 ⏸
    fireEvent.play(getAudio(container));
    fireEvent.click(screen.getByText('\u23F8').closest('button')!);
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  });

  it('按下进度条 seek：currentTime = ratio * duration', () => {
    const { container } = render(<AudioPlayer src="/audio/a.mp3" duration={100} />);
    const audio = getAudio(container);
    const progress = getProgress(container);

    vi.spyOn(progress, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 28,
      right: 200,
      bottom: 28,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(progress, { pointerId: 1, clientX: 50 });
    // ratio = 50 / 200 = 0.25 → 0.25 * 100 = 25
    expect(audio.currentTime).toBe(25);
  });

  it('语速按钮循环 1x → 1.5x → 2x → 0.75x → 1x 并同步 playbackRate', () => {
    const { container } = render(<AudioPlayer src="/audio/a.mp3" duration={30} />);
    const audio = getAudio(container);

    for (const expected of ['1.5x', '2x', '0.75x', '1x']) {
      fireEvent.click(screen.getByText(/x$/).closest('button')!);
      expect(screen.getByText(expected)).not.toBeNull();
    }

    expect(audio.playbackRate).toBe(1);
  });

  it('下载按钮创建并点击一个 a[download]', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      /* 阻断真实跳转 */
    });

    render(<AudioPlayer src="/audio/a.mp3" fileName="a.mp3" duration={30} />);
    fireEvent.click(screen.getByText('↓ 下载'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.tagName).toBe('A');
    expect(anchor.download).toBe('a.mp3');
    expect(anchor.href).toContain('/audio/a.mp3');
  });

  it('transcript 传入时渲染文案，不传时不渲染', () => {
    const { rerender } = render(
      <AudioPlayer src="/audio/a.mp3" duration={30} transcript="这是一段转写文本" />,
    );
    expect(screen.getByText('这是一段转写文本')).not.toBeNull();

    rerender(<AudioPlayer src="/audio/a.mp3" duration={30} />);
    expect(screen.queryByText('这是一段转写文本')).toBeNull();
  });

  it('渲染统一进度条（role=slider），fill 宽度随 current 变化', () => {
    const { container } = render(<AudioPlayer src="/audio/a.mp3" duration={30} />);
    const progress = getProgress(container);
    const fill = getProgressFill(container);

    expect(progress.getAttribute('role')).toBe('slider');
    expect(progress.getAttribute('aria-valuemin')).toBe('0');
    expect(progress.getAttribute('aria-valuemax')).toBe('30');
    expect(progress.getAttribute('aria-valuenow')).toBe('0');
    // 假波形已移除：不再有 32 根不等高柱子。
    expect(container.querySelectorAll('.audio-player__progress-thumb')).toHaveLength(1);
    expect(fill.style.width).toBe('0%');

    // 时间推进 → fill 宽度与 aria-valuenow 同步。
    const audio = getAudio(container);
    audio.currentTime = 15;
    fireEvent.timeUpdate(audio);
    expect(fill.style.width).toBe('50%');
    expect(progress.getAttribute('aria-valuenow')).toBe('15');
  });

  it('键盘 seek：ArrowRight 前进 5%、Home 回到 0、End 到总时长', () => {
    const { container } = render(<AudioPlayer src="/audio/a.mp3" duration={100} />);
    const audio = getAudio(container);
    const progress = getProgress(container);

    fireEvent.keyDown(progress, { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(5);

    fireEvent.keyDown(progress, { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(10);

    fireEvent.keyDown(progress, { key: 'ArrowLeft' });
    expect(audio.currentTime).toBe(5);

    fireEvent.keyDown(progress, { key: 'Home' });
    expect(audio.currentTime).toBe(0);

    fireEvent.keyDown(progress, { key: 'End' });
    expect(audio.currentTime).toBe(100);
  });

  it('指针拖拽：pointerDown 25% → pointerMove 75% → pointerUp 后不再变化', () => {
    const { container } = render(<AudioPlayer src="/audio/a.mp3" duration={100} />);
    const audio = getAudio(container);
    const progress = getProgress(container);

    // jsdom 不实现 Pointer Capture API，stub 掉并断言确实被调用（不被 stub 掩盖）。
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const hasPointerCapture = vi.fn().mockReturnValue(true);
    Object.assign(progress, { setPointerCapture, releasePointerCapture, hasPointerCapture });

    vi.spyOn(progress, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 28,
      right: 200,
      bottom: 28,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(progress, { pointerId: 1, clientX: 50 });
    // ratio = 50 / 200 = 0.25
    expect(audio.currentTime).toBe(25);
    expect(setPointerCapture).toHaveBeenCalledWith(1);

    fireEvent.pointerMove(progress, { pointerId: 1, clientX: 150 });
    // ratio = 150 / 200 = 0.75
    expect(audio.currentTime).toBe(75);

    fireEvent.pointerUp(progress, { pointerId: 1, clientX: 150 });
    expect(releasePointerCapture).toHaveBeenCalledWith(1);

    fireEvent.pointerMove(progress, { pointerId: 1, clientX: 20 });
    // 拖拽已结束，位置不再变化。
    expect(audio.currentTime).toBe(75);
  });

  it('始终显示文件名（variant 死路径已移除）', () => {
    render(<AudioPlayer src="/audio/a.mp3" fileName="a.mp3" duration={30} />);
    expect(screen.getByText('a.mp3')).not.toBeNull();
  });
});
