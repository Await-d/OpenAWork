// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'auth-store';

/** 复现历史脏数据:指定 gatewayUrl 的持久化快照。 */
function persistedState(gatewayUrl: string): string {
  return JSON.stringify({
    state: {
      accessToken: 'token',
      refreshToken: 'refresh',
      tokenExpiresAt: null,
      email: 'admin@openAwork.local',
      gatewayUrl,
      webAccessEnabled: false,
      webPort: 3000,
      webExposeLan: false,
      customBaseUrl: '',
    },
    version: 0,
  });
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
});

describe('useAuthStore 的网关地址', () => {
  it('空字符串写入时回落到默认地址(否则相对 baseUrl 会打到前端自身)', async () => {
    const { useAuthStore } = await import('./auth.js');

    useAuthStore.getState().setGatewayUrl('http://gateway.test:3000');
    useAuthStore.getState().setGatewayUrl('');

    expect(useAuthStore.getState().gatewayUrl).toBe('http://localhost:3000');
  });

  it('仅空白的写入同样回落到默认地址', async () => {
    const { useAuthStore } = await import('./auth.js');

    useAuthStore.getState().setGatewayUrl('   ');

    expect(useAuthStore.getState().gatewayUrl).toBe('http://localhost:3000');
  });

  it('合法地址写入时去掉尾部斜杠', async () => {
    const { useAuthStore } = await import('./auth.js');

    useAuthStore.getState().setGatewayUrl('http://gateway.test:8080///');

    expect(useAuthStore.getState().gatewayUrl).toBe('http://gateway.test:8080');
  });

  it('rehydrate 时把历史遗留的空网关地址就地修复', async () => {
    window.localStorage.setItem(STORAGE_KEY, persistedState(''));

    const { useAuthStore } = await import('./auth.js');

    expect(useAuthStore.getState().gatewayUrl).toBe('http://localhost:3000');
    expect(useAuthStore.getState().accessToken).toBe('token');
  });

  it('rehydrate 时把旧版同源推断留下的「页面自身来源」脏值修复', async () => {
    // jsdom 的 location.origin 为 http://localhost;旧版逻辑会把 dev server 端口(如
    // 5180)当成网关地址持久化,导致 /usage、/dev-logs 全部落到 SPA 兜底。
    window.localStorage.setItem(STORAGE_KEY, persistedState(window.location.origin));

    const { useAuthStore } = await import('./auth.js');

    expect(useAuthStore.getState().gatewayUrl).toBe('http://localhost:3000');
  });

  it('rehydrate 不会改写非空且非页面来源的自定义网关地址', async () => {
    window.localStorage.setItem(STORAGE_KEY, persistedState('http://gateway.test:8080'));

    const { useAuthStore } = await import('./auth.js');

    expect(useAuthStore.getState().gatewayUrl).toBe('http://gateway.test:8080');
  });
});
