// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { McpResultPreview, extractMcpResult } from './mcp-result-preview.js';

afterEach(cleanup);

const PNG_DATA_URL = 'data:image/png;base64,AAAA';
const JPEG_DATA_URL = 'data:image/jpeg;base64,BBBB';

function buildResult() {
  const result = extractMcpResult({
    content: [
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      { type: 'text', text: '说明文字' },
      { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' },
    ],
    isError: false,
  });
  if (!result) throw new Error('MCP 结果解析失败');
  return result;
}

describe('McpResultPreview 图片块', () => {
  it('点击图片块打开查看器，多图之间可左右切换', () => {
    render(<McpResultPreview result={buildResult()} />);

    expect(screen.getByText('说明文字')).toBeTruthy();
    expect(document.querySelector('.image-lightbox')).toBeNull();

    const lightboxSrc = (): string | null =>
      document.querySelector('.image-lightbox__image')?.getAttribute('src') ?? null;

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：image/jpeg' }));
    expect(screen.getByText('2 / 2')).toBeTruthy();
    expect(lightboxSrc()).toBe(JPEG_DATA_URL);

    fireEvent.click(screen.getByRole('button', { name: '上一张' }));
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(lightboxSrc()).toBe(PNG_DATA_URL);
  });

  it('单张图片不渲染左右切换', () => {
    const result = extractMcpResult({
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      isError: false,
    });
    if (!result) throw new Error('MCP 结果解析失败');

    render(<McpResultPreview result={result} />);

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：image/png' }));
    expect(document.querySelector('.image-lightbox__image')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
  });
});
