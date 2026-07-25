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
  openDesktopUpdatePanel: vi.fn(),
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

vi.mock('./about-page-desktop-update.js', () => ({
  openDesktopUpdatePanel: mocks.openDesktopUpdatePanel,
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
    mocks.openDesktopUpdatePanel.mockReset();
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
    mocks.openDesktopUpdatePanel.mockResolvedValue(undefined);
    mocks.tauriInvoke.mockResolvedValue('preview');
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('点击检查更新时同时打开桌面更新面板并刷新版本状态', async () => {
    render(<AboutPage />);

    await waitFor(() => {
      expect(mocks.createSettingsClient).toHaveBeenCalledWith('https://gateway.test');
      expect(mocks.getVersion).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => {
      expect(mocks.openDesktopUpdatePanel).toHaveBeenCalledTimes(1);
      expect(mocks.getVersion).toHaveBeenCalledTimes(2);
    });
  });

  it('打开桌面更新面板失败时回退到 GitHub 发布页', async () => {
    mocks.openDesktopUpdatePanel.mockRejectedValueOnce(new Error('desktop bridge failed'));

    render(<AboutPage />);

    await waitFor(() => {
      expect(mocks.getVersion).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => {
      expect(window.open).toHaveBeenCalledWith(
        'https://github.com/Await-d/OpenAWork/releases',
        '_blank',
        'noopener,noreferrer',
      );
    });
  });
});
