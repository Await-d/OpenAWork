/**
 * Coverage for the unified PTY / pipe backend.
 *
 * The detection matrix is a pure function so it is fully deterministic. The
 * real-spawn cases allocate a genuine PTY, which is only possible on Bun
 * (non-Windows); under Node they are skipped because the backend degrades to
 * pipes there.
 */

import { StringDecoder } from 'node:string_decoder';
import { afterEach, describe, expect, it } from 'vitest';
import {
  __setBunPtyModuleLoaderForTest,
  __setTerminalCapabilitiesForTest,
  detectTerminalBackend,
  normalizePipeWriteForPlatform,
  spawnTerminalProcess,
  type BunPtyModuleLike,
  type BunPtyTerminalLike,
  type SpawnTerminalProcessInput,
  type TerminalProcess,
} from '../../session/pty-backend.js';

const bunAvailable = typeof (globalThis as Record<string, unknown>)['Bun'] !== 'undefined';
const ptySupported = bunAvailable && process.platform !== 'win32';
const itPty = ptySupported ? it : it.skip;

interface RunShellOptions {
  cols?: number;
  rows?: number;
  onSpawn?: (proc: TerminalProcess) => void;
}

function runShell(
  command: string,
  options: RunShellOptions = {},
): Promise<{ text: string; code: number | null; backend: string }> {
  const holder: { proc?: TerminalProcess } = {};
  const promise = new Promise<{ text: string; code: number | null; backend: string }>(
    (resolve, reject) => {
      const decoder = new StringDecoder('utf8');
      let text = '';
      holder.proc = spawnTerminalProcess({
        shell: 'bash',
        args: ['-c', command],
        cwd: process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' },
        cols: options.cols ?? 80,
        rows: options.rows ?? 24,
        onData: (chunk) => {
          text += decoder.write(Buffer.from(chunk));
        },
        onExit: (code) => {
          resolve({ text, code, backend: holder.proc?.backend ?? 'pipe' });
        },
        onError: reject,
      });
      options.onSpawn?.(holder.proc);
    },
  );
  return promise;
}

describe('detectTerminalBackend', () => {
  it('returns pty for bun on linux', () => {
    expect(detectTerminalBackend({ isBun: true, platform: 'linux' })).toEqual({
      kind: 'pty',
      runtime: 'bun',
      platform: 'linux',
      supportsResize: true,
      interactive: true,
    });
  });

  it('returns pipe with a reason for bun on win32', () => {
    const capabilities = detectTerminalBackend({ isBun: true, platform: 'win32' });
    expect(capabilities.kind).toBe('pipe');
    expect(capabilities.runtime).toBe('bun');
    expect(capabilities.supportsResize).toBe(false);
    expect(capabilities.interactive).toBe(false);
    expect(capabilities.reason).toBeTruthy();
  });

  it('returns pipe for node on linux', () => {
    const capabilities = detectTerminalBackend({ isBun: false, platform: 'linux' });
    expect(capabilities.kind).toBe('pipe');
    expect(capabilities.runtime).toBe('node');
    expect(capabilities.supportsResize).toBe(false);
    expect(capabilities.interactive).toBe(false);
    expect(capabilities.reason).toBeTruthy();
  });

  it('returns pipe for node on win32', () => {
    const capabilities = detectTerminalBackend({ isBun: false, platform: 'win32' });
    expect(capabilities.kind).toBe('pipe');
    expect(capabilities.runtime).toBe('node');
    expect(capabilities.supportsResize).toBe(false);
    expect(capabilities.interactive).toBe(false);
    expect(capabilities.reason).toBeTruthy();
  });

  it('reflects the live runtime when no env override is passed', () => {
    const capabilities = detectTerminalBackend();
    expect(capabilities.kind).toBe(ptySupported ? 'pty' : 'pipe');
    expect(capabilities.runtime).toBe(bunAvailable ? 'bun' : 'node');
    expect(capabilities.interactive).toBe(ptySupported);
  });
});

describe('spawnTerminalProcess', () => {
  it('streams output and reports the exit code', async () => {
    const result = await runShell('echo PIPE_OR_PTY_OK');
    expect(result.backend).toBe(detectTerminalBackend().kind);
    expect(result.text).toContain('PIPE_OR_PTY_OK');
    expect(result.code).toBe(0);
  });

  it('pipe backend reports resize as unsupported', async () => {
    if (ptySupported) return;
    const result = await runShell('echo noop', {
      onSpawn: (proc) => {
        expect(proc.resize(120, 40)).toBe(false);
      },
    });
    expect(result.code).toBe(0);
  });

  itPty('allocates a real tty where isatty() is true and resize dispatches', async () => {
    const result = await runShell(
      'test -t 0 && echo TTY || echo NOTTY; echo cols=$(tput cols); echo lines=$(tput lines)',
      {
        cols: 100,
        rows: 30,
      },
    );
    expect(result.backend).toBe('pty');
    expect(result.text).toContain('TTY');
    expect(result.text).not.toContain('NOTTY');
    expect(result.text).toContain('cols=100');
    expect(result.text).toContain('lines=30');
  });

  itPty('applies a resize after spawn so the shell observes the new geometry', async () => {
    const result = await runShell('echo ready; sleep 0.3; tput cols', {
      cols: 100,
      rows: 30,
      onSpawn: (proc) => {
        expect(proc.resize(37, 11)).toBe(true);
      },
    });
    expect(result.text).toContain('ready');
    expect(result.text).toContain('37');
  });
});

describe('normalizePipeWriteForPlatform', () => {
  it('win32：行结束符统一规范成 \\r\\n（PowerShell 管道「回车两次」的修复）', () => {
    expect(normalizePipeWriteForPlatform('echo hi\r', 'win32')).toBe('echo hi\r\n');
    expect(normalizePipeWriteForPlatform('a\rb', 'win32')).toBe('a\r\nb');
    // 初始命令 / 多行粘贴用 `\n`：Windows 管道同样要补成 CRLF。
    expect(normalizePipeWriteForPlatform('echo hi\n', 'win32')).toBe('echo hi\r\n');
    expect(normalizePipeWriteForPlatform('a\nb\n', 'win32')).toBe('a\r\nb\r\n');
  });

  it('已是 \\r\\n 的输入不重复改写；POSIX 输入原样保留', () => {
    expect(normalizePipeWriteForPlatform('x\r\n', 'win32')).toBe('x\r\n');
    expect(normalizePipeWriteForPlatform('echo hi\r', 'linux')).toBe('echo hi\r');
    expect(normalizePipeWriteForPlatform('echo hi\n', 'linux')).toBe('echo hi\n');
    expect(normalizePipeWriteForPlatform('echo hi\r', 'darwin')).toBe('echo hi\r');
  });
});

interface FakeBunPtyTerminal extends BunPtyTerminalLike {
  writes: string[];
  resizes: Array<[number, number]>;
  kills: number;
  emitData(data: string): void;
  emitExit(exitCode: number): void;
}

interface FakeBunPty {
  module: BunPtyModuleLike;
  spawnCalls: Array<{
    file: string;
    args: string[];
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    };
  }>;
  terminals: FakeBunPtyTerminal[];
}

function createFakeBunPty(): FakeBunPty {
  const spawnCalls: FakeBunPty['spawnCalls'] = [];
  const terminals: FakeBunPtyTerminal[] = [];
  const module: BunPtyModuleLike = {
    spawn(file, args, options) {
      spawnCalls.push({ file, args, options });
      const dataListeners: Array<(data: string) => void> = [];
      const exitListeners: Array<(event: { exitCode: number; signal?: number | string }) => void> =
        [];
      const terminal: FakeBunPtyTerminal = {
        pid: 7777,
        writes: [],
        resizes: [],
        kills: 0,
        onData(listener) {
          dataListeners.push(listener);
          return undefined;
        },
        onExit(listener) {
          exitListeners.push(listener);
          return undefined;
        },
        write(data) {
          terminal.writes.push(data);
        },
        resize(cols, rows) {
          terminal.resizes.push([cols, rows]);
        },
        kill() {
          terminal.kills += 1;
        },
        emitData(data) {
          for (const listener of dataListeners) listener(data);
        },
        emitExit(exitCode) {
          for (const listener of exitListeners) listener({ exitCode });
        },
      };
      terminals.push(terminal);
      return terminal;
    },
  };
  return { module, spawnCalls, terminals };
}

describe('bun-pty 后端（Windows 真实 PTY）', () => {
  const originalForceEnv = process.env['OPENAWORK_PTY_BACKEND'];

  afterEach(() => {
    __setBunPtyModuleLoaderForTest(null);
    __setTerminalCapabilitiesForTest(null);
    if (originalForceEnv === undefined) delete process.env['OPENAWORK_PTY_BACKEND'];
    else process.env['OPENAWORK_PTY_BACKEND'] = originalForceEnv;
  });

  function makeInput(
    overrides: Partial<SpawnTerminalProcessInput> = {},
  ): {
    input: SpawnTerminalProcessInput;
    chunks: Uint8Array[];
    exits: Array<[number | null, string | null]>;
  } {
    const chunks: Uint8Array[] = [];
    const exits: Array<[number | null, string | null]> = [];
    const input: SpawnTerminalProcessInput = {
      shell: 'pwsh.exe',
      args: ['-NoLogo', '-NoProfile'],
      cwd: process.cwd(),
      env: { TERM: 'xterm-256color', SHOULD_BE_DROPPED: undefined },
      cols: 80,
      rows: 24,
      onData: (chunk) => chunks.push(chunk),
      onExit: (code, signal) => exits.push([code, signal]),
      onError: () => undefined,
      ...overrides,
    };
    return { input, chunks, exits };
  }

  it('强制 bun-pty 时走 PTY：spawn 参数 / write / resize / close / 数据与退出映射', () => {
    process.env['OPENAWORK_PTY_BACKEND'] = 'bun-pty';
    const fake = createFakeBunPty();
    __setBunPtyModuleLoaderForTest(() => fake.module);
    const { input, chunks, exits } = makeInput();

    const proc = spawnTerminalProcess(input);

    expect(proc.backend).toBe('pty');
    expect(proc.pid).toBe(7777);
    expect(fake.spawnCalls).toHaveLength(1);
    const call = fake.spawnCalls[0]!;
    expect(call.file).toBe('pwsh.exe');
    expect(call.args).toEqual(['-NoLogo', '-NoProfile']);
    expect(call.options.name).toBe('xterm-256color');
    expect(call.options.cols).toBe(80);
    expect(call.options.rows).toBe(24);
    expect(call.options.env?.['TERM']).toBe('xterm-256color');
    // undefined 的环境变量值必须被过滤（bun-pty 会拼成 "k=v" 字符串）。
    expect(Object.prototype.hasOwnProperty.call(call.options.env ?? {}, 'SHOULD_BE_DROPPED')).toBe(
      false,
    );

    const terminal = fake.terminals[0]!;
    terminal.emitData('hello');
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello');

    proc.write('ls\r');
    expect(terminal.writes).toEqual(['ls\r']);
    expect(proc.resize(120, 30)).toBe(true);
    expect(terminal.resizes).toEqual([[120, 30]]);
    proc.close();
    expect(terminal.kills).toBe(1);

    terminal.emitExit(7);
    expect(exits).toEqual([[7, null]]);
    // 退出事件只上报一次（bun-pty 的 kill 也会触发 onExit）。
    terminal.emitExit(9);
    expect(exits).toHaveLength(1);
  });

  it('bun-pty 启动抛错时回退管道，终端功能不整体打挂', () => {
    process.env['OPENAWORK_PTY_BACKEND'] = 'bun-pty';
    __setBunPtyModuleLoaderForTest(() => ({
      spawn() {
        throw new Error('portable-pty unavailable');
      },
    }));
    const { input } = makeInput({ shell: 'bash', args: ['-c', 'sleep 0.05'] });
    const proc = spawnTerminalProcess(input);
    expect(proc.backend).toBe('pipe');
    proc.kill();
  });

  it('bun-pty 不可用（loader 返回 null）时回退管道', () => {
    process.env['OPENAWORK_PTY_BACKEND'] = 'bun-pty';
    __setBunPtyModuleLoaderForTest(() => null);
    const { input } = makeInput({ shell: 'bash', args: ['-c', 'sleep 0.05'] });
    const proc = spawnTerminalProcess(input);
    expect(proc.backend).toBe('pipe');
    proc.kill();
  });

  it('win32 + Bun 能力画像下自动选择 bun-pty（无需强制开关）', () => {
    // Windows 上 Bun 没有原生 PTY：能力探测给出 pipe + runtime=bun，此时应自动走 bun-pty。
    __setTerminalCapabilitiesForTest({
      kind: 'pipe',
      runtime: 'bun',
      platform: 'win32',
      supportsResize: false,
      interactive: false,
      reason: 'test-profile',
    });
    const fake = createFakeBunPty();
    __setBunPtyModuleLoaderForTest(() => fake.module);
    const { input } = makeInput();

    const proc = spawnTerminalProcess(input);

    expect(proc.backend).toBe('pty');
    expect(fake.spawnCalls).toHaveLength(1);
    expect(fake.spawnCalls[0]!.file).toBe('pwsh.exe');
    proc.kill();
  });
});
