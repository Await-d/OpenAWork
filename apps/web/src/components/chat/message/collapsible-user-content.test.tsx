// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CollapsibleUserContent } from './collapsible-user-content.js';
import { MESSAGE_FOLD_CHAR_THRESHOLD } from './message-fold-shell.js';

/**
 * 用户消息是 `white-space: pre-wrap` 的纯文本，长度没有任何约束——一条粘进来的长
 * 日志就能把整个会话页撑开。这里锁住「超过阈值默认折叠、展开/收起可逆」的契约。
 */
const LONG_TEXT = Array.from(
  { length: 60 },
  (_, index) => `第 ${index + 1} 行：粘贴进来的日志正文，用于把内容推过折叠阈值。`,
).join('\n');

function readFoldContainer(): HTMLElement | null {
  return document.querySelector('.chat-markdown-fold-container');
}

afterEach(cleanup);

describe('CollapsibleUserContent 用户消息默认折叠', () => {
  it('短正文不折叠，且不渲染任何折叠控件', () => {
    render(<CollapsibleUserContent content="帮我看下这个报错是什么原因。" />);

    expect(screen.queryByRole('button', { name: '展开全部消息内容' })).toBeNull();
    expect(readFoldContainer()).toBeNull();
    expect(screen.getByText('帮我看下这个报错是什么原因。')).toBeTruthy();
  });

  it('恰好等于阈值时不折叠（阈值语义是「超过才折叠」）', () => {
    const exactThreshold = 'a'.repeat(MESSAGE_FOLD_CHAR_THRESHOLD);

    render(<CollapsibleUserContent content={exactThreshold} />);

    expect(readFoldContainer()).toBeNull();
    expect(screen.queryByRole('button', { name: '展开全部消息内容' })).toBeNull();
  });

  it('超过阈值时默认折叠，按钮带出字符数并标记为 user 折叠', () => {
    render(<CollapsibleUserContent content={LONG_TEXT} />);

    const container = readFoldContainer();
    expect(container).not.toBeNull();
    expect(container?.getAttribute('data-expanded')).toBe('false');
    expect(container?.getAttribute('data-fold-scope')).toBe('user');

    const expandButton = screen.getByRole('button', { name: '展开全部消息内容' });
    expect(expandButton.textContent).toContain(LONG_TEXT.length.toLocaleString());
  });

  it('展开与收起可来回切换，正文始终保留在文档里', () => {
    render(<CollapsibleUserContent content={LONG_TEXT} />);

    fireEvent.click(screen.getByRole('button', { name: '展开全部消息内容' }));
    expect(readFoldContainer()?.getAttribute('data-expanded')).toBe('true');
    // 折叠态靠 CSS 裁剪，不卸载正文——搜索 / 复制都还能拿到完整内容。
    expect(screen.getByText(/第 60 行/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '展开全部消息内容' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '收起消息内容' }));
    expect(readFoldContainer()?.getAttribute('data-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: '展开全部消息内容' })).toBeTruthy();
  });
});
