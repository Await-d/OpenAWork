/**
 * 运行时 Chromium 下载器（替代 `playwright install` CLI）。
 *
 * 背景：桌面端 sidecar 由 `bun build --compile` 编译成单二进制，`process.execPath`
 * 指向 sidecar 本身、`playwright/cli.js` 在运行时并不存在，因此无法再 spawn 官方 CLI。
 * 本模块直接复用 `@openAwork/browser-automation` 暴露的三项稳定能力：
 *
 * 1. `resolveManagedBrowserTargets` —— 从 Playwright 注册表解析目标目录 / 可执行相对路径
 *    与下载地址；
 * 2. `extractBrowserArchive` —— 用 Playwright 自带的 zip 解压实现展开归档；
 * 3. `resolveProxyAgent` —— 复用 Playwright 的代理 Agent，保证下载出网行为一致。
 *
 * 这三项能力都位于含 Playwright 的包内，因此**必须惰性加载**：顶部只用
 * `import type`（编译期擦除）引用类型，实际 `import()` 延迟到第一次真正需要时，
 * 避免网关进程启动即把 Playwright 拖进内存。
 *
 * 安装流程（单个目标）：
 * 下载到 `<browsersPath>/<dir>.download-<pid>-<rand>.zip` → 解压到
 * `<browsersPath>/<dir>.tmp-<pid>-<rand>` → 校验可执行文件 → 写
 * `INSTALLATION_COMPLETE` 标记 → 删除旧目录后原子 rename 到最终目录。
 * 任何失败都在 `finally` 清理临时 zip / 临时目录，绝不留下半成品。
 */

import { constants } from 'node:fs';
import { access, chmod, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { Agent } from 'node:http';
import { basename, join } from 'node:path';

import type { ManagedBrowserTarget } from '@openAwork/browser-automation';

import { downloadFile } from './browser-download.js';
import type { DownloadProgress } from './browser-download.js';

/** 标记文件：语义与 Playwright 官方安装器一致。 */
const INSTALLATION_COMPLETE_MARKER = 'INSTALLATION_COMPLETE';

/** 过期下载残留的保留上限（30 分钟）。 */
const STALE_ARTIFACT_MAX_AGE_MS = 30 * 60 * 1000;

/** Windows 上 rename 遇到占用时的单次重试延迟。 */
const RENAME_RETRY_DELAY_MS = 250;

/** 进度行节流步长（百分比）。 */
const PROGRESS_STEP = 5;

/** 找不到可下载目标时抛出的错误。 */
export class ChromiumUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChromiumUnavailableError';
  }
}

export interface ChromiumDownloaderDeps {
  /** 默认：惰性 import browser-automation 的 `resolveManagedBrowserTargets`。 */
  resolveTargets?: (browsersPath: string) => Promise<ManagedBrowserTarget[]>;
  /** 默认：`./browser-download.js` 的 `downloadFile`；测试注入。 */
  downloadFile?: typeof downloadFile;
  /** 默认：惰性 import browser-automation 的 `extractBrowserArchive`。 */
  extractZip?: (zipPath: string, directory: string) => Promise<void>;
  /** 默认：惰性 import browser-automation 的 `resolveProxyAgent`。 */
  agentFor?: (url: string) => Agent | undefined;
  socketTimeoutMs?: number;
}

export interface ChromiumDownloader {
  resolveTargets(browsersPath: string): Promise<ManagedBrowserTarget[]>;
  ensureInstalled(
    browsersPath: string,
    onLine: (line: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

/**
 * 惰性加载模块的结构类型：只声明本模块真正用到的三项能力，避免 `typeof import()`
 * 类型注解（ESLint `consistent-type-imports` 禁止），也避免静态依赖 Playwright。
 */
interface InstallModule {
  resolveManagedBrowserTargets(
    browsersPath: string,
    env?: NodeJS.ProcessEnv,
  ): ManagedBrowserTarget[];
  extractBrowserArchive(zipPath: string, directory: string): Promise<void>;
  resolveProxyAgent(url: string): Agent | undefined;
}

let installModulePromise: Promise<InstallModule> | null = null;
let resolvedInstallModule: InstallModule | null = null;

/**
 * 惰性加载 browser-automation（含 Playwright）。
 *
 * 缓存 Promise 与已解析模块引用：`resolvedInstallModule` 让同步的 `agentFor`
 * 在 `resolveTargets` 之后也能拿到 `resolveProxyAgent`（`ensureInstalled` 一定先
 * await `resolveTargets` 再下载）。
 */
function loadInstallModule(): Promise<InstallModule> {
  if (installModulePromise === null) {
    installModulePromise = import('@openAwork/browser-automation').then((module) => {
      resolvedInstallModule = module;
      return module;
    });
  }
  return installModulePromise;
}

async function defaultResolveTargets(browsersPath: string): Promise<ManagedBrowserTarget[]> {
  const module = await loadInstallModule();
  return module.resolveManagedBrowserTargets(browsersPath);
}

async function defaultExtractZip(zipPath: string, directory: string): Promise<void> {
  const module = await loadInstallModule();
  await module.extractBrowserArchive(zipPath, directory);
}

function defaultAgentFor(url: string): Agent | undefined {
  return resolvedInstallModule?.resolveProxyAgent(url);
}

interface ResolvedDeps {
  resolveTargets: (browsersPath: string) => Promise<ManagedBrowserTarget[]>;
  downloadFile: typeof downloadFile;
  extractZip: (zipPath: string, directory: string) => Promise<void>;
  agentFor: (url: string) => Agent | undefined;
  socketTimeoutMs: number | undefined;
}

export function createChromiumDownloader(deps: ChromiumDownloaderDeps = {}): ChromiumDownloader {
  const resolved: ResolvedDeps = {
    resolveTargets: deps.resolveTargets ?? defaultResolveTargets,
    downloadFile: deps.downloadFile ?? downloadFile,
    extractZip: deps.extractZip ?? defaultExtractZip,
    agentFor: deps.agentFor ?? defaultAgentFor,
    socketTimeoutMs: deps.socketTimeoutMs,
  };

  return {
    resolveTargets: (browsersPath) => resolved.resolveTargets(browsersPath),
    ensureInstalled: (browsersPath, onLine, signal) =>
      ensureInstalledImpl(resolved, browsersPath, onLine, signal),
  };
}

async function ensureInstalledImpl(
  deps: ResolvedDeps,
  browsersPath: string,
  onLine: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  await mkdir(browsersPath, { recursive: true });
  await reapStaleArtifacts(browsersPath, onLine);

  const targets = await deps.resolveTargets(browsersPath);
  if (targets.length === 0) {
    throw new ChromiumUnavailableError('未找到适用于当前宿主平台的调试浏览器下载目标。');
  }

  for (const target of targets) {
    if (await isInstalled(target)) {
      onLine(`[${target.name}] 已安装，跳过`);
      continue;
    }
    await installTarget(deps, target, browsersPath, onLine, signal);
  }
}

async function installTarget(
  deps: ResolvedDeps,
  target: ManagedBrowserTarget,
  browsersPath: string,
  onLine: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const baseName = basename(target.directory);
  const suffix = `${process.pid}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const tempDir = join(browsersPath, `${baseName}.tmp-${suffix}`);
  const zipPath = join(browsersPath, `${baseName}.download-${suffix}.zip`);

  try {
    await downloadFromMirrors(deps, target, zipPath, onLine, signal);

    onLine(`[${target.name}] 解压中…`);
    await deps.extractZip(zipPath, tempDir);

    const executable = join(tempDir, target.executableRelativePath);
    if (process.platform !== 'win32') {
      await chmod(executable, 0o755);
    }
    await access(executable, constants.X_OK);
    const executableStats = await stat(executable);
    if (!executableStats.isFile() || executableStats.size <= 0) {
      throw new Error(`解压产物无效：${executable}`);
    }

    await writeFile(join(tempDir, INSTALLATION_COMPLETE_MARKER), '');
    await rm(target.directory, { recursive: true, force: true });
    await renameWithRetry(tempDir, target.directory);
    onLine(`[${target.name}] 安装完成`);
  } finally {
    await safeRemove(zipPath, { force: true });
    await safeRemove(tempDir, { recursive: true, force: true });
  }
}

async function downloadFromMirrors(
  deps: ResolvedDeps,
  target: ManagedBrowserTarget,
  zipPath: string,
  onLine: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const urls = target.downloadUrls;
  let lastError: Error | null = null;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    if (url === undefined) {
      continue;
    }
    if (signal.aborted) {
      throw abortErrorFrom(signal);
    }

    onLine(`[${target.name}] 下载镜像 ${index + 1}/${urls.length}：${url}`);
    try {
      await deps.downloadFile(url, zipPath, {
        signal,
        socketTimeoutMs: deps.socketTimeoutMs,
        agentFor: deps.agentFor,
        onProgress: createProgressReporter(target.name, onLine),
      });
      return;
    } catch (error) {
      if (signal.aborted) {
        throw error instanceof Error ? error : new Error(describeError(error));
      }
      lastError = error instanceof Error ? error : new Error(describeError(error));
      onLine(`[${target.name}] 镜像下载失败：${describeError(error)}`);
    }
  }

  throw lastError ?? new Error(`没有可用的下载镜像：${target.name}`);
}

/** 按 ~5% 步长节流进度行，避免刷屏。 */
function createProgressReporter(
  name: string,
  onLine: (line: string) => void,
): (progress: DownloadProgress) => void {
  let lastEmittedPercent = Number.NEGATIVE_INFINITY;

  return (progress: DownloadProgress): void => {
    if (progress.percent === null) {
      return;
    }
    if (progress.percent < 100 && progress.percent - lastEmittedPercent < PROGRESS_STEP) {
      return;
    }
    if (progress.percent === 100 && lastEmittedPercent === 100) {
      return;
    }
    lastEmittedPercent = progress.percent;
    onLine(
      `[${name}] 下载进度 ${Math.floor(progress.percent)}%（${progress.receivedBytes}/${progress.totalBytes} 字节）`,
    );
  };
}

async function isInstalled(target: ManagedBrowserTarget): Promise<boolean> {
  try {
    await access(join(target.directory, INSTALLATION_COMPLETE_MARKER), constants.F_OK);
    const executable = join(target.directory, target.executableRelativePath);
    const executableStats = await stat(executable);
    if (!executableStats.isFile() || executableStats.size <= 0) {
      return false;
    }
    if (process.platform !== 'win32') {
      await access(executable, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/** 清理上一轮遗留的临时目录 / 半成品 zip；逐条忽略错误，绝不阻塞安装。 */
async function reapStaleArtifacts(
  browsersPath: string,
  onLine: (line: string) => void,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(browsersPath);
  } catch {
    return;
  }

  const cutoff = Date.now() - STALE_ARTIFACT_MAX_AGE_MS;
  for (const name of entries) {
    if (!isStaleArtifactName(name)) {
      continue;
    }
    const artifactPath = join(browsersPath, name);
    let artifactStats;
    try {
      artifactStats = await stat(artifactPath);
    } catch {
      continue;
    }
    if (artifactStats.mtimeMs >= cutoff) {
      continue;
    }
    await safeRemove(artifactPath, { recursive: true, force: true });
    onLine(`清理过期的下载残留：${name}`);
  }
}

function isStaleArtifactName(name: string): boolean {
  return name.includes('.tmp-') || (name.includes('.download-') && name.endsWith('.zip'));
}

/** 原子 rename；Windows 上杀毒软件 / 文件锁导致的 EPERM / EBUSY 重试一次。 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
    return;
  } catch (error) {
    if (!isRetryableRenameError(error)) {
      throw error;
    }
    await delay(RENAME_RETRY_DELAY_MS);
    await rename(from, to);
  }
}

function isRetryableRenameError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }
  return error.code === 'EPERM' || error.code === 'EBUSY';
}

/** 清理 helper：记录并吞掉清理错误，避免掩盖原始失败。 */
async function safeRemove(
  targetPath: string,
  options: { force?: boolean; recursive?: boolean },
): Promise<void> {
  try {
    await rm(targetPath, options);
  } catch (error) {
    console.warn(`[chromium-downloader] 清理失败：${targetPath}`, error);
  }
}

function abortErrorFrom(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('下载已取消');
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
