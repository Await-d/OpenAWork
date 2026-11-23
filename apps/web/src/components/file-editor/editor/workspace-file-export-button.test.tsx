// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@openAwork/web-client';
import { WorkspaceFileExportButton } from './workspace-file-export-button.js';

const mocks = vi.hoisted(() => ({
  readFileBinary: vi.fn(),
  exportFile: vi.fn(),
  toast: vi.fn(),
  identity: { sessionId: null, sshConnectionId: null, remote: false } as {
    sessionId: string | null;
    sshConnectionId: string | null;
    remote: boolean;
  },
}));

vi.mock('@openAwork/web-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openAwork/web-client')>()),
  createWorkspaceClient: () => ({ readFileBinary: mocks.readFileBinary }),
}));
vi.mock('../../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (state: { gatewayUrl: string; accessToken: string }) => unknown) =>
    selector({ gatewayUrl: 'http://gateway.test', accessToken: 'token' }),
}));
vi.mock('../../../stores/ui/uiState.js', () => ({
  useWorkspaceReadIdentity: () => mocks.identity,
}));
vi.mock('../../../utils/export-file.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/export-file.js')>()),
  exportFile: mocks.exportFile,
}));
vi.mock('../../common/feedback/ToastNotification.js', () => ({ toast: mocks.toast }));

const ROOT = '/workspace';
const PATH = `${ROOT}/report.pdf`;
const data = { buffer: new Uint8Array([0, 127, 255]).buffer, contentType: 'application/pdf' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity = { sessionId: null, sshConnectionId: null, remote: false };
  mocks.readFileBinary.mockResolvedValue(data);
  mocks.exportFile.mockResolvedValue({ kind: 'browser' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkspaceFileExportButton', () => {
  it('点击才读取保存后的原文件，并将相同字节交给导出器', async () => {
    render(<WorkspaceFileExportButton path={PATH} workspaceRoot={ROOT} />);
    expect(mocks.readFileBinary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '下载' }));

    expect(mocks.readFileBinary).toHaveBeenCalledWith('token', PATH, {
      workspaceRoot: ROOT,
      signal: expect.any(AbortSignal),
    });
    await waitFor(() => expect(mocks.exportFile).toHaveBeenCalledOnce());
    const { blob, filename } = mocks.exportFile.mock.calls[0]?.[0] as {
      blob: Blob;
      filename: string;
    };
    expect(filename).toBe('report.pdf');
    expect(blob.type).toBe('application/pdf');
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) resolve(reader.result);
        else reject(new Error('未读取到文件字节'));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array(data.buffer));
  });

  it('桌面端显示另存为，保留 SSH 会话身份，取消保存不显示错误', async () => {
    vi.stubGlobal('__TAURI__', { core: { invoke: vi.fn() } });
    mocks.identity = { sessionId: 'ssh-session', sshConnectionId: null, remote: true };
    mocks.exportFile.mockResolvedValue({ kind: 'cancelled' });
    render(<WorkspaceFileExportButton path={PATH} workspaceRoot={ROOT} />);
    fireEvent.click(screen.getByRole('button', { name: '另存为' }));

    expect(mocks.readFileBinary).toHaveBeenCalledWith('token', PATH, {
      workspaceRoot: ROOT,
      sessionId: 'ssh-session',
      signal: expect.any(AbortSignal),
    });
    await screen.findByRole('button', { name: '另存为' });
    expect(mocks.exportFile).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('读取失败时不导出，并允许重试', async () => {
    mocks.readFileBinary.mockRejectedValueOnce(new Error('无权读取文件'));
    render(<WorkspaceFileExportButton path={PATH} workspaceRoot={ROOT} />);
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    await screen.findByRole('button', { name: '下载' });
    expect(mocks.exportFile).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('无权读取文件', 'error');
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    await waitFor(() => expect(mocks.exportFile).toHaveBeenCalledOnce());
  });

  it('仅在跨主机路径不兼容时改用 SSH 连接身份读取', async () => {
    mocks.identity = { sessionId: 'ssh-session', sshConnectionId: 'ssh-connection', remote: true };
    mocks.readFileBinary.mockRejectedValueOnce(new HttpError('无法访问 POSIX 路径', 400));
    render(<WorkspaceFileExportButton path={PATH} workspaceRoot={ROOT} />);
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    await waitFor(() => expect(mocks.exportFile).toHaveBeenCalledOnce());
    expect(mocks.readFileBinary).toHaveBeenCalledTimes(2);
    expect(mocks.readFileBinary).toHaveBeenLastCalledWith('token', PATH, {
      workspaceRoot: ROOT,
      sshConnectionId: 'ssh-connection',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([403, 413])('读取返回 %i 时不会改用其他身份或导出', async (status) => {
    mocks.identity = { sessionId: 'ssh-session', sshConnectionId: 'ssh-connection', remote: true };
    mocks.readFileBinary.mockRejectedValueOnce(new HttpError('无法访问路径', status));
    render(<WorkspaceFileExportButton path={PATH} workspaceRoot={ROOT} />);
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    await screen.findByRole('button', { name: '下载' });
    expect(mocks.readFileBinary).toHaveBeenCalledOnce();
    expect(mocks.exportFile).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      status === 413 ? '文件超过 10 MiB，无法从文件编辑器导出。' : '无法访问路径',
      'error',
    );
  });

  it('相同路径切换会话后丢弃旧响应，并恢复按钮', async () => {
    let complete: ((value: typeof data) => void) | undefined;
    mocks.readFileBinary.mockImplementationOnce(
      () =>
        new Promise<typeof data>((resolve) => {
          complete = resolve;
        }),
    );
    mocks.identity = { sessionId: 'first', sshConnectionId: null, remote: false };
    const { rerender } = render(<WorkspaceFileExportButton path={PATH} workspaceRoot={ROOT} />);
    fireEvent.click(screen.getByRole('button', { name: '下载' }));

    mocks.identity = { sessionId: 'second', sshConnectionId: null, remote: false };
    rerender(<WorkspaceFileExportButton path={PATH} workspaceRoot={ROOT} />);
    await act(async () => complete?.(data));

    expect(mocks.exportFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    await waitFor(() => expect(mocks.exportFile).toHaveBeenCalledOnce());
    expect(mocks.readFileBinary).toHaveBeenLastCalledWith('token', PATH, {
      workspaceRoot: ROOT,
      sessionId: 'second',
      signal: expect.any(AbortSignal),
    });
  });
});
