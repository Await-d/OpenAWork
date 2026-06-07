/**
 * Write path + retention for `team_messages`.
 *
 * `POST /team/messages` appends a row per call with no throttle, and the table
 * is read with `ORDER BY created_at ASC LIMIT 100` — so rows beyond the newest
 * window are never shown yet never removed (the only deletion is the
 * user-delete CASCADE). On a long-lived account the table grows without bound,
 * storing messages no reader will ever surface. This centralizes the insert
 * and bounds the table per-user with the same amortized most-recent-N retention
 * as `notifications` (§0.40 family): trim every PRUNE_CHECK_INTERVAL inserts so
 * the row count overshoots the cap by at most one interval, and never let a
 * prune failure break the message write.
 */

import { sqliteRun } from '../infra/db.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';

const DEFAULT_TEAM_MESSAGE_MAX_ROWS_PER_USER = 1000;
export const TEAM_MESSAGE_PRUNE_CHECK_INTERVAL = 50;

let retentionOverride: number | null = null;
let pruneCheckInterval = TEAM_MESSAGE_PRUNE_CHECK_INTERVAL;
const insertsSincePruneByUser = new Map<string, number>();
let storeDisabled = false;

function resolveRetention(): number {
  if (retentionOverride !== null) {
    return retentionOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_TEAM_MESSAGE_MAX_ROWS_PER_USER'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_TEAM_MESSAGE_MAX_ROWS_PER_USER;
  }
  const parsed = Number(raw);
  // Non-positive / NaN disables retention, matching the sibling stores' env
  // dead-switch semantics.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function prune(userId: string, limit: number): void {
  // Order by the implicit rowid: created_at is second-precision (same-second
  // rows tie), while rowid is monotonic and uniquely identifies "the most
  // recent N" for this user.
  sqliteRun(
    `DELETE FROM team_messages
      WHERE user_id = ?
        AND rowid NOT IN (
          SELECT rowid FROM team_messages
           WHERE user_id = ?
           ORDER BY rowid DESC
           LIMIT ?
        )`,
    [userId, userId, limit],
  );
}

function maybePrune(userId: string): void {
  if (storeDisabled) {
    return;
  }
  const limit = resolveRetention();
  if (limit <= 0) {
    // Retention disabled: drop the counter so re-enabling later doesn't
    // trigger one giant catch-up prune.
    insertsSincePruneByUser.delete(userId);
    return;
  }
  const pending = (insertsSincePruneByUser.get(userId) ?? 0) + 1;
  if (pending < pruneCheckInterval) {
    insertsSincePruneByUser.set(userId, pending);
    return;
  }
  insertsSincePruneByUser.set(userId, 0);
  try {
    prune(userId, limit);
  } catch (error) {
    // A prune failure must never break message persistence. On DB corruption
    // disable the prune path entirely, consistent with the sibling stores.
    if (isSqliteMalformedError(error)) {
      storeDisabled = true;
      return;
    }
    // Otherwise swallow — retention is best-effort.
  }
}

export interface TeamMessageInput {
  id: string;
  userId: string;
  senderId?: string | null;
  recipientMemberId?: string | null;
  replyToMessageId?: string | null;
  content: string;
  type: string;
}

/**
 * Append one team message, then opportunistically prune older rows for this
 * user. The prune is best-effort and never blocks the write.
 */
export function appendTeamMessage(input: TeamMessageInput): void {
  sqliteRun(
    `INSERT INTO team_messages (
      id,
      user_id,
      sender_id,
      recipient_member_id,
      reply_to_message_id,
      content,
      type
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.userId,
      input.senderId ?? null,
      input.recipientMemberId ?? null,
      input.replyToMessageId ?? null,
      input.content,
      input.type,
    ],
  );
  maybePrune(input.userId);
}

/** Test-only: override the per-user row cap (null clears the override). */
export function __setTeamMessageRetentionForTesting(
  limit: number | null,
  checkInterval?: number,
): void {
  retentionOverride = limit;
  pruneCheckInterval =
    typeof checkInterval === 'number' && checkInterval > 0
      ? Math.floor(checkInterval)
      : TEAM_MESSAGE_PRUNE_CHECK_INTERVAL;
  insertsSincePruneByUser.clear();
  storeDisabled = false;
}
