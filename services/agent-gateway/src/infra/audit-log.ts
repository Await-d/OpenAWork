import { sqliteRun } from './db.js';
import { isSqliteMalformedError } from './sqlite-error-utils.js';

export type AuditErrorCategory = 'tool' | 'llm' | 'stream' | 'route';

export interface WriteAuditLogOptions {
  sessionId: string | null;
  category: AuditErrorCategory;
  /**
   * tool → 工具名（`file_edit`）
   * llm  → `QUOTA_EXCEEDED` / `RATE_LIMIT` / `MODEL_ERROR`
   * stream → `PARSE_ERROR` / `STREAM_ERROR`
   * route → `MODEL_RESOLVE` / `SESSION_CONFLICT` / `REPLAY_FAILED`
   */
  sourceName: string;
  requestId: string;
  input?: unknown;
  /** 需包含 `message` 字段以被前端 `extractAuditSummary` 正确提取 */
  output?: unknown;
  isError?: boolean;
  durationMs?: number | null;
}

/**
 * category + sourceName → `tool_name` 列值。
 * tool 类保持原样，其他加前缀（`llm:QUOTA_EXCEEDED`）以支持前端按类型分组。
 */
function resolveToolNameColumn(category: AuditErrorCategory, sourceName: string): string {
  if (category === 'tool') {
    return sourceName;
  }
  if (sourceName.startsWith(`${category}:`)) {
    return sourceName;
  }
  return `${category}:${sourceName}`;
}

function safeStringify(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  const fallback = (): string => {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    if (value instanceof Error) {
      return value.stack ?? value.message;
    }
    return Object.prototype.toString.call(value);
  };

  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === 'string') {
      return serialized;
    }
    if (typeof value === 'function') {
      return value.name.length > 0 ? `[Function: ${value.name}]` : '[Function]';
    }
    return null;
  } catch {
    return fallback();
  }
}

/**
 * Global row cap for the `audit_logs` table. Every tool call plus every
 * llm/stream/route error appends a row (19+ call sites), and the only
 * cleanup is an on-demand `DELETE /settings/diagnostics` that clears just
 * `is_error = 1` rows for one user. Successful-call rows survive session
 * deletion too (`session_id` uses ON DELETE SET NULL, not cascade), so on a
 * long-lived install the table grows without bound. Consumers only ever read
 * the most recent rows (`ORDER BY ... DESC LIMIT 100/200`, `id DESC LIMIT 50`)
 * or look up by `request_id`, so keeping the most recent N rows globally is
 * safe. Matches the retention pattern of `request_workflow_logs` (§0.40).
 */
const DEFAULT_AUDIT_LOG_MAX_ROWS = 20_000;
export const AUDIT_LOG_PRUNE_CHECK_INTERVAL = 200;

let auditLogRetentionOverride: number | null = null;
let auditLogPruneCheckInterval = AUDIT_LOG_PRUNE_CHECK_INTERVAL;
let auditLogInsertsSincePrune = 0;
let auditLogStoreDisabled = false;

function resolveAuditLogRetention(): number {
  if (auditLogRetentionOverride !== null) {
    return auditLogRetentionOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_AUDIT_LOG_MAX_ROWS'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_AUDIT_LOG_MAX_ROWS;
  }
  const parsed = Number(raw);
  // Non-positive / NaN means "retention disabled", matching the env
  // dead-switch semantics of the sibling retention stores.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function pruneAuditLogs(limit: number): void {
  // Sort by the autoincrement id: created_at is second-precision so same-second
  // rows tie, while id is monotonic and uniquely identifies "the most recent N".
  sqliteRun(
    `DELETE FROM audit_logs
      WHERE id NOT IN (
        SELECT id FROM audit_logs
         ORDER BY id DESC
         LIMIT ?
      )`,
    [limit],
  );
}

function maybePruneAuditLogs(): void {
  if (auditLogStoreDisabled) {
    return;
  }
  const limit = resolveAuditLogRetention();
  if (limit <= 0) {
    // Retention disabled: reset the counter so re-enabling later doesn't
    // trigger one giant catch-up prune.
    auditLogInsertsSincePrune = 0;
    return;
  }
  auditLogInsertsSincePrune += 1;
  if (auditLogInsertsSincePrune < auditLogPruneCheckInterval) {
    return;
  }
  auditLogInsertsSincePrune = 0;
  try {
    pruneAuditLogs(limit);
  } catch (error) {
    // A prune failure must never break audit persistence or the main request
    // flow. On DB corruption disable the prune path entirely, consistent with
    // the sibling retention stores.
    if (isSqliteMalformedError(error)) {
      auditLogStoreDisabled = true;
      return;
    }
    // Otherwise swallow — audit retention is best-effort.
  }
}

/** Test-only: override the global row cap (null clears the override). */
export function __setAuditLogRetentionForTesting(
  limit: number | null,
  checkInterval?: number,
): void {
  auditLogRetentionOverride = limit;
  auditLogPruneCheckInterval =
    typeof checkInterval === 'number' && checkInterval > 0
      ? Math.floor(checkInterval)
      : AUDIT_LOG_PRUNE_CHECK_INTERVAL;
  auditLogInsertsSincePrune = 0;
  auditLogStoreDisabled = false;
}

export function writeAuditLog(options: WriteAuditLogOptions): void {
  try {
    sqliteRun(
      'INSERT INTO audit_logs (session_id, tool_name, request_id, input_json, output_json, is_error, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        options.sessionId,
        resolveToolNameColumn(options.category, options.sourceName),
        options.requestId,
        safeStringify(options.input),
        safeStringify(options.output),
        (options.isError ?? true) ? 1 : 0,
        options.durationMs ?? null,
      ],
    );
    maybePruneAuditLogs();
  } catch {
    // 审计写入不阻塞主流程
  }
}
