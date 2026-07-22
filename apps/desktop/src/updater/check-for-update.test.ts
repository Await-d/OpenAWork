import { afterEach, describe, expect, it, vi } from 'vitest';
import { check } from '@tauri-apps/plugin-updater';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

import { checkForUpdate } from './auto-update.js';

const originalFetch = globalThis.fetch;
const navigatorPlatformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'platform');
const originalNavigatorPlatform =
  typeof navigatorPlatformDescriptor?.value === 'string'
    ? navigatorPlatformDescriptor.value
    : 'Win32';

function previewJsonResponse(platformKey: string, downloadUrl: string): Response {
  return new Response(
    JSON.stringify({
      version: '0.7.0',
      notes: 'preview update',
      platforms: {
        [platformKey]: {
          signature: 'signature',
          url: downloadUrl,
        },
      },
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    },
  );
}

describe('checkForUpdate', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mocks.invoke.mockReset();
    Object.defineProperty(window.navigator, 'platform', {
      value: originalNavigatorPlatform,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('原生检查失败且稳定 latest.json 不存在时，仍可通过 preview 端点完成代理回退检查', async () => {
    vi.mocked(check).mockRejectedValueOnce(new Error('network unreachable'));
    mocks.invoke
      .mockResolvedValueOnce('preview') // detectChannel()
      .mockResolvedValueOnce('windows-x86_64'); // getCurrentPlatformKey()
    Object.defineProperty(window.navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const fetchMock: typeof fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        const method = init?.method ?? 'GET';

        const isProxyPreviewEndpoint =
          url.startsWith('https://ghp.ci/') &&
          url.includes('/releases/download/desktop-latest-preview/latest.json');
        const isProxyStableEndpoint =
          url.startsWith('https://ghp.ci/') &&
          url.includes('/releases/latest/download/latest.json');

        if (method === 'HEAD') {
          if (isProxyPreviewEndpoint) {
            return new Response(null, { status: 200 });
          }
          if (isProxyStableEndpoint) {
            return new Response(null, { status: 404 });
          }
          return new Response(null, { status: 404 });
        }

        if (isProxyPreviewEndpoint) {
          return previewJsonResponse(
            'windows-x86_64',
            'https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/OpenAWork_0.7.0_x64-setup.exe',
          );
        }
        return new Response(null, { status: 404 });
      },
    );
    globalThis.fetch = fetchMock;

    const result = await checkForUpdate();

    expect(result.available).toBe(true);
    expect(result.version).toBe('0.7.0');
    expect(result.installMode).toBe('proxy-auto');
    expect(result.proxyUsed?.name).toBe('GHProxy.cn');
    expect(result.proxiedDownloadUrl).toBe(
      'https://ghp.ci/https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/OpenAWork_0.7.0_x64-setup.exe',
    );
  });

  it('代理回退检查在 Intel macOS 上使用 darwin-x86_64 平台键', async () => {
    vi.mocked(check).mockRejectedValueOnce(new Error('network unreachable'));
    mocks.invoke
      .mockResolvedValueOnce('preview') // detectChannel()
      .mockResolvedValueOnce('darwin-x86_64'); // getCurrentPlatformKey()

    const fetchMock: typeof fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        const method = init?.method ?? 'GET';

        const isProxyPreviewEndpoint =
          url.startsWith('https://ghp.ci/') &&
          url.includes('/releases/download/desktop-latest-preview/latest.json');

        if (method === 'HEAD') {
          return new Response(null, { status: isProxyPreviewEndpoint ? 200 : 404 });
        }

        if (isProxyPreviewEndpoint) {
          return previewJsonResponse(
            'darwin-x86_64',
            'https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/OpenAWork_0.7.0_x64.dmg',
          );
        }
        return new Response(null, { status: 404 });
      },
    );
    globalThis.fetch = fetchMock;

    const result = await checkForUpdate();

    expect(result.available).toBe(true);
    expect(result.installMode).toBe('proxy-auto');
    expect(result.proxiedDownloadUrl).toBe(
      'https://ghp.ci/https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/OpenAWork_0.7.0_x64.dmg',
    );
  });
});
