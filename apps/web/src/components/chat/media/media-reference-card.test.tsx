// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaReferenceCard } from './media-reference-card.js';

/**
 * `useSessionArtifactBlob` 被替换为可控 stub：本文件的目的是验证「按扩展名分流 + 降级
 * 链」的接线，不是验证取流本身（那条路径由 `use-session-artifact-blob.test.tsx` 负责，
 * 含端点契约）。`vi.hoisted` 是必须的 —— `vi.mock` 的工厂会被提升到 import 之前执行。
 */
const { useSessionArtifactBlobMock } = vi.hoisted(() => ({
  useSessionArtifactBlobMock: vi.fn(),
}));
vi.mock('./use-session-artifact-blob.js', () => ({
  useSessionArtifactBlob: useSessionArtifactBlobMock,
}));

interface ArtifactStub {
  objectUrl?: string | null;
  loading?: boolean;
  error?: string | null;
}

function stubArtifact(overrides: ArtifactStub): void {
  useSessionArtifactBlobMock.mockReturnValue({
    objectUrl: null,
    loading: false,
    error: null,
    retry: () => undefined,
    ...overrides,
  });
}

afterEach(() => {
  cleanup();
  useSessionArtifactBlobMock.mockReset();
});

describe('MediaReferenceCard', () => {
  it('音频扩展名取流成功后渲染真实音频播放器，并把会话 id 传进取流 hook', () => {
    stubArtifact({ objectUrl: 'blob:audio-url' });

    render(<MediaReferenceCard fileName="meeting.mp3" artifactId="art-audio" sessionId="ses-1" />);

    expect(useSessionArtifactBlobMock).toHaveBeenCalledWith('ses-1', 'art-audio');
    expect(document.querySelector('.media-reference-card')?.getAttribute('data-kind')).toBe(
      'audio',
    );
    expect(document.querySelector('audio')).not.toBeNull();
    expect(document.querySelector('.media-file-card')).toBeNull();

    // 这条断言同时是「apps/web 的 shared-ui mock 桶已转发真实 AudioPlayer」的证明：
    // 若拿到的是未转发的替身（undefined），既不会有原生 <audio>，也不会有进度条节点。
    const slider = document.querySelector('.audio-player__progress');
    expect(slider).not.toBeNull();
    expect(slider?.getAttribute('role')).toBe('slider');
  });

  it('视频扩展名取流成功后渲染真实视频播放器', () => {
    stubArtifact({ objectUrl: 'blob:video-url' });

    render(<MediaReferenceCard fileName="demo.mp4" artifactId="art-video" sessionId="ses-1" />);

    expect(useSessionArtifactBlobMock).toHaveBeenCalledWith('ses-1', 'art-video');
    expect(document.querySelector('.media-reference-card')?.getAttribute('data-kind')).toBe(
      'video',
    );
    expect(document.querySelector('video')).not.toBeNull();
    expect(document.querySelector('.media-reference-card--pending')).toBeNull();
  });

  it('取流中显示统一占位（与结构化媒体路径同源），不渲染播放器也不渲染文件卡片', () => {
    stubArtifact({ loading: true });

    render(<MediaReferenceCard fileName="demo.mp4" artifactId="art-video" sessionId="ses-1" />);

    expect(document.querySelector('.media-card-status[data-kind="pending"]')).not.toBeNull();
    expect(screen.getByText('加载中…')).toBeTruthy();
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('.media-file-card')).toBeNull();
  });

  it('取流失败给出错误 + 重试，而不是静默降级为文件卡片', () => {
    const retry = vi.fn();
    useSessionArtifactBlobMock.mockReturnValue({
      objectUrl: null,
      loading: false,
      error: '取流失败',
      retry,
    });

    render(<MediaReferenceCard fileName="demo.mp4" artifactId="art-video" sessionId="ses-1" />);

    const status = document.querySelector('.media-card-status[data-kind="error"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain('加载失败：取流失败');
    expect(document.querySelector('video')).toBeNull();
    // 下载走的是同一个端点，大概率同样失败 —— 不给一个必然失败的下载按钮。
    expect(document.querySelector('.media-file-card')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('非音视频扩展名不发起取流，直接文件卡片', () => {
    stubArtifact({ objectUrl: 'should-not-be-used' });

    render(<MediaReferenceCard fileName="report.pdf" artifactId="art-pdf" sessionId="ses-1" />);

    // 第二个参数为 undefined ⇒ hook 直接返回、不发请求。
    expect(useSessionArtifactBlobMock).toHaveBeenCalledWith('ses-1', undefined);
    expect(document.querySelector('.media-file-card')).not.toBeNull();
    expect(document.querySelector('.media-reference-card')).toBeNull();
  });

  it('无法判定类型（无扩展名）同样不发起取流', () => {
    stubArtifact({ objectUrl: 'should-not-be-used' });

    render(<MediaReferenceCard fileName="LICENSE" artifactId="art-unknown" sessionId="ses-1" />);

    expect(useSessionArtifactBlobMock).toHaveBeenCalledWith('ses-1', undefined);
    expect(document.querySelector('.media-file-card')).not.toBeNull();
  });

  it('缺 sessionId 时音频引用降级为文件卡片（不发注定 404 的请求）', () => {
    // 真实 hook 在 sessionId 缺失时直接早退、objectUrl 恒为 null；stub 必须如实模拟这一
    // 行为，否则测到的不是真实降级路径（这正是本用例第一版的错误）。
    stubArtifact({ objectUrl: null });

    render(<MediaReferenceCard fileName="meeting.mp3" artifactId="art-audio" />);

    expect(useSessionArtifactBlobMock).toHaveBeenCalledWith(undefined, 'art-audio');
    expect(document.querySelector('audio')).toBeNull();
    expect(document.querySelector('.media-file-card')).not.toBeNull();
  });
});
