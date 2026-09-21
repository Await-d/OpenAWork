// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface MediaArtifactMockState {
  loading: boolean;
  /** `undefined` 表示按 artifactId 自动生成 src；null 表示尚未解析出 src。 */
  overrideSrc: string | null | undefined;
}

const mediaArtifactState = vi.hoisted<MediaArtifactMockState>(() => ({
  loading: false,
  overrideSrc: undefined,
}));

vi.mock('@openAwork/shared-ui', () => ({
  resolveToolVisualStatus: ({ isError }: { isError?: boolean }) =>
    isError ? 'failed' : 'completed',
  ToolGlyph: () => null,
}));

vi.mock('../../media/use-media-artifact.js', () => ({
  useMediaArtifact: (artifactId: string | undefined) => {
    const { loading, overrideSrc } = mediaArtifactState;
    const mediaSrc =
      overrideSrc !== undefined
        ? overrideSrc
        : artifactId
          ? `data:image/png;base64,${artifactId}`
          : null;
    return {
      mediaSrc,
      loading,
      error: null,
      fileName: 'media',
      mimeType: undefined,
      duration: undefined,
      width: undefined,
      height: undefined,
      thumbnailUrl: undefined,
      retry: () => undefined,
    };
  },
}));

import { ExtractVideoFrameToolCard } from './extract-video-frame-tool-card.js';

function frameOutput(count: number): string {
  return JSON.stringify({
    success: true,
    count,
    frames: Array.from({ length: count }, (_, index) => ({
      artifactId: `frame-${index + 1}`,
      fileName: `frame-${index + 1}.png`,
      timestamp: index * 2,
    })),
  });
}

function openLightboxFromThumbnail(frameNumber: number): void {
  const thumbnail = screen.getByAltText(`帧 ${frameNumber}`);
  fireEvent.click(thumbnail);
}

function getFrameThumbnail(index: number): HTMLElement {
  const thumbnail = document.querySelector<HTMLElement>(`[data-frame-index="${index}"]`);
  if (!thumbnail) throw new Error(`缩略图未渲染：${index}`);
  return thumbnail;
}

function getLightboxImage(): HTMLImageElement {
  const image = document.querySelector<HTMLImageElement>('.image-lightbox__image');
  if (!image) throw new Error('查看器图片未渲染');
  return image;
}

function getLightboxButton(name: string): HTMLButtonElement {
  const button = screen.getByRole('button', { name });
  if (!(button instanceof HTMLButtonElement)) throw new Error(`查看器按钮未渲染：${name}`);
  return button;
}

afterEach(() => {
  cleanup();
  mediaArtifactState.loading = false;
  mediaArtifactState.overrideSrc = undefined;
});

describe('ExtractVideoFrameToolCard 帧图集查看器', () => {
  it('多帧时点击缩略图打开图集，并可用按钮 / 方向键切换', () => {
    render(<ExtractVideoFrameToolCard input={{}} output={frameOutput(3)} />);

    openLightboxFromThumbnail(1);
    expect(getLightboxImage().getAttribute('src')).toBe('data:image/png;base64,frame-1');
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(getLightboxButton('上一张').disabled).toBe(true);

    fireEvent.click(getLightboxButton('下一张'));
    expect(getLightboxImage().getAttribute('src')).toBe('data:image/png;base64,frame-2');
    expect(screen.getByText('2 / 3')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(getLightboxImage().getAttribute('src')).toBe('data:image/png;base64,frame-3');
    expect(getLightboxButton('下一张').disabled).toBe(true);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(getLightboxImage().getAttribute('src')).toBe('data:image/png;base64,frame-2');
  });

  it('从中间帧打开时图集索引与帧下标一致', () => {
    render(<ExtractVideoFrameToolCard input={{}} output={frameOutput(3)} />);

    openLightboxFromThumbnail(2);
    expect(getLightboxImage().getAttribute('src')).toBe('data:image/png;base64,frame-2');
    expect(screen.getByText('2 / 3')).toBeTruthy();

    fireEvent.click(getLightboxButton('下一张'));
    expect(getLightboxImage().getAttribute('src')).toBe('data:image/png;base64,frame-3');
  });

  it('单帧时不渲染切换按钮，行为与旧版一致', () => {
    render(<ExtractVideoFrameToolCard input={{}} output={frameOutput(1)} />);

    openLightboxFromThumbnail(1);
    expect(getLightboxImage().getAttribute('src')).toBe('data:image/png;base64,frame-1');
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
    expect(document.querySelector('.image-lightbox__counter')).toBeNull();
  });

  it('关闭查看器后回到缩略图，不再渲染图集', () => {
    render(<ExtractVideoFrameToolCard input={{}} output={frameOutput(2)} />);

    openLightboxFromThumbnail(1);
    fireEvent.click(getLightboxButton('关闭预览'));
    expect(document.querySelector('.image-lightbox')).toBeNull();
  });

  it('帧未就绪时点击缩略图不打开查看器，并给出加载反馈', () => {
    mediaArtifactState.loading = true;
    mediaArtifactState.overrideSrc = null;

    render(<ExtractVideoFrameToolCard input={{}} output={frameOutput(2)} />);

    const thumbnail = getFrameThumbnail(0);
    expect(thumbnail.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('加载…')).toHaveLength(2);

    fireEvent.click(thumbnail);
    expect(document.querySelector('.image-lightbox')).toBeNull();
  });

  it('帧就绪后缩略图可点击打开查看器', () => {
    render(<ExtractVideoFrameToolCard input={{}} output={frameOutput(1)} />);

    expect(getFrameThumbnail(0).getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(getFrameThumbnail(0));
    expect(getLightboxImage().getAttribute('src')).toBe('data:image/png;base64,frame-1');
  });

  it('output 变化后不残留旧帧 src，查看器不会指向上一轮同下标的帧', () => {
    const { rerender } = render(<ExtractVideoFrameToolCard input={{}} output={frameOutput(2)} />);

    openLightboxFromThumbnail(2);
    expect(getLightboxImage().getAttribute('src')).toBe('data:image/png;base64,frame-2');

    mediaArtifactState.loading = true;
    mediaArtifactState.overrideSrc = null;
    rerender(
      <ExtractVideoFrameToolCard
        input={{}}
        output={JSON.stringify({
          success: true,
          count: 2,
          frames: [
            { artifactId: 'frame-alpha', fileName: 'alpha.png', timestamp: 0 },
            { artifactId: 'frame-beta', fileName: 'beta.png', timestamp: 2 },
          ],
        })}
      />,
    );

    expect(document.querySelector('.image-lightbox')).toBeNull();
  });
});
