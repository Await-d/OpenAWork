// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserPreviewStartPage } from './BrowserPreviewStartPage.js';

const WORKSPACE = '/home/await/project/OpenAWork';
const TABS_KEY = `openawork:builtin-browser:tabs:v1:${WORKSPACE}`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe('BrowserPreviewStartPage', () => {
  it('提交时把预览地址补全为完整 URL', () => {
    const onSubmit = vi.fn();
    render(<BrowserPreviewStartPage workspacePath={WORKSPACE} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('预览地址'), { target: { value: 'localhost:5173' } });
    fireEvent.click(screen.getByRole('button', { name: '前往' }));

    expect(onSubmit).toHaveBeenCalledWith('http://localhost:5173');
  });

  it('空输入不触发回调', () => {
    const onSubmit = vi.fn();
    render(<BrowserPreviewStartPage workspacePath={WORKSPACE} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: '前往' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('从该 workspace 持久化的标签历史里展示「快速打开」入口', () => {
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({
        version: 1,
        activeTabId: 'tab-prev',
        tabs: [
          {
            id: 'tab-prev',
            url: 'https://example.test/previous',
            title: '上次预览',
            history: ['https://example.test/previous'],
            historyIndex: 0,
          },
        ],
      }),
    );

    render(<BrowserPreviewStartPage workspacePath={WORKSPACE} onSubmit={vi.fn()} />);

    expect(screen.getByTitle('https://example.test/previous')).toBeTruthy();
    expect(screen.getByText('上次预览')).toBeTruthy();
  });

  it('点击快捷入口直接以该地址打开预览', () => {
    const onSubmit = vi.fn();
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({
        version: 1,
        activeTabId: 'tab-prev',
        tabs: [
          {
            id: 'tab-prev',
            url: 'localhost:5173',
            title: 'dev',
            history: ['http://localhost:5173/'],
            historyIndex: 0,
          },
        ],
      }),
    );

    render(<BrowserPreviewStartPage workspacePath={WORKSPACE} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTitle('http://localhost:5173/'));

    expect(onSubmit).toHaveBeenCalledWith('http://localhost:5173/');
  });
});
