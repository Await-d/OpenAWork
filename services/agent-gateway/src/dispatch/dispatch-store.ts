import { randomUUID } from 'node:crypto';
import type {
  DispatchAttempt,
  DispatchDetail,
  DispatchDraftEdit,
  DispatchDraftInput,
  DispatchItem,
  DispatchItemAction,
  DispatchItemDraft,
  DispatchList,
  DispatchSummary,
} from '@openAwork/shared';
import { sqliteAll, sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';
import { ApiError } from '../infra/error-response.js';
import {
  dispatchPlan,
  DISPATCH_DETAIL_ATTEMPT_LIMIT,
  DISPATCH_GLOBAL_ACTIVE_LIMIT,
  DISPATCH_USER_ACTIVE_LIMIT,
} from './dispatch-contract.js';

export type DispatchSelection = DispatchDetail['selection'];
export type DispatchPlan = Omit<DispatchDraftEdit, 'revision'>;
export type DispatchCursor = [number, string];

interface DispatchRow extends DispatchDraftInput {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  revision: number;
  confirmedAt: number | null;
  updatedAt: number;
  draftJson: string;
}

const ATTEMPT_COLUMNS = `id, thread_id AS threadId, number, kind, status, question, result,
  error, stop_requested AS stopRequested, created_at AS createdAt, finished_at AS finishedAt`;
const ROW_COLUMNS = `id, title, provider_id AS providerId, model_id AS modelId, revision,
  confirmed_at AS confirmedAt, updated_at AS updatedAt`;

export function getDispatchRow(owner: string, id: string): DispatchRow {
  const row = sqliteGet<DispatchRow>(
    `SELECT ${ROW_COLUMNS}, request, excerpt, draft_json AS draftJson
    FROM dispatches WHERE owner_user_id = ? AND id = ?`,
    [owner, id],
  );
  if (!row) throw ApiError.notFound('找不到该派工单。');
  return row;
}

function summarize(
  row: Pick<DispatchRow, 'id' | 'title' | 'updatedAt' | 'confirmedAt'>,
): DispatchSummary {
  const statuses = sqliteAll<Pick<DispatchAttempt, 'status'>>(
    `SELECT a.status
    FROM dispatch_items i JOIN dispatch_attempts a ON a.id = (
      SELECT id FROM dispatch_attempts WHERE item_id = i.id ORDER BY number DESC LIMIT 1
    ) WHERE i.dispatch_id = ?`,
    [row.id],
  ).map(({ status }) => status);
  const succeeded = statuses.filter((status) => status === 'succeeded').length;
  const status =
    row.confirmedAt === null
      ? 'draft'
      : statuses.includes('running')
        ? 'running'
        : statuses.includes('queued')
          ? 'queued'
          : succeeded === statuses.length
            ? 'succeeded'
            : succeeded > 0
              ? 'partial'
              : statuses.includes('failed')
                ? 'failed'
                : statuses.includes('interrupted')
                  ? 'interrupted'
                  : 'cancelled';
  return {
    id: row.id,
    title: row.title,
    status,
    total: statuses.length,
    succeeded,
    updatedAt: row.updatedAt,
  };
}

export function getDispatch(owner: string, id: string): DispatchDetail {
  const row = getDispatchRow(owner, id);
  const items = sqliteAll<Omit<DispatchItem, 'attempts' | 'hasEarlierAttempts'>>(
    `SELECT
    id, title, objective, acceptance, role FROM dispatch_items WHERE dispatch_id = ? ORDER BY ordinal`,
    [id],
  );
  return {
    ...summarize(row),
    request: row.request,
    excerpt: row.excerpt,
    revision: row.revision,
    selection: { providerId: row.providerId, modelId: row.modelId },
    draftItems: row.confirmedAt === null ? readDraft(row).items : [],
    items: items.map((item) => {
      const attempts = sqliteAll<DispatchAttempt>(
        `SELECT ${ATTEMPT_COLUMNS} FROM dispatch_attempts
        WHERE item_id = ? ORDER BY number DESC LIMIT ?`,
        [item.id, DISPATCH_DETAIL_ATTEMPT_LIMIT],
      );
      return {
        ...item,
        attempts: attempts.map((attempt) => ({
          ...attempt,
          stopRequested: Boolean(attempt.stopRequested),
        })),
        hasEarlierAttempts: (attempts[0]?.number ?? 0) > attempts.length,
      };
    }),
  };
}

export function listDispatches(
  owner: string,
  cursor?: DispatchCursor,
): Omit<DispatchList, 'enabled'> {
  const limit = 20;
  const rows = sqliteAll<
    Pick<DispatchRow, 'id' | 'title' | 'updatedAt' | 'confirmedAt'> & { createdAt: number }
  >(
    `SELECT
    ${ROW_COLUMNS}, created_at AS createdAt FROM dispatches WHERE owner_user_id = ?
    ${cursor ? 'AND (created_at, id) < (?, ?)' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`,
    [owner, ...(cursor ?? []), limit + 1],
  );
  const last = rows[limit - 1];
  return {
    entries: rows.slice(0, limit).map(summarize),
    nextCursor: rows.length > limit && last ? JSON.stringify([last.createdAt, last.id]) : null,
  };
}

export function createDispatch(
  owner: string,
  input: DispatchDraftInput,
  selection: DispatchSelection,
  plan: DispatchPlan,
): DispatchDetail {
  const id = randomUUID();
  const now = Date.now();
  sqliteRun(
    `INSERT INTO dispatches (id, owner_user_id, title, request, excerpt, provider_id,
    model_id, draft_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      owner,
      plan.title,
      input.request,
      input.excerpt,
      selection.providerId,
      selection.modelId,
      JSON.stringify(plan.items),
      now,
      now,
    ],
  );
  return getDispatch(owner, id);
}

function readDraft(row: DispatchRow): { title: string; items: DispatchItemDraft[] } {
  return dispatchPlan.parse({ title: row.title, items: JSON.parse(row.draftJson) });
}

export function editDispatch(owner: string, id: string, edit: DispatchDraftEdit): DispatchDetail {
  return sqliteTransaction(() => {
    const row = getDispatchRow(owner, id);
    if (row.confirmedAt !== null || row.revision !== edit.revision) {
      throw ApiError.conflict('草稿已更新或已确认，请重新加载。');
    }
    sqliteRun(
      `UPDATE dispatches SET title = ?, draft_json = ?, revision = revision + 1,
      updated_at = ? WHERE id = ? AND owner_user_id = ?`,
      [edit.title, JSON.stringify(edit.items), Date.now(), id, owner],
    );
    return getDispatch(owner, id);
  });
}

function ensureQueueCapacity(owner: string, incoming: number): void {
  const counts = sqliteGet<{ total: number; owned: number | null }>(
    `SELECT COUNT(*) AS total,
    SUM(d.owner_user_id = ?) AS owned FROM dispatch_attempts a
    JOIN dispatch_items i ON i.id = a.item_id JOIN dispatches d ON d.id = i.dispatch_id
    WHERE a.status IN ('queued', 'running')`,
    [owner],
  );
  if (
    (counts?.total ?? 0) + incoming > DISPATCH_GLOBAL_ACTIVE_LIMIT ||
    (counts?.owned ?? 0) + incoming > DISPATCH_USER_ACTIVE_LIMIT
  ) {
    throw new ApiError(429, 'Conflict', '派工队列已满，请等现有事项结束后重试。');
  }
}

export function confirmDispatch(owner: string, id: string, revision: number): DispatchDetail {
  return sqliteTransaction(() => {
    const row = getDispatchRow(owner, id);
    if (row.revision !== revision) throw ApiError.conflict('草稿已更新，请重新加载。');
    if (row.confirmedAt !== null) return getDispatch(owner, id);
    const { items } = readDraft(row);
    ensureQueueCapacity(owner, items.length);
    const now = Date.now();
    items.forEach((item, ordinal) => {
      const itemId = randomUUID();
      sqliteRun(
        `INSERT INTO dispatch_items (id, dispatch_id, ordinal, title, objective, acceptance, role)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [itemId, id, ordinal, item.title, item.objective, item.acceptance, item.role],
      );
      sqliteRun(
        `INSERT INTO dispatch_attempts (id, item_id, thread_id, number, kind, status, created_at)
        VALUES (?, ?, ?, 1, 'initial', 'queued', ?)`,
        [randomUUID(), itemId, randomUUID(), now],
      );
    });
    sqliteRun('UPDATE dispatches SET confirmed_at = ?, updated_at = ? WHERE id = ?', [
      now,
      now,
      id,
    ]);
    return getDispatch(owner, id);
  });
}

export function actOnDispatch(
  owner: string,
  id: string,
  itemId: string,
  action: DispatchItemAction,
  requireEnabled: () => void,
): DispatchDetail {
  return sqliteTransaction(() => {
    getDispatchRow(owner, id);
    const current = sqliteGet<DispatchAttempt>(
      `SELECT ${ATTEMPT_COLUMNS} FROM dispatch_attempts
      WHERE item_id = (SELECT id FROM dispatch_items WHERE id = ? AND dispatch_id = ?)
      ORDER BY number DESC LIMIT 1`,
      [itemId, id],
    );
    if (!current) throw ApiError.notFound('找不到该事项。');
    if (current.id !== action.expectedAttemptId) {
      const replay = sqliteGet<Pick<DispatchAttempt, 'kind' | 'question'>>(
        `SELECT kind, question
        FROM dispatch_attempts WHERE prior_attempt_id = ? AND item_id = ?`,
        [action.expectedAttemptId, itemId],
      );
      if (
        replay?.kind === action.kind &&
        (action.kind !== 'follow-up' || replay.question === action.question)
      ) {
        return getDispatch(owner, id);
      }
      if (
        action.kind === 'cancel' &&
        sqliteGet(
          `SELECT id FROM dispatch_attempts
        WHERE id = ? AND item_id = ? AND status = 'cancelled'`,
          [action.expectedAttemptId, itemId],
        )
      ) {
        return getDispatch(owner, id);
      }
      throw ApiError.conflict('事项已更新，请重新加载。');
    }
    const now = Date.now();
    if (action.kind === 'cancel') {
      if (current.status === 'cancelled' || current.stopRequested) return getDispatch(owner, id);
      if (current.status === 'queued') {
        sqliteRun(
          `UPDATE dispatch_attempts SET status = 'cancelled', stop_requested = 1,
          finished_at = ? WHERE id = ?`,
          [now, current.id],
        );
      } else if (current.status === 'running') {
        sqliteRun('UPDATE dispatch_attempts SET stop_requested = 1 WHERE id = ?', [current.id]);
      } else {
        throw ApiError.conflict('该次执行已结束。');
      }
    } else {
      requireEnabled();
      const allowed =
        action.kind === 'follow-up'
          ? current.status === 'succeeded'
          : ['failed', 'interrupted', 'cancelled'].includes(current.status);
      if (!allowed) throw ApiError.conflict('当前状态不支持该操作。');
      ensureQueueCapacity(owner, 1);
      const question = action.kind === 'follow-up' ? action.question : current.question;
      sqliteRun(
        `INSERT INTO dispatch_attempts (id, item_id, thread_id, number, prior_attempt_id,
        kind, status, question, created_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        [
          randomUUID(),
          itemId,
          question !== null ? current.threadId : randomUUID(),
          current.number + 1,
          current.id,
          action.kind,
          question,
          now,
        ],
      );
    }
    sqliteRun('UPDATE dispatches SET updated_at = ? WHERE id = ?', [now, id]);
    return getDispatch(owner, id);
  });
}
