// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VideoContentBlock } from './video-content-block.js';

/**
 * 这组用例的目的不是测取流，而是**锁住「结构化媒体路径也用统一卡片状态」**这一收敛结果。
 *
 * 修复前这里返回的是内联样式的固定 480px 占位框 + 「加载视频中…」，与文本引用路径
 * （`MediaReferenceCard`）的卡片壳是两套观感。若有人改回内联样式，断言
 * `.media-card-status` 会立刻失败。
 */
const { useMediaArtifactMock } = vi.hoisted(() => ({ useMediaArtifactMock: vi.fn() }));
vi.mock('./use-media-artifact.js', () => ({ useMediaArtifact: useMediaArtifactMock }));

function stubArtifact(overrides: Record<string, unknown>): void {
  useMediaArtifactMock.mockReturnValue({
    mediaSrc: null,
    loading: false,
    error: null,
    fileName: 'media',
    mimeType: undefined,
    duration: undefined,
    width: undefined,
    height: undefined,
    thumbnailUrl: undefined,
    retry: () => undefined,
    ...overrides,
  });
}

afterEach(() => {
  cleanup();
  useMediaArtifactMock.mockReset();
});

describe('VideoContentBlock 的媒体卡状态', () => {
  it('取流中走统一占位卡，不再是内联样式的 480px 占位框', () => {
    stubArtifact({ loading: true });

    render(<VideoContentBlock artifactId="art-1" fileName="demo.mp4" />);

    const status = document.querySelector('.media-card-status[data-kind="pending"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain('demo.mp4');
    expect(status?.textContent).toContain('加载中…');
    // 旧文案必须消失，否则说明又走回了内联分支。
    expect(screen.queryByText('加载视频中…')).toBeNull();
  });

  it('取流失败走统一错误卡，并能触发重试', () => {
    const retry = vi.fn();
    stubArtifact({ error: '网络异常', retry });

    render(<VideoContentBlock artifactId="art-1" fileName="demo.mp4" />);

    const status = document.querySelector('.media-card-status[data-kind="error"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain('加载失败：网络异常');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('取流成功才渲染真实播放器，且不残留状态卡', () => {
    stubArtifact({ mediaSrc: 'blob:video-source' });

    render(<VideoContentBlock artifactId="art-1" fileName="demo.mp4" />);

    expect(document.querySelector('video')).not.toBeNull();
    expect(document.querySelector('.media-card-status')).toBeNull();
  });

  it('既无内联 url 也无取流结果时不渲染空壳', () => {
    stubArtifact({ mediaSrc: null });

    render(<VideoContentBlock artifactId="art-1" />);

    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('.media-card-status')).toBeNull();
  });
});
