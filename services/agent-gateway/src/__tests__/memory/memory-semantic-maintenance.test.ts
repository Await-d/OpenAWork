import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StoreModule from '../../memory/memory-store.js';
import type * as SemanticModule from '../../memory/maintenance/memory-semantic-maintenance.js';

process.env['DATABASE_URL'] = ':memory:';
let db: typeof DbModule;
let store: typeof StoreModule;
let run: typeof SemanticModule.runMemorySemanticAnalysis;
const userId = 'u-semantic';
const scope = { type: 'user' as const, id: userId };
const now = new Date('2026-11-01T12:00:00Z');

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  store = await import('../../memory/memory-store.js');
  run = (await import('../../memory/maintenance/memory-semantic-maintenance.js'))
    .runMemorySemanticAnalysis;
});
beforeEach(() => {
  db.sqliteRun('DELETE FROM users', []);
  db.sqliteRun("INSERT INTO users(id,email,password_hash) VALUES (?,?,'x')", [userId, 'sem@test']);
  store.writeMemorySettings(userId, {
    ...store.readMemorySettings(userId),
    semanticMaintenance: true,
  });
});
afterAll(async () => {
  await db.closeDb();
});

function seed() {
  const a = store.createMemory(userId, {
    type: 'fact',
    key: 'runtime',
    value: '项目使用 bun。',
    scope,
  });
  const b = store.createMemory(userId, {
    type: 'fact',
    key: 'package-manager',
    value: '依赖由 bun 管理。',
    scope,
  });
  return { a, b };
}
function generator(suggestions: unknown[] = []) {
  return vi.fn(async () => ({
    text: JSON.stringify({ suggestions }),
    inputTokens: 100,
    outputTokens: 50,
  }));
}

describe('模型语义整理', () => {
  it('缺省关闭，不调用模型', async () => {
    seed();
    store.writeMemorySettings(userId, {
      ...store.readMemorySettings(userId),
      semanticMaintenance: false,
    });
    const generate = generator();
    expect((await run({ userId, scope, now, generate })).skipped).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('只生成待确认提议，不修改正文或版本；重复输入不再付费调用', async () => {
    const { a } = seed();
    const generate = generator([
      {
        action: 'update',
        targetId: a.id,
        value: '项目使用 bun 管理依赖与执行脚本。',
        reason: '合并相近表述',
      },
    ]);
    expect((await run({ userId, scope, now, generate })).proposed).toBe(1);
    expect(store.getMemoryById(userId, a.id)?.revision).toBe(1);
    expect(store.getMemoryById(userId, a.id)?.value).toBe(a.value);
    const proposal = db.sqliteGet<{ status: string; origin: string }>(
      'SELECT status,origin FROM memory_proposals WHERE user_id=?',
      [userId],
    );
    expect(proposal).toMatchObject({ status: 'pending', origin: 'maintenance' });
    await run({ userId, scope, now, generate });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('模型返回其他范围的ID、不合法结构或JSON均不生成提议', async () => {
    seed();
    const generate = generator([{ action: 'archive', targetId: 'foreign', reason: '不要跨范围' }]);
    expect((await run({ userId, scope, now, generate })).proposed).toBe(0);
    const usage = db.sqliteGet<{ calls: number }>(
      'SELECT calls FROM memory_semantic_usage WHERE user_id=?',
      [userId],
    );
    expect(usage?.calls).toBe(1);
  });

  it('无效JSON可重试，但每天含失败最多调用3次，重启不清预算', async () => {
    seed();
    const generate = vi.fn(async () => ({ text: 'not-json', inputTokens: 1, outputTokens: 1 }));
    for (let i = 0; i < 5; i += 1) await run({ userId, scope, now, generate });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(db.sqliteGet<{ n: number }>('SELECT COUNT(*) n FROM memory_proposals')?.n).toBe(0);
  });

  it('分析期间撤权或目标版本变化，迟到结果丢弃', async () => {
    const { a } = seed();
    const generate = vi.fn(async () => {
      store.writeMemorySettings(userId, {
        ...store.readMemorySettings(userId),
        semanticMaintenance: false,
      });
      return {
        text: JSON.stringify({
          suggestions: [{ action: 'archive', targetId: a.id, reason: '重复' }],
        }),
        inputTokens: 1,
        outputTokens: 1,
      };
    });
    expect((await run({ userId, scope, now, generate })).proposed).toBe(0);
    expect(store.getMemoryById(userId, a.id)?.enabled).toBe(true);
  });

  it('其他输入条目被修改也会使整批建议作废', async () => {
    const { a, b } = seed();
    const generate = vi.fn(async () => {
      store.updateMemory(userId, b.id, { value: '项目已改为其他管理方式。' });
      return {
        text: JSON.stringify({
          suggestions: [{ action: 'archive', targetId: a.id, reason: '重复' }],
        }),
        inputTokens: 1,
        outputTokens: 1,
      };
    });
    expect((await run({ userId, scope, now, generate })).skipped).toBe(true);
    expect(store.getMemoryById(userId, a.id)?.enabled).toBe(true);
  });

  it('凭据不发送给整理模型', async () => {
    seed();
    store.createMemory(userId, {
      type: 'fact',
      key: 'credential',
      value: 'password=supersecret',
      scope,
    });
    const generate = vi.fn(async (_user: string, content: string) => {
      expect(content).not.toContain('supersecret');
      return { text: '{"suggestions":[]}', inputTokens: 1, outputTokens: 1 };
    });
    await run({ userId, scope, now, generate });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('输出凭据不得写入待确认正文或理由', async () => {
    const { a } = seed();
    const generate = generator([
      { action: 'update', targetId: a.id, value: 'password=leaked-secret', reason: '更新' },
    ]);
    expect((await run({ userId, scope, now, generate })).proposed).toBe(0);
  });

  it('输入和输出token均有硬上限', async () => {
    seed();
    for (let i = 0; i < 110; i += 1) {
      store.createMemory(userId, {
        type: 'fact',
        key: `fact-${i}`,
        value: '稳定项目事实。'.repeat(200),
        scope,
      });
    }
    const generate = vi.fn(async (_user: string, content: string) => {
      expect(content.length).toBeLessThanOrEqual(42_000);
      expect((JSON.parse(content) as unknown[]).length).toBeLessThanOrEqual(100);
      return { text: '{"suggestions":[]}', inputTokens: 12000, outputTokens: 1 };
    });
    await run({ userId, scope, now, generate });
  });

  it('同范围并发只有一个分析调用', async () => {
    seed();
    let finish:
      ((value: { text: string; inputTokens: number; outputTokens: number }) => void) | undefined;
    const generate = vi.fn(
      () =>
        new Promise<{ text: string; inputTokens: number; outputTokens: number }>((resolve) => {
          finish = resolve;
        }),
    );
    const first = run({ userId, scope, now, generate });
    const second = await run({ userId, scope, now, generate });
    expect(second.skipped).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    finish?.({ text: '{"suggestions":[]}', inputTokens: 1, outputTokens: 1 });
    await first;
  });
});
