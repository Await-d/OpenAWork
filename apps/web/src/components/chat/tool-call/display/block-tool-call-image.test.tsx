// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@openAwork/shared-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BashTerminalCard: () => null,
  FileTypeIcon: () => null,
  resolveToolCallCardDisplayData: () => ({
    displayToolName: 'webfetch',
    summary: 'webfetch',
    showInputField: true,
    hasDetails: true,
  }),
  resolveToolVisualStatus: () => 'completed',
  getProviderUiList: () => [],
  ToolGlyph: () => <span data-testid="tool-glyph" />,
  UnifiedCodeDiff: () => null,
}));

vi.mock('../../../../stores/settings/use-tool-expand-default.js', () => ({
  useToolExpandDefault: () => () => true,
}));

import { BlockToolCall } from './block-tool-call.js';

afterEach(() => {
  cleanup();
});

describe('BlockToolCall web image preview', () => {
  it('renders a fetched image preview even when the output has no text content', () => {
    render(
      <BlockToolCall
        toolName="webfetch"
        input={{ url: 'https://cdn.example.com/cat.png' }}
        output={{
          url: 'https://cdn.example.com/cat.png',
          status: 200,
          contentType: 'image/png',
          mediaKind: 'image',
          imageUrl: 'https://cdn.example.com/cat.png',
          content: '',
        }}
      />,
    );

    const image = screen.getByRole('img', { name: '抓取到的网络图片' });

    expect(image.getAttribute('src')).toBe('https://cdn.example.com/cat.png');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('opens the lightbox from the fetched image preview', () => {
    render(
      <BlockToolCall
        toolName="webfetch"
        input={{ url: 'https://cdn.example.com/cat.png' }}
        output={{
          url: 'https://cdn.example.com/cat.png',
          status: 200,
          contentType: 'image/png',
          mediaKind: 'image',
          imageUrl: 'https://cdn.example.com/cat.png',
          content: '',
        }}
      />,
    );

    fireEvent.click(screen.getByTitle('打开图片预览'));

    expect(screen.getByTitle('下载图片')).toBeTruthy();
  });

  it('does not render an image preview for unsupported image URL protocols', () => {
    render(
      <BlockToolCall
        toolName="webfetch"
        input={{ url: 'javascript:alert(1)' }}
        output={{
          url: 'javascript:alert(1)',
          status: 200,
          contentType: 'image/svg+xml',
          mediaKind: 'image',
          imageUrl: 'javascript:alert(1)',
          content: '',
        }}
      />,
    );

    expect(screen.queryByRole('img', { name: '抓取到的网络图片' })).toBeNull();
  });

  it('discards empty-src images inside fetched markdown instead of rendering `<img src="">`', () => {
    render(
      <BlockToolCall
        toolName="webfetch"
        input={{ url: 'https://example.com/docs' }}
        output={{
          url: 'https://example.com/docs',
          status: 200,
          contentType: 'text/markdown',
          format: 'markdown',
          content: '# 标题\n\n![坏图]()\n\n正文',
        }}
      />,
    );

    expect(screen.getByText('标题')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('BlockToolCall 渠道发图缩略图', () => {
  const SENT_IMAGE_URL = 'https://example.com/assets/photo.png';

  it.each(['WeixinSendImage', 'PluginSendImage', 'FeishuSendImage'])(
    '%s 的图片源取自入参 file_path，展开态渲染缩略图 + 回执确认行',
    (toolName) => {
      // 渠道发图走 block 卡（不在 INLINE_TOOLS 名单里），缩略图由 BlockToolCall 的
      // imageSource 统一渲染——不要再在 ToolOutputPreview 里渲染一次，否则同一张图
      // 会在同一张卡片里出现两遍。
      const { container } = render(
        <BlockToolCall
          toolName={toolName}
          input={{ file_path: SENT_IMAGE_URL }}
          output={JSON.stringify({ messageId: 'ROBOT1.0_abc' })}
        />,
      );

      const image = container.querySelector<HTMLImageElement>('.tool-call-image-preview img');
      expect(image?.getAttribute('src')).toBe(SENT_IMAGE_URL);
      expect(container.querySelector('.tool-call-confirm')?.textContent).toContain('已发送了图片');
    },
  );

  it('file_path 不是图片时只留回执确认行，不渲染缩略图', () => {
    const { container } = render(
      <BlockToolCall
        toolName="WeixinSendImage"
        input={{ file_path: '/workspace/report.pdf' }}
        output={JSON.stringify({ messageId: 'ROBOT1.0_abc' })}
      />,
    );

    expect(container.querySelector('.tool-call-image-preview')).toBeNull();
    expect(container.querySelector('.tool-call-confirm')).not.toBeNull();
  });
});
