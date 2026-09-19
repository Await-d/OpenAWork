/**
 * 调试浏览器（Chromium）的**应用内引导安装**。
 *
 * 目标是当探针报告 `browser-missing` / `browser-outdated` 时，用户能在 Web UI 里
 * 点击「安装调试浏览器」直接完成安装，而不是被要求去终端执行命令。
 *
 * 设计要点：
 * - **运行时下载**：不再 spawn `playwright/cli.js`（打包成单二进制 sidecar 后该文件
 *   并不存在）。实际下载 / 解压 / 代理交给 {@link createChromiumDownloader}，它惰性
 *   加载 `@openAwork/browser-automation`，负责 revision / 平台映射与 zip 解压。
 * - **单飞**：同一时刻只允许一个安装在进行；重复调用返回 `started: false`，路由据此
 *   回 409。
 * - **有界日志**：下载进度合并进 ring buffer（最近 `INSTALL_TAIL_LOG_LIMIT` 行，每行
 *   截断 `INSTALL_TAIL_LOG_LINE_MAX` 字符），供 UI 展示。
 * - **超时**：默认 20 分钟；超时 abort 下载并标记 `failed`，避免永久 running。
 * - **无可用目标**：当前宿主平台没有任何可下载目标时进入诚实的 `unavailable` 态并给出
 *   可手动执行的命令——绝不假装能装。
 *
 * 安装目录解析与桌面端 `lib.rs` 的 `playwright_browsers_dir` 保持一致：
 * `PLAYWRIGHT_BROWSERS_PATH`（非空）优先，否则 `<gateway 数据目录>/browsers`。
 */

import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import type { Agent } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ManagedBrowserTarget } from '@openAwork/browser-automation';

import { resolveGatewayDataDir } from '../infra/storage-paths.js';
import type { downloadFile } from './browser-download.js';
import { createChromiumDownloader } from './chromium-downloader.js';
import type { ChromiumDownloader } from './chromium-downloader.js';

/** 安装状态机的状态。 */
export type BrowserInstallState = 'idle' | 'running' | 'succeeded' | 'failed' | 'unavailable';

/** 安装进度的不可变快照（`status()` 返回的永远是副本）。 */
export interface BrowserInstallStatus {
  state: BrowserInstallState;
  startedAt: number | null;
  finishedAt: number | null;
  /** 最近若干行安装输出。 */
  tailLog: string[];
  error: string | null;
  /** 目标浏览器目录。 */
  browsersPath: string | null;
}

/** 启动安装的结果：`started=false` 表示已有安装在进行中（单飞）。 */
export interface BrowserInstallStartResult {
  started: boolean;
  status: BrowserInstallStatus;
}

export interface BrowserInstallerOptions {
  /** @deprecated 旧 CLI 解析注入点，新实现不再使用；仅保留以兼容既有调用方。 */
  resolveCliPath?: () => string | null;
  /** 测试注入点：解析浏览器安装目录。 */
  resolveBrowsersPath?: () => string;
  /** 测试注入点：安装成功后的探针缓存失效回调（缺省用真实实现）。 */
  resetAvailabilityCache?: () => void;
  /** 安装墙钟上限，默认 20 分钟。 */
  timeoutMs?: number;
  /** 测试注入点：解析可下载的托管浏览器目标。 */
  resolveDownloadTargets?: (browsersPath: string) => Promise<ManagedBrowserTarget[]>;
  /** 测试注入点：流式下载实现。 */
  downloadFile?: typeof downloadFile;
  /** 测试注入点：zip 解压实现。 */
  extractZip?: (zipPath: string, directory: string) => Promise<void>;
  /** 测试注入点：按 URL 解析代理 Agent。 */
  agentFor?: (url: string) => Agent | undefined;
}

/** ring buffer 保留的最大行数。 */
export const INSTALL_TAIL_LOG_LIMIT = 40;

/** 单行最大字符数，超出截断。 */
export const INSTALL_TAIL_LOG_LINE_MAX = 300;

/**
 * 安装墙钟上限（20 分钟）。
 *
 * 需要顺序下载 chromium 与 chromium-headless-shell 两个构建，合计约 270MB，
 * 慢网下 10 分钟可能不足，因此放宽到 20 分钟。
 */
export const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;

/** 供 UI / 路由错误信息复用的手动命令。 */
export const MANUAL_INSTALL_COMMAND = 'npx playwright install chromium';

/** 已有安装在进行中时的稳定错误码（路由 409）。 */
export const BROWSER_INSTALL_CONFLICT_CODE = 'browser_install_in_progress';

/** 已有安装进行中时给用户的中文提示。 */
export const BROWSER_INSTALL_CONFLICT_MESSAGE = '调试浏览器安装已在进行中，请稍候。';

const CLI_PATH_ENV = 'OPENAWORK_PLAYWRIGHT_CLI';
const BROWSERS_PATH_ENV = 'PLAYWRIGHT_BROWSERS_PATH';
/** 测试用：显式指定 `@openAwork/browser-automation` 包目录；指向不存在路径即可模拟 CLI 缺席。 */
const AUTOMATION_DIR_ENV = 'OPENAWORK_BROWSER_AUTOMATION_DIR';

/**
 * 无可用 CLI 时给用户的诚实提示（含可手动执行的命令）。
 *
 * @deprecated CLI 安装路径已废弃，改用 {@link buildInstallUnavailableMessage}。
 */
export function buildCliUnavailableMessage(cliPathEnv: string): string {
  return `当前运行环境未内置 Playwright 安装器，无法在应用内安装调试浏览器。请改为在终端执行 ${MANUAL_INSTALL_COMMAND}（可通过环境变量 ${cliPathEnv} 指定 cli.js 路径）。`;
}

/**
 * 当前宿主平台没有可下载目标时给用户的诚实提示。
 *
 * 说明：运行时下载依赖 Playwright 注册表提供的平台映射，无对应构建（例如未知架构 /
 * 缺少下载地址）时无法在应用内安装，只能引导用户手动执行命令。
 */
export function buildInstallUnavailableMessage(): string {
  return `当前宿主平台（${process.platform}-${process.arch}）不支持在应用内下载调试浏览器。请改为在终端执行 ${MANUAL_INSTALL_COMMAND}。`;
}

/**
 * 解析 `playwright/cli.js`。
 *
 * @deprecated CLI 安装路径已废弃。保留该导出仅为兼容既有调用方 / 测试，新实现不再使用。
 *
 * 解析顺序（任一命中即止）：
 * 1. `OPENAWORK_PLAYWRIGHT_CLI` 显式覆盖（测试 / 特殊部署用；要求文件存在）；
 * 2. 从本模块自身解析 `playwright/package.json`；
 * 3. 从 `@openAwork/browser-automation` 入口解析——网关不直接依赖 playwright，
 *    它由 browser-automation 声明，pnpm 下常落在该包的嵌套 node_modules 里。
 *
 * 全部失败返回 null。
 */
export function resolvePlaywrightCliPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env[CLI_PATH_ENV]?.trim();
  if (override && existsSyncSafe(override)) {
    return override;
  }

  const requireFromHere = createRequire(fileURLToPath(import.meta.url));
  const direct = tryResolveCli(requireFromHere);
  if (direct) {
    return direct;
  }

  return resolveCliFromAutomation(defaultResolveBrowserAutomationEntry);
}

/**
 * 从 `@openAwork/browser-automation` 的依赖里去解析 `playwright/cli.js`。
 *
 * @deprecated CLI 安装路径已废弃。保留该导出仅为兼容既有调用方 / 测试。
 *
 * 独立导出纯函数便于单测注入：vitest 的 Vite 解析器可能与 Node 运行时不同。
 */
export function resolvePlaywrightCliPathFromAutomation(
  resolvePackageEntry: () => string = defaultResolveBrowserAutomationEntry,
): string | null {
  return resolveCliFromAutomation(resolvePackageEntry);
}

function resolveCliFromAutomation(resolvePackageEntry: () => string): string | null {
  const override = process.env[AUTOMATION_DIR_ENV]?.trim();
  if (override) {
    return existsSyncSafe(join(override, 'package.json'))
      ? tryResolveCli(createRequire(join(override, 'package.json')))
      : null;
  }
  try {
    const entryUrl = resolvePackageEntry();
    const packageDir = findPackageDir(dirname(fileURLToPath(entryUrl)));
    if (!packageDir) {
      return null;
    }
    return tryResolveCli(createRequire(join(packageDir, 'package.json')));
  } catch {
    return null;
  }
}

function defaultResolveBrowserAutomationEntry(): string {
  return import.meta.resolve('@openAwork/browser-automation');
}

function tryResolveCli(requireFn: NodeJS.Require): string | null {
  try {
    const packageJsonPath = requireFn.resolve('playwright/package.json');
    const cliPath = join(dirname(packageJsonPath), 'cli.js');
    return existsSyncSafe(cliPath) ? cliPath : null;
  } catch {
    return null;
  }
}

function findPackageDir(startDir: string): string | null {
  let current = startDir;
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSyncSafe(join(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

function existsSyncSafe(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/** 解析浏览器安装目录：`PLAYWRIGHT_BROWSERS_PATH` 优先，否则 `<gateway 数据目录>/browsers`。 */
export function resolveBrowsersPath(
  env: NodeJS.ProcessEnv = process.env,
  resolveDataDir: () => string = resolveGatewayDataDir,
): string {
  const configured = env[BROWSERS_PATH_ENV]?.trim();
  if (configured) {
    return configured;
  }
  return join(resolveDataDir(), 'browsers');
}

interface InstallerState {
  state: BrowserInstallState;
  startedAt: number | null;
  finishedAt: number | null;
  tailLog: string[];
  error: string | null;
  browsersPath: string | null;
}

export interface BrowserInstaller {
  status(): BrowserInstallStatus;
  install(): Promise<BrowserInstallStartResult>;
}

class BrowserInstallerImpl implements BrowserInstaller {
  private readonly resolveBrowsersPath: () => string;
  private readonly resetAvailabilityCache: () => void;
  private readonly timeoutMs: number;
  private readonly downloader: ChromiumDownloader;

  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly state: InstallerState = {
    state: 'idle',
    startedAt: null,
    finishedAt: null,
    tailLog: [],
    error: null,
    browsersPath: null,
  };

  constructor(options: BrowserInstallerOptions = {}) {
    this.resolveBrowsersPath = options.resolveBrowsersPath ?? resolveBrowsersPath;
    this.resetAvailabilityCache = options.resetAvailabilityCache ?? defaultResetAvailabilityCache;
    this.timeoutMs = options.timeoutMs ?? INSTALL_TIMEOUT_MS;
    this.downloader = createChromiumDownloader({
      resolveTargets: options.resolveDownloadTargets,
      downloadFile: options.downloadFile,
      extractZip: options.extractZip,
      agentFor: options.agentFor,
    });
  }

  status(): BrowserInstallStatus {
    return {
      state: this.state.state,
      startedAt: this.state.startedAt,
      finishedAt: this.state.finishedAt,
      // 快照必须深拷贝数组：调用方拿到的是副本，不能泄漏可变内部状态。
      tailLog: [...this.state.tailLog],
      error: this.state.error,
      browsersPath: this.state.browsersPath,
    };
  }

  async install(): Promise<BrowserInstallStartResult> {
    if (this.state.state === 'running') {
      return { started: false, status: this.status() };
    }

    const browsersPath = this.resolveBrowsersPath();
    if (!(await this.ensureBrowsersPath(browsersPath))) {
      this.state.state = 'failed';
      this.state.startedAt = null;
      this.state.finishedAt = Date.now();
      this.state.tailLog = [];
      this.state.browsersPath = browsersPath;
      this.state.error = `无法创建浏览器安装目录：${browsersPath}`;
      return { started: false, status: this.status() };
    }

    let targets: ManagedBrowserTarget[];
    try {
      targets = await this.downloader.resolveTargets(browsersPath);
    } catch (error) {
      this.state.state = 'failed';
      this.state.startedAt = null;
      this.state.finishedAt = Date.now();
      this.state.tailLog = [];
      this.state.browsersPath = browsersPath;
      this.state.error = `解析调试浏览器下载目标失败：${describeError(error)}`;
      return { started: false, status: this.status() };
    }

    if (targets.length === 0) {
      this.state.state = 'unavailable';
      this.state.startedAt = null;
      this.state.finishedAt = Date.now();
      this.state.tailLog = [];
      this.state.browsersPath = browsersPath;
      this.state.error = buildInstallUnavailableMessage();
      return { started: false, status: this.status() };
    }

    this.state.state = 'running';
    this.state.startedAt = Date.now();
    this.state.finishedAt = null;
    this.state.tailLog = [];
    this.state.error = null;
    this.state.browsersPath = browsersPath;

    const controller = new AbortController();

    if (this.timeoutMs > 0) {
      this.timeoutTimer = setTimeout(() => {
        this.timeoutTimer = null;
        if (this.state.state !== 'running') {
          return;
        }
        controller.abort(new Error('安装超时'));
        this.finishFailed(`安装超时（超过 ${Math.round(this.timeoutMs / 1000)} 秒未完成）。`);
      }, this.timeoutMs);
      this.timeoutTimer.unref?.();
    }

    void this.downloader
      .ensureInstalled(browsersPath, (line) => this.pushLog(line), controller.signal)
      .then(() => this.finishSucceeded())
      .catch((error: unknown) => this.finishFailed(describeError(error)));

    return { started: true, status: this.status() };
  }

  private pushLog(rawLine: string): void {
    const line = rawLine.trimEnd().slice(0, INSTALL_TAIL_LOG_LINE_MAX);
    if (line.length === 0) {
      return;
    }
    const tail = this.state.tailLog;
    tail.push(line);
    while (tail.length > INSTALL_TAIL_LOG_LIMIT) {
      tail.shift();
    }
  }

  private finishSucceeded(): void {
    if (this.state.state !== 'running') {
      return;
    }
    this.clearTimeout();
    this.state.state = 'succeeded';
    this.state.finishedAt = Date.now();
    this.state.error = null;
    this.resetAvailabilityCache();
  }

  private finishFailed(error: string): void {
    if (this.state.state !== 'running') {
      return;
    }
    this.clearTimeout();
    this.state.state = 'failed';
    this.state.finishedAt = Date.now();
    this.state.error = error;
  }

  private clearTimeout(): void {
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private async ensureBrowsersPath(browsersPath: string): Promise<boolean> {
    try {
      await mkdir(browsersPath, { recursive: true });
      const stats = await stat(browsersPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

function defaultResetAvailabilityCache(): void {
  // 惰性 import：避免模块顶层把 browser-automation（含 playwright）拖进网关进程。
  void import('@openAwork/browser-automation')
    .then((module) => {
      module.resetLiveBrowserAvailabilityCache();
    })
    .catch((error: unknown) => {
      console.warn('[browser-installer] failed to reset availability cache', error);
    });
}

export function createBrowserInstaller(options?: BrowserInstallerOptions): BrowserInstaller {
  return new BrowserInstallerImpl(options);
}

/** 模块级单例（与 `browserLiveManager` 同构）。 */
export const browserInstaller = createBrowserInstaller();
