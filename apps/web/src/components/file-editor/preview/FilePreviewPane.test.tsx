// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewPane } from './FilePreviewPane.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FilePreviewPane', () => {
  it('图片内容包含 Unicode 字符时不会在渲染期抛错', () => {
    expect(() =>
      render(<FilePreviewPane path="/workspace/demo/封面.png" content="你好，世界" />),
    ).not.toThrow();

    const image = screen.getByRole('img');
    expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  // 右键 / 键盘呼出菜单由 ContentContextMenuHost 承接（见该组件与
  // content-context-menu-items 的测试）——本组件只管渲染，不再持有菜单逻辑。
});
