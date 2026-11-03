// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { OfficePreview } from './OfficePreview.js';

/**
 * `OfficePreview` 的关键控制流测试。
 *
 * 本文件锁住的是「PDF 白名单 + 渲染器接线」这条路径，而不是 docx / xlsx
 * 的渲染质量：一旦 `renderable` 的判定被重构，PDF 会被静默挡回「不支持」
 * 提示而所有既有测试仍绿 —— 那正是这里要防的回归。
 */

/** 网关 client 替身：`useOfficeFile` 只用到 `readFileBinary`。 */
const { readFileBinary } = vi.hoisted(() => ({
  readFileBinary: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: () => ({
    readFileBinary,
  }),
}));

/**
 * pdfjs 替身：让 `getDocument` 返回一个**永不 resolve** 的加载任务。
 * 这样 PDF 会稳定停在 `PdfPreview` 的加载态，DOM 断言不必等异步渲染，
 * 也顺带证明「确实进入了 `PdfPreview`（pdfjs）这条路径」。
 */
const { getDocument, destroyTask } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroyTask: vi.fn(),
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument,
}));

/** 用合法 PDF 魔数（%PDF-）当字节，语义清晰且不会被误当成空文件。 */
const PDF_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]).buffer;

beforeEach(() => {
  readFileBinary.mockReset();
  readFileBinary.mockResolvedValue({ buffer: PDF_BYTES, contentType: 'application/pdf' });
  getDocument.mockReset();
  destroyTask.mockReset();
  // 停在加载态：promise 永不 settle。
  getDocument.mockReturnValue({ promise: new Promise(() => undefined), destroy: destroyTask });

  useAuthStore.setState({
    accessToken: 'token-test',
    email: 'qa@example.com',
    gatewayUrl: 'https://gw.test',
    refreshToken: null,
    tokenExpiresAt: null,
    webAccessEnabled: false,
    webExposeLan: false,
    webPort: 3000,
  });
  useUIStateStore.setState({ selectedWorkspacePath: '/workspace/demo' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OfficePreview — PDF 支持', () => {
  it('PDF 渲染真实预览（进入 PdfPreview 路径），不再显示「规划中 / 不支持」', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:openawork-pdf-preview');

    render(<OfficePreview path="/workspace/demo/report.pdf" />);

    // 稳定标志：PdfPreview 的加载态文案必然出现，说明 pdfjs 路径被走到。
    await waitFor(() => {
      expect(screen.getByText('正在加载 PDF…')).toBeTruthy();
    });
    // 加载态的容器类名同样由 PdfPreview 提供（未加载成功时它不带 aria-label，
    // 那是 row 165 才渲染的形态，因此这里只断类名）。
    expect(document.querySelector('.pdf-preview')).not.toBeNull();

    // 反面断言：旧的「正在规划中」提示必须消失。
    expect(screen.queryByText(/规划中/)).toBeNull();
    expect(screen.queryByText(/暂不支持|不支持在线预览/)).toBeNull();
  });

  it('PDF 确实触发了二进制读取（锁住「不再被白名单早退挡住」这一根因）', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:openawork-pdf-preview');

    render(<OfficePreview path="/workspace/demo/report.pdf" />);

    await waitFor(() => {
      expect(readFileBinary).toHaveBeenCalled();
    });
    // 以该 path 读取，且走本地身份（workspaceRoot）。
    expect(readFileBinary).toHaveBeenCalledWith('token-test', '/workspace/demo/report.pdf', {
      workspaceRoot: '/workspace/demo',
    });
  });

  it('卸载时回收 object URL（防止每次打开 PDF 泄漏一份常驻内存）', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:openawork-pdf-preview');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const { unmount } = render(<OfficePreview path="/workspace/demo/report.pdf" />);

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:openawork-pdf-preview');
  });
});

describe('OfficePreview — 既有行为不回归', () => {
  it('DOCX 仍走 DocxPreview 分支（会拉取二进制），不显示 PDF 预览', async () => {
    readFileBinary.mockResolvedValue({
      buffer: new ArrayBuffer(4),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:should-not-be-used');

    render(<OfficePreview path="/workspace/demo/notes.docx" />);

    await waitFor(() => {
      expect(readFileBinary).toHaveBeenCalledWith('token-test', '/workspace/demo/notes.docx', {
        workspaceRoot: '/workspace/demo',
      });
    });
    // 未进入 PDF 路径：不会有 PdfPreview 的加载文案。
    expect(screen.queryByText('正在加载 PDF…')).toBeNull();
  });

  it('PPTX 等仍显示「不支持」提示（白名单未误放行）', () => {
    render(<OfficePreview path="/workspace/demo/slides.pptx" />);

    expect(screen.getByText('PPTX 文件')).toBeTruthy();
    // pptx 提示文案保留；且不应发起任何字节读取。
    expect(screen.queryByText(/暂不支持在线渲染|请下载后用 PowerPoint/)).toBeTruthy();
    expect(readFileBinary).not.toHaveBeenCalled();
  });
});
