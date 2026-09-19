import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import type { ClientChannel } from 'ssh2';
import { openSSHTerminal, type SSHTerminalClient } from './ssh-terminal.js';

class Channel extends PassThrough implements ClientChannel {
  stderr = new PassThrough();
  type = 'session' as const;
  server = false as const;
  stdin = this;
  stdout = this;
  eof = vi.fn();
  exit = vi.fn();
  subtype = 'shell' as const;
  incoming = { id: 0, window: 0, packetSize: 0, state: 'open' };
  outgoing = { id: 0, window: 0, packetSize: 0, state: 'open' };
  setWindow = vi.fn();
  signal = vi.fn();
  close = vi.fn();
}

afterEach(() => vi.useRealTimers());

it('申请真正 PTY 并暂停通道，等待消费者安装输出监听', async () => {
  const channel = new Channel();
  const shell: NonNullable<SSHTerminalClient['shell']> = (window, callback) => {
    expect(window).toEqual({ term: 'xterm-256color', cols: 80, rows: 24 });
    callback(undefined, channel);
  };
  expect(await openSSHTerminal({ shell }, { cols: 80, rows: 24 })).toBe(channel);
  expect(channel.isPaused()).toBe(true);
  channel.destroy();
});

it('通道超时后到达的迟发回调立即回收通道', async () => {
  vi.useFakeTimers();
  let callback: ((error: Error | undefined, channel: ClientChannel) => void) | undefined;
  const channel = new Channel();
  const promise = openSSHTerminal(
    {
      shell: (_window, cb) => {
        callback = cb;
      },
    },
    { cols: 80, rows: 24 },
  );
  const rejected = expect(promise).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  callback?.(undefined, channel);
  expect(channel.destroyed).toBe(true);
});

it('拒绝不支持交互 Shell 的传输', async () => {
  await expect(openSSHTerminal({}, { cols: 80, rows: 24 })).rejects.toThrow(/does not support/);
});
