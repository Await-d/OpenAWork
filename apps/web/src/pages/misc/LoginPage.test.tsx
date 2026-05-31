// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authStore = {
  accessToken: null as string | null,
  gatewayUrl: 'http://localhost:3000',
  webPort: 3000,
  setAuth: vi.fn(),
  setGatewayUrl: vi.fn(),
  setWebAccess: vi.fn(),
};

const gatewayMocks = vi.hoisted(() => ({
  desktopGatewayModeForUrl: vi.fn(() => 'local'),
  isTauriRuntime: vi.fn(() => true),
  localGatewayUrl: vi.fn((port: number) => `http://127.0.0.1:${port}`),
  normalizeGatewayUrl: vi.fn((value: string) => value.trim().replace(/\/+$/, '')),
  parseGatewayPort: vi.fn((value: string, fallback: number) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }),
  readDesktopGatewayMode: vi.fn(() => 'local'),
  readGatewayPortFromUrl: vi.fn(() => 3000),
  startDesktopGateway: vi.fn(async () => undefined),
  stopDesktopGateway: vi.fn(async () => undefined),
  waitForGatewayHealth: vi.fn(async () => false),
  writeDesktopGatewayMode: vi.fn(),
}));

vi.mock('../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (state: typeof authStore) => unknown) => selector(authStore),
}));

vi.mock('react-router', () => ({
  Navigate: () => null,
  useNavigate: () => vi.fn(),
}));

vi.mock('../../routes/preloadable-route-modules.js', () => ({
  preloadRouteModuleByPath: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  login: vi.fn(),
}));

vi.mock('../../utils/gateway/desktop-gateway.js', () => ({
  DEFAULT_GATEWAY_PORT: 3000,
  desktopGatewayModeForUrl: gatewayMocks.desktopGatewayModeForUrl,
  isTauriRuntime: gatewayMocks.isTauriRuntime,
  localGatewayUrl: gatewayMocks.localGatewayUrl,
  normalizeGatewayUrl: gatewayMocks.normalizeGatewayUrl,
  parseGatewayPort: gatewayMocks.parseGatewayPort,
  readDesktopGatewayMode: gatewayMocks.readDesktopGatewayMode,
  readGatewayPortFromUrl: gatewayMocks.readGatewayPortFromUrl,
  startDesktopGateway: gatewayMocks.startDesktopGateway,
  stopDesktopGateway: gatewayMocks.stopDesktopGateway,
  waitForGatewayHealth: gatewayMocks.waitForGatewayHealth,
  writeDesktopGatewayMode: gatewayMocks.writeDesktopGatewayMode,
}));

import LoginPage from './LoginPage.js';

beforeEach(() => {
  authStore.accessToken = null;
  authStore.gatewayUrl = 'http://localhost:3000';
  authStore.webPort = 3000;
  authStore.setAuth.mockReset();
  authStore.setGatewayUrl.mockReset();
  authStore.setWebAccess.mockReset();
  gatewayMocks.desktopGatewayModeForUrl.mockReset().mockReturnValue('local');
  gatewayMocks.isTauriRuntime.mockReset().mockReturnValue(true);
  gatewayMocks.localGatewayUrl.mockReset().mockImplementation((port: number) => `http://127.0.0.1:${port}`);
  gatewayMocks.normalizeGatewayUrl.mockReset().mockImplementation((value: string) => value.trim().replace(/\/+$/, ''));
  gatewayMocks.parseGatewayPort.mockReset().mockImplementation((value: string, fallback: number) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  });
  gatewayMocks.readDesktopGatewayMode.mockReset().mockReturnValue('local');
  gatewayMocks.readGatewayPortFromUrl.mockReset().mockReturnValue(3000);
  gatewayMocks.startDesktopGateway.mockReset().mockResolvedValue(undefined);
  gatewayMocks.stopDesktopGateway.mockReset().mockResolvedValue(undefined);
  gatewayMocks.waitForGatewayHealth.mockReset().mockResolvedValue(false);
  gatewayMocks.writeDesktopGatewayMode.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginPage', () => {
  it('本地服务端健康检查失败时展示错误信息', async () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: '服务器设置' }));
    fireEvent.click(screen.getByRole('button', { name: '使用本地服务端' }));

    await waitFor(() => {
      expect(screen.getByText('本地服务端已启动，但健康检查暂未通过。')).toBeTruthy();
    });
  });
});
