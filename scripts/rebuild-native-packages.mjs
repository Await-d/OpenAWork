#!/usr/bin/env node
/**
 * 重新执行指定依赖包的生命周期脚本。
 *
 * 背景：bun 没有 `pnpm rebuild <pkg>` 的等价命令，而桌面端跨架构打包与
 * 单包原生产物补装都需要「按目标 arch/platform 重跑 install/postinstall」的能力。
 *
 * 使用场景：
 *   1) 桌面端跨架构打包前，按目标 arch/platform 重跑原生依赖
 *      （ffmpeg-static / ffprobe-static / better-sqlite3 / koffi / @sentry/cli / esbuild / msw）；
 *   2) 单个包的原生产物缺失时按需补装。
 *
 * 解析规则与隔离式 node_modules（bun / pnpm）一致：先沿「哪个清单声明了它」解析，
 * 解析不到再从 bun 的 node_modules/.bun store 兜底（供 esbuild 这类传递依赖使用）。
 *
 * 用法：node scripts/rebuild-native-packages.mjs <pkg...> [--arch=<arch>] [--platform=<platform>]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIFECYCLE_SCRIPT_NAMES = ['preinstall', 'install', 'postinstall'];
const WORKSPACE_ROOTS = ['apps', 'packages', 'services'];

function listWorkspaceManifests() {
  const manifests = [join(rootDir, 'package.json')];

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const absoluteRoot = join(rootDir, workspaceRoot);
    if (!existsSync(absoluteRoot)) {
      continue;
    }
    for (const entry of readdirSync(absoluteRoot)) {
      const manifestPath = join(absoluteRoot, entry, 'package.json');
      if (existsSync(manifestPath)) {
        manifests.push(manifestPath);
      }
    }
  }

  return manifests;
}

/**
 * 沿声明链解析包目录；解析不到时回退到 bun store 扫描。
 * store 里 scoped 包目录名写作 `@scope+name@version`。
 */
export function resolveInstalledPackageDir(packageName) {
  for (const manifestPath of listWorkspaceManifests()) {
    try {
      const require = createRequire(manifestPath);
      return dirname(require.resolve(`${packageName}/package.json`));
    } catch {
      // 该清单未声明此包，继续下一个。
    }
  }

  const storeDir = join(rootDir, 'node_modules', '.bun');
  if (!existsSync(storeDir)) {
    return null;
  }

  const prefix = `${packageName.replace('/', '+')}@`;
  const candidates = readdirSync(storeDir)
    .filter((entry) => entry.startsWith(prefix))
    .sort();
  const chosen = candidates.at(-1);
  if (!chosen) {
    return null;
  }

  const candidateDir = join(storeDir, chosen, 'node_modules', packageName);
  return existsSync(join(candidateDir, 'package.json')) ? candidateDir : null;
}

/**
 * 依次执行各包的 preinstall / install / postinstall。
 * 返回每个包的执行结果；任一脚本非零退出即抛错（与 pnpm rebuild 行为一致）。
 */
export function runPackageLifecycleScripts(packageNames, options = {}) {
  const env = { ...process.env };
  if (options.arch) {
    env.npm_config_arch = options.arch;
  }
  if (options.platform) {
    env.npm_config_platform = options.platform;
  }

  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const results = [];

  for (const packageName of packageNames) {
    const packageDir = resolveInstalledPackageDir(packageName);
    if (!packageDir) {
      results.push({ packageName, ran: false, reason: 'package-not-found' });
      continue;
    }

    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    const scripts = manifest.scripts ?? {};
    const scriptNames = LIFECYCLE_SCRIPT_NAMES.filter(
      (name) => typeof scripts[name] === 'string' && scripts[name].trim().length > 0,
    );

    if (scriptNames.length === 0) {
      results.push({ packageName, ran: false, reason: 'no-lifecycle-script', packageDir });
      continue;
    }

    // 与 npm/pnpm 运行生命周期脚本的语义对齐：把包自身、**包所在 node_modules** 与
    // 仓库根的 `.bin` 加进 PATH。
    //
    // 关键点是中间那一项：隔离式布局（bun 的 `node_modules/.bun/<name>@<ver>/node_modules/`
    // 与 pnpm 的 `.pnpm/...`）把「该包依赖的 bin」放在**包的父级** `node_modules/.bin`，
    // 而不是包内部的 `node_modules/.bin`（后者通常不存在）。例如 better-sqlite3 的 install
    // 脚本是 `prebuild-install || node-gyp rebuild`，prebuild-install 只挂在父级 .bin 下；
    // 漏掉它就会退化为「找不到 prebuild-install」→ 无 node-gyp 的环境（如 Windows ARM64
    // runner）直接失败，有 node-gyp 的环境则静默改成源码编译。
    const scriptEnv = {
      ...env,
      PATH: [
        join(packageDir, 'node_modules', '.bin'),
        join(dirname(packageDir), '.bin'),
        join(rootDir, 'node_modules', '.bin'),
        env.PATH ?? '',
      ]
        .filter((entry) => entry.length > 0)
        .join(pathSeparator),
    };

    for (const scriptName of scriptNames) {
      const scriptCommand = scripts[scriptName];
      console.log(`[rebuild] ${packageName}: ${scriptName} → ${scriptCommand}`);
      const result = spawnSync(scriptCommand, {
        cwd: packageDir,
        env: scriptEnv,
        stdio: 'inherit',
        shell: true,
      });
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(
          `[rebuild] ${packageName} 的 ${scriptName} 脚本失败（退出码 ${result.status ?? 'unknown'}）`,
        );
      }
    }

    results.push({ packageName, ran: true, packageDir, scripts: scriptNames });
  }

  return results;
}

const isCliEntry =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCliEntry) {
  const args = process.argv.slice(2);
  const packageNames = [];
  let arch;
  let platform;

  for (const arg of args) {
    if (arg.startsWith('--arch=')) {
      arch = arg.slice('--arch='.length);
      continue;
    }
    if (arg.startsWith('--platform=')) {
      platform = arg.slice('--platform='.length);
      continue;
    }
    packageNames.push(arg);
  }

  if (packageNames.length === 0) {
    process.stderr.write(
      '用法：node scripts/rebuild-native-packages.mjs <pkg...> [--arch=<arch>] [--platform=<platform>]\n',
    );
    process.exit(1);
  }

  try {
    const results = runPackageLifecycleScripts(packageNames, { arch, platform });
    for (const result of results) {
      if (result.ran) {
        console.log(`[rebuild] ${result.packageName}: 完成（${result.scripts.join(', ')}）`);
      } else {
        console.warn(`[rebuild] ${result.packageName}: 跳过（${result.reason}）`);
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
