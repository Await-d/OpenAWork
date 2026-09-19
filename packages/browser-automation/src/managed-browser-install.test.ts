/**
 * `managed-browser-install` 的覆盖。
 *
 * - 目标解析依赖 `playwright-core` 注册表（revision 1208 由 playwright 1.58.2 固化），
 *   在无对应构建的宿主机（ubuntu18.04、未知架构等）上注册表不提供可执行路径或下载地址，
 *   因此所有「双目标」断言都带 `skipIf`，同时保留「返回数组」的类型契约测试；
 * - 目录重定位用注入的 `browsersPath` 验证：注册表目录在导入期被环境变量固化，
 *   函数必须取 basename 后重新拼接，才不会被宿主机 `PLAYWRIGHT_BROWSERS_PATH` 污染；
 * - 下载主机覆盖只做「拼接 + pathname」，这里钉死专用变量优先、通用变量兜底与空白忽略；
 * - 真实解压不构造 zip（仓库无 zip 写入依赖），只验证缺失归档会以 rejection 暴露错误；
 * - 代理构造复用 `playwright-core/lib/utilsBundle` 的同一实例做 `toBeInstanceOf`，
 *   并清理代理环境变量，保证与宿主机 shell 配置无关。
 */

import { basename, join } from 'node:path';

import { HttpsProxyAgent, SocksProxyAgent } from 'playwright-core/lib/utilsBundle';
import { describe, expect, it, afterEach } from 'vitest';

import {
  extractBrowserArchive,
  resolveManagedBrowserTargets,
  resolveProxyAgent,
  type ManagedBrowserTarget,
} from './managed-browser-install.js';

const BROWSERS_PATH = '/tmp/openawork-test-browsers';
const EXPECTED_REVISION = '1208';

/** 宿主平台可下载构建时注册表会给出两个目标；否则按约定返回空数组。 */
const hostTargets = resolveManagedBrowserTargets(BROWSERS_PATH, {});
const hostHasDownloadableBuild = hostTargets.length > 0;

function findTarget(name: ManagedBrowserTarget['name']): ManagedBrowserTarget | undefined {
  return hostTargets.find((target) => target.name === name);
}

describe('resolveManagedBrowserTargets', () => {
  it('始终返回数组；无对应构建的宿主平台返回空数组', () => {
    expect(Array.isArray(hostTargets)).toBe(true);
    if (!hostHasDownloadableBuild) {
      expect(hostTargets).toEqual([]);
    }
  });

  it.skipIf(!hostHasDownloadableBuild)(
    '解析出 chromium 与 chromium-headless-shell 且 revision 为 1208',
    () => {
      expect(hostTargets.map((target) => target.name)).toEqual([
        'chromium',
        'chromium-headless-shell',
      ]);
      expect(findTarget('chromium')?.revision).toBe(EXPECTED_REVISION);
      expect(findTarget('chromium-headless-shell')?.revision).toBe(EXPECTED_REVISION);
    },
  );

  it.skipIf(!hostHasDownloadableBuild)('目录重定位到注入的 browsersPath 之下', () => {
    expect(findTarget('chromium')?.directory).toBe(join(BROWSERS_PATH, 'chromium-1208'));
    expect(findTarget('chromium-headless-shell')?.directory).toBe(
      join(BROWSERS_PATH, 'chromium_headless_shell-1208'),
    );
    expect(findTarget('chromium')?.directory.endsWith('chromium-1208')).toBe(true);
    expect(
      findTarget('chromium-headless-shell')?.directory.endsWith('chromium_headless_shell-1208'),
    ).toBe(true);
    expect(basename(findTarget('chromium')?.directory ?? '')).toBe('chromium-1208');
    expect(basename(findTarget('chromium-headless-shell')?.directory ?? '')).toBe(
      'chromium_headless_shell-1208',
    );
  });

  it.skipIf(!hostHasDownloadableBuild)('可执行文件相对路径为 chrome 布局且不含根前缀', () => {
    for (const target of hostTargets) {
      expect(target.executableRelativePath).toContain('chrome');
      expect(target.executableRelativePath.startsWith('/')).toBe(false);
      expect(target.executableRelativePath).not.toContain('..');
      expect(join(target.directory, target.executableRelativePath)).toContain(target.directory);
    }
  });

  it.skipIf(!hostHasDownloadableBuild)('downloadUrls 非空且均为 http(s) 地址', () => {
    for (const target of hostTargets) {
      expect(target.downloadUrls.length).toBeGreaterThan(0);
      for (const downloadUrl of target.downloadUrls) {
        expect(downloadUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it.skipIf(!hostHasDownloadableBuild)('browserVersion 为字符串或 null', () => {
    for (const target of hostTargets) {
      if (target.browserVersion !== null) {
        expect(typeof target.browserVersion).toBe('string');
        expect(target.browserVersion).toMatch(/^\d+\./);
      }
    }
  });

  it.skipIf(!hostHasDownloadableBuild)(
    'PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST 覆盖主机并保留 pathname',
    () => {
      const overridden = resolveManagedBrowserTargets(BROWSERS_PATH, {
        PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: 'https://mirror.example.com/',
      });
      const chromium = overridden.find((target) => target.name === 'chromium');
      const original = findTarget('chromium');
      const [overriddenUrl] = chromium?.downloadUrls ?? [];
      const [originalUrl] = original?.downloadUrls ?? [];

      expect(overriddenUrl).toBeDefined();
      expect(originalUrl).toBeDefined();
      expect(overriddenUrl).toBe(
        `https://mirror.example.com${new URL(originalUrl ?? 'https://invalid.example').pathname}`,
      );
      expect(overriddenUrl).not.toContain('cdn.playwright.dev');
      expect(chromium?.downloadUrls.length).toBe(original?.downloadUrls.length);
    },
  );

  it.skipIf(!hostHasDownloadableBuild)(
    'PLAYWRIGHT_DOWNLOAD_HOST 作为通用兜底，专用变量优先',
    () => {
      const generic = resolveManagedBrowserTargets(BROWSERS_PATH, {
        PLAYWRIGHT_DOWNLOAD_HOST: 'https://generic.example.com/',
      });
      expect(generic.find((target) => target.name === 'chromium')?.downloadUrls[0]).toMatch(
        /^https:\/\/generic\.example\.com\//,
      );

      const both = resolveManagedBrowserTargets(BROWSERS_PATH, {
        PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: 'https://chromium.example.com',
        PLAYWRIGHT_DOWNLOAD_HOST: 'https://generic.example.com',
      });
      expect(both.find((target) => target.name === 'chromium')?.downloadUrls[0]).toMatch(
        /^https:\/\/chromium\.example\.com\//,
      );
      expect(
        both.find((target) => target.name === 'chromium-headless-shell')?.downloadUrls[0],
      ).toMatch(/^https:\/\/chromium\.example\.com\//);
    },
  );

  it.skipIf(!hostHasDownloadableBuild)('覆盖变量为空白时视为未设置，不重写地址', () => {
    const blank = resolveManagedBrowserTargets(BROWSERS_PATH, {
      PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: '   ',
    });
    expect(blank.find((target) => target.name === 'chromium')?.downloadUrls).toEqual(
      findTarget('chromium')?.downloadUrls,
    );
  });
});

describe('extractBrowserArchive', () => {
  it('归档不存在时以 rejection 暴露错误（不吞错）', async () => {
    await expect(
      extractBrowserArchive('/nonexistent/openawork-browser.zip', '/tmp/openawork-test-browsers'),
    ).rejects.toThrow(/ENOENT/);
  });
});

describe('resolveProxyAgent', () => {
  const PROXY_ENV_KEYS = [
    'http_proxy',
    'HTTP_PROXY',
    'https_proxy',
    'HTTPS_PROXY',
    'all_proxy',
    'ALL_PROXY',
    'no_proxy',
    'NO_PROXY',
    'npm_config_proxy',
    'npm_config_https_proxy',
  ] as const;

  const savedEnv = new Map<string, string | undefined>();

  const clearProxyEnv = (): void => {
    for (const key of PROXY_ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  };

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    savedEnv.clear();
  });

  it('无代理环境变量时返回 undefined', () => {
    clearProxyEnv();
    expect(resolveProxyAgent('https://example.com/page')).toBeUndefined();
  });

  it('socks 代理返回 SocksProxyAgent，其余返回 HttpsProxyAgent', () => {
    clearProxyEnv();

    process.env.HTTPS_PROXY = 'socks5://127.0.0.1:1080';
    expect(resolveProxyAgent('https://example.com/page')).toBeInstanceOf(SocksProxyAgent);

    process.env.HTTPS_PROXY = 'http://127.0.0.1:8080';
    expect(resolveProxyAgent('https://example.com/page')).toBeInstanceOf(HttpsProxyAgent);
  });
});
