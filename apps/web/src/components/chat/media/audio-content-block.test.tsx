// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AudioContentBlock } from './audio-content-block.js';

/**
 * 与 `video-content-block.test.tsx` 同目的：锁住「结构化音频路径也用统一卡片状态」。
 * 修复前这里是一行裸文本「加载音频中…」，与文本引用路径的卡片壳观感不一致。
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

describe('AudioContentBlock 的媒体卡状态', () => {
  it('取流中走统一占位卡，不再是裸文本「加载音频中…」', () => {
    stubArtifact({ loading: true });

    render(<AudioContentBlock artifactId="art-1" fileName="meeting.mp3" />);

    const status = document.querySelector('.media-card-status[data-kind="pending"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain('meeting.mp3');
    expect(screen.queryByText('加载音频中…')).toBeNull();
  });

  it('取流失败走统一错误卡，并能触发重试', () => {
    const retry = vi.fn();
    stubArtifact({ error: '网络异常', retry });

    render(<AudioContentBlock artifactId="art-1" fileName="meeting.mp3" />);

    expect(document.querySelector('.media-card-status[data-kind="error"]')?.textContent).toContain(
      '加载失败：网络异常',
    );

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('取流成功渲染真实音频播放器（含可访问进度条）', () => {
    stubArtifact({ mediaSrc: 'blob:audio-source' });

    render(<AudioContentBlock artifactId="art-1" fileName="meeting.mp3" />);

    expect(document.querySelector('audio')).not.toBeNull();
    expect(document.querySelector('.audio-player__progress')?.getAttribute('role')).toBe('slider');
    expect(document.querySelector('.media-card-status')).toBeNull();
  });

  it('既无内联 url 也无取流结果时不渲染空壳', () => {
    stubArtifact({ mediaSrc: null });

    render(<AudioContentBlock artifactId="art-1" />);

    expect(document.querySelector('audio')).toBeNull();
  });
});
