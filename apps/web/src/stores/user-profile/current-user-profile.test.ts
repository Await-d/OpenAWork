// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../auth/auth.js';

const mocks = vi.hoisted(() => ({
  createSettingsClient: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createSettingsClient: mocks.createSettingsClient,
}));

import {
  useCurrentUserDisplayName,
  useCurrentUserProfileBootstrap,
  useCurrentUserProfileStore,
} from './current-user-profile.js';

function resetAuthState(input?: {
  accessToken?: string | null;
  email?: string | null;
  gatewayUrl?: string;
}): void {
  useAuthStore.setState({
    accessToken: input?.accessToken ?? null,
    email: input?.email ?? null,
    gatewayUrl: input?.gatewayUrl ?? 'https://gw-a.test',
    refreshToken: null,
    tokenExpiresAt: null,
    webAccessEnabled: false,
    webExposeLan: false,
    webPort: 3000,
  });
}

function resetCurrentUserProfileState(): void {
  useCurrentUserProfileStore.setState({
    email: null,
    gatewayUrl: null,
    nickname: null,
    syncStatus: 'idle',
    errorMessage: null,
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.persist.clearStorage();
  useCurrentUserProfileStore.persist.clearStorage();
  mocks.createSettingsClient.mockReset();
  resetAuthState();
  resetCurrentUserProfileState();
});

afterEach(() => {
  localStorage.clear();
  useAuthStore.persist.clearStorage();
  useCurrentUserProfileStore.persist.clearStorage();
  mocks.createSettingsClient.mockReset();
  resetAuthState();
  resetCurrentUserProfileState();
});

describe('useCurrentUserProfileStore', () => {
  it('store 与当前登录身份不匹配时，展示名会回退为当前邮箱', () => {
    resetAuthState({
      accessToken: 'token-b',
      email: 'user-b@example.com',
      gatewayUrl: 'https://gw-b.test',
    });
    useCurrentUserProfileStore.setState({
      email: 'user-a@example.com',
      gatewayUrl: 'https://gw-a.test',
      nickname: '旧昵称',
      syncStatus: 'synced',
      errorMessage: null,
    });

    const { result } = renderHook(() => useCurrentUserDisplayName());

    expect(result.current).toBe('user-b@example.com');
  });

  it('切换账号时会继续为新账号拉取昵称，而不是卡在旧请求上', async () => {
    const firstLoad = createDeferred<{
      email: string;
      nickname: string | null;
      displayName: string;
    }>();
    const secondLoad = createDeferred<{
      email: string;
      nickname: string | null;
      displayName: string;
    }>();

    mocks.createSettingsClient.mockImplementation((baseUrl: string) => ({
      getProfile: vi.fn(() => {
        if (baseUrl === 'https://gw-a.test') {
          return firstLoad.promise;
        }
        if (baseUrl === 'https://gw-b.test') {
          return secondLoad.promise;
        }
        throw new Error(`unexpected baseUrl: ${baseUrl}`);
      }),
      putProfile: vi.fn(),
    }));

    resetAuthState({
      accessToken: 'token-a',
      email: 'user-a@example.com',
      gatewayUrl: 'https://gw-a.test',
    });
    const pendingFirst = useCurrentUserProfileStore.getState().ensureLoaded();

    resetAuthState({
      accessToken: 'token-b',
      email: 'user-b@example.com',
      gatewayUrl: 'https://gw-b.test',
    });
    const pendingSecond = useCurrentUserProfileStore.getState().ensureLoaded();

    expect(mocks.createSettingsClient).toHaveBeenCalledTimes(2);
    expect(mocks.createSettingsClient).toHaveBeenNthCalledWith(1, 'https://gw-a.test');
    expect(mocks.createSettingsClient).toHaveBeenNthCalledWith(2, 'https://gw-b.test');

    secondLoad.resolve({
      email: 'user-b@example.com',
      nickname: '林雾',
      displayName: '林雾',
    });
    firstLoad.resolve({
      email: 'user-a@example.com',
      nickname: '旧昵称',
      displayName: '旧昵称',
    });

    await Promise.all([pendingFirst, pendingSecond]);

    expect(useCurrentUserProfileStore.getState()).toMatchObject({
      email: 'user-b@example.com',
      gatewayUrl: 'https://gw-b.test',
      nickname: '林雾',
      syncStatus: 'synced',
      errorMessage: null,
    });
  });

  it('切换资料作用域后会立刻清空旧昵称，失败时继续回退邮箱', async () => {
    const nextLoad = createDeferred<{
      email: string;
      nickname: string | null;
      displayName: string;
    }>();

    mocks.createSettingsClient.mockImplementation(() => ({
      getProfile: vi.fn(() => nextLoad.promise),
      putProfile: vi.fn(),
    }));

    resetAuthState({
      accessToken: 'token-a',
      email: 'user-a@example.com',
      gatewayUrl: 'https://gw-a.test',
    });
    useCurrentUserProfileStore.setState({
      email: 'user-a@example.com',
      gatewayUrl: 'https://gw-a.test',
      nickname: '旧昵称',
      syncStatus: 'synced',
      errorMessage: null,
    });

    resetAuthState({
      accessToken: 'token-b',
      email: 'user-b@example.com',
      gatewayUrl: 'https://gw-b.test',
    });
    const pendingLoad = useCurrentUserProfileStore.getState().ensureLoaded();

    expect(useCurrentUserProfileStore.getState()).toMatchObject({
      email: 'user-b@example.com',
      gatewayUrl: 'https://gw-b.test',
      nickname: null,
      syncStatus: 'loading',
      errorMessage: null,
    });

    nextLoad.reject(new Error('昵称接口异常'));
    await pendingLoad;

    expect(useCurrentUserProfileStore.getState()).toMatchObject({
      email: 'user-b@example.com',
      gatewayUrl: 'https://gw-b.test',
      nickname: null,
      syncStatus: 'error',
      errorMessage: '昵称接口异常',
    });
  });

  it('同一账号切换网关地址时会重新读取对应网关上的昵称', async () => {
    mocks.createSettingsClient.mockImplementation((baseUrl: string) => ({
      getProfile: vi.fn(async () => {
        if (baseUrl === 'https://gw-a.test') {
          return {
            email: 'same-user@example.com',
            nickname: '旧网关昵称',
            displayName: '旧网关昵称',
          };
        }
        if (baseUrl === 'https://gw-b.test') {
          return {
            email: 'same-user@example.com',
            nickname: '新网关昵称',
            displayName: '新网关昵称',
          };
        }
        throw new Error(`unexpected baseUrl: ${baseUrl}`);
      }),
      putProfile: vi.fn(),
    }));

    resetAuthState({
      accessToken: 'token-a',
      email: 'same-user@example.com',
      gatewayUrl: 'https://gw-a.test',
    });
    await useCurrentUserProfileStore.getState().ensureLoaded();

    resetAuthState({
      accessToken: 'token-b',
      email: 'same-user@example.com',
      gatewayUrl: 'https://gw-b.test',
    });
    await useCurrentUserProfileStore.getState().ensureLoaded();

    expect(mocks.createSettingsClient).toHaveBeenCalledTimes(2);
    expect(useCurrentUserProfileStore.getState()).toMatchObject({
      email: 'same-user@example.com',
      gatewayUrl: 'https://gw-b.test',
      nickname: '新网关昵称',
      syncStatus: 'synced',
      errorMessage: null,
    });
  });

  it('bootstrap 会在 gateway 变化时重新读取昵称', async () => {
    mocks.createSettingsClient.mockImplementation((baseUrl: string) => ({
      getProfile: vi.fn(async () => ({
        email: 'same-user@example.com',
        nickname: baseUrl === 'https://gw-a.test' ? '旧网关昵称' : '新网关昵称',
        displayName: baseUrl === 'https://gw-a.test' ? '旧网关昵称' : '新网关昵称',
      })),
      putProfile: vi.fn(),
    }));

    resetAuthState({
      accessToken: 'token-a',
      email: 'same-user@example.com',
      gatewayUrl: 'https://gw-a.test',
    });

    renderHook(() => useCurrentUserProfileBootstrap(true));

    await waitFor(() => {
      expect(useCurrentUserProfileStore.getState()).toMatchObject({
        email: 'same-user@example.com',
        gatewayUrl: 'https://gw-a.test',
        nickname: '旧网关昵称',
        syncStatus: 'synced',
      });
    });

    act(() => {
      resetAuthState({
        accessToken: 'token-b',
        email: 'same-user@example.com',
        gatewayUrl: 'https://gw-b.test',
      });
    });

    await waitFor(() => {
      expect(useCurrentUserProfileStore.getState()).toMatchObject({
        email: 'same-user@example.com',
        gatewayUrl: 'https://gw-b.test',
        nickname: '新网关昵称',
        syncStatus: 'synced',
      });
    });

    expect(mocks.createSettingsClient).toHaveBeenNthCalledWith(1, 'https://gw-a.test');
    expect(mocks.createSettingsClient).toHaveBeenNthCalledWith(2, 'https://gw-b.test');
  });
});
