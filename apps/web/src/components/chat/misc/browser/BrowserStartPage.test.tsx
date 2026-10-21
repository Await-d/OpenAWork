// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserStartPage } from './BrowserStartPage.js';
import { toQuickLink } from './browser-start-page.js';
import type { Bookmark } from './browser-storage.js';

afterEach(cleanup);

const BOOKMARK: Bookmark = {
  id: 'bm-1',
  url: 'https://docs.example.test/guide',
  title: '使用指南',
  createdAt: 1,
};

describe('BrowserStartPage', () => {
  it('展示开始页引导，空输入回车不导航', () => {
    const onNavigate = vi.fn();
    render(<BrowserStartPage onNavigate={onNavigate} bookmarks={[]} recentLinks={[]} />);

    expect(screen.getByTestId('browser-start-page')).toBeTruthy();
    expect(screen.getByText('开始浏览')).toBeTruthy();

    fireEvent.keyDown(screen.getByPlaceholderText('搜索或输入网址，回车打开'), { key: 'Enter' });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('去掉首尾空白后把输入交给宿主导航', () => {
    const onNavigate = vi.fn();
    render(<BrowserStartPage onNavigate={onNavigate} bookmarks={[]} recentLinks={[]} />);

    const input = screen.getByPlaceholderText('搜索或输入网址，回车打开');
    fireEvent.change(input, { target: { value: '  localhost:5173  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onNavigate).toHaveBeenCalledWith('localhost:5173');
  });

  it('输入法组合期间的 Enter 不算提交', () => {
    const onNavigate = vi.fn();
    render(<BrowserStartPage onNavigate={onNavigate} bookmarks={[]} recentLinks={[]} />);

    const input = screen.getByPlaceholderText('搜索或输入网址，回车打开');
    fireEvent.change(input, { target: { value: '示例站点' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('本地预览、书签与最近访问归并去重后展示', () => {
    render(
      <BrowserStartPage
        onNavigate={vi.fn()}
        previewUrl="https://docs.example.test/guide"
        bookmarks={[BOOKMARK]}
        recentLinks={[
          toQuickLink('https://docs.example.test/guide'),
          toQuickLink('https://other.example.test/'),
        ]}
      />,
    );

    // 预览地址与书签同址：只保留一个入口（不重复渲染卡片）。
    expect(screen.getByTitle('https://docs.example.test/guide')).toBeTruthy();
    expect(screen.getByTitle('https://other.example.test/')).toBeTruthy();
    expect(screen.queryByText(/还没有书签或访问记录/)).toBeNull();
  });

  it('点击快捷入口用完整 URL 导航', () => {
    const onNavigate = vi.fn();
    render(
      <BrowserStartPage
        onNavigate={onNavigate}
        bookmarks={[]}
        recentLinks={[toQuickLink('https://example.test/docs?page=2')]}
      />,
    );

    fireEvent.click(screen.getByTitle('https://example.test/docs?page=2'));

    expect(onNavigate).toHaveBeenCalledWith('https://example.test/docs?page=2');
  });

  it('preview 模式：输入框按「预览地址」语义呈现', () => {
    const onNavigate = vi.fn();
    render(
      <BrowserStartPage mode="preview" onNavigate={onNavigate} bookmarks={[]} recentLinks={[]} />,
    );

    const input = screen.getByLabelText('预览地址');
    expect(input.getAttribute('placeholder')).toBe('输入预览地址，回车打开');
    expect(screen.getByText(/在对话里执行 \/open/)).toBeTruthy();

    fireEvent.change(input, { target: { value: 'localhost:5173' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onNavigate).toHaveBeenCalledWith('localhost:5173');
  });

  it('没有书签与历史时给出收藏引导', () => {
    render(<BrowserStartPage onNavigate={vi.fn()} bookmarks={[]} recentLinks={[]} />);

    expect(screen.getByText(/还没有书签或访问记录/)).toBeTruthy();
  });
});
