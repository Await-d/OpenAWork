import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '../../../..');
const gatewayDir = resolve(root, 'services/agent-gateway');
const binariesDir = resolve(root, 'apps/desktop/src-tauri/binaries');
const npmExecPath = process.env.npm_execpath ?? '';
const invokedByPnpm = basename(npmExecPath).toLowerCase().startsWith('pnpm');
const fallbackPnpmCommand = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
const fallbackPnpmBaseArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm'] : [];
const pnpmCommand = invokedByPnpm ? process.execPath : fallbackPnpmCommand;
const pnpmBaseArgs = invokedByPnpm ? [npmExecPath] : fallbackPnpmBaseArgs;

if (process.env.OPENAWORK_SKIP_SIDECAR_BUNDLE === '1') {
  console.log('Skipping gateway sidecar bundling because OPENAWORK_SKIP_SIDECAR_BUNDLE=1.');
  process.exit(0);
}

function createPnpmArgs(...args) {
  return [...pnpmBaseArgs, ...args];
}

// 当通过 pnpm 调用本脚本时，pnpmCommand = node.exe + pnpm 脚本路径，
// 可避免含空格的路径（如 D:\Program Files\...）被 cmd 拆断。
// npm_execpath 也会被 npm 设置；tauri-action 通过 npm run 调用时必须回退到 pnpm。
const useShell = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: useShell,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return result;
}

function runSoft(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell,
    ...options,
  });
}

/**
 * Bun 交叉编译会下载目标平台 runtime zip 并解压。
 * Windows runner 上偶发 “Failed to extract executable … download may be incomplete”。
 * 这里预热下载 + 有限重试，避免整次 release 因瞬时网络/解压失败挂掉。
 */
function resolveBunVersion() {
  const result = runSoft('bun', ['--version']);
  if (result.status !== 0) {
    return null;
  }
  const version = String(result.stdout || '')
    .trim()
    .replace(/^v/, '');
  return version || null;
}

function bunRuntimeAssetName(bunTarget) {
  // bun --target 使用 arm64 命名；release asset 实际是 aarch64
  // asset 文件名不带版本号，版本只在 download 路径里：
  //   https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-windows-aarch64.zip
  return `${String(bunTarget).replace(/-arm64(-|$)/, '-aarch64$1')}.zip`;
}

function prefetchBunRuntime(bunTarget) {
  const bunVersion = resolveBunVersion();
  if (!bunVersion) {
    console.warn('Unable to resolve bun version; skip runtime prefetch.');
    return;
  }

  const assetName = bunRuntimeAssetName(bunTarget);
  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/${assetName}`;
  console.log(`Prefetching Bun runtime for cross-compile: ${url}`);

  // 让 host bun 自己拉一次缓存；失败不阻断，后面仍会走正式 compile + 重试
  const warm = runSoft('bun', ['pm', 'cache']);
  if (warm.status !== 0) {
    // older bun may not support `pm cache`; ignore
  }

  // 用 curl/powershell 预下载到临时目录，至少验证 asset 可访问且完整
  const tmpDir = resolve(root, 'temp', 'bun-runtime-prefetch');
  const zipPath = resolve(tmpDir, assetName);
  try {
    run(
      process.platform === 'win32' ? 'powershell.exe' : 'bash',
      process.platform === 'win32'
        ? [
            '-NoLogo',
            '-NoProfile',
            '-Command',
            `New-Item -ItemType Directory -Force -Path '${tmpDir.replace(/'/g, "''")}' | Out-Null; ` +
              `Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath.replace(/'/g, "''")}'`,
          ]
        : ['-lc', `mkdir -p '${tmpDir}' && curl -fL --retry 3 --retry-delay 2 -o '${zipPath}' '${url}'`],
    );
    const sizeResult = runSoft(
      process.platform === 'win32' ? 'powershell.exe' : 'bash',
      process.platform === 'win32'
        ? ['-NoLogo', '-NoProfile', '-Command', `(Get-Item '${zipPath.replace(/'/g, "''")}').Length`]
        : ['-lc', `wc -c < '${zipPath}'`],
    );
    const size = Number(String(sizeResult.stdout || '').trim());
    if (!Number.isFinite(size) || size < 1_000_000) {
      console.warn(`Prefetched Bun runtime looks too small (${size} bytes): ${zipPath}`);
    } else {
      console.log(`Prefetched Bun runtime OK (${size} bytes): ${zipPath}`);
    }
  } catch (error) {
    console.warn(
      `Prefetch Bun runtime failed (will still try bun build): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function runBunCompileWithRetry(bunArgs, options = {}, attempts = 3) {
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      console.log(`bun compile attempt ${i}/${attempts}: bun ${bunArgs.join(' ')}`);
      run('bun', bunArgs, options);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`bun compile attempt ${i} failed: ${message}`);
      if (i < attempts) {
        // 给网络/解压一点恢复时间
        spawnSync(process.platform === 'win32' ? 'powershell.exe' : 'sleep',
          process.platform === 'win32'
            ? ['-NoLogo', '-NoProfile', '-Command', 'Start-Sleep -Seconds 2']
            : ['2'],
        );
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`bun compile failed after ${attempts} attempts`);
}

function readHostTriple() {
  const result = spawnSync('rustc', ['-Vv'], { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error('rustc -Vv failed while resolving host triple');
  }

  const hostLine = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('host:'));
  const hostTriple = hostLine?.slice('host:'.length).trim();
  if (!hostTriple) {
    throw new Error('Cannot resolve host triple from rustc -Vv output');
  }
  return hostTriple;
}

function readTargetTriple() {
  if (process.env.TAURI_TARGET_TRIPLE) {
    return process.env.TAURI_TARGET_TRIPLE;
  }
  return readHostTriple();
}

/**
 * Map a Rust/Tauri target triple to Bun's cross-compile --target value.
 * Returns null when the host binary is already the intended target (no flag needed).
 *
 * Without this, `bun build --compile` always emits a host-arch binary, then we
 * rename it with the target triple suffix — producing a mislabeled sidecar that
 * crashes on windows-aarch64 / linux-aarch64 / cross-mac builds.
 *
 * 注意：仅在“目标 ≠ 主机”时才返回 bun --target。主机匹配时强制 --target 会让
 * Bun 去下载/解压目标 runtime；Windows x64→arm64 场景下该步骤会稳定失败：
 *   Failed to extract executable for 'bun-windows-aarch64-v…'
 */
function bunCompileTargetForTriple(targetTriple) {
  const triple = String(targetTriple || '').trim();
  if (!triple) return null;

  let hostTriple = '';
  try {
    hostTriple = readHostTriple();
  } catch {
    hostTriple = '';
  }
  if (hostTriple && hostTriple === triple) {
    // 原生构建：直接用 host bun，不触发交叉 runtime 下载/解压
    return null;
  }

  /** @type {Record<string, string>} */
  const mapping = {
    'aarch64-apple-darwin': 'bun-darwin-arm64',
    'x86_64-apple-darwin': 'bun-darwin-x64',
    'aarch64-pc-windows-msvc': 'bun-windows-arm64',
    'x86_64-pc-windows-msvc': 'bun-windows-x64',
    'i686-pc-windows-msvc': 'bun-windows-x64',
    'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
    'x86_64-unknown-linux-gnu': 'bun-linux-x64',
    'aarch64-unknown-linux-musl': 'bun-linux-arm64-musl',
    'x86_64-unknown-linux-musl': 'bun-linux-x64-musl',
  };

  const mapped = mapping[triple];
  if (!mapped) {
    throw new Error(
      `Unsupported TAURI_TARGET_TRIPLE for Bun sidecar compile: ${triple}. ` +
        `Add a mapping in bundle-sidecar.mjs or unset TAURI_TARGET_TRIPLE for host builds.`,
    );
  }
  return mapped;
}

function isWindowsTriple(targetTriple) {
  return String(targetTriple || '').includes('windows');
}

function isLinuxTriple(targetTriple) {
  return String(targetTriple || '').includes('linux');
}

async function removeStaleGatewayBinaries() {
  await mkdir(binariesDir, { recursive: true });
  for (const entry of await readdir(binariesDir)) {
    if (entry.startsWith('agent-gateway-')) {
      await rm(resolve(binariesDir, entry), { force: true });
    }
  }
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createLinuxGatewayWrapper(payloadName, payloadHash) {
  return `#!/usr/bin/env sh
set -eu

payload_name=${shellSingleQuote(payloadName)}
payload_hash=${shellSingleQuote(payloadHash)}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cache_root="\${XDG_CACHE_HOME:-\${HOME:-/tmp}/.cache}/openawork/sidecars"
target="$cache_root/agent-gateway-$payload_hash"

# 诊断日志：写入 cache_root 同级目录，方便排查 AppImage 启动失败。
log_dir="\${XDG_CACHE_HOME:-\${HOME:-/tmp}/.cache}/openawork"
mkdir -p "$log_dir" 2>/dev/null || true
log_file="$log_dir/sidecar-launch.log"

log() {
  printf '[%s] %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$log_file" 2>/dev/null || true
}

log "=== sidecar wrapper start ==="
log "payload_name=$payload_name"
log "payload_hash=$payload_hash"
log "script_dir=$script_dir"
log "APPDIR=\${APPDIR:-<unset>}"
log "cache_root=$cache_root"
log "target=$target"

find_payload() {
  # 1) 相对路径：deb/rpm 安装或直接运行场景。
  for candidate in \\
    "$script_dir/$payload_name" \\
    "$script_dir/binaries/$payload_name" \\
    "$script_dir/../binaries/$payload_name" \\
    "$script_dir/../lib/openAwork-desktop/binaries/$payload_name" \\
    "$script_dir/../lib/OpenAWork/binaries/$payload_name" \\
    "$script_dir/../lib/openAwork/binaries/$payload_name"
  do
    if [ -f "$candidate" ]; then
      log "FOUND (relative): $candidate"
      printf '%s\\n' "$candidate"
      return 0
    else
      log "miss: $candidate"
    fi
  done

  # 2) AppImage 场景：Tauri 2.x 把 externalBin 放在 $APPDIR/usr/bin/，
  #    resources 放在 $APPDIR/usr/lib/<binary-name>/。
  #    用确定性路径避免 find 扫描整个 FUSE 挂载（极慢）。
  if [ -n "\${APPDIR:-}" ]; then
    log "AppImage mode detected, listing APPDIR structure:"
    ls -la "$APPDIR/usr/bin/" >> "$log_file" 2>&1 || true
    ls -la "$APPDIR/usr/lib/" >> "$log_file" 2>&1 || true
    # 列出所有 lib 子目录
    for d in "$APPDIR/usr/lib/"*/; do
      [ -d "$d" ] && log "  lib subdir: $d" && ls "$d" >> "$log_file" 2>&1 || true
    done

    for candidate in \\
      "$APPDIR/usr/bin/$payload_name" \\
      "$APPDIR/usr/bin/binaries/$payload_name" \\
      "$APPDIR/usr/lib/openAwork-desktop/binaries/$payload_name" \\
      "$APPDIR/usr/lib/openAwork-desktop/$payload_name" \\
      "$APPDIR/usr/lib/OpenAWork/binaries/$payload_name" \\
      "$APPDIR/usr/lib/OpenAWork/$payload_name" \\
      "$APPDIR/usr/lib/openAwork/binaries/$payload_name" \\
      "$APPDIR/usr/lib/openawork/binaries/$payload_name" \\
      "$APPDIR/usr/lib/binaries/$payload_name" \\
      "$APPDIR/usr/share/OpenAWork/binaries/$payload_name" \\
      "$APPDIR/usr/share/openAwork/binaries/$payload_name"
    do
      if [ -f "$candidate" ]; then
        log "FOUND (appimage): $candidate"
        printf '%s\\n' "$candidate"
        return 0
      else
        log "miss: $candidate"
      fi
    done
    # 确定性路径未命中时 fallback 到 find，限制深度减少 FUSE 开销。
    log "fallback: find APPDIR -maxdepth 4 -name $payload_name"
    found=$(find "$APPDIR" -maxdepth 4 -type f -name "$payload_name" -print -quit 2>/dev/null || true)
    if [ -n "$found" ]; then
      log "FOUND (find): $found"
      printf '%s\\n' "$found"
      return 0
    fi
    log "find returned nothing"
  fi

  # 3) 兜底：从 script_dir 向下搜索。
  log "fallback: find script_dir -maxdepth 5 -name $payload_name"
  found=$(find "$script_dir" -maxdepth 5 -type f -name "$payload_name" -print -quit 2>/dev/null || true)
  if [ -n "$found" ]; then
    log "FOUND (script_dir find): $found"
    printf '%s\\n' "$found"
    return 0
  fi

  log "payload NOT FOUND anywhere"
  return 1
}

payload=$(find_payload) || {
  log "FATAL: Cannot locate bundled agent-gateway payload: $payload_name"
  echo "Cannot locate bundled agent-gateway payload: $payload_name" >&2
  echo "Diagnostics written to: $log_file" >&2
  exit 127
}

log "payload resolved: $payload"

mkdir -p "$cache_root"
if [ ! -x "$target" ]; then
  log "decompressing payload to $target"
  tmp="$target.tmp.$$"
  gzip -dc "$payload" > "$tmp"
  chmod 755 "$tmp"
  mv -f "$tmp" "$target" 2>/dev/null || {
    # 并发启动：另一个进程可能已完成解压，mv 失败不致命。
    rm -f "$tmp" 2>/dev/null || true
    if [ ! -x "$target" ]; then
      log "FATAL: Failed to stage agent-gateway binary to $target"
      echo "Failed to stage agent-gateway binary to $target" >&2
      exit 1
    fi
  }
  log "decompression complete"
else
  log "using cached binary: $target"
fi

log "exec $target $@"
exec "$target" "$@"
`;
}

// Step 1: Compile gateway TypeScript（确保 workspace 依赖已编译）。
run(pnpmCommand, createPnpmArgs('build'), { cwd: gatewayDir });

// Step 2: 用 Bun 将 gateway 编译为独立可执行文件（含所有依赖）。
// 这一步产出 dist/agent-gateway[.exe]，无需 node_modules，彻底消除
// Windows 下 pnpm deploy 产生 NTFS junction 导致 tauri-build 资源打包失败的问题。
//
// playwright-core 内部有 chromium-bidi / electron 等可选模块，运行时按需懒加载；
// Bun --compile 静态分析时无法找到这些包，需标记 external 跳过。桌面端 sidecar
// 不使用 BiDi 协议或 Electron 自动化，标记后不影响实际运行时功能。
//
// 当 CI 传入 TAURI_TARGET_TRIPLE（交叉编译）时，必须同步传给 bun --target，
// 否则会把 host 架构二进制误标成目标架构（例如在 x64 runner 上打出 arm64 标签）。
const targetTriple = readTargetTriple();
const bunTarget = bunCompileTargetForTriple(targetTriple);
const bunArgs = [
  'build',
  'src/index.ts',
  '--compile',
  '--outfile',
  'dist/agent-gateway',
  '--external',
  'chromium-bidi',
  '--external',
  'electron',
];
if (bunTarget) {
  bunArgs.push('--target', bunTarget);
  console.log(`Cross-compiling gateway sidecar with bun --target=${bunTarget} (triple=${targetTriple})`);
  prefetchBunRuntime(bunTarget);
}
runBunCompileWithRetry(bunArgs, { cwd: gatewayDir }, 3);

// Step 3: 把 gateway 可执行文件复制到 binaries/ 并加上 Tauri 要求的目标三元组后缀。
// 扩展名按目标 triple 判断，而不是按当前 host OS（支持交叉编译）。
const executableExtension = isWindowsTriple(targetTriple) ? '.exe' : '';
const gatewaySrc = resolve(gatewayDir, `dist/agent-gateway${executableExtension}`);
const gatewayDest = resolve(binariesDir, `agent-gateway-${targetTriple}${executableExtension}`);

await removeStaleGatewayBinaries();
if (isLinuxTriple(targetTriple)) {
  const gatewayBytes = await readFile(gatewaySrc);
  const payloadHash = createHash('sha256').update(gatewayBytes).digest('hex').slice(0, 16);
  const payloadDest = `${gatewayDest}.gz`;
  await writeFile(payloadDest, gzipSync(gatewayBytes));
  await writeFile(gatewayDest, createLinuxGatewayWrapper(basename(payloadDest), payloadHash));
  await chmod(gatewayDest, 0o755);
  console.log(`Gateway payload staged: ${payloadDest}`);
} else {
  await cp(gatewaySrc, gatewayDest);
  if (!isWindowsTriple(targetTriple)) {
    await chmod(gatewayDest, 0o755);
  }
}
console.log(`Gateway binary staged: ${gatewayDest}`);

// Step 4: 写入 bundle stamp 触发 cargo 重新运行 build.rs。
const stampContents = `${new Date().toISOString()}\n`;
await writeFile(resolve(binariesDir, '.bundle-stamp'), stampContents);
console.log('Bundle stamp written; cargo will rerun tauri build script on next build');
