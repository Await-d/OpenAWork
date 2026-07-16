// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FilePreviewPane } from './FilePreviewPane.js';

afterEach(() => {
  cleanup();
});

describe('FilePreviewPane', () => {
  it('图片内容包含 Unicode 字符时不会在渲染期抛错', () => {
    expect(() =>
      render(<FilePreviewPane path="/workspace/demo/封面.png" content="你好，世界" />),
    ).not.toThrow();

    const image = screen.getByRole('img');
    expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });
});
