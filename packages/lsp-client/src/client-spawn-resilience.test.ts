import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createLSPClient } from './client.js';
import type { LSPServerHandle } from './types.js';

/** Minimal ChildProcess stand-in: an EventEmitter with optional stdio. */
function fakeProcess(opts: { withStdio: boolean }): EventEmitter & {
  stdout: unknown;
  stdin: unknown;
} {
  const emitter = new EventEmitter() as EventEmitter & { stdout: unknown; stdin: unknown };
  emitter.stdout = opts.withStdio ? new EventEmitter() : null;
  emitter.stdin = opts.withStdio ? new EventEmitter() : null;
  return emitter;
}

describe('createLSPClient spawn resilience', () => {
  it('缺少 stdio 管道时快速抛错（spawn 失败场景），不进入连接建立', async () => {
    const proc = fakeProcess({ withStdio: false });
    const handle = { process: proc } as unknown as LSPServerHandle;
    await expect(
      createLSPClient({ serverID: 'broken', server: handle, root: '/tmp' }),
    ).rejects.toThrow(/no stdio pipes/);
  });

  it('子进程 emit error 时不会抛出未捕获异常', async () => {
    const proc = fakeProcess({ withStdio: false });
    const handle = { process: proc } as unknown as LSPServerHandle;

    // 触发 createLSPClient 内部挂载 error 监听后再 emit；监听存在则不抛。
    const pending = createLSPClient({ serverID: 'broken', server: handle, root: '/tmp' }).catch(
      () => undefined,
    );
    expect(() => proc.emit('error', new Error('spawn ENOENT'))).not.toThrow();
    await pending;
  });
});
