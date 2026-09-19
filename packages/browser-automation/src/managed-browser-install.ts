/**
 * Playwright 托管浏览器的运行时安装支持。
 *
 * 桌面端 sidecar 由 `bun build --compile` 编译，Playwright CLI（`playwright/cli.js`）在
 * 运行时并不存在，因此网关需要自行下载 Chromium。本模块把 Playwright 自己的注册表元数据
 * （`browsers.json` 已由 Bun 内联进产物）、zip 解压与代理构造三项内部能力包装成稳定 API：
 *
 * 1. {@link resolveManagedBrowserTargets} —— 从 `playwright-core` 注册表解析出可下载的
 *    浏览器目标（chromium / chromium-headless-shell），并把目录重定位到调用方注入的
 *    `browsersPath` 之下（注册表目录在模块导入期就被环境变量固化，不能直接使用）；
 * 2. {@link extractBrowserArchive} —— 用 Playwright 自带的 zip 解压实现展开下载产物；
 * 3. {@link resolveProxyAgent} —— 复用 Playwright 的 `getProxyForUrl` 与代理 Agent
 *    实现，保证下载请求与企业代理 / socks 配置行为一致。
 *
 * 平台兼容：在无对应构建的宿主机（例如 ubuntu18.04、未知架构）上，注册表给出的
 * 可执行路径或下载地址为空，函数按约定返回空数组而不是抛错。
 */

import type { Agent } from 'node:http';
import { basename, join, relative } from 'node:path';

import { registry } from 'playwright-core/lib/server/registry/index';
import { getProxyForUrl, HttpsProxyAgent, SocksProxyAgent } from 'playwright-core/lib/utilsBundle';
import { extract } from 'playwright-core/lib/zipBundle';

/** 本模块支持的托管浏览器目标名。 */
export type ManagedBrowserTargetName = 'chromium' | 'chromium-headless-shell';

/** 单个可下载的托管浏览器目标。 */
export interface ManagedBrowserTarget {
  readonly name: ManagedBrowserTargetName;
  readonly revision: string;
  readonly browserVersion: string | null;
  /** 最终绝对目录，例如 <browsersPath>/chromium-1208 */
  readonly directory: string;
  /** 相对可执行路径，例如 chrome-linux64/chrome */
  readonly executableRelativePath: string;
  readonly downloadUrls: string[];
}

/** 下载主机覆盖变量：Chromium 专用优先，通用变量兜底（与 Playwright 自身语义一致）。 */
const CHROMIUM_DOWNLOAD_HOST_ENV = 'PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST';
const GENERIC_DOWNLOAD_HOST_ENV = 'PLAYWRIGHT_DOWNLOAD_HOST';

/** 解析顺序即产物顺序：主流 chromium 在前，headless shell 作为后备。 */
const MANAGED_BROWSER_TARGET_NAMES: readonly ManagedBrowserTargetName[] = [
  'chromium',
  'chromium-headless-shell',
];

/**
 * 读取下载主机覆盖。返回 `null` 表示未配置（保持注册表原始地址）。
 * 这里只做「拼接 + 取 pathname」的保守重写，不做 CDN 镜像语义推断。
 */
function resolveDownloadHostBase(env: NodeJS.ProcessEnv): string | null {
  const configured = env[CHROMIUM_DOWNLOAD_HOST_ENV] ?? env[GENERIC_DOWNLOAD_HOST_ENV];
  if (!configured) return null;

  const base = configured.trim().replace(/\/+$/, '');
  return base.length > 0 ? base : null;
}

/** 把单个下载地址重写到覆盖主机上，保留原始 pathname。 */
function rewriteDownloadUrl(downloadUrl: string, base: string): string {
  try {
    return `${base}${new URL(downloadUrl).pathname}`;
  } catch {
    // 地址不可解析时保留原样：单个异常数据不应导致整组下载源被丢弃。
    return downloadUrl;
  }
}

/** 对一组下载地址应用主机覆盖；未配置覆盖时原样返回副本。 */
function applyDownloadHostOverride(
  downloadUrls: readonly string[],
  env: NodeJS.ProcessEnv,
): string[] {
  const base = resolveDownloadHostBase(env);
  if (base === null) return [...downloadUrls];

  return downloadUrls.map((downloadUrl) => rewriteDownloadUrl(downloadUrl, base));
}

/**
 * 解析本机可下载的托管浏览器目标。
 *
 * - `browsersPath` 是最终安装根目录：目标目录取 `join(browsersPath, basename(registryDir))`，
 *   因此在导入后注入自定义路径依然生效；
 * - 注册表缺少可执行路径 / 目录 / 下载地址（无对应平台构建）时跳过该目标；
 * - `env` 缺省时回退到 `process.env`；显式传入空对象表示「不应用任何下载主机覆盖」。
 */
export function resolveManagedBrowserTargets(
  browsersPath: string,
  env?: NodeJS.ProcessEnv,
): ManagedBrowserTarget[] {
  const effectiveEnv = env ?? process.env;
  const targets: ManagedBrowserTarget[] = [];

  for (const name of MANAGED_BROWSER_TARGET_NAMES) {
    const executable = registry.findExecutable(name);
    if (!executable) continue;

    const absoluteExecutablePath = executable.executablePath();
    const capturedDirectory = executable.directory;
    if (!absoluteExecutablePath || !capturedDirectory) continue;

    const downloadUrls = applyDownloadHostOverride(executable.downloadURLs, effectiveEnv);
    if (downloadUrls.length === 0) continue;

    targets.push({
      name,
      revision: executable.revision,
      browserVersion: executable.browserVersion ?? null,
      directory: join(browsersPath, basename(capturedDirectory)),
      executableRelativePath: relative(capturedDirectory, absoluteExecutablePath),
      downloadUrls,
    });
  }

  return targets;
}

/** 解压 Playwright 下载的浏览器归档到目标目录（zip 布局由 Playwright 自身维护）。 */
export async function extractBrowserArchive(zipPath: string, directory: string): Promise<void> {
  return extract(zipPath, { dir: directory });
}

/** 依据 URL 解析代理 Agent：socks 协议走 SocksProxyAgent，其余走 HttpsProxyAgent。 */
export function resolveProxyAgent(url: string): Agent | undefined {
  const proxy = getProxyForUrl(url);
  if (!proxy) return undefined;
  return /^socks/i.test(proxy) ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy);
}
