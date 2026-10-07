// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaidMocks }));

import { ChartPreview } from './ChartPreview.js';

const RENDERED_SVG = '<svg viewBox="0 0 800 400"><text>diagram</text></svg>';
const DIAGRAM = ['graph TD', '  A[需求] --> B[实现]', '  B --> C[验证]'].join('\n');

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'carbon');
  document.documentElement.setAttribute('data-mode', 'dark');
  mermaidMocks.initialize.mockReset();
  mermaidMocks.parse.mockReset();
  mermaidMocks.render.mockReset();
  mermaidMocks.parse.mockResolvedValue(true);
  mermaidMocks.render.mockResolvedValue({ svg: RENDERED_SVG });
});

afterEach(() => {
  cleanup();
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  root.removeAttribute('data-mode');
  root.removeAttribute('style');
});

async function waitForFigure(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector('[data-testid="file-editor-chart-figure"]');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
}

function sourceText(): string {
  return screen.getByTestId('file-editor-chart-source').textContent ?? '';
}

describe('ChartPreview', () => {
  it('把源码渲染成图形，并标注图表类型', async () => {
    render(<ChartPreview code={DIAGRAM} />);

    const figure = await waitForFigure();

    expect(figure.querySelector('svg')).toBeTruthy();
    expect(mermaidMocks.render).toHaveBeenCalledWith(expect.any(String), DIAGRAM);
    expect(screen.getByText('流程图')).toBeTruthy();
  });

  it('以 strict 安全级别初始化，输出走净化后的 SVG', async () => {
    render(<ChartPreview code={DIAGRAM} />);
    await waitForFigure();

    expect(mermaidMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }),
    );
  });

  it('图表渲染失败时降级为源码并给出提示', async () => {
    mermaidMocks.parse.mockRejectedValue(new Error('Parse error on line 2'));
    mermaidMocks.render.mockRejectedValue(new Error('Parse error on line 2'));

    render(<ChartPreview code={DIAGRAM} />);

    expect(
      await screen.findByText('图表语法不完整或存在错误，可切换为源码查看并修正。'),
    ).toBeTruthy();
    // 错误信息在异步渲染链末尾才落地（parse → render → setState），
    // 提示文案先出现，错误详情需要再等一拍。
    await waitFor(() => {
      expect(screen.getByText('Parse error on line 2')).toBeTruthy();
    });
    expect(sourceText()).toContain('graph TD');
  });

  it('可切换到源码视图并复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ChartPreview code={DIAGRAM} />);
    await waitForFigure();

    fireEvent.click(screen.getByTestId('file-editor-chart-toggle'));
    expect(sourceText()).toContain('A[需求] --> B[实现]');

    fireEvent.click(screen.getByRole('button', { name: '复制源码' }));
    expect(writeText).toHaveBeenCalledWith(DIAGRAM);
  });
});
