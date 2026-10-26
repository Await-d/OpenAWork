// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MediaInfoPreview } from './media-info-preview.js';

afterEach(cleanup);

describe('MediaInfoPreview', () => {
  it('展示类型、时长、分辨率、编码与体积', () => {
    const { container } = render(
      <MediaInfoPreview
        data={{
          type: 'video',
          mimeType: 'video/mp4',
          duration: 754,
          width: 1920,
          height: 1080,
          fps: 30,
          videoCodec: 'h264',
          audioCodec: 'aac',
          bitrate: 2_500_000,
          sizeBytes: 12_345_678,
          summary: '视频 · 1920x1080 · 12:34',
        }}
      />,
    );

    expect(container.textContent).toContain('视频');
    expect(container.textContent).toContain('video/mp4');
    expect(container.textContent).toContain('12:34');
    expect(container.textContent).toContain('1920×1080');
    expect(container.textContent).toContain('30 fps');
    expect(container.textContent).toContain('h264');
    expect(container.textContent).toContain('2.5 Mbps');
    expect(container.textContent).toContain('11.8 MB');
    expect(container.textContent).toContain('视频 · 1920x1080 · 12:34');
  });

  it('音频只渲染存在的字段', () => {
    const { container } = render(
      <MediaInfoPreview
        data={{ type: 'audio', duration: 65, audioCodec: 'mp3', sampleRate: 44100, channels: 2 }}
      />,
    );

    expect(container.textContent).toContain('音频');
    expect(container.textContent).toContain('1:05');
    expect(container.textContent).toContain('44100 Hz');
    expect(container.textContent).not.toContain('分辨率');
  });

  it('没有可渲染字段时不崩（空网格）', () => {
    const { container } = render(<MediaInfoPreview data={{ type: 'image' }} />);

    expect(container.textContent).toContain('图片');
  });
});
