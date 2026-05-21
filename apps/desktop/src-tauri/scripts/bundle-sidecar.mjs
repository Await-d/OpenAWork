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
}

function readTargetTriple() {
  if (process.env.TAURI_TARGET_TRIPLE) {
    return process.env.TAURI_TARGET_TRIPLE;
  }

  const result = spawnSync('rustc', ['-Vv'], { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error('rustc -Vv failed while resolving Tauri target triple');
  }

  const hostLine = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('host:'));
  const targetTriple = hostLine?.slice('host:'.length).trim();
  if (!targetTriple) {
    throw new Error('Cannot resolve Tauri target triple from rustc -Vv output');
  }

  return targetTriple;
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

find_payload() {
  # 1) 相对路径：deb/rpm 安装或直接运行场景。
  for candidate in \\
    "$script_dir/$payload_name" \\
    "$script_dir/binaries/$payload_name" \\
    "$script_dir/../binaries/$payload_name" \\
    "$script_dir/../lib/OpenAWork/binaries/$payload_name" \\
    "$script_dir/../lib/openAwork/binaries/$payload_name"
  do
    if [ -f "$candidate" ]; then
      printf '%s\\n' "$candidate"
      return 0
    fi
  done

  # 2) AppImage 场景：Tauri 2.x 把 externalBin 放在 $APPDIR/usr/bin/，
  #    resources 放在 $APPDIR/usr/lib/<productName>/。
  #    用确定性路径避免 find 扫描整个 FUSE 挂载（极慢）。
  if [ -n "\${APPDIR:-}" ]; then
    for candidate in \\
      "$APPDIR/usr/bin/$payload_name" \\
      "$APPDIR/usr/bin/binaries/$payload_name" \\
      "$APPDIR/usr/lib/OpenAWork/binaries/$payload_name" \\
      "$APPDIR/usr/lib/OpenAWork/$payload_name" \\
      "$APPDIR/usr/lib/openAwork/binaries/$payload_name" \\
      "$APPDIR/usr/lib/openawork/binaries/$payload_name" \\
      "$APPDIR/usr/lib/binaries/$payload_name" \\
      "$APPDIR/usr/share/OpenAWork/binaries/$payload_name" \\
      "$APPDIR/usr/share/openAwork/binaries/$payload_name"
    do
      if [ -f "$candidate" ]; then
        printf '%s\\n' "$candidate"
        return 0
      fi
    done
    # 确定性路径未命中时 fallback 到 find，限制深度减少 FUSE 开销。
    found=$(find "$APPDIR" -maxdepth 4 -type f -name "$payload_name" -print -quit 2>/dev/null || true)
    if [ -n "$found" ]; then
      printf '%s\\n' "$found"
      return 0
    fi
  fi

  # 3) 兜底：从 script_dir 向下搜索。
  found=$(find "$script_dir" -maxdepth 5 -type f -name "$payload_name" -print -quit 2>/dev/null || true)
  if [ -n "$found" ]; then
    printf '%s\\n' "$found"
    return 0
  fi

  return 1
}

payload=$(find_payload) || {
  echo "Cannot locate bundled agent-gateway payload: $payload_name" >&2
  exit 127
}

mkdir -p "$cache_root"
if [ ! -x "$target" ]; then
  tmp="$target.tmp.$$"
  gzip -dc "$payload" > "$tmp"
  chmod 755 "$tmp"
  mv -f "$tmp" "$target" 2>/dev/null || {
    # 并发启动：另一个进程可能已完成解压，mv 失败不致命。
    rm -f "$tmp" 2>/dev/null || true
    if [ ! -x "$target" ]; then
      echo "Failed to stage agent-gateway binary to $target" >&2
      exit 1
    fi
  }
fi

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
run('bun', [
  'build', 'src/index.ts',
  '--compile',
  '--outfile', `dist/agent-gateway`,
  '--external', 'chromium-bidi',
  '--external', 'electron',
], { cwd: gatewayDir });

// Step 3: 把 gateway 可执行文件复制到 binaries/ 并加上 Tauri 要求的目标三元组后缀。
const targetTriple = readTargetTriple();
const executableExtension = process.platform === 'win32' ? '.exe' : '';
const gatewaySrc = resolve(gatewayDir, `dist/agent-gateway${executableExtension}`);
const gatewayDest = resolve(binariesDir, `agent-gateway-${targetTriple}${executableExtension}`);

await removeStaleGatewayBinaries();
if (process.platform === 'linux') {
  const gatewayBytes = await readFile(gatewaySrc);
  const payloadHash = createHash('sha256').update(gatewayBytes).digest('hex').slice(0, 16);
  const payloadDest = `${gatewayDest}.gz`;
  await writeFile(payloadDest, gzipSync(gatewayBytes));
  await writeFile(gatewayDest, createLinuxGatewayWrapper(basename(payloadDest), payloadHash));
  await chmod(gatewayDest, 0o755);
  console.log(`Gateway payload staged: ${payloadDest}`);
} else {
  await cp(gatewaySrc, gatewayDest);
  if (process.platform !== 'win32') {
    await chmod(gatewayDest, 0o755);
  }
}
console.log(`Gateway binary staged: ${gatewayDest}`);

// Step 4: 写入 bundle stamp 触发 cargo 重新运行 build.rs。
const stampContents = `${new Date().toISOString()}\n`;
await writeFile(resolve(binariesDir, '.bundle-stamp'), stampContents);
console.log('Bundle stamp written; cargo will rerun tauri build script on next build');
