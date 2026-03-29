import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';

interface UsageRecordRow {
  month: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface UsageRecord {
  month: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: Record<string, number>;
}

interface CostBreakdownItem {
  modelName: string;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

interface BudgetRow {
  budget_usd: number;
}

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/usage/records',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'usage.records.list');
      const user = request.user as JwtPayload;

      const recordsStep = child('query');
      const rows = sqliteAll<UsageRecordRow>(
        `SELECT month, input_tokens, output_tokens, cost_usd
         FROM usage_records
         WHERE user_id = ?
         ORDER BY month DESC
         LIMIT 12`,
        [user.sub],
      );
      const records: UsageRecord[] = rows.map((row) => ({
        month: row.month,
        totalCostUsd: row.cost_usd,
        totalInputTokens: row.input_tokens,
        totalOutputTokens: row.output_tokens,
        byProvider: {},
      }));
      recordsStep.succeed(undefined, { months: records.length });

      const budgetStep = child('budget.load');
      const budget =
        sqliteGet<BudgetRow>(
          `SELECT CAST(value AS REAL) as budget_usd FROM user_settings WHERE user_id = ? AND key = 'budget_usd'`,
          [user.sub],
        )?.budget_usd ?? 20;
      budgetStep.succeed(undefined, { budgetUsd: budget });
      step.succeed(undefined, { months: records.length, budgetUsd: budget });

      return reply.send({ records, budgetUsd: budget });
    },
  );

  app.get(
    '/usage/breakdown',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'usage.breakdown.get');
      const user = request.user as JwtPayload;
      const currentMonth = new Date().toISOString().slice(0, 7);

      const lookupStep = child('lookup', undefined, { month: currentMonth });
      const row = sqliteGet<UsageRecordRow>(
        `SELECT month, input_tokens, output_tokens, cost_usd
         FROM usage_records
         WHERE user_id = ? AND month = ?`,
        [user.sub, currentMonth],
      );
      const monthlyCostUsd = row?.cost_usd ?? 0;
      const breakdown: CostBreakdownItem[] = [];

      lookupStep.succeed(undefined, { found: row !== undefined, month: currentMonth });
      step.succeed(undefined, { month: currentMonth, found: row !== undefined });

      return reply.send({ monthlyCostUsd, breakdown });
    },
  );
}
