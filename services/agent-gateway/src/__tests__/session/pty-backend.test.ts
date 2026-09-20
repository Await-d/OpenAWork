/**
 * Coverage for the unified PTY / pipe backend.
 *
 * The detection matrix is a pure function so it is fully deterministic. The
 * real-spawn cases allocate a genuine PTY, which is only possible on Bun
 * (non-Windows); under Node they are skipped because the backend degrades to
 * pipes there.
 */

import { StringDecoder } from 'node:string_decoder';
import { describe, expect, it } from 'vitest';
import {
  detectTerminalBackend,
  spawnTerminalProcess,
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
