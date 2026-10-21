import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactManagerImpl } from './manager.js';

let dir: string;
let indexPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'artifacts-test-'));
  indexPath = join(dir, 'index.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('ArtifactManagerImpl index resilience', () => {
  it('索引文件为非法 JSON 时降级为空 store，不抛错', () => {
    writeFileSync(indexPath, '{ this is not json', 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    let manager: ArtifactManagerImpl | undefined;
    expect(() => {
      manager = new ArtifactManagerImpl({ indexFilePath: indexPath });
    }).not.toThrow();
    expect(warn).toHaveBeenCalled();
    // 仍可正常使用：add 后能读回。
    const added = manager!.add({ sessionId: 's1', type: 'file_created', name: 'a.txt' });
    expect(added.id).toBeTruthy();
  });

  it('索引文件 JSON 合法但不是数组时降级为空 store', () => {
    writeFileSync(indexPath, JSON.stringify({ nope: true }), 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const manager = new ArtifactManagerImpl({ indexFilePath: indexPath });
    expect(warn).toHaveBeenCalled();
    return expect(manager.list('s1')).resolves.toEqual([]);
  });

  it('add 持久化后可被新实例加载（原子写产生合法 JSON）', async () => {
    const m1 = new ArtifactManagerImpl({ indexFilePath: indexPath });
    const added = m1.add({ sessionId: 's1', type: 'file_created', name: 'a.txt' });

    // 写出的索引应是合法 JSON 数组。
    const raw = readFileSync(indexPath, 'utf-8');
    expect(Array.isArray(JSON.parse(raw))).toBe(true);

    const m2 = new ArtifactManagerImpl({ indexFilePath: indexPath });
    const list = await m2.list('s1');
    expect(list.map((a) => a.id)).toContain(added.id);
  });

  it('跳过数组中缺少 id 的损坏条目', () => {
    writeFileSync(
      indexPath,
      JSON.stringify([
        { id: 'ok', sessionId: 's1', type: 'file_created', name: 'a' },
        { broken: 1 },
      ]),
      'utf-8',
    );
    const manager = new ArtifactManagerImpl({ indexFilePath: indexPath });
    return expect(manager.list('s1')).resolves.toHaveLength(1);
  });
});

describe('ArtifactManagerImpl get / remove', () => {
  it('remove 同时清理索引条目与磁盘文件，且持久化后不被复活', async () => {
    const manager = new ArtifactManagerImpl({ indexFilePath: indexPath });
    const filePath = join(dir, 'payload.bin');
    writeFileSync(filePath, 'binary');
    const artifact = manager.add({
      sessionId: 's1',
      type: 'document',
      name: 'payload.bin',
      path: filePath,
    });

    expect(manager.get(artifact.id)?.id).toBe(artifact.id);
    expect(manager.remove(artifact.id)).toBe(true);
    expect(manager.get(artifact.id)).toBeUndefined();
    expect(existsSync(filePath)).toBe(false);
    await expect(manager.list('s1')).resolves.toEqual([]);

    // 新实例从索引加载：删除必须已落盘，否则下一次上传的全量重写会把它带回来。
    const reloaded = new ArtifactManagerImpl({ indexFilePath: indexPath });
    await expect(reloaded.list('s1')).resolves.toEqual([]);
  });

  it('磁盘文件已缺失时 remove 仍按成功处理（索引是唯一真相源）', () => {
    const manager = new ArtifactManagerImpl({ indexFilePath: indexPath });
    const artifact = manager.add({
      sessionId: 's1',
      type: 'document',
      name: 'ghost.bin',
      path: join(dir, 'ghost.bin'),
    });

    expect(manager.remove(artifact.id)).toBe(true);
    expect(manager.get(artifact.id)).toBeUndefined();
  });

  it('remove 不存在的 id 返回 false 且不抛错', () => {
    const manager = new ArtifactManagerImpl({ indexFilePath: indexPath });

    expect(manager.remove('missing-artifact')).toBe(false);
    expect(manager.get('missing-artifact')).toBeUndefined();
  });

  it('removeMany 一次清理多项，忽略不存在的 id', async () => {
    const manager = new ArtifactManagerImpl({ indexFilePath: indexPath });
    const firstPath = join(dir, 'batch-1.bin');
    const secondPath = join(dir, 'batch-2.bin');
    writeFileSync(firstPath, '1');
    writeFileSync(secondPath, '2');
    const first = manager.add({
      sessionId: 's1',
      type: 'document',
      name: 'batch-1.bin',
      path: firstPath,
    });
    const second = manager.add({
      sessionId: 's1',
      type: 'document',
      name: 'batch-2.bin',
      path: secondPath,
    });

    expect(manager.removeMany([first.id, second.id, 'missing-artifact'])).toBe(2);
    expect(manager.get(first.id)).toBeUndefined();
    expect(manager.get(second.id)).toBeUndefined();
    expect(existsSync(firstPath)).toBe(false);
    expect(existsSync(secondPath)).toBe(false);
    // 批量删除同样要落盘，否则下一次上传的全量重写会把它们带回来。
    const reloaded = new ArtifactManagerImpl({ indexFilePath: indexPath });
    await expect(reloaded.list('s1')).resolves.toEqual([]);
  });

  it('removeMany 传入空集合时不写索引、返回 0', () => {
    const manager = new ArtifactManagerImpl({ indexFilePath: indexPath });
    const artifact = manager.add({
      sessionId: 's1',
      type: 'document',
      name: 'kept.bin',
      path: join(dir, 'kept.bin'),
    });

    expect(manager.removeMany([])).toBe(0);
    expect(manager.get(artifact.id)).toBeDefined();
  });
});
