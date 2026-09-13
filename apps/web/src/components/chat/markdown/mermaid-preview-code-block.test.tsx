import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaidMocks }));

vi.mock('../../../stores/settings/display-preferences.js', () => ({
  useDisplayPreferencesStore: vi.fn(
    (selector: (state: { themeMode: 'dark' | 'light' | 'system' }) => unknown) =>
      selector({ themeMode: 'dark' }),
  ),
}));

import { MermaidPreviewCodeBlock } from './mermaid-preview-code-block.js';

afterEach(cleanup);

const DIAGRAM = ['graph TD', '  A[错误结论] --> B[错因1]', '  B --> C[关键词偏差]'].join('\n');

beforeEach(() => {
  mermaidMocks.initialize.mockReset();
  mermaidMocks.parse.mockReset();
  mermaidMocks.render.mockReset();
  mermaidMocks.parse.mockResolvedValue(true);
  mermaidMocks.render.mockResolvedValue({ svg: '<svg><text>diagram</text></svg>' });
});

describe('MermaidPreviewCodeBlock', () => {
  it('加载库后把 mermaid 源码渲染为图形', async () => {
    render(<MermaidPreviewCodeBlock code={DIAGRAM} codeProps={{}} language="MERMAID" />);

    const figure = await waitFor(() => {
      const el = document.querySelector('[data-testid="chat-markdown-mermaid-figure"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });

    expect(figure.querySelector('svg')).toBeTruthy();
    expect(mermaidMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', theme: 'dark' }),
    );
    expect(mermaidMocks.render).toHaveBeenCalledWith(expect.any(String), DIAGRAM);
  });

  it('渲染失败时回退到源码并给出提示', async () => {
    mermaidMocks.parse.mockRejectedValue(new Error('Parse error on line 2'));

    render(<MermaidPreviewCodeBlock code={DIAGRAM} codeProps={{}} language="MERMAID" />);

    await waitFor(() => {
      expect(screen.getByText(/语法尚未完整或存在错误/)).toBeTruthy();
    });

    expect(document.querySelector('[data-testid="chat-markdown-mermaid-figure"]')).toBeNull();
    // 源码仍然可见，信息不丢失
    expect(screen.getByText(/A\[错误结论\]/)).toBeTruthy();
  });

  it('渲染失败的错误详情以小字展示', async () => {
    mermaidMocks.parse.mockRejectedValue(new Error('Parse error on line 2'));

    render(<MermaidPreviewCodeBlock code={DIAGRAM} codeProps={{}} language="MERMAID" />);

    await waitFor(() => {
      expect(screen.getByText(/Parse error on line 2/)).toBeTruthy();
    });
  });

  it('可以在图形与源码之间切换', async () => {
    render(<MermaidPreviewCodeBlock code={DIAGRAM} codeProps={{}} language="MERMAID" />);

    await waitFor(() => {
      expect(document.querySelector('[data-testid="chat-markdown-mermaid-figure"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('chat-markdown-mermaid-toggle'));

    expect(document.querySelector('[data-testid="chat-markdown-mermaid-figure"]')).toBeNull();
    expect(screen.getByText(/A\[错误结论\]/)).toBeTruthy();
    expect(screen.getByTestId('chat-markdown-mermaid-toggle').textContent).toBe('查看图形');

    fireEvent.click(screen.getByTestId('chat-markdown-mermaid-toggle'));

    expect(document.querySelector('[data-testid="chat-markdown-mermaid-figure"]')).toBeTruthy();
  });

  it('提供复制按钮复制源码', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MermaidPreviewCodeBlock code={DIAGRAM} codeProps={{}} language="MERMAID" />);

    fireEvent.click(screen.getByTestId('chat-markdown-mermaid-copy'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(DIAGRAM);
    });
  });
});
