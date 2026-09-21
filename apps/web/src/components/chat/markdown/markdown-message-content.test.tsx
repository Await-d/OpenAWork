import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => true),
    render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 320 180"><text>d</text></svg>' })),
  },
}));

import MarkdownMessageContent from './markdown-message-content.js';
import { OPEN_LINK_PREVIEW_EVENT } from '../../../utils/preview/link-preview.js';

afterEach(cleanup);

describe('MarkdownMessageContent math rendering', () => {
  it('renders the copied bracketed LaTeX answer as display math', async () => {
    render(<MarkdownMessageContent content={'所以\n\n[\nx\\le 7.\n]\n\n\\boxed{x=7}。'} />);

    expect((await screen.findAllByText('x')).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.katex-display')).toHaveLength(2);
    expect(document.querySelector('.katex')).toBeTruthy();
  });

  it('renders the complete exchange-count answer without empty math nodes', async () => {
    const content = String.raw`第一步消耗 (1) 次交换；引理保证之后最多再用 (6) 次，因此总数不超过

[
1+6=7.
]

所以

[
x\le 7.
]

结合前面的下界 (x\ge7)，得到

[
\boxed{x=7}.
]

因此，所有保证成功的策略中，最坏情况下所需的最少交换次数是：

[
\boxed{7\text{ 次}}.
]`;

    render(<MarkdownMessageContent content={content} />);

    expect((await screen.findAllByText('所以')).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.katex-display')).toHaveLength(4);
    expect(document.querySelectorAll('.katex')).toHaveLength(5);
    expect(document.querySelector('.katex-display:empty')).toBeNull();
    expect(document.body.textContent).toContain('次');
  });

  it('renders Chinese prose with comparison operators without KaTeX warnings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const content = [
      '- 计费月起（2026-01 及之后），较上月 > 100 元的部分计入。',
      '- 合计 $计费月起，较上月 > 100$ 元。',
    ].join('\n');

    render(<MarkdownMessageContent content={content} />);

    expect(await screen.findByText(/计费月起（2026-01 及之后）/u)).toBeTruthy();
    expect(document.querySelectorAll('.katex')).toHaveLength(0);
    expect(warn.mock.calls.flat().join('\n')).not.toContain('unicodeTextInMathMode');

    warn.mockRestore();
  });
});

describe('MarkdownMessageContent hard breaks', () => {
  it('renders a raw <br> inside a table cell as a real line break', () => {
    const content = ['| 评论 | 热度 |', '| --- | --- |', '| A<br>B | 1 |'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    const cell = container.querySelector('.chat-markdown-td');
    expect(cell?.querySelector('br')).toBeTruthy();
    expect(cell?.textContent).toBe('AB');
    expect(container.textContent).not.toContain('<br>');
  });

  it('renders <br> in prose without leaving a stray blank line', () => {
    const { container } = render(<MarkdownMessageContent content={'第一行<br>\n第二行'} />);

    const paragraph = container.querySelector('.chat-markdown-p');
    expect(paragraph?.querySelector('br')).toBeTruthy();
    expect(paragraph?.textContent).toBe('第一行第二行');
  });

  it('keeps a literal <br> inside inline code', () => {
    const { container } = render(<MarkdownMessageContent content={'使用 `<br>` 换行'} />);

    expect(container.querySelector('.chat-markdown-inline-code')?.textContent).toBe('<br>');
  });

  it('drops a <br> that occupies a line of its own', () => {
    const content = ['第一段', '', '<br>', '', '第二段'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    expect(container.textContent).not.toContain('<br>');
    expect(container.querySelectorAll('.chat-markdown-p')).toHaveLength(2);
  });
});

describe('MarkdownMessageContent tables', () => {
  const TABLE = ['| 项目 | 金额 | 备注 |', '| :--- | ---: | --- |', '| 合计 | 1200 | ok |'].join(
    '\n',
  );

  it('渲染为卡片结构：工具栏 + 独立滚动区', () => {
    const { container } = render(<MarkdownMessageContent content={TABLE} />);

    expect(container.querySelector('.chat-markdown-table-shell')).toBeTruthy();
    expect(container.querySelector('.chat-markdown-table-viewport')).toBeTruthy();
    expect(container.querySelector('.chat-markdown-table-wrap .chat-markdown-table')).toBeTruthy();
    expect(screen.getByTestId('chat-markdown-table-copy')).toBeTruthy();
    expect(screen.getByText('1 行 × 3 列')).toBeTruthy();
  });

  it('把 GFM 列对齐落到 data-align，交给样式处理', () => {
    const { container } = render(<MarkdownMessageContent content={TABLE} />);

    const headerCells = container.querySelectorAll('.chat-markdown-th');
    const bodyCells = container.querySelectorAll('.chat-markdown-td');

    expect(headerCells[0]?.getAttribute('data-align')).toBe('left');
    expect(headerCells[1]?.getAttribute('data-align')).toBe('right');
    // 未标注对齐的列默认左对齐
    expect(headerCells[2]?.getAttribute('data-align')).toBe('left');
    expect(bodyCells[1]?.getAttribute('data-align')).toBe('right');
    expect(headerCells[0]?.getAttribute('scope')).toBe('col');
  });

  it('列数多时切到紧凑密度', () => {
    const wide = [
      '| a | b | c | d | e | f | g |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| 1 | 2 | 3 | 4 | 5 | 6 | 7 |',
    ].join('\n');
    const { container } = render(<MarkdownMessageContent content={wide} />);

    expect(
      container.querySelector('.chat-markdown-table-shell')?.getAttribute('data-density'),
    ).toBe('compact');
  });
});

describe('MarkdownMessageContent images', () => {
  const lightboxSrc = (): string | null =>
    document.querySelector('.image-lightbox__image')?.getAttribute('src') ?? null;

  it('单图：点击打开查看器，且不渲染左右切换', () => {
    render(<MarkdownMessageContent content={'![架构图](/images/arch.png "架构图说明")'} />);

    const trigger = screen.getByRole('button', { name: '放大查看图片：架构图' });
    const thumbnail = trigger.querySelector('img');
    expect(thumbnail?.getAttribute('src')).toBe('/images/arch.png');
    expect(thumbnail?.getAttribute('alt')).toBe('架构图');
    expect(thumbnail?.getAttribute('title')).toBe('架构图说明');
    expect(document.querySelector('.image-lightbox')).toBeNull();

    fireEvent.click(trigger);

    expect(lightboxSrc()).toBe('/images/arch.png');
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
  });

  it('链接图片：回退为纯 <img>，不嵌套按钮、点击不打开灯箱', () => {
    render(<MarkdownMessageContent content={'[![Logo](/logo-openai.svg)](/home)'} />);

    const link = screen.getByRole('link', { name: 'Logo' });
    const image = screen.getByRole('img', { name: 'Logo' });
    // 锚点语义保持不变（href / 新标签打开），只是不再包一层可点击触发器。
    expect(link.getAttribute('href')).toBe('/home');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(image.closest('a')).toBe(link);
    expect(screen.queryByRole('button')).toBeNull();

    fireEvent.click(image);
    expect(document.querySelector('.image-lightbox')).toBeNull();
  });

  it('同段混合：链接内图片不渲染放大按钮，但图集仍按正文顺序收录全部图片', () => {
    const content = ['[![Logo](/logo.svg)](/home)', '', '![截图](/images/1.png)'].join('\n');
    render(<MarkdownMessageContent content={content} />);

    // 可点击入口只属于链接外的图片；链接内图片保留锚点语义（见上一个用例）。
    expect(screen.getAllByRole('button', { name: /^放大查看图片：/u })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：截图' }));
    expect(lightboxSrc()).toBe('/images/1.png');

    // 图集收录的是正文中出现的全部图片 URL（抽取阶段不区分是否位于链接内），
    // 所以从截图切上一张会落到链接内的 Logo —— 这是当前实现的可观察行为。
    fireEvent.click(screen.getByRole('button', { name: '上一张' }));
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(lightboxSrc()).toBe('/logo.svg');
  });

  it('多图：从任意一张打开都带完整图集，可左右切换且边界不循环', () => {
    const content = [
      '![图一](/images/1.png)',
      '',
      '![图二](/images/2.png "第二张")',
      '',
      '![图三](/images/3.png)',
    ].join('\n');
    render(<MarkdownMessageContent content={content} />);

    expect(screen.getAllByRole('button', { name: /^放大查看图片：/u })).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：图二' }));
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(lightboxSrc()).toBe('/images/2.png');

    fireEvent.click(screen.getByRole('button', { name: '下一张' }));
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(lightboxSrc()).toBe('/images/3.png');
    expect((screen.getByRole('button', { name: '下一张' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: '上一张' }));
    fireEvent.click(screen.getByRole('button', { name: '上一张' }));
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(lightboxSrc()).toBe('/images/1.png');
    expect((screen.getByRole('button', { name: '上一张' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('键盘可达：Esc 关闭查看器', () => {
    render(<MarkdownMessageContent content={'![图一](/images/1.png)'} />);

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：图一' }));
    expect(document.querySelector('.image-lightbox')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.image-lightbox')).toBeNull();
  });

  it('代码块中的图片写法不进入图集', () => {
    const content = [
      '```ts',
      'const markdown = "![伪图](/images/code.png)";',
      '```',
      '',
      '![真图](/images/real.png)',
    ].join('\n');
    render(<MarkdownMessageContent content={content} />);

    expect(screen.getAllByRole('button', { name: /^放大查看图片：/u })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：真图' }));
    expect(lightboxSrc()).toBe('/images/real.png');
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
  });
});

describe('MarkdownMessageContent mermaid fences', () => {
  it('把 ```mindmap 直接当图表渲染并标注类型', () => {
    const content = ['```mindmap', 'mindmap', '  root((主题))', '    分支', '```'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    expect(
      container.querySelector('.chat-markdown-code-block')?.getAttribute('data-diagram-kind'),
    ).toBe('mindmap');
    expect(screen.getByText('思维导图')).toBeTruthy();
  });

  it('普通代码围栏不受影响，不带上图表标记', () => {
    const content = ['```ts', 'const a = 1;', '```'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    const block = container.querySelector('.chat-markdown-code-block');
    expect(block).toBeTruthy();
    expect(block?.hasAttribute('data-diagram-kind')).toBe(false);
  });
});

describe('MarkdownMessageContent static preview fences', () => {
  it('```html / ```css / ```svg 默认展开预览', () => {
    for (const language of ['html', 'css', 'svg']) {
      const content = ['```' + language, '<div></div>', '```'].join('\n');
      const { container, unmount } = render(<MarkdownMessageContent content={content} />);

      const block = container.querySelector('.chat-markdown-code-block');
      expect(block?.getAttribute('data-static-preview')).toBe('true');
      expect(block?.getAttribute('data-preview-open')).toBe('true');
      expect(container.querySelector('[data-testid="chat-markdown-html-preview"]')).toBeTruthy();
      unmount();
    }
  });

  it('```xml 不默认预览，保持源码视图', () => {
    const content = ['```xml', '<project></project>', '```'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    const block = container.querySelector('.chat-markdown-code-block');
    expect(block?.getAttribute('data-static-preview')).toBe('true');
    expect(block?.hasAttribute('data-preview-open')).toBe(false);
    expect(container.querySelector('[data-testid="chat-markdown-html-preview"]')).toBeNull();
    expect(container.querySelector('pre.chat-markdown-pre')).toBeTruthy();
  });

  it('```js 不默认预览，保持源码视图', () => {
    const content = ['```js', 'const a = 1;', '```'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    const block = container.querySelector('.chat-markdown-code-block');
    expect(block?.hasAttribute('data-preview-open')).toBe(false);
    expect(container.querySelector('pre.chat-markdown-pre')).toBeTruthy();
  });
});

describe('MarkdownMessageContent link preview', () => {
  const HTTPS_LINK = '[官网](https://example.com)';

  /** 注册一个「认领」监听：记录 url 并 preventDefault，模拟页面的应用内预览。 */
  function registerClaimingListener(): {
    readonly urls: string[];
    readonly listener: EventListener;
  } {
    const urls: string[] = [];
    const listener: EventListener = (event) => {
      urls.push((event as CustomEvent<{ url: string }>).detail.url);
      event.preventDefault();
    };
    window.addEventListener(OPEN_LINK_PREVIEW_EVENT, listener);
    return { urls, listener };
  }

  it('页面认领预览请求时阻止锚点原生跳转', () => {
    render(<MarkdownMessageContent content={HTTPS_LINK} />);
    const { urls, listener } = registerClaimingListener();

    const result = fireEvent.click(screen.getByRole('link', { name: '官网' }));
    window.removeEventListener(OPEN_LINK_PREVIEW_EVENT, listener);

    expect(result).toBe(false);
    expect(urls).toEqual(['https://example.com']);
  });

  it('没有页面认领时锚点保持新标签打开', () => {
    render(<MarkdownMessageContent content={HTTPS_LINK} />);
    const link = screen.getByRole('link', { name: '官网' });

    expect(link.getAttribute('target')).toBe('_blank');
    expect(fireEvent.click(link)).toBe(true);
  });

  it('相对链接不进入预览面', () => {
    render(<MarkdownMessageContent content={'[首页](/home)'} />);
    const listener = vi.fn();
    window.addEventListener(OPEN_LINK_PREVIEW_EVENT, listener);

    const link = screen.getByRole('link', { name: '首页' });
    fireEvent.click(link);
    window.removeEventListener(OPEN_LINK_PREVIEW_EVENT, listener);

    expect(listener).not.toHaveBeenCalled();
    expect(link.getAttribute('href')).toBe('/home');
  });

  it('修饰键或中键点击不进入预览面', () => {
    render(<MarkdownMessageContent content={HTTPS_LINK} />);
    const listener = vi.fn();
    window.addEventListener(OPEN_LINK_PREVIEW_EVENT, listener);

    const link = screen.getByRole('link', { name: '官网' });
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      fireEvent.click(link, init);
    }
    window.removeEventListener(OPEN_LINK_PREVIEW_EVENT, listener);

    expect(listener).not.toHaveBeenCalled();
  });
});
