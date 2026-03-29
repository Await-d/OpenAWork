import { describe, expect, it } from 'vitest';
import {
  createWorkerSessionManager,
  type WorkerLaunchConfig,
  type WorkerMode,
} from '../worker/index.js';

describe('WorkerSessionManager', () => {
  it('launches local, cloud, and sandbox worker sessions with mode-specific metadata', async () => {
    const manager = createWorkerSessionManager();

    const local = await manager.launch({ mode: 'local', name: 'Local Worker' });
    const cloud = await manager.launch({
      mode: 'cloud_worker',
      name: 'Cloud Worker',
      endpoint: 'https://workers.example.com',
      token: 'token-123',
      region: 'ap-southeast-1',
    });
    const sandbox = await manager.launch({
      mode: 'sandbox',
      name: 'Sandbox Worker',
      sandboxRoot: '/tmp/openawork-sandbox',
      allowedHosts: ['api.example.com'],
    });

    expect(local).toMatchObject({ mode: 'local', status: 'idle', name: 'Local Worker' });
    expect(cloud).toMatchObject({
      mode: 'cloud_worker',
      status: 'running',
      endpoint: 'https://workers.example.com',
      region: 'ap-southeast-1',
    });
    expect(sandbox).toMatchObject({
      mode: 'sandbox',
      status: 'running',
      sandboxRoot: '/tmp/openawork-sandbox',
      allowedHosts: ['api.example.com'],
    });
  });

  it('lists active sessions and can stop a running worker', async () => {
    const manager = createWorkerSessionManager();
    const cloud = await manager.launch({
      mode: 'cloud_worker',
      name: 'Cloud Worker',
      endpoint: 'https://workers.example.com',
      token: 'token-123',
    });

    const beforeStop = await manager.list();
    expect(beforeStop).toHaveLength(1);
    expect(beforeStop[0]?.status).toBe('running');

    await manager.stop(cloud.workerId);
    const afterStop = await manager.list();
    expect(afterStop[0]).toMatchObject({ workerId: cloud.workerId, status: 'stopped' });
  });

  it('rejects invalid launch configs for each worker mode', async () => {
    const manager = createWorkerSessionManager();

    const invalidCases: Array<{
      label: string;
      config: WorkerLaunchConfig;
      expectedMode: WorkerMode;
    }> = [
      {
        label: 'cloud worker requires endpoint and token',
        config: { mode: 'cloud_worker', name: 'Cloud Worker', endpoint: '', token: '' },
        expectedMode: 'cloud_worker',
      },
      {
        label: 'sandbox worker requires sandboxRoot',
        config: { mode: 'sandbox', name: 'Sandbox Worker', sandboxRoot: '' },
        expectedMode: 'sandbox',
      },
    ];

    for (const item of invalidCases) {
      await expect(manager.launch(item.config), item.label).rejects.toThrow(item.expectedMode);
    }
  });
});
