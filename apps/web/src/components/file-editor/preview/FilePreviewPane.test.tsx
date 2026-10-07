// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaidMocks }));

import { FilePreviewPane } from './FilePreviewPane.js';
import { OPEN_LINK_PREVIEW_EVENT } from '../../../utils/preview/link-preview.js';

const RENDERED_SVG = '<svg viewBox="0 0 800 400"><text>diagram</text></svg>';
const DIAGRAM = ['graph TD', '  A[需求] --> B[实现]'].join('\n');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mermaidMocks.initialize.mockReset();
  mermaidMocks.parse.mockReset();
  mermaidMocks.render.mockReset();
  mermaidMocks.parse.mockResolvedValue(true);
  mermaidMocks.render.mockResolvedValue({ svg: RENDERED_SVG });
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

  it('图片预览：点击缩略图打开查看器', () => {
    render(<FilePreviewPane path="/workspace/demo/封面.png" content="你好，世界" />);

    expect(document.querySelector('.image-lightbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：封面.png' }));

    expect(document.querySelector('.image-lightbox__image')?.getAttribute('src')).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(screen.getByText('封面.png')).toBeTruthy();
  });

  it('Markdown 预览：正文图片可点击打开查看器', async () => {
    render(
      <FilePreviewPane
        path="/workspace/demo/README.md"
        content={'# 文档\n\n![封面](/images/cover.png)'}
      />,
    );

    // Markdown 渲染器是 lazy 加载的，并行跑全量测试时需要更宽的超时窗口。
    const trigger = await screen.findByRole(
      'button',
      { name: '放大查看图片：封面' },
      { timeout: 5000 },
    );
    expect(document.querySelector('.image-lightbox')).toBeNull();

    fireEvent.click(trigger);

    expect(document.querySelector('.image-lightbox__image')?.getAttribute('src')).toBe(
      '/images/cover.png',
    );
  });

  it('Markdown 预览：链接图片不再渲染成嵌套按钮，点击不打开查看器', async () => {
    render(
      <FilePreviewPane
        path="/workspace/demo/README.md"
        content={'[![封面](/images/cover.png)](/home)'}
      />,
    );

    const link = await screen.findByRole('link', { name: '封面' }, { timeout: 5000 });
    expect(link.getAttribute('href')).toBe('/home');
    expect(link.querySelector('img')?.getAttribute('src')).toBe('/images/cover.png');
    expect(link.querySelector('button')).toBeNull();

    const image = link.querySelector('img');
    expect(image).toBeTruthy();
    if (image) fireEvent.click(image);
    expect(document.querySelector('.image-lightbox')).toBeNull();
  });

  it('Markdown 预览：页面认领后链接预览接管点击', async () => {
    render(
      <FilePreviewPane path="/workspace/demo/README.md" content={'[官网](https://example.com)'} />,
    );

    const link = await screen.findByRole('link', { name: '官网' }, { timeout: 5000 });

    const urls: string[] = [];
    const listener: EventListener = (event) => {
      urls.push((event as CustomEvent<{ url: string }>).detail.url);
      event.preventDefault();
    };
    window.addEventListener(OPEN_LINK_PREVIEW_EVENT, listener);
    const result = fireEvent.click(link);
    window.removeEventListener(OPEN_LINK_PREVIEW_EVENT, listener);

    expect(result).toBe(false);
    expect(urls).toEqual(['https://example.com']);
  });

  it('图表文件：.mmd 渲染成图表而不是「暂不支持预览」', async () => {
    render(<FilePreviewPane path="/workspace/demo/架构.mmd" content={DIAGRAM} />);

    await waitFor(() => {
      expect(document.querySelector('[data-testid="file-editor-chart-figure"]')).toBeTruthy();
    });
    expect(screen.queryByText('当前文件类型暂不支持预览。')).toBeNull();
    expect(mermaidMocks.render).toHaveBeenCalledWith(expect.any(String), DIAGRAM);
  });

  it('Markdown 预览：图表围栏渲染成图表', async () => {
    render(
      <FilePreviewPane
        path="/workspace/demo/README.md"
        content={'# 文档\n\n```mermaid\n' + DIAGRAM + '\n```'}
      />,
    );

    await waitFor(
      () => {
        expect(document.querySelector('[data-testid="file-editor-chart-figure"]')).toBeTruthy();
      },
      { timeout: 5000 },
    );
    expect(mermaidMocks.render).toHaveBeenCalledWith(expect.any(String), DIAGRAM);
  });

  it('SVG 预览：提供缩放控件与导出，而不是只有一块死图', () => {
    render(
      <FilePreviewPane
        path="/workspace/demo/logo.svg"
        content={
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect width="240" height="120" /></svg>'
        }
      />,
    );

    expect(screen.getByTestId('file-editor-svg-figure')).toBeTruthy();
    expect(screen.getByRole('group', { name: '矢量图缩放' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下载 SVG' })).toBeTruthy();
    expect(screen.getByText('240 × 120')).toBeTruthy();
  });

  it('CSV 预览：首行作表头并渲染数据行', () => {
    render(
      <FilePreviewPane path="/workspace/demo/data.csv" content={'name,age\nAda,36\nLin,28'} />,
    );

    expect(screen.getByTestId('file-editor-csv-table')).toBeTruthy();
    expect(screen.getByText('2 列 · 2 行')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
  });

  it('纯文本预览：按行号逐行渲染', () => {
    render(<FilePreviewPane path="/workspace/demo/notes.txt" content={'第一行\n第二行'} />);

    expect(screen.getByTestId('file-editor-text-code')).toBeTruthy();
    expect(screen.getByText('第一行')).toBeTruthy();
    expect(screen.getByText('第二行')).toBeTruthy();
  });
});

describe('FilePreviewPane 无语言围栏代码块', () => {
  // 复现：react-markdown 不给无语言围栏加 className，只看 className 区分
  // 行内 / 块级时，这类代码块会被当成行内代码，换行折叠、树形图挤成一行。
  const TREE = ['OpenAWork/', '├── apps/', '│   └── web/'].join('\n');

  it('按块级渲染并保留原始换行', async () => {
    render(<FilePreviewPane path="/workspace/demo/TREE.md" content={'```\n' + TREE + '\n```'} />);

    // 渲染器是 lazy 加载的
    const pre = await waitFor(() => {
      const element = document.querySelector('pre');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    expect(pre.textContent).toContain(TREE);
  });

  it('行内代码仍走行内样式，不套 pre', async () => {
    render(
      <FilePreviewPane
        path="/workspace/demo/TREE.md"
        content={'路径是 `apps/web/src/index.ts`。'}
      />,
    );

    const inline = await waitFor(() => {
      const element = document.querySelector('code');
      expect(element?.textContent).toContain('apps/web/src/index.ts');
      return element as HTMLElement;
    });
    expect(inline.closest('pre')).toBeNull();
  });
});

describe('FilePreviewPane 围栏代码块复制', () => {
  const CODE = ['line-1', 'line-2', 'line-3'].join('\n');

  it('代码块工具栏提供复制按钮与语言、行数信息', async () => {
    render(<FilePreviewPane path="/workspace/demo/demo.md" content={'```ts\n' + CODE + '\n```'} />);

    const copy = await waitFor(() => screen.getByTestId('file-editor-code-copy'));
    expect(copy.textContent).toBe('复制代码');
    expect(screen.getByText('TS')).toBeTruthy();
    expect(screen.getByText('3 行')).toBeTruthy();
  });

  it('无语言围栏同样有复制按钮，语言标签退化为 CODE', async () => {
    render(<FilePreviewPane path="/workspace/demo/demo.md" content={'```\n' + CODE + '\n```'} />);

    const copy = await waitFor(() => screen.getByTestId('file-editor-code-copy'));
    expect(copy).toBeTruthy();
    expect(screen.getByText('CODE')).toBeTruthy();
  });

  it('点击复制写入原始源码，并给出已复制反馈', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<FilePreviewPane path="/workspace/demo/demo.md" content={'```ts\n' + CODE + '\n```'} />);

    const copy = await waitFor(() => screen.getByTestId('file-editor-code-copy'));
    fireEvent.click(copy);

    expect(writeText).toHaveBeenCalledWith(CODE + '\n');
    await waitFor(() => {
      expect(screen.getByTestId('file-editor-code-copy').textContent).toBe('✓ 已复制');
    });
  });
});

describe('FilePreviewPane Markdown 表格', () => {
  const TABLE = [
    '| 名称 | 说明 | 状态 |',
    '| :--- | ---: | :---: |',
    '| alpha | 第一项 | 已完成 |',
    '| beta | 第二项 | 进行中 |',
  ].join('\n');

  it('复用消息侧表格组件，拿到工具栏与统计信息', async () => {
    render(<FilePreviewPane path="/workspace/demo/TABLE.md" content={TABLE} />);

    const shell = await waitFor(() => {
      const el = document.querySelector('[data-testid="chat-markdown-table"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });

    expect(shell.getAttribute('data-density')).toBe('comfortable');
    expect(screen.getByText('2 行 × 3 列')).toBeTruthy();
    expect(screen.getByTestId('chat-markdown-table-copy')).toBeTruthy();
    expect(screen.getByTestId('chat-markdown-table-download')).toBeTruthy();
  });

  it('表头单元格挂类名并保留 GFM 列对齐', async () => {
    render(<FilePreviewPane path="/workspace/demo/TABLE.md" content={TABLE} />);

    const th = await waitFor(() => {
      const el = document.querySelector('.chat-markdown-th');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(th.getAttribute('data-align')).toBe('left');

    const rightCell = document.querySelector('.chat-markdown-td[data-align="right"]');
    const centerCell = document.querySelector('.chat-markdown-td[data-align="center"]');
    expect(rightCell?.textContent).toBe('第一项');
    expect(centerCell?.textContent).toBe('已完成');
  });
});
