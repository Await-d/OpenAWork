import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentTaskManagerImpl } from './index.js';
import { AgentTaskStoreImpl } from './store.js';
import type { AgentTaskDraft, AgentTaskGraph } from './types.js';

/**
 * 落盘层回归测试。
 *
 * Windows 上 `fs.rename` 覆盖一个被占用的目标文件会抛 EPERM（杀软 / 索引器 /
 * 另一个写者都占着句柄）；叠加 batch 里多个 task_update 并发 save 同一图文件，
 * 就会出现「任务状态没写进去」的静默丢失——batch 里一个子调用失败、另一个成功。
 */

const GRAPH_ID = 'session-under-test';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-task-store-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(projectRoot, { recursive: true, force: true });
});

function graphPath(): string {
  return path.join(projectRoot, '.agentdocs', 'tasks', `${GRAPH_ID}.json`);
}

function tasksDir(): string {
  return path.join(projectRoot, '.agentdocs', 'tasks');
}

function draft(title: string): AgentTaskDraft {
  return {
    title,
    status: 'pending',
    blockedBy: [],
    priority: 'medium',
    tags: [],
  };
}

function createManager(): AgentTaskManagerImpl {
  return new AgentTaskManagerImpl({ store: new AgentTaskStoreImpl() });
}

describe('AgentTaskStoreImpl.save', () => {
  it('写入后可原样读回', async () => {
    const manager = createManager();
    const graph = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    manager.addTask(graph, draft('第一步'));

    await manager.save(graph);

    const reloaded = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    expect(Object.values(reloaded.tasks).map((task) => task.title)).toEqual(['第一步']);
  });

  it('并发 save 同一图文件时全部成功，且不残留 .tmp 文件', async () => {
    const manager = createManager();
    const graph = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    for (let index = 0; index < 8; index += 1) {
      manager.addTask(graph, draft(`任务 ${index}`));
    }

    await Promise.all(Array.from({ length: 8 }, () => manager.save(graph)));

    const reloaded = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    expect(Object.keys(reloaded.tasks)).toHaveLength(8);
    const entries = await fs.readdir(tasksDir());
    expect(entries.filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('rename 撞上 EPERM 时退避重试，不把错误抛给调用方', async () => {
    const manager = createManager();
    const graph = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    manager.addTask(graph, draft('第一步'));

    const realRename = fs.rename.bind(fs);
    let renameCalls = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      renameCalls += 1;
      // 前两次模拟 Windows 句柄争抢（杀软扫描 / 并发写者）。
      if (renameCalls <= 2) {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      }
      return realRename(from, to);
    });

    await expect(manager.save(graph)).resolves.toBeUndefined();
    expect(renameCalls).toBeGreaterThan(2);

    const reloaded = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    expect(Object.values(reloaded.tasks).map((task) => task.title)).toEqual(['第一步']);
  });

  it('rename 持续 EPERM 时删掉目标再 rename', async () => {
    const manager = createManager();
    const graph = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    manager.addTask(graph, draft('第一步'));
    await manager.save(graph);

    const realRename = fs.rename.bind(fs);
    let renameCalls = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      renameCalls += 1;
      // 退避重试全部失败，逼出 unlink 兜底分支；只拦指向目标文件的 rename。
      if (to === graphPath() && renameCalls <= 5) {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      }
      return realRename(from, to);
    });

    await expect(manager.save(graph)).resolves.toBeUndefined();

    const reloaded = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    expect(Object.values(reloaded.tasks).map((task) => task.title)).toEqual(['第一步']);
  });

  it('非争抢类错误原样抛出，不做无谓重试', async () => {
    const manager = createManager();
    const graph = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    manager.addTask(graph, draft('第一步'));

    const rename = vi
      .spyOn(fs, 'rename')
      .mockRejectedValue(Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }));

    await expect(manager.save(graph)).rejects.toThrow('EIO');
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('写入失败时清理临时文件，不在任务目录里留垃圾', async () => {
    const manager = createManager();
    const graph = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    manager.addTask(graph, draft('第一步'));

    vi.spyOn(fs, 'rename').mockRejectedValue(
      Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }),
    );

    await expect(manager.save(graph)).rejects.toThrow('EIO');
    const entries = await fs.readdir(tasksDir());
    expect(entries).toEqual([]);
  });

  it('一次写入失败不会卡死同路径的后续写入', async () => {
    const manager = createManager();
    const graph = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    manager.addTask(graph, draft('第一步'));

    const realRename = fs.rename.bind(fs);
    const rename = vi.spyOn(fs, 'rename');
    rename.mockRejectedValueOnce(Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }));
    rename.mockImplementation(async (from, to) => realRename(from, to));

    await expect(manager.save(graph)).rejects.toThrow('EIO');
    await expect(manager.save(graph)).resolves.toBeUndefined();

    const reloaded = await manager.loadOrCreate(projectRoot, GRAPH_ID);
    expect(Object.values(reloaded.tasks).map((task) => task.title)).toEqual(['第一步']);
  });
});

describe('AgentTaskStoreImpl.save 图隔离', async () => {
  it('不同 graphId 落到不同文件', async () => {
    const manager = createManager();
    const alpha = (await manager.loadOrCreate(projectRoot, 'alpha')) as AgentTaskGraph;
    const beta = (await manager.loadOrCreate(projectRoot, 'beta')) as AgentTaskGraph;
    manager.addTask(alpha, draft('alpha 任务'));
    manager.addTask(beta, draft('beta 任务'));

    await Promise.all([manager.save(alpha), manager.save(beta)]);

    expect((await fs.readdir(tasksDir())).sort()).toEqual(['alpha.json', 'beta.json']);
  });
});
