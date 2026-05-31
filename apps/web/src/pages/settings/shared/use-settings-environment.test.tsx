// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateDesktopGateway: vi.fn(),
  createSettingsClient: vi.fn(() => ({
    getVersion: vi.fn(),
  })),
  desktopGatewayModeForUrl: vi.fn((url: string) =>
    url.startsWith('http://127.0.0.1') ? 'local' : 'remote',
  ),
  isLocalGatewayUrl: vi.fn((url: string) => url.startsWith('http://127.0.0.1')),
  isTauriRuntime: vi.fn(() => true),
  localGatewayUrl: vi.fn((port: number) => `http://127.0.0.1:${port}`),
  login: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  normalizeGatewayUrl: vi.fn((value: string) => value.trim().replace(/\/+$/, '')),
  parseGatewayPort: vi.fn((value: string, fallback: number) => {
    const port = Number.parseInt(value, 10);
    return Number.isFinite(port) ? port : fallback;
  }),
  readGatewayPortFromUrl: vi.fn(() => 3000),
  tauriInvoke: vi.fn(async () => undefined),
  waitForGatewayHealth: vi.fn(async () => true),
  writeDesktopGatewayMode: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createSettingsClient: mocks.createSettingsClient,
  login: mocks.login,
}));

vi.mock('../../../utils/log/logger.js', () => ({
  logger: {
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
  },
}));

vi.mock('../../../utils/gateway/desktop-gateway.js', () => ({
  authenticateDesktopGateway: mocks.authenticateDesktopGateway,
  DESKTOP_DEFAULT_EMAIL: 'admin@openAwork.local',
  desktopGatewayModeForUrl: mocks.desktopGatewayModeForUrl,
  isLocalGatewayUrl: mocks.isLocalGatewayUrl,
  isTauriRuntime: mocks.isTauriRuntime,
  localGatewayUrl: mocks.localGatewayUrl,
  normalizeGatewayUrl: mocks.normalizeGatewayUrl,
  parseGatewayPort: mocks.parseGatewayPort,
  readGatewayPortFromUrl: mocks.readGatewayPortFromUrl,
  waitForGatewayHealth: mocks.waitForGatewayHealth,
  writeDesktopGatewayMode: mocks.writeDesktopGatewayMode,
}));

vi.mock('./settings-page-helpers.js', () => ({
  tauriInvoke: mocks.tauriInvoke,
}));

import { useSettingsEnvironment } from './use-settings-environment.js';

afterEach(() => {
  vi.restoreAllMocks();
  mocks.createSettingsClient.mockClear();
  mocks.login.mockClear();
  mocks.authenticateDesktopGateway.mockClear();
  mocks.desktopGatewayModeForUrl.mockClear();
  mocks.isLocalGatewayUrl.mockClear();
  mocks.isTauriRuntime.mockClear();
  mocks.localGatewayUrl.mockClear();
  mocks.normalizeGatewayUrl.mockClear();
  mocks.parseGatewayPort.mockClear();
  mocks.readGatewayPortFromUrl.mockClear();
  mocks.tauriInvoke.mockClear();
  mocks.waitForGatewayHealth.mockClear();
  mocks.writeDesktopGatewayMode.mockClear();
  mocks.loggerError.mockClear();
  mocks.loggerWarn.mockClear();
});

describe('useSettingsEnvironment', () => {
  it('saveGatewayUrl 在远程密码缺失时设置中文错误', async () => {
    const { result } = renderHook(() =>
      useSettingsEnvironment({
        gatewayUrl: 'http://127.0.0.1:3000',
        setGatewayUrl: vi.fn(),
        setAuth: vi.fn(),
        token: 'token-1',
        webAccessEnabled: false,
        webPort: 3000,
        webExposeLan: false,
        setWebAccess: vi.fn(),
      }),
    );

    act(() => {
      result.current.setUrlInput('https://remote.example.com');
    });

    await act(async () => {
      await result.current.saveGatewayUrl();
    });

    await waitFor(() => {
      expect(result.current.desktopGatewayError).toBe('请填写远程网关管理员邮箱和密码。');
    });
  });

  it('toggleWebAccess 在远程地址无效时设置中文错误', async () => {
    const { result } = renderHook(() =>
      useSettingsEnvironment({
        gatewayUrl: 'http://127.0.0.1:3000',
        setGatewayUrl: vi.fn(),
        setAuth: vi.fn(),
        token: 'token-1',
        webAccessEnabled: true,
        webPort: 3000,
        webExposeLan: false,
        setWebAccess: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.toggleWebAccess();
    });

    await waitFor(() => {
      expect(result.current.desktopGatewayError).toBe(
        '请先在上方填写远程网关地址，再切换到远程网关。',
      );
    });
  });
});
