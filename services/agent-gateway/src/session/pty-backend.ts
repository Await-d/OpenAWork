/**
 * Unified terminal process backend — real PTY on Bun (non-Windows), the
 * `bun-pty` package on Windows (Rust `portable-pty` + Bun FFI), and a pipe
 * fallback everywhere else (Node, or when the PTY module is unavailable).
 *
 * PTY support comes from Bun's native `Bun.spawn(cmd, { terminal })` on
 * POSIX; Windows is explicitly unsupported by that API (Bun documents the
 * Terminal API as POSIX-only), so Windows uses the third-party `bun-pty`
 * package, which bundles prebuilt `portable-pty` libraries for every platform
 * and is designed to work inside `bun build --compile` output. Node has no
 * built-in PTY and never loads `bun-pty`, so it degrades to piped stdio:
 * input/output still flow, but `isatty()` is false, resize is a no-op
 * signalled by a `false` return, and the capability probe reports
 * `interactive: false` so callers and clients know TUI / resize support is
 * absent. That piped path still executes commands — it is an explicit
 * degradation, not a fake terminal.
 *
 * Bun exposes no ambient TypeScript types, and this repo forbids `any` /
 * `@ts-ignore`, so runtime handles are narrowed through minimal local
 * structural interfaces below.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { Buffer } from 'node:buffer';

export type TerminalBackendKind = 'pty' | 'pipe';

export interface TerminalBackendCapabilities {
  kind: TerminalBackendKind;
  runtime: 'bun' | 'node';
  platform: NodeJS.Platform;
  supportsResize: boolean;
  /**
   * True only for a real PTY backend. When false the shell has no terminal
   * (`isatty()` is false): resize is a no-op and TUI / full-screen programs
   * are unsupported, though piped stdin still executes commands.
   */
  interactive: boolean;
  reason?: string;
}

export interface SpawnTerminalProcessInput {
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
  onData: (chunk: Uint8Array) => void;
  onExit: (code: number | null, signal: string | null) => void;
  onError: (error: Error) => void;
}

export interface TerminalProcess {
  readonly pid: number | undefined;
  readonly backend: TerminalBackendKind;
  write(data: string): void;
  /** Returns true when the resize was actually dispatched (PTY); false for pipe. */
  resize(cols: number, rows: number): boolean;
  /** Graceful teardown: PTY → terminal.close(); pipe → stdin.end(). */
  close(): void;
  /** Forced termination: SIGTERM/SIGKILL (Windows goes through taskkill). */
  kill(): void;
}

interface BunTerminalLike {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface BunTerminalOptionsLike {
  cols: number;
  rows: number;
  data: (terminal: unknown, data: Uint8Array) => void;
}

interface BunProcessLike {
  readonly pid: number | undefined;
  readonly terminal: BunTerminalLike | undefined;
  readonly exited: Promise<number>;
  kill(signal?: string | number): void;
}

interface BunSpawnOptionsLike {
  cwd?: string;
  env?: Record<string, string | undefined>;
  terminal?: BunTerminalOptionsLike | BunTerminalLike;
}

interface BunRuntimeLike {
  spawn(command: string[], options: BunSpawnOptionsLike): BunProcessLike;
}

function getBunRuntime(): BunRuntimeLike | undefined {
  const candidate = (globalThis as Record<string, unknown>)['Bun'];
  if (candidate === null || typeof candidate !== 'object') return undefined;
  const spawnFn = (candidate as { spawn?: unknown }).spawn;
  if (typeof spawnFn !== 'function') return undefined;
  return candidate as unknown as BunRuntimeLike;
}

function isBunRuntime(): boolean {
  if (getBunRuntime() !== undefined) return true;
  const versions = (process as NodeJS.Process & { versions?: Record<string, string | undefined> })
    .versions;
  return typeof versions?.['bun'] === 'string';
}

/* ---------------------------------------------------------------------- */
/* bun-pty：Windows 上的真实 PTY                                           */
/* ---------------------------------------------------------------------- */

/**
 * `bun-pty` 的最小结构切片（仓库禁止 `any`；该包的运行时形状在此显式收窄）。
 * 只声明实际使用的成员，避免与上游实现细节耦合。
 */
export interface BunPtyTerminalLike {
  readonly pid: number;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number | string }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface BunPtyModuleLike {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ): BunPtyTerminalLike;
}

let bunPtyModuleCache: BunPtyModuleLike | null | undefined;
let bunPtyModuleLoaderOverride: (() => BunPtyModuleLike | null) | undefined;
let terminalCapabilitiesOverride: TerminalBackendCapabilities | undefined;

/** 测试钩子：注入替身加载器（传 null 恢复真实加载）。 */
export function __setBunPtyModuleLoaderForTest(
  loader: (() => BunPtyModuleLike | null) | null,
): void {
  bunPtyModuleLoaderOverride = loader ?? undefined;
  bunPtyModuleCache = undefined;
}

/** 测试钩子：覆盖能力探测（用于在非 Windows 主机上验证 Windows 选择分支）。 */
export function __setTerminalCapabilitiesForTest(
  capabilities: TerminalBackendCapabilities | null,
): void {
  terminalCapabilitiesOverride = capabilities ?? undefined;
}

/** 排查用逃生门：`OPENAWORK_DISABLE_BUN_PTY=1` 强制回到管道后端。 */
function isBunPtyDisabledByEnv(): boolean {
  const raw = process.env['OPENAWORK_DISABLE_BUN_PTY'];
  return raw === '1' || raw === 'true';
}

/**
 * Bun 在 ESM 中提供 CommonJS 风格的 `require`；Node 没有（该分支只在 Bun 下执行）。
 * 必须用**裸 `require('bun-pty')`**：Bun 打包器只对可静态分析的 require 做嵌入，
 * `createRequire(...)('bun-pty')` 不会被分析，编译成单文件 sidecar 后会在运行时报
 * `Cannot find module`（已实测）。裸 require 则会把 bun-pty 及其内联的平台预编译库
 * 一起嵌入（与编译产物探针验证一致）。若打包环境仍未嵌入成功，还可用 `BUN_PTY_LIB`
 * 指向外部库文件兜底（bun-pty 自身支持的覆盖项）。
 */
declare const require: ((id: string) => unknown) | undefined;

/**
 * 按需加载 `bun-pty`（仅 Bun 运行时；它依赖 `bun:ffi`，Node 下必然失败）。
 * 结果缓存；任何失败只警告并返回 null，由调用方回退管道 —— 终端功能绝不因缺库
 * 而整体不可用。
 */
export function loadBunPtyModule(): BunPtyModuleLike | null {
  if (bunPtyModuleLoaderOverride !== undefined) return bunPtyModuleLoaderOverride();
  if (bunPtyModuleCache !== undefined) return bunPtyModuleCache;
  bunPtyModuleCache = null;
  if (!isBunRuntime() || isBunPtyDisabledByEnv()) return null;
  try {
    const loaded = (
      typeof require === 'function' ? require('bun-pty') : null
    ) as Partial<BunPtyModuleLike> | null;
    if (loaded === null || typeof loaded.spawn !== 'function') {
      console.warn('[pty-backend] bun-pty 缺少 spawn 导出，回退管道');
      return null;
    }
    bunPtyModuleCache = loaded as BunPtyModuleLike;
  } catch (error) {
    // ARM64 Windows 上 bun-pty 的预编译库目前只有 x64（无法加载进 ARM64 进程），
    // 这里给出明确提示，避免把「回退管道」误判成配置错误。
    const hint =
      process.platform === 'win32' && process.arch === 'arm64'
        ? '（bun-pty 的 Windows 预编译库目前仅 x64，ARM64 上只能回退管道）'
        : '';
    console.warn(
      `[pty-backend] bun-pty 加载失败，回退管道${hint}：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return bunPtyModuleCache;
}

/** Pure capability probe. Injectable for tests; never throws. */
export function detectTerminalBackend(env?: {
  isBun?: boolean;
  platform?: NodeJS.Platform;
}): TerminalBackendCapabilities {
  const platform = env?.platform ?? process.platform;
  const isBun = env?.isBun ?? isBunRuntime();
  const runtime: 'bun' | 'node' = isBun ? 'bun' : 'node';
  if (isBun && platform !== 'win32') {
    return { kind: 'pty', runtime, platform, supportsResize: true, interactive: true };
  }
  const reason = isBun
    ? `bun runtime on ${platform} has no native PTY (Windows uses bun-pty; pipes only when it is unavailable)`
    : 'node runtime has no built-in PTY; falling back to pipes';
  return { kind: 'pipe', runtime, platform, supportsResize: false, interactive: false, reason };
}

let pipeFallbackLogged = false;

function logPipeFallbackOnce(capabilities: TerminalBackendCapabilities): void {
  if (pipeFallbackLogged) return;
  pipeFallbackLogged = true;
  console.warn(
    `[pty-backend] pty unavailable, falling back to pipe, reason=${capabilities.reason ?? 'unknown'}`,
  );
}

function createExitOnce(onExit: SpawnTerminalProcessInput['onExit']) {
  let fired = false;
  return (code: number | null, signal: string | null): void => {
    if (fired) return;
    fired = true;
    onExit(code, signal);
  };
}

function createErrorOnce(onError: SpawnTerminalProcessInput['onError']) {
  let fired = false;
  return (error: Error): void => {
    if (fired) return;
    fired = true;
    onError(error);
  };
}

export function spawnTerminalProcess(input: SpawnTerminalProcessInput): TerminalProcess {
  const capabilities = terminalCapabilitiesOverride ?? detectTerminalBackend();
  // 诊断/验证用：强制走 bun-pty（即使平台有原生 PTY），用于在 Linux 上验证
  // 编译产物内的 bun-pty 嵌入是否可用。
  const forceBunPty = process.env['OPENAWORK_PTY_BACKEND'] === 'bun-pty';

  if (!forceBunPty && capabilities.kind === 'pty') {
    const bun = getBunRuntime();
    if (bun !== undefined) {
      return spawnBunNativeTerminal(input, bun);
    }
  }

  // Windows：Bun 原生 Terminal API 未实现（官方 POSIX-only），改用 bun-pty
  // （portable-pty + Bun FFI）。加载/启动的任何失败都回退管道，终端功能不整体打挂。
  // 强制开关同时服务于诊断/验证：它在任意平台都尝试加载 bun-pty（真实加载仍要求
  // Bun 运行时，Node 下自然回退管道）。
  const bunPtyEligible =
    forceBunPty || (capabilities.runtime === 'bun' && capabilities.kind !== 'pty');
  if (bunPtyEligible) {
    const bunPty = loadBunPtyModule();
    if (bunPty !== null) {
      try {
        return spawnBunPtyModule(input, bunPty);
      } catch (error) {
        console.warn(
          `[pty-backend] bun-pty 启动失败，回退管道：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  logPipeFallbackOnce(capabilities);
  return spawnPipe(input);
}

function spawnBunNativeTerminal(
  input: SpawnTerminalProcessInput,
  bun: BunRuntimeLike,
): TerminalProcess {
  const proc = bun.spawn([input.shell, ...input.args], {
    cwd: input.cwd,
    env: input.env,
    terminal: {
      cols: input.cols,
      rows: input.rows,
      data: (_terminal, data) => input.onData(data),
    },
  });
  const exitOnce = createExitOnce(input.onExit);
  const errorOnce = createErrorOnce(input.onError);
  proc.exited
    .then((code) => {
      exitOnce(code ?? null, null);
    })
    .catch((error: unknown) => {
      errorOnce(error instanceof Error ? error : new Error(String(error)));
    });
  const terminal = proc.terminal;
  const pid = proc.pid;
  return {
    pid,
    backend: 'pty',
    write(data) {
      // 就绪门控的 `initialCommand` 可能由定时器在 terminal 关闭后写入，不能抛出。
      try {
        terminal?.write(data);
      } catch {
        /* terminal already closed — the exit handler surfaces the outcome */
      }
    },
    resize(cols, rows) {
      if (terminal === undefined) return false;
      try {
        terminal.resize(cols, rows);
        return true;
      } catch {
        /* terminal already closed — resize is a no-op from here on */
        return false;
      }
    },
    close() {
      try {
        terminal?.close();
      } catch {
        /* terminal already closed */
      }
    },
    kill() {
      try {
        proc.kill();
      } catch {
        /* process already gone */
      }
      scheduleSigkill(pid);
    },
  };
}

/**
 * Windows 管道后端的行结束符规范化（仅用于 bun-pty 不可用时的降级路径）。
 *
 * PowerShell / cmd 从重定向的 stdin 读命令时，.NET `StreamReader.ReadLine` 遇到
 * 裸 `\r` 会 peek 下一个字节来判断是否 `\r\n`；在管道上该 peek 会一直等待，于是
 * 「第一次回车不执行、第二次回车才把上一行交付」。统一把行结束符规范成 Windows
 * 原生的 `\r\n` 让行立即交付；POSIX 管道不受影响，因此只在 win32 改写。
 */
export function normalizePipeWriteForPlatform(
  data: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') return data;
  return data.replace(/\r\n|\r|\n/g, '\r\n');
}

/**
 * `bun-pty` 后端（Windows 的真实 PTY）。事件模型与原生后端保持一致：
 * 输出统一转成 UTF-8 字节交给 `onData`，退出只上报一次，resize 返回是否派发。
 */
function spawnBunPtyModule(
  input: SpawnTerminalProcessInput,
  bunPty: BunPtyModuleLike,
): TerminalProcess {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  const terminal = bunPty.spawn(input.shell, input.args, {
    name: 'xterm-256color',
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env,
  });
  const exitOnce = createExitOnce(input.onExit);
  terminal.onData((data) => {
    if (data.length > 0) input.onData(Buffer.from(data, 'utf8'));
  });
  terminal.onExit((event) => {
    exitOnce(typeof event.exitCode === 'number' ? event.exitCode : null, null);
  });
  const pid = terminal.pid;
  return {
    pid,
    backend: 'pty',
    write(data) {
      // 就绪门控的 `initialCommand` 可能由定时器在终端关闭后写入，不能抛出。
      try {
        terminal.write(data);
      } catch {
        /* terminal already closed — the exit handler surfaces the outcome */
      }
    },
    resize(cols, rows) {
      try {
        terminal.resize(cols, rows);
        return true;
      } catch {
        /* terminal already closed — resize is a no-op from here on */
        return false;
      }
    },
    close() {
      try {
        terminal.kill();
      } catch {
        /* terminal already closed */
      }
    },
    kill() {
      try {
        terminal.kill();
      } catch {
        /* process already gone */
      }
      // ConPTY 关闭只保证终止直接子进程；shell 里再起的 TUI / 子进程需要 taskkill /T 兜底。
      killProcessTreeOnWindows(pid);
    },
  };
}

/** Windows：taskkill /T 终止整棵进程树（best-effort，不抛错）。 */
function killProcessTreeOnWindows(pid: number | undefined): void {
  if (process.platform !== 'win32' || pid === undefined) return;
  try {
    const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => {
      /* best-effort kill — nothing more to do */
    });
  } catch {
    /* taskkill unavailable */
  }
}

function spawnPipe(input: SpawnTerminalProcessInput): TerminalProcess {
  let child: ChildProcess;
  try {
    child = spawn(input.shell, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  const exitOnce = createExitOnce(input.onExit);
  const errorOnce = createErrorOnce(input.onError);
  child.stdout?.on('data', (chunk: Buffer) => input.onData(chunk));
  child.stderr?.on('data', (chunk: Buffer) => input.onData(chunk));
  child.on('error', (error: Error) => {
    errorOnce(error);
  });
  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    exitOnce(code, signal ?? null);
  });
  const pid = child.pid;
  return {
    pid,
    backend: 'pipe',
    write(data) {
      try {
        child.stdin?.write(normalizePipeWriteForPlatform(data));
      } catch {
        /* stdin already closed — exit handler will surface the outcome */
      }
    },
    resize(_cols, _rows) {
      return false;
    },
    close() {
      try {
        child.stdin?.end();
      } catch {
        /* stdin already closed */
      }
    },
    kill() {
      if (process.platform === 'win32') {
        killProcessTreeOnWindows(pid);
        return;
      }
      try {
        if (pid !== undefined) {
          process.kill(-pid, 'SIGTERM');
          scheduleSigkill(pid, true);
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* process already gone */
        }
      }
    },
  };
}

function scheduleSigkill(pid: number | undefined, processGroup = false): void {
  if (pid === undefined || process.platform === 'win32') return;
  const timer = setTimeout(() => {
    try {
      process.kill(processGroup ? -pid : pid, 'SIGKILL');
    } catch {
      /* process already gone */
    }
  }, 3_000);
  timer.unref();
}
