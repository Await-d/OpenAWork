/**
 * 「写入入口」守卫（261101-记忆确认写入与周期整理）。
 *
 * 本改造的核心不变量是：**任何正式记忆写入都必须经确认门**（`commitMemoryProposal` 或
 * 用户显式保存的 `applyManualMemoryChange`）。破坏它的方式不是「有人写错代码」，而是
 * 「有人在存储层又加回一个批量写入函数」——新增的调用方看起来人畜无害，却把整条确认链
 * 绕过去了。
 *
 * 具体被删掉的两个入口：
 *   - `memory-store.upsertExtractedMemories`：与 `memory-extraction-store` 同名壳重复的
 *     直写实现（无人调用，属静默旁路）；
 *   - `memory-store.listEnabledMemoriesForInjection`：返回该用户**全部作用域**的注入查询，
 *     正是渠道越权面的原料（无人调用，但一旦被接上就恢复越权）。
 *
 * 该断言是刻意的「负面测试」：它保护的是**不存在**的东西。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as MemoryStoreModule from '../../memory/memory-store.js';
import type * as CommitServiceModule from '../../memory/governance/memory-commit-service.js';

process.env['DATABASE_URL'] = ':memory:';

let memoryStore: typeof MemoryStoreModule;
let commitService: typeof CommitServiceModule;

beforeAll(async () => {
  const db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  memoryStore = await import('../../memory/memory-store.js');
  commitService = await import('../../memory/governance/memory-commit-service.js');
});

afterAll(async () => {
  const db = await import('../../infra/db.js');
  await db.closeDb();
});

describe('存储层写入入口守卫', () => {
  it('存储层不再暴露绕过确认门的批量写入函数', () => {
    expect(Object.keys(memoryStore)).not.toContain('upsertExtractedMemories');
  });

  it('存储层不再暴露「全部作用域」的注入查询（越权面原料）', () => {
    expect(Object.keys(memoryStore)).not.toContain('listEnabledMemoriesForInjection');
  });

  it('存储层不再暴露「硬删除记忆」原语（会连版本历史一起 CASCADE 掉且无审计）', () => {
    expect(Object.keys(memoryStore)).not.toContain('deleteMemory');
  });

  it('存储层仍导出唯一可信提交器的依赖原语（清理勿伤及正常路径）', () => {
    for (const name of [
      'createMemory',
      'updateMemory',
      'getMemoryById',
      'listMemories',
      'listEnabledMemoriesForScopeInjection',
    ]) {
      expect(Object.keys(memoryStore)).toContain(name);
    }
  });

  it('正式写入入口只有两类：提议确认与人工显式保存', () => {
    // 这两条是仅有的写入 API；新增写入路径必须先在这里被显式决策。
    expect(typeof commitService.commitMemoryProposal).toBe('function');
    expect(typeof commitService.applyManualMemoryChange).toBe('function');
  });
});
