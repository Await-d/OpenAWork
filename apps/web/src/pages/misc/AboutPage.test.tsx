// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = {
  accessToken: 'token-test',
  gatewayUrl: 'https://gateway.test',
};

const mocks = vi.hoisted(() => ({
  createSettingsClient: vi.fn(),
  getVersion: vi.fn(),
  checkForUpdate: vi.fn(),
  downloadAndInstallProxyUpdate: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  restartDesktopApp: vi.fn(),
  stopDesktopGateway: vi.fn(),
  tauriInvoke: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createSettingsClient: mocks.createSettingsClient,
}));

vi.mock('@openAwork/shared-ui', () => ({
  BrandLogo: () => null,
}));

vi.mock('../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

vi.mock('../../components/common/feedback/ToastNotification.js', () => ({
  toast: mocks.toast,
}));

vi.mock('../settings/shared/settings-page-helpers.js', () => ({
  isTauri: true,
  tauriInvoke: mocks.tauriInvoke,
}));

vi.mock('../../../../desktop/src/updater/auto-update.js', () => ({
  checkForUpdate: mocks.checkForUpdate,
  clearProxyCache: vi.fn(),
  downloadUpdate: mocks.downloadUpdate,
  installUpdate: mocks.installUpdate,
  toUpdateError: (error: unknown) => error,
  UpdateError: class UpdateError extends Error {
    kind: string;

    constructor(kind: string, message: string) {
      super(message);
      this.kind = kind;
    }
  },
}));

vi.mock('../../../../desktop/src/updater/proxy-update.js', () => ({
  downloadAndInstallProxyUpdate: mocks.downloadAndInstallProxyUpdate,
}));

vi.mock('../../../../desktop/src/utils/tauri-gateway.js', () => ({
  restartDesktopApp: mocks.restartDesktopApp,
  stopDesktopGateway: mocks.stopDesktopGateway,
}));

import AboutPage from './AboutPage.js';

describe('AboutPage 桌面端更新入口', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '0.8.6');
    vi.stubGlobal('__APP_BUILD_VERSION__', '20260724.1');
    vi.stubGlobal('__APP_BUILD_TIME__', '2026-07-24T10:00:00.000Z');
    vi.stubGlobal('__APP_GIT_HASH__', 'abcdef123456');
    vi.stubGlobal('__APP_GIT_BRANCH__', 'main');
    vi.stubGlobal('__APP_GIT_TAG__', 'desktop-v0.8.6');
    vi.stubGlobal('__APP_REPOSITORY_URL__', 'https://github.com/Await-d/OpenAWork');
    vi.stubGlobal('__APP_RECENT_COMMITS__', []);

    mocks.createSettingsClient.mockReset();
    mocks.getVersion.mockReset();
    mocks.checkForUpdate.mockReset();
    mocks.downloadAndInstallProxyUpdate.mockReset();
    mocks.downloadUpdate.mockReset();
    mocks.installUpdate.mockReset();
    mocks.restartDesktopApp.mockReset();
    mocks.stopDesktopGateway.mockReset();
    mocks.tauriInvoke.mockReset();
    mocks.toast.mockReset();

    mocks.createSettingsClient.mockReturnValue({
      getVersion: mocks.getVersion,
    });
    mocks.getVersion.mockResolvedValue({
      currentVersion: '0.8.6',
      latestVersion: '0.8.7',
      updateAvailable: true,
      checkError: null,
      checkedAt: '2026-07-24T10:00:00.000Z',
      checking: false,
    });
    mocks.checkForUpdate.mockResolvedValue({
      available: true,
      update: null,
      version: '0.9.0',
      notes: '## 更新亮点\n\n- 修复更新显示方案',
      installMode: 'proxy-auto',
      channel: 'preview',
      proxyUsed: { name: 'FastGit', prefix: 'https://proxy.example/' },
      proxiedDownloadUrl: 'https://proxy.example/release.exe',
    });
    mocks.tauriInvoke.mockResolvedValue('preview');
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('点击检查更新时在关于页内显示桌面更新详情并刷新版本状态', async () => {
    render(<AboutPage />);

    await waitFor(() => {
      expect(mocks.createSettingsClient).toHaveBeenCalledWith('https://gateway.test');
      expect(mocks.getVersion).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => {
      expect(mocks.checkForUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.getVersion).toHaveBeenCalledTimes(2);
      expect(screen.getByText('桌面端更新')).toBeTruthy();
      expect(screen.getByText('发现新版本 0.9.0（通过 FastGit 加速）。')).toBeTruthy();
    });
  });

  it('页内更新检查失败时显示错误信息而不跳 GitHub', async () => {
    mocks.checkForUpdate.mockRejectedValueOnce({
      kind: 'network',
      message: 'desktop bridge failed',
    });

    render(<AboutPage />);

    await waitFor(() => {
      expect(mocks.getVersion).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => {
      expect(screen.getByText('连接失败')).toBeTruthy();
      expect(screen.getByText('desktop bridge failed')).toBeTruthy();
      expect(window.open).not.toHaveBeenCalled();
    });
  });

  it('下载过程中显示取消下载并允许恢复到可重新下载状态', async () => {
    let resolveDownload: (() => void) | null = null;
    mocks.downloadAndInstallProxyUpdate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        }),
    );

    render(<AboutPage />);

    await waitFor(() => {
      expect(mocks.getVersion).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '下载更新 v0.9.0' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '下载更新 v0.9.0' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '取消下载' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '取消下载' }));
    resolveDownload!();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '下载更新 v0.9.0' })).toBeTruthy();
    });
  });
});
