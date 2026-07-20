import { accessSync, constants, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const REQUIRE_NATIVE_CHECK = process.env.OPENAWORK_REQUIRE_DESKTOP_NATIVE_CHECK === '1';
const REPO_ROOT = resolve(process.cwd());

function hasCommand(command) {
  const pathValue = process.env.PATH ?? '';
  if (!pathValue) {
    return false;
  }

  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter((entry) => entry.length > 0)
      : [''];

  for (const directory of pathValue.split(delimiter)) {
    if (!directory) {
      continue;
    }

    for (const extension of extensions) {
      const candidate =
        process.platform === 'win32' && command.toLowerCase().endsWith(extension.toLowerCase())
          ? join(directory, command)
          : join(directory, `${command}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch (_error) {
        continue;
      }
    }
  }

  return false;
}

function resolveCommand(command, fallbackPaths = []) {
  if (hasCommand(command)) {
    return command;
  }

  return fallbackPaths.find((candidate) => existsSync(candidate)) ?? null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.signal) {
    console.error(`桌面原生检查被信号中断：${result.signal}`);
    process.exit(1);
  }
}

const cargoCommand = resolveCommand('cargo', ['/usr/local/cargo/bin/cargo']);
const bunCommand = resolveCommand('bun');

if (!cargoCommand) {
  const message =
    '未检测到 cargo，无法执行桌面原生检查。若改动 apps/desktop/src-tauri/**，请先安装 Rust 工具链后再运行 `pnpm check:desktop-native`。';
  if (REQUIRE_NATIVE_CHECK) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
  process.exit(0);
}

if (!bunCommand) {
  const message =
    '未检测到 bun，无法生成桌面 sidecar。若改动 apps/desktop/**，请先安装 Bun 后再运行 `pnpm check:desktop-native`。';
  if (REQUIRE_NATIVE_CHECK) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
  process.exit(0);
}

if (process.platform === 'linux') {
  run('node', ['apps/desktop/src-tauri/scripts/check-build-deps.mjs']);
}

const tempTargetDir = mkdtempSync(join(tmpdir(), 'openawork-desktop-native-target-'));
const childEnv = {
  ...process.env,
  CARGO_TARGET_DIR: tempTargetDir,
};

try {
  run('node', ['apps/desktop/src-tauri/scripts/bundle-sidecar.mjs'], {
    cwd: REPO_ROOT,
    env: childEnv,
  });
  run(
    cargoCommand,
    ['check', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--all-targets'],
    {
      cwd: REPO_ROOT,
      env: childEnv,
    },
  );
} finally {
  rmSync(resolve(REPO_ROOT, 'services/agent-gateway/dist'), {
    force: true,
    recursive: true,
  });

  const binariesDir = resolve(REPO_ROOT, 'apps/desktop/src-tauri/binaries');
  if (existsSync(binariesDir)) {
    for (const entry of readdirSync(binariesDir)) {
      if (entry.startsWith('agent-gateway-')) {
        rmSync(resolve(binariesDir, entry), { force: true, recursive: true });
      }
    }
  }
}
