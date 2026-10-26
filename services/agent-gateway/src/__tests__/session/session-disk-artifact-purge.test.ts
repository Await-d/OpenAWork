import { describe, expect, it, vi } from 'vitest';
import {
  purgeSessionDiskArtifacts,
  purgeSessionDiskArtifactsForSessions,
  type SessionDiskArtifactManager,
} from '../../session/session-disk-artifact-purge.js';

function fakeManager(input: {
  artifacts?: ReadonlyArray<{ id: string }>;
  listError?: Error;
  removeError?: Error;
}): { manager: SessionDiskArtifactManager; removeMany: ReturnType<typeof vi.fn> } {
  const removeMany = vi.fn((ids: Iterable<string>) => {
    if (input.removeError) throw input.removeError;
    return [...ids].length;
  });
  const manager: SessionDiskArtifactManager = {
    list: async () => {
      if (input.listError) throw input.listError;
      return input.artifacts ?? [];
    },
    removeMany,
  };
  return { manager, removeMany };
}

describe('purgeSessionDiskArtifacts', () => {
  it('按 sessionId 列出并一次性批量删除（不逐条 remove）', async () => {
    const { manager, removeMany } = fakeManager({
      artifacts: [{ id: 'a-1' }, { id: 'a-2' }],
    });

    const removed = await purgeSessionDiskArtifacts({ sessionId: 's-1', manager });

    expect(removed).toBe(2);
    expect(removeMany).toHaveBeenCalledTimes(1);
    const ids = removeMany.mock.calls[0]?.[0];
    expect(ids ? [...ids] : []).toEqual(['a-1', 'a-2']);
  });

  it('会话没有任何磁盘产物时零删除', async () => {
    const { manager, removeMany } = fakeManager({ artifacts: [] });

    const removed = await purgeSessionDiskArtifacts({ sessionId: 's-1', manager });

    expect(removed).toBe(0);
    expect(removeMany).not.toHaveBeenCalled();
  });

  // 调用点在会话行已删除之后：回收失败不能让删除接口整体失败（重试只会 404）。
  it('list 失败时吞错并返回 0', async () => {
    const { manager } = fakeManager({ listError: new Error('index unreadable') });

    await expect(purgeSessionDiskArtifacts({ sessionId: 's-1', manager })).resolves.toBe(0);
  });

  it('removeMany 失败（索引落盘异常）时同样吞错', async () => {
    const { manager } = fakeManager({
      artifacts: [{ id: 'a-1' }],
      removeError: new Error('disk full'),
    });

    await expect(purgeSessionDiskArtifacts({ sessionId: 's-1', manager })).resolves.toBe(0);
  });
});

describe('purgeSessionDiskArtifactsForSessions', () => {
  it('会话树的所有产物合并成一次 removeMany（避免逐会话全量重写索引）', async () => {
    const removeMany = vi.fn((ids: Iterable<string>) => [...ids].length);
    const bySession: Record<string, ReadonlyArray<{ id: string }>> = {
      's-root': [{ id: 'a-1' }, { id: 'a-2' }],
      's-child': [{ id: 'a-3' }],
    };
    const manager: SessionDiskArtifactManager = {
      list: async (sessionId) => bySession[sessionId] ?? [],
      removeMany,
    };

    const removed = await purgeSessionDiskArtifactsForSessions({
      sessionIds: ['s-root', 's-child'],
      manager,
    });

    expect(removed).toBe(3);
    expect(removeMany).toHaveBeenCalledTimes(1);
    const ids = removeMany.mock.calls[0]?.[0];
    expect(ids ? new Set(ids) : new Set()).toEqual(new Set(['a-1', 'a-2', 'a-3']));
  });

  it('会话列表为空时零查询、零删除', async () => {
    const { manager, removeMany } = fakeManager({});

    const removed = await purgeSessionDiskArtifactsForSessions({ sessionIds: [], manager });

    expect(removed).toBe(0);
    expect(removeMany).not.toHaveBeenCalled();
  });

  it('跨会话重复的产物 id 去重后只删一次', async () => {
    const removeMany = vi.fn((ids: Iterable<string>) => new Set(ids).size);
    const manager: SessionDiskArtifactManager = {
      list: async () => [{ id: 'shared-1' }],
      removeMany,
    };

    await purgeSessionDiskArtifactsForSessions({ sessionIds: ['s-1', 's-2'], manager });

    const ids = removeMany.mock.calls[0]?.[0];
    expect(ids ? [...ids] : []).toEqual(['shared-1']);
  });
});
