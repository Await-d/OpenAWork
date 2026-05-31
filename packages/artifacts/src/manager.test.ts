import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
