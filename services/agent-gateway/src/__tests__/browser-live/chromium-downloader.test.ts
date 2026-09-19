/**
 * `createChromiumDownloader` 的安装编排覆盖。
 *
 * 全部通过注入 fake 依赖运行，不触碰真实网络 / Playwright 注册表：
 * - fake `resolveTargets` 返回指向临时目录的目标；
 * - fake `downloadFile` 写盘 / 失败 / 上报进度；
 * - fake `extractZip` 构造带可执行文件的目标树。
 */

import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ManagedBrowserTarget } from '@openAwork/browser-automation';

import type { DownloadFileOptions } from '../../browser-live/browser-download.js';
import { createChromiumDownloader } from '../../browser-live/chromium-downloader.js';

const INSTALLATION_COMPLETE = 'INSTALLATION_COMPLETE';
const EXECUTABLE_RELATIVE_PATH = join('chrome-linux64', 'chrome');

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oaw-downloader-'));
  tempDirs.push(dir);
  return dir;
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
    downloadUrls: ['https://mirror-a.example/chromium.zip'],
    ...overrides,
  };
}

async function writeExecutable(directory: string, relativePath: string): Promise<void> {
  const executable = join(directory, relativePath);
  await mkdir(dirname(executable), { recursive: true });
  await writeFile(executable, 'binary-bytes', { mode: 0o755 });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('createChromiumDownloader.ensureInstalled', () => {
  it('下载 + 解压 + 原子重命名后留下最终目录与标记文件', async () => {
    const browsersPath = await makeTempDir();
    const target = makeTarget(browsersPath);
    const lines: string[] = [];
    const downloads: string[] = [];

    const download = async (
      url: string,
      destination: string,
      options?: DownloadFileOptions,
    ): Promise<void> => {
      downloads.push(url);
      await writeFile(destination, 'zip-bytes');
      options?.onProgress?.({ receivedBytes: 50, totalBytes: 100, percent: 50 });
      options?.onProgress?.({ receivedBytes: 100, totalBytes: 100, percent: 100 });
    };

    const extractZip = async (zipPath: string, directory: string): Promise<void> => {
      expect(await pathExists(zipPath)).toBe(true);
      await writeExecutable(directory, target.executableRelativePath);
    };

    const downloader = createChromiumDownloader({
      resolveTargets: async () => [target],
      downloadFile: download,
      extractZip,
    });

    await downloader.ensureInstalled(
      browsersPath,
      (line) => lines.push(line),
      new AbortController().signal,
    );

    expect(downloads).toEqual(['https://mirror-a.example/chromium.zip']);
    expect(await pathExists(join(target.directory, INSTALLATION_COMPLETE))).toBe(true);
    expect(await pathExists(join(target.directory, target.executableRelativePath))).toBe(true);

    const entries = await readdir(browsersPath);
    expect(entries.some((entry) => entry.includes('.tmp-'))).toBe(false);
    expect(entries.some((entry) => entry.includes('.download-'))).toBe(false);
    expect(lines.some((line) => line.includes('安装完成'))).toBe(true);
  });

  it('已安装目标直接跳过，不再触发下载', async () => {
    const browsersPath = await makeTempDir();
    const target = makeTarget(browsersPath);
    await writeExecutable(target.directory, target.executableRelativePath);
    await writeFile(join(target.directory, INSTALLATION_COMPLETE), '');

    const lines: string[] = [];
    let downloadCalled = false;
    const downloader = createChromiumDownloader({
      resolveTargets: async () => [target],
      downloadFile: async () => {
        downloadCalled = true;
      },
      extractZip: async () => undefined,
    });

    await downloader.ensureInstalled(
      browsersPath,
      (line) => lines.push(line),
      new AbortController().signal,
    );

    expect(downloadCalled).toBe(false);
    expect(lines.some((line) => line.includes('已安装，跳过'))).toBe(true);
  });

  it('首个镜像失败后回退到下一个镜像并最终安装成功', async () => {
    const browsersPath = await makeTempDir();
    const target = makeTarget(browsersPath, {
      downloadUrls: [
        'https://mirror-a.example/chromium.zip',
        'https://mirror-b.example/chromium.zip',
      ],
    });
    const attempts: string[] = [];
    const lines: string[] = [];

    const download = async (url: string, destination: string): Promise<void> => {
      attempts.push(url);
      if (url.includes('mirror-a')) {
        throw new Error('mirror-a 不可用');
      }
      await writeFile(destination, 'zip-bytes');
    };

    const downloader = createChromiumDownloader({
      resolveTargets: async () => [target],
      downloadFile: download,
      extractZip: async (_zipPath, directory) => {
        await writeExecutable(directory, target.executableRelativePath);
      },
    });

    await downloader.ensureInstalled(
      browsersPath,
      (line) => lines.push(line),
      new AbortController().signal,
    );

    expect(attempts).toEqual([
      'https://mirror-a.example/chromium.zip',
      'https://mirror-b.example/chromium.zip',
    ]);
    expect(lines.some((line) => line.includes('mirror-a'))).toBe(true);
    expect(lines.some((line) => line.includes('mirror-b'))).toBe(true);
    expect(await pathExists(join(target.directory, INSTALLATION_COMPLETE))).toBe(true);
  });

  it('全部镜像失败时抛出最后错误并清理临时目录 / zip', async () => {
    const browsersPath = await makeTempDir();
    const target = makeTarget(browsersPath, {
      downloadUrls: [
        'https://mirror-a.example/chromium.zip',
        'https://mirror-b.example/chromium.zip',
      ],
    });

    const downloader = createChromiumDownloader({
      resolveTargets: async () => [target],
      downloadFile: async (url: string) => {
        throw new Error(`${url} 下载失败`);
      },
      extractZip: async () => undefined,
    });

    await expect(
      downloader.ensureInstalled(browsersPath, () => undefined, new AbortController().signal),
    ).rejects.toThrow('https://mirror-b.example/chromium.zip 下载失败');

    const entries = await readdir(browsersPath);
    expect(entries.some((entry) => entry.includes('.tmp-'))).toBe(false);
    expect(entries.some((entry) => entry.includes('.download-'))).toBe(false);
    expect(entries).toEqual([]);
  });

  it('按 ~5% 步长节流上报进度行', async () => {
    const browsersPath = await makeTempDir();
    const target = makeTarget(browsersPath);
    const lines: string[] = [];

    const percents = [0, 2, 7, 50, 100];
    const download = async (
      _url: string,
      destination: string,
      options?: DownloadFileOptions,
    ): Promise<void> => {
      await writeFile(destination, 'zip-bytes');
      for (const percent of percents) {
        options?.onProgress?.({ receivedBytes: percent, totalBytes: 100, percent });
      }
    };

    const downloader = createChromiumDownloader({
      resolveTargets: async () => [target],
      downloadFile: download,
      extractZip: async (_zipPath, directory) => {
        await writeExecutable(directory, target.executableRelativePath);
      },
    });

    await downloader.ensureInstalled(
      browsersPath,
      (line) => lines.push(line),
      new AbortController().signal,
    );

    const progressLines = lines.filter((line) => line.includes('下载进度'));
    // 0 / 7 / 50 / 100 触发，2 被节流。
    expect(progressLines).toHaveLength(4);
    expect(progressLines[progressLines.length - 1]).toContain('100%');
  });
});
