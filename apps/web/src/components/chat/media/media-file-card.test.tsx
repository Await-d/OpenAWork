// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaFileCard } from './media-file-card.js';

/**
 * 文件卡片的**下载端点契约**。
 *
 * 修复前的实现走 `createArtifactsClient().get(token, artifactId)`
 * （`GET /artifacts/:id`，SQLite 内容型表），而上传附件写在磁盘型索引里 —— 那条请求
 * 稳定 404，用户看到的是「下载失败，请重试」。
 *
 * 因此这里显式断言 `downloadFromSession(token, sessionId, artifactId)` 被调用、
 * 且 `get` **没有**被调用。改回旧端点会让本文件立刻失败。
 */
const { downloadFromSession, get } = vi.hoisted(() => ({
  downloadFromSession: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createArtifactsClient: () => ({ downloadFromSession, get }),
}));

vi.mock('../../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ gatewayUrl: 'http://gateway.test', accessToken: 'token-1' }),
}));

// 下载必须经统一导出器（桌面端会弹原生保存对话框），而不是本卡片自造 anchor。
// 因此这里只观察 exportFile 的入参，避免依赖它的内部实现。
const { exportFile } = vi.hoisted(() => ({ exportFile: vi.fn() }));
vi.mock('../../../utils/export-file.js', () => ({ exportFile }));

// 不把真正的 pdfjs 拖进本文件：这里只验「按钮 → 懒取流 → 渲染预览」的接线。
vi.mock('./pdf-preview.js', () => ({
  PdfPreview: ({ src }: { src: string }) => <div data-testid="pdf-preview">{src}</div>,
}));

const createObjectURL = vi.fn(() => 'blob:download-url');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  downloadFromSession.mockResolvedValue(new Blob(['payload'], { type: 'application/pdf' }));
  exportFile.mockResolvedValue({ kind: 'browser' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MediaFileCard', () => {
  it('渲染类型徽章与文件名', () => {
    render(<MediaFileCard fileName="report.pdf" artifactId="art-1" sessionId="ses-1" />);

    expect(screen.getByText('PDF')).toBeTruthy();
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('PDF 文档')).toBeTruthy();
  });

  it('下载走会话级端点，且不碰内容型端点', async () => {
    render(<MediaFileCard fileName="report.pdf" artifactId="art-1" sessionId="ses-1" />);

    fireEvent.click(screen.getByRole('button', { name: '下载 report.pdf' }));

    await waitFor(() => {
      expect(downloadFromSession).toHaveBeenCalledWith('token-1', 'ses-1', 'art-1');
    });
    // ↓ 回归防线：改回 get() 会立刻失败。
    expect(get).not.toHaveBeenCalled();
  });

  it('下载成功后回到 idle、不显示错误', async () => {
    render(<MediaFileCard fileName="report.pdf" artifactId="art-1" sessionId="ses-1" />);

    fireEvent.click(screen.getByRole('button', { name: '下载 report.pdf' }));

    await waitFor(() => {
      expect(downloadFromSession).toHaveBeenCalled();
    });
    expect(screen.queryByText('下载失败，请重试')).toBeNull();
  });

  it('下载交给统一导出器（桌面端才能弹原生保存对话框），并带上文件名', async () => {
    render(<MediaFileCard fileName="report.pdf" artifactId="art-1" sessionId="ses-1" />);

    fireEvent.click(screen.getByRole('button', { name: '下载 report.pdf' }));

    await waitFor(() => {
      expect(exportFile).toHaveBeenCalledTimes(1);
    });
    const arg = exportFile.mock.calls[0]?.[0] as { blob: Blob; filename: string };
    expect(arg.filename).toBe('report.pdf');
    expect(arg.blob).toBeInstanceOf(Blob);
  });

  it('用户在原生保存对话框取消（cancelled）不算失败', async () => {
    exportFile.mockResolvedValue({ kind: 'cancelled' });

    render(<MediaFileCard fileName="report.pdf" artifactId="art-1" sessionId="ses-1" />);
    fireEvent.click(screen.getByRole('button', { name: '下载 report.pdf' }));

    await waitFor(() => {
      expect(exportFile).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('下载失败，请重试')).toBeNull();
    // 按钮回到可再次点击的 idle 态（loading 时显示「…」）。
    expect(screen.getByRole('button', { name: '下载 report.pdf' }).textContent).toBe('↓');
  });

  it('缺 sessionId 时给出错误，且不发注定 404 的请求', async () => {
    render(<MediaFileCard fileName="report.pdf" artifactId="art-1" />);

    fireEvent.click(screen.getByRole('button', { name: '下载 report.pdf' }));

    await waitFor(() => {
      expect(screen.getByText('下载失败，请重试')).toBeTruthy();
    });
    expect(downloadFromSession).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('端点报错时进入错误态', async () => {
    downloadFromSession.mockRejectedValue(new Error('404 not found'));

    render(<MediaFileCard fileName="report.pdf" artifactId="art-1" sessionId="ses-1" />);
    fireEvent.click(screen.getByRole('button', { name: '下载 report.pdf' }));

    await waitFor(() => {
      expect(screen.getByText('下载失败，请重试')).toBeTruthy();
    });
  });

  it('未判定出类型的文件也能渲染（回落 FILE 徽章）', () => {
    render(<MediaFileCard fileName="LICENSE" artifactId="art-2" sessionId="ses-1" />);

    expect(screen.getByText('FILE')).toBeTruthy();
    expect(screen.getByText('LICENSE')).toBeTruthy();
  });

  it('PDF 卡片带预览按钮，且**未点击前不发起取流**（PDF 可能几十 MB，必须懒加载）', () => {
    render(<MediaFileCard fileName="report.pdf" artifactId="art-1" sessionId="ses-1" />);

    expect(screen.getByRole('button', { name: '预览 report.pdf' })).toBeTruthy();
    expect(downloadFromSession).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pdf-preview')).toBeNull();
  });

  it('点「预览」才开始取流，就绪后渲染 PDF 预览，再点可收起', async () => {
    render(<MediaFileCard fileName="report.pdf" artifactId="art-1" sessionId="ses-1" />);

    fireEvent.click(screen.getByRole('button', { name: '预览 report.pdf' }));

    await waitFor(() => {
      expect(downloadFromSession).toHaveBeenCalledWith('token-1', 'ses-1', 'art-1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('pdf-preview')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '收起 report.pdf 预览' }));
    expect(screen.queryByTestId('pdf-preview')).toBeNull();
  });

  it('非 PDF 不给预览按钮（本期只有 pdfjs 这一条预览能力）', () => {
    render(<MediaFileCard fileName="bundle.zip" artifactId="art-2" sessionId="ses-1" />);

    expect(screen.queryByRole('button', { name: /预览/ })).toBeNull();
  });

  it('缺 sessionId 时不给预览按钮（取不到内容，按钮只会变成假承诺）', () => {
    render(<MediaFileCard fileName="report.pdf" artifactId="art-1" />);

    expect(screen.queryByRole('button', { name: /预览/ })).toBeNull();
  });

  it('预览取流失败时给出错误与重试，而不是空白面板', async () => {
    downloadFromSession.mockRejectedValue(new Error('404 not found'));

    render(<MediaFileCard fileName="report.pdf" artifactId="art-1" sessionId="ses-1" />);
    fireEvent.click(screen.getByRole('button', { name: '预览 report.pdf' }));

    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeTruthy();
    });
    expect(screen.queryByTestId('pdf-preview')).toBeNull();
  });
});
