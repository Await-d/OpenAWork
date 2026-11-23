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

vi.mock('../../infra/gateway-logger.js', () => ({
  logGatewayDebug: vi.fn(),
  logGatewayWarn: vi.fn(),
}));

import { logGatewayDebug, logGatewayWarn } from '../../infra/gateway-logger.js';

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

  it('automation 包解析失败时 debug 记录并返回 null，不泄漏异常中的凭据', () => {
    vi.mocked(logGatewayDebug).mockClear();
    vi.mocked(logGatewayWarn).mockClear();
    expect(
      resolvePlaywrightCliPathFromAutomation(() => {
        throw new Error('module not found https://user:secret@example.test/?token=private');
      }),
    ).toBeNull();
    expect(logGatewayDebug).toHaveBeenCalledWith(
      '[browser-installer] browser automation CLI probe unavailable',
    );
    expect(logGatewayWarn).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logGatewayDebug).mock.calls)).not.toContain('secret');
    expect(JSON.stringify(vi.mocked(logGatewayDebug).mock.calls)).not.toContain('private');
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
  it('安装目录创建失败时 warn 并保留 failed 返回', async () => {
    vi.mocked(logGatewayWarn).mockClear();
    const browsersPath = join(await makeTempDir(), 'not-a-directory');
    await writeFile(browsersPath, 'file');
    const installer = createBrowserInstaller({ resolveBrowsersPath: () => browsersPath });
    const result = await installer.install();
    expect(result.started).toBe(false);
    expect(result.status.state).toBe('failed');
    expect(logGatewayWarn).toHaveBeenCalledWith(
      '[browser-installer] failed to prepare browser installation directory',
    );
  });

  it('下载目标解析失败时 warn，不把异常凭据写入服务端日志', async () => {
    vi.mocked(logGatewayWarn).mockClear();
    const browsersPath = await makeBrowsersDir();
    const installer = createBrowserInstaller({
      resolveBrowsersPath: () => browsersPath,
      resolveDownloadTargets: async () => {
        throw new Error('https://user:secret@example.test/?token=private');
      },
    });
    const result = await installer.install();
    expect(result.status.state).toBe('failed');
    expect(result.status.error).not.toContain('secret');
    expect(result.status.error).not.toContain('private');
    expect(logGatewayWarn).toHaveBeenCalledWith(
      '[browser-installer] failed to resolve browser download targets',
    );
    expect(JSON.stringify(vi.mocked(logGatewayWarn).mock.calls)).not.toContain('secret');
    expect(JSON.stringify(vi.mocked(logGatewayWarn).mock.calls)).not.toContain('private');
  });

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

  it('目标准备也受总deadline约束，晚到结果不得启动下载且结束后可重试', async () => {
    const browsersPath = await makeBrowsersDir();
    let resolveTargets: (targets: ManagedBrowserTarget[]) => void = () => undefined;
    const pending = new Promise<ManagedBrowserTarget[]>((resolve) => {
      resolveTargets = resolve;
    });
    const download = vi.fn(writeZip);
    const installer = createBrowserInstaller({
      resolveBrowsersPath: () => browsersPath,
      resolveDownloadTargets: vi.fn().mockReturnValueOnce(pending).mockResolvedValue([]),
      downloadFile: download,
      timeoutMs: 30,
    });
    const first = installer.install();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const timedOut = installer.status();
    expect(timedOut.state).toBe('failed');
    expect(timedOut.error).toContain('安装超时');
    expect((await installer.install()).started).toBe(false);
    resolveTargets([makeTarget(browsersPath)]);
    expect((await first).started).toBe(false);
    expect(installer.status()).toEqual(timedOut);
    expect(download).not.toHaveBeenCalled();
    expect((await installer.install()).status.state).toBe('unavailable');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(installer.status().state).toBe('unavailable');
  });

  it('准备目录期间同步占位，并发 install 只能启动一次', async () => {
    const browsersPath = await makeBrowsersDir();
    const installer = createBrowserInstaller({
      resolveBrowsersPath: () => browsersPath,
      resolveDownloadTargets: async () => [],
    });
    const first = installer.install();
    expect(installer.status().state).toBe('running');
    const second = await installer.install();
    expect(second.started).toBe(false);
    expect(second.status.state).toBe('running');
    await first;
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

  it('超时后旧下载未结束仍拒绝重试，旧进度不得污染失败快照', async () => {
    const browsersPath = await makeBrowsersDir();
    let release: () => void = () => undefined;
    let report: DownloadFileOptions['onProgress'];
    const installer = createBrowserInstaller({
      resolveBrowsersPath: () => browsersPath,
      resolveDownloadTargets: async () => [makeTarget(browsersPath)],
      downloadFile: async (_url, _destination, options) => {
        report = options?.onProgress;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        throw new Error('旧下载结束');
      },
      resetAvailabilityCache: () => undefined,
      timeoutMs: 40,
    });
    await installer.install();
    await waitForState(installer, (state) => state === 'failed');
    const failed = installer.status();
    const retry = await installer.install();
    expect(retry.started).toBe(false);
    report?.({ receivedBytes: 99, totalBytes: 100, percent: 99 });
    expect(installer.status()).toEqual(failed);
    const oldReport = report;
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await installer.install()).started).toBe(true);
    const nextRun = installer.status();
    oldReport?.({ receivedBytes: 100, totalBytes: 100, percent: 100 });
    expect(installer.status()).toEqual(nextRun);
    await waitForState(installer, (state) => state === 'failed');
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  it('下载失败的共享日志和错误均脱敏，unknown 不调用自定义字符串化', async () => {
    const browsersPath = await makeBrowsersDir();
    const url = 'https://private-user:private-password@example.test/file?signature=private-query';
    const installer = createBrowserInstaller({
      resolveBrowsersPath: () => browsersPath,
      resolveDownloadTargets: async () => [makeTarget(browsersPath, { downloadUrls: [url] })],
      downloadFile: async () => {
        throw new Error(`下载失败 ${url}`);
      },
    });
    await installer.install();
    await waitForState(installer, (state) => state === 'failed');
    const shared = JSON.stringify(installer.status());
    for (const secret of ['private-user', 'private-password', 'private-query']) {
      expect(shared).not.toContain(secret);
    }
    const toString = vi.fn(() => {
      throw new Error('不应字符串化');
    });
    const unknownInstaller = createBrowserInstaller({
      resolveBrowsersPath: () => browsersPath,
      resolveDownloadTargets: async () => {
        throw Object.assign(new Error(''), { toString });
      },
    });
    expect((await unknownInstaller.install()).status.state).toBe('failed');
    expect(toString).not.toHaveBeenCalled();
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
