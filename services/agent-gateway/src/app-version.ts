import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * 解析 gateway 当前进程对外报告的「应用版本号」。
 *
 * 历史 bug：当 gateway 作为 Tauri sidecar 的 Bun 编译二进制启动时，
 * `process.cwd()` 通常是桌面端可执行目录或用户 HOME，附近**根本没有**
 * 仓库的 `package.json`。原先 `routes/settings.ts` 的实现一路向上找
 * `name === 'openAwork'` 的 root package.json 都找不到，最后兜底成
 * `'0.0.1'`。哪怕用户卸载旧版本（保留用户数据）后安装了新版本，
 * 「设置 → 工作区」展示的「当前版本」依然是错误的兜底值。
 *
 * 修复策略：
 * 1. 桌面端 `spawn_gateway_sidecar` 注入 `OPENAWORK_APP_VERSION`，
 *    在生产/桌面环境永远走该路径，确保版本号与桌面安装包一致。
 * 2. 工作区源代码运行（dev / monorepo 测试）下走 package.json walk，
 *    用 root `openAwork` 包的 version 作为权威来源。
 * 3. 仍然提供 `npm_package_version` / `'0.0.1'` 作为最终兜底。
 */
export interface LoadAppVersionOptions {
  /** 注入用于测试的 env 容器；缺省取 `process.env`。 */
  env?: NodeJS.ProcessEnv;
  /** 注入用于测试的工作目录；缺省取 `process.cwd()`。 */
  cwd?: string;
  /** 注入用于测试的 fs.readFileSync；缺省使用真实读取。 */
  readFile?: (filePath: string) => string;
}

interface RootPackageJson {
  name?: string;
  version?: string;
}

const DEFAULT_FALLBACK_VERSION = '0.0.1';

function defaultReadFile(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

function tryReadPackageJson(
  filePath: string,
  readFile: (path: string) => string,
): RootPackageJson | null {
  try {
    const content = readFile(filePath);
    return JSON.parse(content) as RootPackageJson;
  } catch {
    return null;
  }
}

/**
 * 沿 cwd 向上找 `name === 'openAwork'` 的 root package.json。
 * 找到则返回 `version`，否则返回 null。中途读到的非 root package.json
 * 仍会返回最近一个有 version 字段的 fallback。
 */
function walkPackageJson(
  startCwd: string,
  readFile: (path: string) => string,
): { rootVersion: string | null; nearestVersion: string | null } {
  let nearestVersion: string | null = null;
  let cursor = startCwd;

  while (true) {
    const candidate = tryReadPackageJson(resolve(cursor, 'package.json'), readFile);
    if (candidate) {
      if (typeof candidate.version === 'string' && nearestVersion === null) {
        nearestVersion = candidate.version;
      }
      if (candidate.name === 'openAwork' && typeof candidate.version === 'string') {
        return { rootVersion: candidate.version, nearestVersion };
      }
    }

    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  return { rootVersion: null, nearestVersion };
}

/**
 * 解析当前 gateway 进程对外暴露的应用版本号。
 *
 * 解析顺序：
 * 1. `OPENAWORK_APP_VERSION` —— 桌面端 / 启动器显式注入。
 * 2. 工作区 root `openAwork` package.json —— monorepo 源码运行兜底。
 * 3. 最近一个 package.json 的 version —— bun-compile 也可能命中。
 * 4. `npm_package_version` —— `pnpm run` 之类的间接兜底。
 * 5. `'0.0.1'` —— 终极兜底；正常生产环境不应该走到这里。
 */
export function loadAppVersion(options: LoadAppVersionOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const readFile = options.readFile ?? defaultReadFile;

  const explicit = env['OPENAWORK_APP_VERSION'];
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit.trim();
  }

  const { rootVersion, nearestVersion } = walkPackageJson(cwd, readFile);
  if (rootVersion) {
    return rootVersion;
  }
  if (nearestVersion) {
    return nearestVersion;
  }

  const npmVersion = env['npm_package_version'];
  if (typeof npmVersion === 'string' && npmVersion.trim().length > 0) {
    return npmVersion.trim();
  }

  return DEFAULT_FALLBACK_VERSION;
}
