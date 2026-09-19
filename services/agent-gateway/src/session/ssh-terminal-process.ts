import type { SSHConnectionManager } from '@openAwork/agent-core';
import type { SpawnTerminalProcessInput, TerminalProcess } from './pty-backend.js';

type Channel = Awaited<ReturnType<NonNullable<SSHConnectionManager['openTerminal']>>>;

export function attachSshTerminalProcess(
  channel: Channel,
  input: SpawnTerminalProcessInput,
): TerminalProcess {
  let closed = false;
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    input.onExit(exitCode, exitSignal);
  };
  channel.on('data', input.onData);
  channel.stderr.on('data', input.onData);
  channel.on('exit', (code: number | null, signal: string | null) => {
    exitCode = code;
    exitSignal = signal;
  });
  channel.once('close', finish);
  channel.once('error', (error: Error) => {
    if (closed) return;
    closed = true;
    input.onError(error);
    channel.destroy();
  });
  // 通道保持暂停直到 persistent-terminals 完成记录注册，避免首屏输出丢失。
  queueMicrotask(() => channel.resume());
  return {
    pid: undefined,
    backend: 'pty',
    write: (data) => {
      channel.write(data);
    },
    resize: (cols, rows) => {
      channel.setWindow(rows, cols, 0, 0);
      return true;
    },
    close: () => {
      channel.end();
    },
    kill: () => {
      channel.close();
      finish();
    },
  };
}
