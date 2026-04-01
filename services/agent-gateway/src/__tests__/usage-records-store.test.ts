import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteRunMock } = vi.hoisted(() => ({
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteRun: sqliteRunMock,
}));

import { persistMonthlyUsageRecord } from '../usage-records-store.js';

describe('persistMonthlyUsageRecord', () => {
  beforeEach(() => {
    sqliteRunMock.mockReset();
  });

  it('upserts monthly usage totals with computed cost', () => {
    persistMonthlyUsageRecord({
      occurredAt: Date.UTC(2026, 3, 1, 12, 0, 0),
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10,
      usage: {
        inputTokens: 1200,
        outputTokens: 3400,
      },
      userId: 'user-a',
    });

    expect(sqliteRunMock).toHaveBeenCalledTimes(1);
    const [query, params] = sqliteRunMock.mock.calls[0] ?? [];
    expect(String(query)).toContain('INSERT INTO usage_records');
    expect(String(query)).toContain('ON CONFLICT(user_id, month) DO UPDATE');
    expect(params).toEqual(['user-a', '2026-04', 1200, 3400, 0.037, 1200, 3400, 0.037]);
  });

  it('skips persistence when both input and output tokens are zero', () => {
    persistMonthlyUsageRecord({
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      userId: 'user-a',
    });

    expect(sqliteRunMock).not.toHaveBeenCalled();
  });
});
