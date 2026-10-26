import { describe, expect, it } from 'vitest';

import { extractMediaInfo, formatBitrate, formatBytes, formatDuration } from './media-info-view.js';

describe('extractMediaInfo', () => {
  it('解析视频元信息（HLS / 普通文件同构）', () => {
    const view = extractMediaInfo({
      success: true,
      type: 'video',
      mimeType: 'video/mp4',
      duration: 754.2,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      bitrate: 2_500_000,
      sizeBytes: 12_345_678,
      summary: '视频 · 1920x1080 · 12:34',
    });

    expect(view).toMatchObject({
      type: 'video',
      mimeType: 'video/mp4',
      duration: 754.2,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      bitrate: 2_500_000,
    });
  });

  it('失败信封（success:false / error）返回 null，保留错误字段表', () => {
    expect(extractMediaInfo({ success: false, error: 'ffprobe not found' })).toBeNull();
    expect(extractMediaInfo({ error: '找不到 artifact' })).toBeNull();
  });

  it('非媒体对象返回 null', () => {
    expect(extractMediaInfo({ foo: 'bar' })).toBeNull();
    expect(extractMediaInfo(null)).toBeNull();
    expect(extractMediaInfo('text')).toBeNull();
  });
});

describe('格式化', () => {
  it('时长：分:秒 / 时:分:秒', () => {
    expect(formatDuration(754)).toBe('12:34');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(-1)).toBe('—');
  });

  it('体积与码率', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(12_345_678)).toBe('11.8 MB');
    expect(formatBitrate(2_500_000)).toBe('2.5 Mbps');
    expect(formatBitrate(128_000)).toBe('128 kbps');
  });
});
