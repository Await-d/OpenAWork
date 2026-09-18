// @vitest-environment jsdom
/**
 * TeamAttentionBar · 提示可见性契约
 *
 * jsdom 不参与布局计算，这里锁定样式契约（浏览器 QA 负责像素级证明）：
 *  - 标题 flex 1 1 auto + minWidth 0：唯一可无限压缩到省略号的字段
 *  - 提示 flex 0 1 auto + minWidth 120：有下限，不会被标题压成 0 宽
 *  - 超长标题按 ATTENTION_TITLE_MAX_LENGTH 截断，完整原文保留在 title 属性
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ATTENTION_TITLE_MAX_LENGTH, TeamAttentionBar } from './TeamAttentionBar.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LONG_TITLE = '失败回传：callback 校验超时，请重试并检查网络代理配置，'.repeat(8);
const HINT = '去「任务 → 待澄清」回答';

describe('TeamAttentionBar', () => {
  it('提示元素带非零 flex 下限，不是纯 flex:1（basis 0）', () => {
    render(<TeamAttentionBar show title={LONG_TITLE} hint={HINT} onJump={vi.fn()} />);

    const hint = screen.getByText(HINT);
    expect(hint.style.flex).toBe('0 1 auto');
    expect(hint.style.minWidth).toBe('120px');
    expect(hint.style.maxWidth).toBe('240px');
  });

  it('标题保留省略号契约并在压缩时让位给提示', () => {
    render(<TeamAttentionBar show title={LONG_TITLE} hint={HINT} onJump={vi.fn()} />);

    // 标签本身已被截断，用 title 属性定位同一个 strong 元素（契约未变）。
    const title = screen.getByTitle(LONG_TITLE);
    expect(title.style.flex).toBe('1 1 auto');
    expect(title.style.minWidth).toBe('0px');
    expect(title.style.overflow).toBe('hidden');
    expect(title.style.textOverflow).toBe('ellipsis');
    expect(title.style.whiteSpace).toBe('nowrap');
  });

  it('超长标题按上限截断，完整原文保留在 title 属性', () => {
    render(<TeamAttentionBar show title={LONG_TITLE} hint={HINT} onJump={vi.fn()} />);

    const title = screen.getByTitle(LONG_TITLE);
    const label = title.textContent ?? '';

    expect(LONG_TITLE.length).toBeGreaterThan(ATTENTION_TITLE_MAX_LENGTH);
    expect(label).toBe(`${LONG_TITLE.slice(0, ATTENTION_TITLE_MAX_LENGTH)}…`);
    expect(label.length).toBe(ATTENTION_TITLE_MAX_LENGTH + 1);
    expect(title.getAttribute('title')).toBe(LONG_TITLE);
  });

  it('不超过上限的标题原样渲染，不加省略号', () => {
    const shortTitle = '失败回传：callback 校验超时';
    render(<TeamAttentionBar show title={shortTitle} hint={HINT} onJump={vi.fn()} />);

    const title = screen.getByTitle(shortTitle);
    expect(title.textContent).toBe(shortTitle);
  });

  it('提示同时渲染 title 属性，截断后仍可悬停查看全文', () => {
    render(<TeamAttentionBar show title={LONG_TITLE} hint={HINT} onJump={vi.fn()} />);

    expect(screen.getByTitle(HINT)).toBe(screen.getByText(HINT));
  });

  it('无提示时只渲染标题且不报错', () => {
    const { container } = render(<TeamAttentionBar show title="只有标题" />);

    expect(screen.getByText('待你处理')).toBeTruthy();
    expect(screen.getByText('只有标题')).toBeTruthy();
    expect(container.querySelector('button')).toBeNull();
  });

  it('show=false 时不渲染', () => {
    const { container } = render(<TeamAttentionBar show={false} title={LONG_TITLE} />);

    expect(container.firstChild).toBeNull();
  });
});
