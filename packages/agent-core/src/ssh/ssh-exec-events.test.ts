import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { SSHConnectionManagerImpl } from './ssh-connection-manager.js';

it('远程 exec 监听 close 事件，绝不主动关闭仍在执行的通道', async () => {
  const channel = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), close: vi.fn() });
  const client = Object.assign(new EventEmitter(), {
    connect: vi.fn(),
    end: vi.fn(),
    sftp: vi.fn(),
    exec: (
      _command: string,
      callback: (error: Error | undefined, stream: typeof channel) => void,
    ) => {
      callback(undefined, channel);
      queueMicrotask(() => {
        channel.emit('data', Buffer.from('done'));
        channel.emit('close', 7);
      });
    },
  });
  const manager = new SSHConnectionManagerImpl({ clients: new Map([['exec', client]]) });
  const result = await manager.execCommand('exec', 'run', { timeoutMs: 100 });
  expect(result).toEqual({ stdout: 'done', stderr: '', exitCode: 7 });
  expect(channel.close).not.toHaveBeenCalled();
});
