import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: a sandboxed worker's `SandboxConfig.timeoutMs` must actually
 * bound its lifetime. Before the fix the field was stored on the runtime but
 * never enforced, so a sandboxed child could run forever — defeating the
 * point of a bounded sandbox. We mock node:child_process so `spawn` returns a
 * fake child with a `kill` spy, then drive the armed deadline with fake timers
 * and assert the worker is killed + marked stopped.
 */

interface FakeChild {
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  once: (event: string, cb: () => void) => void;
  handlers: Map<string, () => void>;
}

const spawned: FakeChild[] = [];

vi.mock('node:child_process', () => ({
  spawn: () => {
    const handlers = new Map<string, () => void>();
    const child: FakeChild = {
      pid: 4242,
      kill: vi.fn(),
      once: (event: string, cb: () => void) => {
        handlers.set(event, cb);
      },
      handlers,
    };
    spawned.push(child);
    return child;
  },
}));

beforeEach(() => {
  spawned.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WorkerManagerImpl sandbox timeout enforcement', () => {
  it('达到 sandbox.timeoutMs 时 kill 子进程并标记 stopped', async () => {
    const { WorkerManagerImpl } = await import('./index.js');
    const mgr = new WorkerManagerImpl();

    const info = await mgr.launch('w1', 'sleep', ['30'], {
      isolateFilesystem: true,
      isolateNetwork: true,
      allowedPaths: [],
      allowedHosts: [],
      timeoutMs: 1_000,
    });
    expect(mgr.getStatus(info.id)).toBe('running');
    const child = spawned[0]!;
    expect(child.kill).not.toHaveBeenCalled();

    // Cross the deadline.
    await vi.advanceTimersByTimeAsync(1_000);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(mgr.getStatus(info.id)).toBe('stopped');
  });

  it('worker 在超时前正常退出时不再 kill（计时器已清理）', async () => {
    const { WorkerManagerImpl } = await import('./index.js');
    const mgr = new WorkerManagerImpl();

    const info = await mgr.launch('w2', 'sleep', ['1'], {
      isolateFilesystem: true,
      isolateNetwork: true,
      allowedPaths: [],
      allowedHosts: [],
      timeoutMs: 10_000,
    });
    const child = spawned[0]!;

    // Child exits on its own before the deadline.
    child.handlers.get('exit')?.();
    expect(mgr.getStatus(info.id)).toBe('stopped');

    // Advancing past the original deadline must not kill again.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('无 sandbox 时不设置超时计时器（worker 保持 running）', async () => {
    const { WorkerManagerImpl } = await import('./index.js');
    const mgr = new WorkerManagerImpl();

    const info = await mgr.launch('w3', 'sleep', ['30']);
    const child = spawned[0]!;

    await vi.advanceTimersByTimeAsync(60_000);
    expect(child.kill).not.toHaveBeenCalled();
    expect(mgr.getStatus(info.id)).toBe('running');
  });
});
