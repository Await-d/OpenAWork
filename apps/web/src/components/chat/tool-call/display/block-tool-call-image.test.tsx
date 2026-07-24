// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@openAwork/shared-ui', () => ({
  BashTerminalCard: () => null,
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
});
