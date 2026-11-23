import type { DispatchAttempt, DispatchItemDraft } from '@openAwork/shared';
import { sqliteAll, sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';
import { DISPATCH_MAX_RESULT_CHARS } from './dispatch-contract.js';
import type { DispatchSelection } from './dispatch-store.js';

export interface DispatchJob extends DispatchSelection, DispatchItemDraft {
  id: string;
  owner: string;
  dispatchId: string;
  itemId: string;
  threadId: string;
  kind: DispatchAttempt['kind'];
  request: string;
  excerpt: string;
  question: string | null;
}

export type DispatchOutcome = { result: string } | { error: NonNullable<DispatchAttempt['error']> };

export function claimDispatchJob(): DispatchJob | undefined {
  return sqliteTransaction(() => {
    const job = sqliteGet<DispatchJob>(`SELECT a.id, a.item_id AS itemId,
      a.thread_id AS threadId, a.kind, a.question, d.id AS dispatchId, d.owner_user_id AS owner,
      d.provider_id AS providerId, d.model_id AS modelId, d.request, d.excerpt,
      i.title, i.role, i.objective, i.acceptance
      FROM dispatch_attempts a JOIN dispatch_items i ON i.id = a.item_id
      JOIN dispatches d ON d.id = i.dispatch_id
      WHERE a.status = 'queued' AND (
        SELECT COUNT(*) FROM dispatch_attempts WHERE status = 'running'
      ) < 4 AND (
        SELECT COUNT(*) FROM dispatch_attempts r JOIN dispatch_items ri ON ri.id = r.item_id
        JOIN dispatches rd ON rd.id = ri.dispatch_id
        WHERE r.status = 'running' AND rd.owner_user_id = d.owner_user_id
      ) < 2 ORDER BY a.created_at, a.id LIMIT 1`);
    if (!job) return undefined;
    sqliteRun(
      "UPDATE dispatch_attempts SET status = 'running' WHERE id = ? AND status = 'queued'",
      [job.id],
    );
    touchDispatch(job.dispatchId, Date.now());
    return job;
  });
}

export function readDispatchHistory(
  job: DispatchJob,
): { question: string | null; result: string }[] {
  return sqliteAll<{ question: string | null; result: string }>(
    `SELECT question, result
    FROM dispatch_attempts WHERE item_id = ? AND thread_id = ? AND status = 'succeeded'
      AND result IS NOT NULL ORDER BY number DESC LIMIT 3`,
    [job.itemId, job.threadId],
  ).reverse();
}

export function finishDispatchJob(job: DispatchJob, outcome: DispatchOutcome): void {
  sqliteTransaction(() => {
    const row = sqliteGet<{ stop: number }>(
      `SELECT stop_requested AS stop
      FROM dispatch_attempts WHERE id = ? AND status = 'running'`,
      [job.id],
    );
    if (!row) return;
    const status = row.stop ? 'cancelled' : 'result' in outcome ? 'succeeded' : 'failed';
    const result =
      !row.stop && 'result' in outcome ? outcome.result.slice(0, DISPATCH_MAX_RESULT_CHARS) : null;
    const error = !row.stop && 'error' in outcome ? outcome.error : null;
    const now = Date.now();
    sqliteRun(
      `UPDATE dispatch_attempts SET status = ?, result = ?, error = ?, finished_at = ?
      WHERE id = ? AND status = 'running'`,
      [status, result, error, now, job.id],
    );
    touchDispatch(job.dispatchId, now);
  });
}

export function recoverDispatchJobs(): void {
  sqliteTransaction(() => {
    const now = Date.now();
    sqliteRun(
      `UPDATE dispatches SET updated_at = ? WHERE id IN (
      SELECT i.dispatch_id FROM dispatch_items i JOIN dispatch_attempts a ON a.item_id = i.id
      WHERE a.status = 'running'
    )`,
      [now],
    );
    sqliteRun(
      `UPDATE dispatch_attempts SET status = CASE WHEN stop_requested = 1 THEN 'cancelled'
      ELSE 'interrupted' END, error = CASE WHEN stop_requested = 1 THEN NULL ELSE 'gateway-stopped' END,
      finished_at = ? WHERE status = 'running'`,
      [now],
    );
  });
}

function touchDispatch(id: string, now: number): void {
  sqliteRun('UPDATE dispatches SET updated_at = ? WHERE id = ?', [now, id]);
}
