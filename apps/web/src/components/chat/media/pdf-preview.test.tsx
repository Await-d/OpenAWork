// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PdfPreview } from './pdf-preview.js';

/**
 * `pdfjs-dist` 整体替身：本文件验证的是**接线与生命周期**（加载 / 分批 / 失败 / 销毁），
 * 不是 pdfjs 的渲染质量。
 *
 * 注意没有 mock `pdfjs-dist/build/pdf.worker.min.mjs?url` —— 让 Vite 自己解析它，
 * 顺便验证这条 `?url` 导入在本仓库的构建链里确实可解析（它一旦断裂，预览会直接挂）。
 */
const { getDocument, destroyTask } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroyTask: vi.fn(),
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument,
}));

interface FakePage {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: () => { promise: Promise<void> };
}

function makeDocument(pageCount: number): {
  numPages: number;
  getPage: (pageNumber: number) => Promise<FakePage>;
} {
  return {
    numPages: pageCount,
    getPage: async (): Promise<FakePage> => ({
      getViewport: () => ({ width: 100, height: 200 }),
      render: () => ({ promise: Promise.resolve() }),
    }),
  };
}

function stubDocument(pageCount: number): void {
  getDocument.mockReturnValue({
    promise: Promise.resolve(makeDocument(pageCount)),
    destroy: destroyTask,
  });
}

beforeEach(() => {
  // jsdom 不实现 canvas 2d 上下文（未装 canvas 包），给一个最小替身。
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => ({})),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PdfPreview', () => {
  it('加载中显示占位，且不渲染画布', () => {
    getDocument.mockReturnValue({ promise: new Promise(() => undefined), destroy: destroyTask });

    render(<PdfPreview src="blob:pdf" fileName="report.pdf" />);

    expect(screen.getByText('正在加载 PDF…')).toBeTruthy();
    expect(document.querySelector('canvas')).toBeNull();
    // 加载态也要带文件名的可访问名：一条消息里多个附件同时加载时，读屏不能只听到
    // 一串相同的「正在加载 PDF…」（成功态本就有 label，此处曾漏）。
    expect(screen.getByLabelText('report.pdf 预览')).toBeTruthy();
  });

  it('加载成功后按批渲染画布，页数不足一批时不显示「继续加载」', async () => {
    stubDocument(2);

    render(<PdfPreview src="blob:pdf" fileName="report.pdf" />);

    await waitFor(() => {
      expect(document.querySelectorAll('canvas')).toHaveLength(2);
    });
    expect(screen.getByText('已显示全部 2 页')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('页数超过一批时提供「继续加载」，点击后追加渲染', async () => {
    stubDocument(7);

    render(<PdfPreview src="blob:pdf" fileName="report.pdf" />);

    await waitFor(() => {
      expect(document.querySelectorAll('canvas')).toHaveLength(3);
    });

    fireEvent.click(screen.getByRole('button', { name: /继续加载/ }));

    await waitFor(() => {
      expect(document.querySelectorAll('canvas')).toHaveLength(6);
    });
    // 7 页：第二批到 6，还剩 1 页
    expect(screen.getByRole('button', { name: /继续加载/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /继续加载/ }));

    await waitFor(() => {
      expect(document.querySelectorAll('canvas')).toHaveLength(7);
    });
    expect(screen.getByText('已显示全部 7 页')).toBeTruthy();
  });

  it('加载失败显示错误文案', async () => {
    getDocument.mockReturnValue({
      promise: Promise.reject(new Error('文件已损坏')),
      destroy: destroyTask,
    });

    render(<PdfPreview src="blob:pdf" fileName="report.pdf" />);

    await waitFor(() => {
      expect(screen.getByText('PDF 预览失败：文件已损坏')).toBeTruthy();
    });
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('卸载时销毁加载任务（否则 worker 与内存一直被占着）', async () => {
    stubDocument(1);

    const { unmount } = render(<PdfPreview src="blob:pdf" fileName="report.pdf" />);

    await waitFor(() => {
      expect(document.querySelectorAll('canvas')).toHaveLength(1);
    });

    unmount();

    expect(destroyTask).toHaveBeenCalled();
  });

  it('src 变化时重新加载', async () => {
    stubDocument(1);

    const { rerender } = render(<PdfPreview src="blob:pdf-1" fileName="a.pdf" />);

    await waitFor(() => {
      expect(getDocument).toHaveBeenCalledWith({ url: 'blob:pdf-1' });
    });

    rerender(<PdfPreview src="blob:pdf-2" fileName="a.pdf" />);

    await waitFor(() => {
      expect(getDocument).toHaveBeenCalledWith({ url: 'blob:pdf-2' });
    });
  });
});
