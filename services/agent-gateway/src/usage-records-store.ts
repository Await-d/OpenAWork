import { calculateTokenCost } from '@openAwork/agent-core';
import { sqliteRun } from './db.js';
import type { StreamUsageSummary } from './routes/stream-protocol.js';

export function persistMonthlyUsageRecord(input: {
  occurredAt?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  usage: Pick<StreamUsageSummary, 'inputTokens' | 'outputTokens'>;
  userId: string;
}): void {
  const inputTokens = Math.max(0, Math.trunc(input.usage.inputTokens));
  const outputTokens = Math.max(0, Math.trunc(input.usage.outputTokens));

  if (inputTokens === 0 && outputTokens === 0) {
    return;
  }

  const month = new Date(input.occurredAt ?? Date.now()).toISOString().slice(0, 7);
  const costUsd = calculateTokenCost(
    inputTokens,
    outputTokens,
    input.inputPricePerMillion,
    input.outputPricePerMillion,
  );

  sqliteRun(
    `INSERT INTO usage_records (user_id, month, input_tokens, output_tokens, cost_usd)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, month) DO UPDATE SET
       input_tokens = usage_records.input_tokens + ?,
       output_tokens = usage_records.output_tokens + ?,
       cost_usd = usage_records.cost_usd + ?`,
    [input.userId, month, inputTokens, outputTokens, costUsd, inputTokens, outputTokens, costUsd],
  );
}
