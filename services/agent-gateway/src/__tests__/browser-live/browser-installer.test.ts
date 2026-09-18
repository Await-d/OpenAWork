/**
 * 调试浏览器应用内安装器（`browserInstaller`）的状态机覆盖。
 *
 * 用 `resolveCliPath` 注入一段内联 node 脚本作为「假 CLI」：spawn 时会以
 * `process.execPath -e <script>` 执行，因此走完整的 spawn / stdio / exit / kill 路径，
 * 但不会真正下载 Playwright。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BROWSER_INSTALL_CONFLICT_CODE,
  INSTALL_TAIL_LOG_LIMIT,
  createBrowserInstaller,
  resolveBrowsersPath,
  resolvePlaywrightCliPath,
  resolvePlaywrightCliPathFromAutomation,
} from '../../browser-live/browser-installer.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oaw-installer-'));
  tempDirs.push(dir);
  return dir;
}

/** 把一段 node 脚本落盘成假 `cli.js`，返回给它用的同步解析器。 */
async function makeFakeCli(source: string): Promise<() => string> {
  const dir = await makeTempDir();
  const file = join(dir, 'cli.js');
  await writeFile(file, source, 'utf8');
  return () => file;
}

async function makeBrowsersDir(): Promise<string> {
  return join(await makeTempDir(), 'browsers');
}

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

describe('browserInstaller', () => {
  it('idle → running → succeeded，并在成功时失效探针缓存', async () => {
    const browsersPath = await makeBrowsersDir();
    const reset = vi.fn();
    const installer = createBrowserInstaller({
      resolveCliPath: await makeFakeCli('process.stdout.write("downloading 100%\\n");'),
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
      resolveCliPath: await makeFakeCli('setTimeout(() => {}, 30000);'),
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
      timeoutMs: 120,
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

  it('非零退出 → failed，error 取最后一行 stderr', async () => {
    const browsersPath = await makeBrowsersDir();
    const installer = createBrowserInstaller({
      resolveCliPath: await makeFakeCli(
        'process.stderr.write("first line\\nDownload failed: ECONNRESET\\n");process.exit(7);',
      ),
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
    });

    await installer.install();
    await waitForState(installer, (state) => state === 'failed');

    const status = installer.status();
    expect(status.state).toBe('failed');
    expect(status.error).toBe('Download failed: ECONNRESET');
  });

  it('超时 → kill 子进程并标记 failed', async () => {
    const browsersPath = await makeBrowsersDir();
    const installer = createBrowserInstaller({
      resolveCliPath: await makeFakeCli('setTimeout(() => {}, 30000);'),
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
      timeoutMs: 80,
    });

    await installer.install();
    await waitForState(installer, (state) => state === 'failed');
    expect(installer.status().error).toContain('安装超时');
  });

  it('CLI 不可解析 → unavailable，不 spawn 且 error 含手动命令', async () => {
    const browsersPath = await makeBrowsersDir();
    const installer = createBrowserInstaller({
      resolveCliPath: () => null,
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
    });

    const result = await installer.install();
    expect(result.started).toBe(false);
    expect(result.status.state).toBe('unavailable');
    expect(result.status.error).toContain('npx playwright install chromium');
  });

  it('tailLog 有界：最多保留最近 40 行', async () => {
    const browsersPath = await makeBrowsersDir();
    const script =
      'let out=""; for (let i=1;i<=100;i+=1) out += `line-${i}\\n`; process.stdout.write(out);';
    const installer = createBrowserInstaller({
      resolveCliPath: await makeFakeCli(script),
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
    });

    await installer.install();
    await waitForState(installer, (state) => state === 'succeeded');

    const tail = installer.status().tailLog;
    expect(tail).toHaveLength(INSTALL_TAIL_LOG_LIMIT);
    expect(tail[tail.length - 1]).toBe('line-100');
  });

  it('status() 返回副本：外部改动不影响内部状态', async () => {
    const browsersPath = await makeBrowsersDir();
    const installer = createBrowserInstaller({
      resolveCliPath: await makeFakeCli('process.stdout.write("only-line\\n");'),
      resolveBrowsersPath: () => browsersPath,
      resetAvailabilityCache: () => undefined,
    });

    await installer.install();
    await waitForState(installer, (state) => state === 'succeeded');

    const snapshot = installer.status();
    snapshot.tailLog.push('injected');
    snapshot.tailLog[0] = 'mutated';

    expect(installer.status().tailLog).toEqual(['only-line']);
  });

  it('暴露稳定的 409 冲突码常量', () => {
    expect(BROWSER_INSTALL_CONFLICT_CODE).toBe('browser_install_in_progress');
  });
});
