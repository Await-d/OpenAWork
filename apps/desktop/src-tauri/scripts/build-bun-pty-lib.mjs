/**
 * 为 Windows ARM64 构建 bun-pty 的 Rust PTY 库，并覆盖到 bun-pty 期望的加载路径。
 *
 * 背景：bun-pty 的 npm 包只带 x64 的 `rust_pty.dll`（PE machine = 0x8664），
 * ARM64 的 Bun 进程无法加载 x64 DLL → 终端会回退到管道（无行编辑 / TUI）。
 * 上游仓库的 `rust-pty` crate（MIT）可以自行编译：这里在原生 ARM64 runner 上现场
 * 构建出 arm64 DLL，覆盖 `node_modules/bun-pty/rust-pty/target/release/rust_pty.dll`
 * —— 随后 `bun build --compile` 会把正确的 DLL 一并嵌入 sidecar（bun-pty 的加载器
 * 对 Windows 只有一个文件名，架构由内嵌时点决定）。
 *
 * 失败不致命：打印警告并返回 false，终端按既有逻辑回退管道；排查时也可用
 * `BUN_PTY_LIB` 手动指向外部库文件（bun-pty 自身支持的覆盖项）。
 *
 * 单独使用（本地 Windows ARM64 开发环境需要 Rust 工具链）：
 *   node apps/desktop/src-tauri/scripts/build-bun-pty-lib.mjs
 * 环境变量：
 *   BUN_PTY_SOURCE_URL  覆盖源码下载地址（默认按已安装 bun-pty 的版本取上游 tag）
 *   BUN_PTY_FORCE=1     在非 win32/arm64 主机上也尝试构建（诊断用）
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../../..');

/** PE machine 常量：ARM64 / x64。 */
const PE_MACHINE_ARM64 = 0xaa64;
const PE_MACHINE_X64 = 0x8664;

function log(message) {
  console.log(`[bun-pty-lib] ${message}`);
}

function warn(message) {
  console.warn(`[bun-pty-lib] ${message}`);
}

/** 读取 PE 文件的 machine 字段（0 表示无法识别）。 */
function readPeMachine(filePath) {
  try {
    const header = readFileSync(filePath);
    if (header.length < 0x40) return 0;
    const peOffset = header.readUInt32LE(0x3c);
    if (peOffset + 6 > header.length) return 0;
    if (header.toString('latin1', peOffset, peOffset + 4) !== 'PE\u0000\u0000') return 0;
    return header.readUInt16LE(peOffset + 4);
  } catch {
    return 0;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    // cargo 的输出量不受我们控制（依赖拉取 / 警告）：默认 1MB 上限会截断甚至杀进程，
    // 从而把一次成功构建误判为失败。
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.error ? String(result.error) : (result.stderr ?? '')),
  };
}

function resolveInstalledBunPtyDir(gatewayDir) {
  const require = createRequire(join(gatewayDir, 'package.json'));
  return dirname(require.resolve('bun-pty/package.json'));
}

async function downloadTarball(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`下载失败：HTTP ${response.status} ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000) {
    throw new Error(`下载内容过小（${bytes.length} bytes），疑似失败：${url}`);
  }
  await writeFile(destination, bytes);
  return bytes.length;
}

/**
 * 主入口：构建并把 arm64 DLL 覆盖到 bun-pty 的加载路径。
 * @param {{ gatewayDir?: string, force?: boolean }} [options]
 * @returns {Promise<boolean>} 是否成功替换（false = 保持原样并回退管道）
 */
export async function buildBunPtyArm64Lib(options = {}) {
  const gatewayDir = options.gatewayDir ?? resolve(repoRoot, 'services/agent-gateway');
  const force = options.force ?? process.env['BUN_PTY_FORCE'] === '1';

  const isWindowsArm64 = process.platform === 'win32' && process.arch === 'arm64';
  if (!isWindowsArm64 && !force) {
    log(`跳过：当前主机为 ${process.platform}/${process.arch}，只有 win32/arm64 需要现场构建`);
    return false;
  }

  let tempDir = null;
  try {
    const bunPtyDir = resolveInstalledBunPtyDir(gatewayDir);
    const packageJson = JSON.parse(await readFile(join(bunPtyDir, 'package.json'), 'utf8'));
    const version = String(packageJson.version ?? '').trim();
    if (!/^\d+\.\d+\.\d+/.test(version)) {
      warn(`无法从已安装的 bun-pty 解析版本（${version || '<empty>'}），跳过`);
      return false;
    }

    const sourceUrl =
      process.env['BUN_PTY_SOURCE_URL'] ??
      `https://github.com/sursaone/bun-pty/archive/refs/tags/v${version}.tar.gz`;
    const targetDll = join(bunPtyDir, 'rust-pty', 'target', 'release', 'rust_pty.dll');

    tempDir = await mkdtemp(join(tmpdir(), 'bun-pty-build-'));
    const tarballPath = join(tempDir, 'bun-pty.tar.gz');
    log(`下载上游源码：${sourceUrl}`);
    const bytes = await downloadTarball(sourceUrl, tarballPath);
    log(`下载完成（${Math.round(bytes / 1024)} KiB），解压中…`);

    const extract = run('tar', ['-xzf', tarballPath, '-C', tempDir]);
    if (!extract.ok) {
      throw new Error(`解压失败：${extract.stderr.trim() || `exit ${extract.status}`}`);
    }

    const crateDir = join(tempDir, `bun-pty-${version}`, 'rust-pty');
    if (!existsSync(crateDir)) {
      throw new Error(`解压后未找到 rust-pty 目录：${crateDir}`);
    }

    if (!run('cargo', ['--version']).ok) {
      throw new Error('未找到 cargo（需要 Rust 工具链）');
    }

    // 显式指定 target dir：环境里若存在 CARGO_TARGET_DIR（如 CI 的 rust-cache 注入），
    // 产物就不会落在 crateDir/target 下 —— 这里固定到临时目录，产物路径可预测。
    const cargoTargetDir = join(tempDir, 'cargo-target');
    log('cargo build --release（首次构建需拉取 crates 依赖，可能数分钟）…');
    const build = run('cargo', ['build', '--release'], {
      cwd: crateDir,
      env: { ...process.env, CARGO_TARGET_DIR: cargoTargetDir },
    });
    if (!build.ok) {
      const tail = (build.stderr || build.stdout).trim().split('\n').slice(-6).join(' | ');
      throw new Error(`cargo build 失败：${tail}`);
    }

    const builtDll = join(cargoTargetDir, 'release', 'rust_pty.dll');
    if (!existsSync(builtDll)) {
      throw new Error(`构建产物不存在：${builtDll}`);
    }
    const machine = readPeMachine(builtDll);
    if (machine !== PE_MACHINE_ARM64) {
      throw new Error(
        `构建产物不是 ARM64 DLL（PE machine=0x${machine.toString(16)}，期望 0x${PE_MACHINE_ARM64.toString(16)}）`,
      );
    }

    await mkdir(dirname(targetDll), { recursive: true });
    await copyFile(builtDll, targetDll);
    log(
      `已替换为 ARM64 DLL：${targetDll}（原 x64 版本 PE machine=0x${PE_MACHINE_X64.toString(16)}）`,
    );
    return true;
  } catch (error) {
    warn(
      `构建失败，保持原样（终端将回退管道）：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  } finally {
    if (tempDir !== null) {
      // 清理是尽力而为：Windows 上杀毒 / 索引器可能短暂持有句柄（EBUSY/EPERM），
      // 这里绝不能让清理失败把异常抛给调用方（否则会破坏发布构建）。
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        warn(`临时目录清理失败（忽略）：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

// 直接执行时运行（`node .../build-bun-pty-lib.mjs`）；失败不改变退出码（非致命）。
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  await buildBunPtyArm64Lib();
}
