/**
 * Unified terminal process backend — real PTY on Bun (non-Windows) and a
 * pipe fallback everywhere else (Node, Windows).
 *
 * PTY support comes from Bun's native `Bun.spawn(cmd, { terminal })`; we
 * deliberately avoid `node-pty` / `bun-pty` native addons. Node has no
 * built-in PTY, so on Node (and on Windows under Bun) we degrade to piped
 * stdio: input/output still flow, but `isatty()` is false, resize is a
 * no-op signalled by a `false` return, and the capability probe reports
 * `interactive: false` so callers spawn a plain shell instead of `bash -i`.
 * That piped path is an explicit, honest non-interactive degradation — not a
 * fake terminal.
 *
 * Bun exposes no ambient TypeScript types, and this repo forbids `any` /
 * `@ts-ignore`, so the runtime handle is narrowed through minimal local
 * structural interfaces below.
 */

import { spawn, type ChildProcess } from 'node:child_process';

export type TerminalBackendKind = 'pty' | 'pipe';

export interface TerminalBackendCapabilities {
  kind: TerminalBackendKind;
  runtime: 'bun' | 'node';
  platform: NodeJS.Platform;
  supportsResize: boolean;
  /**
   * True only for a real PTY backend. When false the shell has no terminal
   * (`isatty()` is false), so callers must not force `-i` — that would fake
   * job control / prompts without a tty to back them.
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
    ? `bun runtime on ${platform} has no supported PTY`
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
  const capabilities = detectTerminalBackend();
  if (capabilities.kind === 'pty') {
    const bun = getBunRuntime();
    if (bun !== undefined) {
      return spawnBunPty(input, bun);
    }
  }
  logPipeFallbackOnce(capabilities);
  return spawnPipe(input);
}

function spawnBunPty(input: SpawnTerminalProcessInput, bun: BunRuntimeLike): TerminalProcess {
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
        child.stdin?.write(data);
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
        if (pid !== undefined) {
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
