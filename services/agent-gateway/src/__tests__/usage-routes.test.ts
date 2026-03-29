import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteAllMock, sqliteGetMock } = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteGetMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  requireAuth: async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'user-a' };
  },
}));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: { succeed: () => undefined, fail: () => undefined },
    child: () => ({ succeed: () => undefined, fail: () => undefined }),
  }),
}));

vi.mock('../db.js', () => ({
  sqliteAll: sqliteAllMock,
  sqliteGet: sqliteGetMock,
}));

import { usageRoutes } from '../routes/usage.js';

describe('usage routes', () => {
  beforeEach(() => {
    sqliteAllMock.mockReset();
    sqliteGetMock.mockReset();
  });

  it('returns usage records with the current user budget', async () => {
    sqliteAllMock.mockImplementation((query: string, params: unknown[]) => {
      expect(query).toContain('FROM usage_records');
      expect(query).toContain('WHERE user_id = ?');
      expect(params).toEqual(['user-a']);

      return [
        {
          month: '2026-03',
          input_tokens: 1200,
          output_tokens: 3400,
          cost_usd: 8.5,
        },
      ];
    });

    sqliteGetMock.mockImplementation((query: string, params: unknown[]) => {
      expect(query).toContain("key = 'budget_usd'");
      expect(params).toEqual(['user-a']);
      return { budget_usd: 12.5 };
    });

    const app = Fastify();
    await app.register(usageRoutes);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/usage/records' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      records: [
        {
          month: '2026-03',
          totalCostUsd: 8.5,
          totalInputTokens: 1200,
          totalOutputTokens: 3400,
          byProvider: {},
        },
      ],
      budgetUsd: 12.5,
    });

    await app.close();
  });

  it('falls back to the default budget when user settings are empty', async () => {
    sqliteAllMock.mockReturnValue([]);
    sqliteGetMock.mockReturnValue(undefined);

    const app = Fastify();
    await app.register(usageRoutes);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/usage/records' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ records: [], budgetUsd: 20 });

    await app.close();
  });

  it('returns the current month total cost for breakdown requests', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);

    sqliteGetMock.mockImplementation((query: string, params: unknown[]) => {
      expect(query).toContain('FROM usage_records');
      expect(query).toContain('WHERE user_id = ? AND month = ?');
      expect(params).toEqual(['user-a', currentMonth]);

      return {
        month: currentMonth,
        input_tokens: 640,
        output_tokens: 1280,
        cost_usd: 3.75,
      };
    });

    const app = Fastify();
    await app.register(usageRoutes);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/usage/breakdown' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ monthlyCostUsd: 3.75, breakdown: [] });

    await app.close();
  });
});
