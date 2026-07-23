import { afterEach, describe, expect, it, vi } from 'vitest';
import { check } from '@tauri-apps/plugin-updater';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getVersion: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: mocks.getVersion,
}));

import {
  checkForUpdate,
  ensureProxiedDownloadUrl,
  isNewerVersion,
  toUpdateError,
} from './auto-update.js';

const originalFetch = globalThis.fetch;
const navigatorPlatformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'platform');
const originalNavigatorPlatform =
  typeof navigatorPlatformDescriptor?.value === 'string'
    ? navigatorPlatformDescriptor.value
    : 'Win32';

function previewJsonResponse(
  platformKey: string,
  downloadUrl: string,
  version = '0.7.0',
): Response {
  return new Response(
    JSON.stringify({
      version,
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
    mocks.getVersion.mockReset();
    Object.defineProperty(window.navigator, 'platform', {
      value: originalNavigatorPlatform,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('原生检查失败且稳定 latest.json 不存在时，仍可通过 preview 端点完成代理回退检查', async () => {
    vi.mocked(check).mockRejectedValueOnce(new Error('network unreachable'));
    mocks.getVersion.mockResolvedValueOnce('0.6.9');
    mocks.invoke
      .mockResolvedValueOnce('preview') // detectChannel()
      .mockResolvedValueOnce('windows-x86_64'); // getCurrentPlatformKey()
    Object.defineProperty(window.navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const fetchMock: typeof fetch = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);

        const proxyPrefix = 'https://gh.llkk.cc/';
        const isProxyRequest = url.startsWith(proxyPrefix);
        const isProxyPreviewEndpoint =
          isProxyRequest && url.includes('/releases/download/desktop-latest-preview/latest');

        // Probe + metadata fetch both use GET now (many proxies mishandle HEAD).
        if (isProxyPreviewEndpoint && url.endsWith('latest.json')) {
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
    expect(result.proxyUsed?.name).toBe('GHProxy Fast');
    expect(result.proxiedDownloadUrl).toBe(
      'https://gh.llkk.cc/https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/OpenAWork_0.7.0_x64-setup.exe',
    );
  });

  it('代理回退检查在 Intel macOS 上使用 darwin-x86_64 平台键', async () => {
    vi.mocked(check).mockRejectedValueOnce(new Error('network unreachable'));
    mocks.getVersion.mockResolvedValueOnce('0.6.9');
    mocks.invoke
      .mockResolvedValueOnce('preview') // detectChannel()
      .mockResolvedValueOnce('darwin-x86_64'); // getCurrentPlatformKey()

    const fetchMock: typeof fetch = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);

        const proxyPrefix = 'https://gh.llkk.cc/';
        const isProxyPreviewEndpoint =
          url.startsWith(proxyPrefix) &&
          url.includes('/releases/download/desktop-latest-preview/latest');

        if (isProxyPreviewEndpoint && url.endsWith('latest.json')) {
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
      'https://gh.llkk.cc/https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/OpenAWork_0.7.0_x64.dmg',
    );
  });

  it('代理回退在远端版本不高于当前版本时返回 available=false', async () => {
    vi.mocked(check).mockRejectedValueOnce(new Error('network unreachable'));
    mocks.getVersion.mockResolvedValueOnce('0.7.0');
    mocks.invoke.mockResolvedValueOnce('preview').mockResolvedValueOnce('windows-x86_64');

    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        const isProxyPreviewEndpoint =
          url.startsWith('https://gh.llkk.cc/') &&
          url.includes('/releases/download/desktop-latest-preview/latest');

        if (isProxyPreviewEndpoint && url.endsWith('latest.json')) {
          return previewJsonResponse(
            'windows-x86_64',
            'https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/OpenAWork_0.7.0_x64-setup.exe',
            '0.7.0',
          );
        }
        return new Response(null, { status: 404 });
      },
    ) as typeof fetch;

    const result = await checkForUpdate();
    expect(result.available).toBe(false);
    expect(result.version).toBe('0.7.0');
    expect(result.proxiedDownloadUrl).toBeUndefined();
  });
});

describe('isNewerVersion / ensureProxiedDownloadUrl', () => {
  it('正确比较语义化版本', () => {
    expect(isNewerVersion('0.7.1', '0.7.0')).toBe(true);
    expect(isNewerVersion('0.7.0', '0.7.0')).toBe(false);
    expect(isNewerVersion('0.6.9', '0.7.0')).toBe(false);
    expect(isNewerVersion('v0.8.0', '0.7.9')).toBe(true);
  });

  it('已带代理前缀时不重复拼接；历史 ghp.ci 前缀会被剥离并改走当前代理', () => {
    const proxy = { name: 'GHProxy Fast', prefix: 'https://gh.llkk.cc/' };
    expect(
      ensureProxiedDownloadUrl(
        'https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/a.exe',
        proxy,
      ),
    ).toBe(
      'https://gh.llkk.cc/https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/a.exe',
    );

    expect(
      ensureProxiedDownloadUrl(
        'https://gh.llkk.cc/https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/a.exe',
        proxy,
      ),
    ).toBe(
      'https://gh.llkk.cc/https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/a.exe',
    );

    expect(
      ensureProxiedDownloadUrl(
        'https://ghp.ci/https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/a.exe',
        proxy,
      ),
    ).toBe(
      'https://gh.llkk.cc/https://github.com/Await-d/OpenAWork/releases/download/desktop-v0.7.0-preview/a.exe',
    );
  });
});

describe('toUpdateError', () => {
  it('将常见网络/证书/中文网络错误归类为 network', () => {
    expect(toUpdateError(new Error('tls handshake failed')).kind).toBe('network');
    expect(toUpdateError(new Error('ENOTFOUND github.com')).kind).toBe('network');
    expect(toUpdateError(new Error('网络不可达')).kind).toBe('network');
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(toUpdateError(abort).kind).toBe('network');
  });

  it('保留签名与权限分类', () => {
    expect(toUpdateError(new Error('signature verify failed')).kind).toBe('signature');
    expect(toUpdateError(new Error('permission denied')).kind).toBe('permission');
  });
});
