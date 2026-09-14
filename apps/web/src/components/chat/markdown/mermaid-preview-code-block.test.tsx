import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaidMocks }));

import { MermaidPreviewCodeBlock } from './mermaid-preview-code-block.js';

const RENDERED_SVG = '<svg viewBox="0 0 800 400"><text>diagram</text></svg>';

afterEach(() => {
  cleanup();
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  root.removeAttribute('data-mode');
  root.removeAttribute('style');
});

const DIAGRAM = ['graph TD', '  A[错误结论] --> B[错因1]', '  B --> C[关键词偏差]'].join('\n');
const MINDMAP = ['mindmap', '  root((主题))', '    分支A', '    分支B'].join('\n');

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'carbon');
  document.documentElement.setAttribute('data-mode', 'dark');
  mermaidMocks.initialize.mockReset();
  mermaidMocks.parse.mockReset();
  mermaidMocks.render.mockReset();
  mermaidMocks.parse.mockResolvedValue(true);
  mermaidMocks.render.mockResolvedValue({ svg: RENDERED_SVG });
});

function renderDiagram(code: string = DIAGRAM, language = 'MERMAID') {
  return render(<MermaidPreviewCodeBlock code={code} codeProps={{}} language={language} />);
}

async function waitForFigure(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector('[data-testid="chat-markdown-mermaid-figure"]');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
}

describe('MermaidPreviewCodeBlock', () => {
  it('加载库后把 mermaid 源码渲染为图形', async () => {
    renderDiagram();

    const figure = await waitForFigure();

    expect(figure.querySelector('svg')).toBeTruthy();
    expect(mermaidMocks.render).toHaveBeenCalledWith(expect.any(String), DIAGRAM);
  });

  it('用 base 主题 + 主题变量出图，而不是内置 dark/default', async () => {
    renderDiagram();
    await waitForFigure();

    const options = mermaidMocks.initialize.mock.calls.at(-1)?.[0] as {
      theme: string;
      darkMode: boolean;
      themeVariables: Record<string, string>;
      themeCSS: string;
      securityLevel: string;
    };

    expect(options.securityLevel).toBe('strict');
    expect(options.theme).toBe('base');
    expect(options.darkMode).toBe(true);
    // 分支色板决定思维导图的配色
    expect(options.themeVariables.cScale0).toBeTruthy();
    expect(options.themeVariables.cScaleLabel11).toBeTruthy();
    expect(options.themeVariables.fontFamily).toContain('PingFang SC');
    expect(options.themeCSS).toContain('.node rect');
  });

  it('切换明暗模式后按新主题重新出图', async () => {
    renderDiagram();
    await waitForFigure();

    const callsBefore = mermaidMocks.initialize.mock.calls.length;
    document.documentElement.setAttribute('data-mode', 'light');

    await waitFor(() => {
      expect(mermaidMocks.initialize.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    const options = mermaidMocks.initialize.mock.calls.at(-1)?.[0] as { darkMode: boolean };
    expect(options.darkMode).toBe(false);
  });

  it('识别图表类型并给出中文徽标', async () => {
    renderDiagram(MINDMAP, 'MINDMAP');

    const figure = await waitForFigure();
    const block = figure.closest('.chat-markdown-code-block');

    expect(block?.getAttribute('data-diagram-kind')).toBe('mindmap');
    expect(screen.getByText('思维导图')).toBeTruthy();
  });

  it('支持放大、重置与缩小的百分比反馈', async () => {
    renderDiagram();
    await waitForFigure();

    const value = (): string | null =>
      screen.getByTestId('chat-markdown-mermaid-zoom-reset').textContent;

    expect(value()).toBe('100%');

    fireEvent.click(screen.getByTestId('chat-markdown-mermaid-zoom-in'));
    expect(value()).toBe('125%');

    fireEvent.click(screen.getByTestId('chat-markdown-mermaid-zoom-reset'));
    expect(value()).toBe('100%');

    fireEvent.click(screen.getByTestId('chat-markdown-mermaid-zoom-out'));
    expect(value()).toBe('80%');
  });

  it('适应宽度按容器可用宽度计算缩放', async () => {
    // viewBox 宽 800，容器可用宽 = 426 - 12*2 - 2 = 400 → 50%
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 426,
    });

    try {
      renderDiagram();

      await waitFor(() => {
        expect(screen.getByTestId('chat-markdown-mermaid-zoom-reset').textContent).toBe('50%');
      });

      fireEvent.click(screen.getByTestId('chat-markdown-mermaid-zoom-reset'));
      expect(screen.getByTestId('chat-markdown-mermaid-zoom-reset').textContent).toBe('100%');

      fireEvent.click(screen.getByTestId('chat-markdown-mermaid-fit'));
      expect(screen.getByTestId('chat-markdown-mermaid-zoom-reset').textContent).toBe('50%');
    } finally {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', descriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
      }
    }
  });

  it('下载 SVG 时补上命名空间与背景', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    renderDiagram();
    await waitForFigure();

    fireEvent.click(screen.getByTestId('chat-markdown-mermaid-download'));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });

    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob?.type).toContain('svg');

    const payload = (await blob?.text()) ?? '';
    expect(payload).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(payload).toContain('<rect width="100%" height="100%"');
    expect(click).toHaveBeenCalled();

    click.mockRestore();
  });

  it('渲染失败时回退到源码并给出提示', async () => {
    mermaidMocks.parse.mockRejectedValue(new Error('Parse error on line 2'));

    renderDiagram();

    await waitFor(() => {
      expect(screen.getByText(/语法尚未完整或存在错误/)).toBeTruthy();
    });

    expect(document.querySelector('[data-testid="chat-markdown-mermaid-figure"]')).toBeNull();
    // 源码仍然可见，信息不丢失
    expect(screen.getByText(/A\[错误结论\]/)).toBeTruthy();
  });

  it('渲染失败的错误详情以小字展示', async () => {
    mermaidMocks.parse.mockRejectedValue(new Error('Parse error on line 2'));

    renderDiagram();

    await waitFor(() => {
      expect(screen.getByText(/Parse error on line 2/)).toBeTruthy();
    });
  });

  it('可以在图形与源码之间切换', async () => {
    renderDiagram();
    await waitForFigure();

    fireEvent.click(screen.getByTestId('chat-markdown-mermaid-toggle'));

    expect(document.querySelector('[data-testid="chat-markdown-mermaid-figure"]')).toBeNull();
    expect(screen.getByText(/A\[错误结论\]/)).toBeTruthy();
    expect(screen.getByTestId('chat-markdown-mermaid-toggle').textContent).toBe('查看图形');

    fireEvent.click(screen.getByTestId('chat-markdown-mermaid-toggle'));

    await waitForFigure();
  });

  it('提供复制按钮复制源码', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderDiagram();

    fireEvent.click(screen.getByTestId('chat-markdown-mermaid-copy'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(DIAGRAM);
    });
  });
});
