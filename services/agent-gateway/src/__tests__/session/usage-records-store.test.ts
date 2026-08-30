import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import { persistMonthlyUsageRecord } from '../../session/usage-records-store.js';

process.env['DATABASE_URL'] = ':memory:';

let dbModule: typeof DbModule;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM usage_records', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    'u-usage-cost',
    'usage-cost@example.com',
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('persistMonthlyUsageRecord', () => {
  it('将缓存读写 token 按模型缓存价格计入月度费用', () => {
    persistMonthlyUsageRecord({
      userId: 'u-usage-cost',
      occurredAt: Date.UTC(2026, 7, 1),
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      cacheReadPricePerMillion: 0.3,
      cacheWritePricePerMillion: 3.75,
      usage: {
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 4_000,
        cacheWriteTokens: 2_000,
      },
    });

    const row = dbModule.sqliteGet<{
      cost_usd: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
    }>(
      `SELECT cost_usd, cache_read_tokens, cache_write_tokens
       FROM usage_records WHERE user_id = ? AND month = ?`,
      ['u-usage-cost', '2026-08'],
    );
    expect(row?.cost_usd).toBeCloseTo(0.0192, 8);
    expect(row?.cache_read_tokens).toBe(4_000);
    expect(row?.cache_write_tokens).toBe(2_000);
  });

  it('只有缓存 token 时仍写入月度费用', () => {
    persistMonthlyUsageRecord({
      userId: 'u-usage-cost',
      occurredAt: Date.UTC(2026, 7, 1),
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      cacheReadPricePerMillion: 0.3,
      cacheWritePricePerMillion: 3.75,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 4_000,
        cacheWriteTokens: 2_000,
      },
    });

    const row = dbModule.sqliteGet<{
      cost_usd: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
    }>(
      `SELECT cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
       FROM usage_records WHERE user_id = ? AND month = ?`,
      ['u-usage-cost', '2026-08'],
    );
    expect(row?.cost_usd).toBeCloseTo(0.0087, 8);
    expect(row).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 4_000,
      cache_write_tokens: 2_000,
    });
  });

  it('累计极低缓存单价时不会在单次写入阶段提前归零', () => {
    for (let index = 0; index < 2; index += 1) {
      persistMonthlyUsageRecord({
        userId: 'u-usage-cost',
        occurredAt: Date.UTC(2026, 7, 1),
        inputPricePerMillion: 0.001,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 1,
          cacheWriteTokens: 0,
        },
      });
    }

    const row = dbModule.sqliteGet<{ cost_usd: number; cache_read_tokens: number }>(
      `SELECT cost_usd, cache_read_tokens
       FROM usage_records WHERE user_id = ? AND month = ?`,
      ['u-usage-cost', '2026-08'],
    );
    expect(row?.cost_usd).toBeCloseTo(0.000000002, 14);
    expect(row?.cache_read_tokens).toBe(2);
  });
});
