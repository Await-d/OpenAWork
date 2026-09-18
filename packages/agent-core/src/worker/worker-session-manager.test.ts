import { describe, expect, it } from 'vitest';
import { createWorkerSessionManager } from './index.js';

/**
 * 回归：sandbox 模式的会话此前被标记为 'running'，但实际上没有任何沙箱运行时
 * 被启动——与云 worker 的“假 connected”属于同一类谎报。现在只登记会话，状态
 * 必须是 'idle'；cloud_worker 在缺少协议规格时则必须直接失败。
 */
describe('WorkerSessionManagerImpl 不谎报会话状态', () => {
  it('sandbox 模式只登记会话，状态为 idle', async () => {
    const manager = createWorkerSessionManager();

    const session = await manager.launch({
      mode: 'sandbox',
      name: 'sandbox-1',
      sandboxRoot: '/tmp/sandbox-1',
    });

    expect(session.status).toBe('idle');
    expect(session.sandboxRoot).toBe('/tmp/sandbox-1');
    expect(session.allowedHosts).toEqual([]);
    expect(await manager.getStatus(session.workerId)).toBe('idle');
  });

  it('local 模式状态仍为 idle', async () => {
    const manager = createWorkerSessionManager();

    const session = await manager.launch({ mode: 'local', name: 'local-1' });

    expect(session.status).toBe('idle');
  });

  it('cloud_worker 模式因缺少协议规格直接失败，而不是返回 connected', async () => {
    const manager = createWorkerSessionManager();

    await expect(
      manager.launch({
        mode: 'cloud_worker',
        name: 'cloud-1',
        endpoint: 'https://cloud-worker.example.com',
        token: 'test-token',
      }),
    ).rejects.toThrow('未配置远端传输');
    expect(await manager.list()).toHaveLength(0);
  });
});
