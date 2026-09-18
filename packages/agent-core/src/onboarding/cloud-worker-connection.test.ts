import { describe, expect, it, vi } from 'vitest';
import { CloudWorkerConnection } from './cloud-worker-connection.js';
import type { CloudWorkerConfig, CloudWorkerTransport } from './cloud-worker-connection.js';

/**
 * 回归：`CloudWorkerConnection` 曾用 stub 假装连接成功——不做任何远端调用就写入
 * `status: 'connected'`。缺少云 worker 协议规格时必须直接抛错，只有注入的传输
 * 真正 resolve 之后才允许出现 'connected'。
 */

const VALID_CONFIG: CloudWorkerConfig = {
  endpoint: 'https://cloud-worker.example.com',
  token: 'test-token',
};

function createFakeTransport(workerId: string): {
  transport: CloudWorkerTransport;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
} {
  const connect = vi.fn(async (_config: CloudWorkerConfig) => ({ workerId }));
  const disconnect = vi.fn(async (_workerId: string) => undefined);
  return { transport: { connect, disconnect }, connect, disconnect };
}

describe('CloudWorkerConnection 拒绝伪造云 worker 连接', () => {
  it('未注入传输时 connect 抛错，且不产生任何会话', async () => {
    const connection = new CloudWorkerConnection();

    await expect(connection.connect(VALID_CONFIG)).rejects.toThrow('未配置远端传输');
    expect(connection.getStatus('worker-1')).toBe('disconnected');
    expect(connection.getSession('worker-1')).toBeUndefined();
    expect(connection.listSessions()).toHaveLength(0);
  });

  it('未注入传输时 disconnect 抛错且不改变状态', async () => {
    const connection = new CloudWorkerConnection();

    await expect(connection.disconnect('worker-1')).rejects.toThrow();
    expect(connection.getStatus('worker-1')).toBe('disconnected');
  });

  it('注入传输后 connect 返回 connected，且传输只被调用一次', async () => {
    const fake = createFakeTransport('worker-42');
    const connection = new CloudWorkerConnection(fake.transport);

    const session = await connection.connect(VALID_CONFIG);

    expect(session.workerId).toBe('worker-42');
    expect(session.endpoint).toBe(VALID_CONFIG.endpoint);
    expect(session.status).toBe('connected');
    expect(session.connectedAt).toBeGreaterThan(0);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.connect).toHaveBeenCalledWith(VALID_CONFIG);
    expect(connection.getStatus('worker-42')).toBe('connected');
  });

  it('传输 connect 失败时不记录任何已连接会话', async () => {
    const connect = vi.fn(async (_config: CloudWorkerConfig): Promise<{ workerId: string }> => {
      throw new Error('transport unavailable');
    });
    const disconnect = vi.fn(async (_workerId: string) => undefined);
    const connection = new CloudWorkerConnection({ connect, disconnect });

    await expect(connection.connect(VALID_CONFIG)).rejects.toThrow('transport unavailable');
    expect(connection.getStatus('worker-42')).toBe('disconnected');
    expect(connection.listSessions()).toHaveLength(0);
  });

  it('注入传输后 disconnect 调用传输并仅在 resolve 后标记 disconnected', async () => {
    const fake = createFakeTransport('worker-42');
    const connection = new CloudWorkerConnection(fake.transport);
    await connection.connect(VALID_CONFIG);

    await connection.disconnect('worker-42');

    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.disconnect).toHaveBeenCalledWith('worker-42');
    expect(connection.getStatus('worker-42')).toBe('disconnected');
  });
});
