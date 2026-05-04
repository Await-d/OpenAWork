import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '../../../..');
const gatewayDir = resolve(root, 'services/agent-gateway');
const binariesDir = resolve(root, 'apps/desktop/src-tauri/binaries');
const pnpmCommand = process.env.npm_execpath ? process.execPath : 'pnpm';
const pnpmBaseArgs = process.env.npm_execpath ? [process.env.npm_execpath] : [];

function createPnpmArgs(...args) {
  return [...pnpmBaseArgs, ...args];
}

// Windows 下 'pnpm' 是 .cmd 脚本，需要 shell 才能被 spawnSync 找到。
// 但当通过 pnpm 调用本脚本时（npm_execpath 已设置），pnpmCommand = node.exe，
// 不需要 shell；且 shell=true 会导致含空格的路径（如 D:\Program Files\...）被 cmd 拆断。
const useShell = process.platform === 'win32' && !process.env.npm_execpath;

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

await mkdir(binariesDir, { recursive: true });
await cp(gatewaySrc, gatewayDest);
console.log(`Gateway binary staged: ${gatewayDest}`);

// Step 4: 写入 bundle stamp 触发 cargo 重新运行 build.rs。
const stampContents = `${new Date().toISOString()}\n`;
await writeFile(resolve(binariesDir, '.bundle-stamp'), stampContents);
console.log('Bundle stamp written; cargo will rerun tauri build script on next build');
