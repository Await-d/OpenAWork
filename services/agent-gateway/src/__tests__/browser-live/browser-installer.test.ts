/**
 * 调试浏览器应用内安装器（`browserInstaller`）的状态机覆盖。
 *
 * 新实现不再 spawn `playwright/cli.js`，而是通过下载器注入点运行：
 * - `resolveDownloadTargets` 返回指向临时目录的 fake 目标；
 * - `downloadFile` / `extractZip` 用内存实现替代真实网络与解压。
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ManagedBrowserTarget } from '@openAwork/browser-automation';

import {
  BROWSER_INSTALL_CONFLICT_CODE,
  INSTALL_TAIL_LOG_LIMIT,
  INSTALL_TAIL_LOG_LINE_MAX,
  MANUAL_INSTALL_COMMAND,
  buildInstallUnavailableMessage,
  createBrowserInstaller,
  resolveBrowsersPath,
  resolvePlaywrightCliPath,
  resolvePlaywrightCliPathFromAutomation,
} from '../../browser-live/browser-installer.js';
import type { DownloadFileOptions } from '../../browser-live/browser-download.js';

const EXECUTABLE_RELATIVE_PATH = join('chrome-linux64', 'chrome');

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oaw-installer-'));
  tempDirs.push(dir);
  return dir;
}

async function makeBrowsersDir(): Promise<string> {
  return join(await makeTempDir(), 'browsers');
}

function makeTarget(
  browsersPath: string,
  overrides: Partial<ManagedBrowserTarget> = {},
): ManagedBrowserTarget {
  return {
    name: 'chromium',
    revision: '1208',
    browserVersion: '120.0.0',
    directory: join(browsersPath, 'chromium-1208'),
    executableRelativePath: EXECUTABLE_RELATIVE_PATH,
    downloadUrls: ['https://mirror.example/chromium.zip'],
    ...overrides,
  };
}

async function writeExecutable(directory: string, relativePath: string): Promise<void> {
  const executable = join(directory, relativePath);
  await mkdir(dirname(executable), { recursive: true });
  await writeFile(executable, 'binary-bytes', { mode: 0o755 });
}

const extractFakeExecutable = async (_zipPath: string, directory: string): Promise<void> => {
  await writeExecutable(directory, EXECUTABLE_RELATIVE_PATH);
};

const writeZip = async (_url: string, destination: string): Promise<void> => {
  await writeFile(destination, 'zip-bytes');
};

/** 永不 resolve 的下载（除非被 abort），用于制造 running / 超时场景。 */
const neverResolvingDownload = (
  _url: string,
  _destination: string,
  options?: DownloadFileOptions,
): Promise<void> =>
  new Promise<void>((_resolve, reject) => {
    const signal = options?.signal;
    if (!signal) {
      return;
    }
    if (signal.aborted) {
      reject(new Error('下载已取消'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('下载已取消')), { once: true });
  });

async function waitForState(
  installer: ReturnType<typeof createBrowserInstaller>,
  predicate: (state: string) => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate(installer.status().state)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`state did not settle, last=${installer.status().state}`);
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('resolveBrowsersPath', () => {
  it('优先读取 PLAYWRIGHT_BROWSERS_PATH', () => {
    expect(
      resolveBrowsersPath({
        PLAYWRIGHT_BROWSERS_PATH: '/custom/pw',
        OPENAWORK_DATA_DIR: '/data',
      } as NodeJS.ProcessEnv),
    ).toBe('/custom/pw');
  });

  it('未设置时回落到 <gateway 数据目录>/browsers', () => {
    const resolved = resolveBrowsersPath({} as NodeJS.ProcessEnv, () => '/data/openawork');

    expect(resolved).toBe(join('/data/openawork', 'browsers'));
  });
});

describe('resolvePlaywrightCliPath', () => {
  it('存在显式 CLI 覆盖时直接采用', async () => {
    const cli = join(await makeTempDir(), 'cli.js');
    await writeFile(cli, '// stub', 'utf8');
    expect(resolvePlaywrightCliPath({ OPENAWORK_PLAYWRIGHT_CLI: cli } as NodeJS.ProcessEnv)).toBe(
      cli,
    );
  });

  it('automation 包解析失败时返回 null（模拟 CLI 缺席）', () => {
    expect(
      resolvePlaywrightCliPathFromAutomation(() => {
        throw new Error('module not found');
      }),
    ).toBeNull();
  });
});

describe('buildInstallUnavailableMessage', () => {
  it('包含手动安装命令与宿主平台信息', () => {
    const message = buildInstallUnavailableMessage();
    expect(message).toContain(MANUAL_INSTALL_COMMAND);
    expect(message).toContain(`${process.platform}-${process.arch}`);
  });
});

describe('browserInstaller', () => {
  it('idle → running → succeeded，并在成功时失效探针缓存', async () => {
    const browsersPath = await makeBrowsersDir();
    const reset = vi.fn();
    const installer = createBrowserInstaller({
      resolveDownloadTargets: async () => [makeTarget(browsersPath)],
      downloadFile: writeZip,
      extractZip: extractFakeExecutable,
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: reset,
    });

    expect(installer.status().state).toBe('idle');
    const result = await installer.install();
    expect(result.started).toBe(true);
    expect(result.status.state).toBe('running');
    expect(result.status.browsersPath).toBe(browsersPath);

    await waitForState(installer, (state) => state === 'succeeded');
    const status = installer.status();
    expect(status.state).toBe('succeeded');
    expect(status.error).toBeNull();
    expect(status.startedAt).not.toBeNull();
    expect(status.finishedAt).not.toBeNull();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('单飞：running 期间第二次 install 不启动且返回 started:false', async () => {
    const browsersPath = await makeBrowsersDir();
    const installer = createBrowserInstaller({
      resolveDownloadTargets: async () => [makeTarget(browsersPath)],
      downloadFile: neverResolvingDownload,
      extractZip: extractFakeExecutable,
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
      timeoutMs: 60,
    });

    const first = await installer.install();
    expect(first.started).toBe(true);
    expect(first.status.state).toBe('running');

    const second = await installer.install();
    expect(second.started).toBe(false);
    expect(second.status.state).toBe('running');

    await waitForState(installer, (state) => state === 'failed');
    expect(installer.status().error).toContain('安装超时');
  });

  it('下载失败 → failed，error 取最后一个镜像的错误', async () => {
    const browsersPath = await makeBrowsersDir();
    const installer = createBrowserInstaller({
      resolveDownloadTargets: async () => [makeTarget(browsersPath)],
      downloadFile: async () => {
        throw new Error('Download failed: ECONNRESET');
      },
      extractZip: extractFakeExecutable,
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
    });

    await installer.install();
    await waitForState(installer, (state) => state === 'failed');

    const status = installer.status();
    expect(status.state).toBe('failed');
    expect(status.error).toBe('Download failed: ECONNRESET');
  });

  it('超时 → abort 下载并标记 failed', async () => {
    const browsersPath = await makeBrowsersDir();
    const installer = createBrowserInstaller({
      resolveDownloadTargets: async () => [makeTarget(browsersPath)],
      downloadFile: neverResolvingDownload,
      extractZip: extractFakeExecutable,
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
      timeoutMs: 40,
    });

    await installer.install();
    await waitForState(installer, (state) => state === 'failed');
    expect(installer.status().error).toContain('安装超时');
  });

  it('无可用下载目标 → unavailable，不启动且 error 含手动命令', async () => {
    const browsersPath = await makeBrowsersDir();
    const installer = createBrowserInstaller({
      resolveDownloadTargets: async () => [],
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
    });

    const result = await installer.install();
    expect(result.started).toBe(false);
    expect(result.status.state).toBe('unavailable');
    expect(result.status.error).toContain('npx playwright install chromium');
  });

  it('tailLog 有界：行数封顶 40，单行截断到 300 字符', async () => {
    const browsersPath = await makeBrowsersDir();
    const urls = Array.from(
      { length: 25 },
      (_, index) => `https://${'a'.repeat(320)}-${index}.example/chromium.zip`,
    );
    let attempts = 0;
    const installer = createBrowserInstaller({
      resolveDownloadTargets: async () => [makeTarget(browsersPath, { downloadUrls: urls })],
      downloadFile: async (_url, destination) => {
        attempts += 1;
        if (attempts < urls.length) {
          throw new Error(`镜像 ${attempts} 不可用`);
        }
        await writeFile(destination, 'zip-bytes');
      },
      extractZip: extractFakeExecutable,
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
    });

    await installer.install();
    await waitForState(installer, (state) => state === 'succeeded');

    const tail = installer.status().tailLog;
    expect(attempts).toBe(urls.length);
    expect(tail).toHaveLength(INSTALL_TAIL_LOG_LIMIT);
    expect(tail.every((line) => line.length <= INSTALL_TAIL_LOG_LINE_MAX)).toBe(true);
    expect(tail[tail.length - 1]).toContain('安装完成');
  });

  it('status() 返回副本：外部改动不影响内部状态', async () => {
    const browsersPath = await makeBrowsersDir();
    const installer = createBrowserInstaller({
      resolveDownloadTargets: async () => [makeTarget(browsersPath)],
      downloadFile: writeZip,
      extractZip: extractFakeExecutable,
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
    });

    await installer.install();
    await waitForState(installer, (state) => state === 'succeeded');

    const snapshot = installer.status();
    const originalFirst = snapshot.tailLog[0];
    snapshot.tailLog.push('injected');
    snapshot.tailLog[0] = 'mutated';

    const fresh = installer.status();
    expect(fresh.tailLog).not.toContain('injected');
    expect(fresh.tailLog[0]).toBe(originalFirst);
  });

  it('暴露稳定的 409 冲突码常量', () => {
    expect(BROWSER_INSTALL_CONFLICT_CODE).toBe('browser_install_in_progress');
  });
});
