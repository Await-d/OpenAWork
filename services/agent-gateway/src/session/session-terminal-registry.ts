/**
 * Session terminal registry — single source of truth for every bash /
 * interactive_bash / background bash invocation in a chat session.
 *
 * Design contract (see .agentdocs/workflow/260512-session-terminal-tracking-spec.md):
 *
 *   - In-memory map holds the live `AbortController` so killTerminal() can
 *     trigger the same abort path as the session-wide stop button, but
 *     scoped to a single command.
 *   - SQLite persistence so the UI can render "recently exited terminals"
 *     after a gateway restart and so multi-tab clients fetching via
 *     `GET /sessions/:id/terminals` share a consistent view.
 *   - `appendTerminalOutput` is throttled (≥100ms) and emits
 *     `terminal_output` RunEvents through the existing
 *     `publishSessionRunEvent` channel.
 *
 * Lifecycle states are defined by SessionTerminalStatus in
 * `@openAwork/shared`:
 *
 *   running → exited | aborted | timeout | spawn_error | killed | stale
 *   (pseudo) tmux-spawned | tmux-killed   ← interactive_bash lifecycle
 *
 * The registry intentionally stays decoupled from `bash-tools.ts`
 * implementation details: callers hand us snapshots / status transitions,
 * we mirror them into SQLite and broadcast events.
 */

import { randomBytes } from 'node:crypto';
import type {
  RunEvent,
  SessionTerminalKind,
  SessionTerminalStatus,
  SessionTerminalSummary,
  StreamTerminalExitedChunk,
  StreamTerminalOutputChunk,
  StreamTerminalStartedChunk,
} from '@openAwork/shared';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { publishSessionRunEvent } from './session-run-events.js';

/** Max bytes retained in `output_tail`. UTF-8 safe truncation enforced. */
export const TERMINAL_OUTPUT_TAIL_BYTES = 8 * 1024;

/** Min interval between successive terminal_output broadcasts per terminal. */
const OUTPUT_EMIT_THROTTLE_MS = 100;

export interface SessionTerminalRecord extends SessionTerminalSummary {
  userId: string;
  metadata: Record<string, unknown>;
}

export interface RegisterTerminalInput {
  sessionId: string;
  userId: string;
  clientRequestId?: string;
  toolName: string;
  kind: SessionTerminalKind;
  command: string;
  description?: string;
  cwd: string;
  toolCallId?: string;
  initialStatus?: SessionTerminalStatus;
  metadata?: Record<string, unknown>;
  /**
   * Optional abort controller — killTerminal() calls `.abort()` on this
   * to propagate the kill request back into spawnAndCollect(). Not stored
   * in SQLite (process-local handle).
   */
  abortController?: AbortController;
  /**
   * Optional override of terminal_id — used for tmux pseudo-terminals
   * where we want the id to derive deterministically from the tmux
   * session name so kill-session can find it.
   */
  terminalId?: string;
}

interface LiveTerminalState {
  abortController?: AbortController;
  /** Tail emitter throttle bookkeeping. */
  lastEmitMs: number;
  /** Last byte count emitted, so we can skip no-op emits. */
  lastEmittedBytes: number;
  /** Last buffered tail awaiting emit (post-throttle flush). */
  pendingTail?: string;
  pendingBytes: number;
  trailingTimer: NodeJS.Timeout | null;
  /** Process pid once known, for fallback kill path. */
  pid?: number;
  /** Already-finalized terminals are pruned from this map. */
  closed: boolean;
}

const liveTerminals = new Map<string, LiveTerminalState>();

interface SessionTerminalRow {
  terminal_id: string;
  session_id: string;
  user_id: string;
  client_request_id: string | null;
  tool_name: string;
  kind: string;
  command: string;
  description: string | null;
  name: string | null;
  cwd: string;
  pid: number | null;
  status: string;
  exit_code: number | null;
  started_at_ms: number;
  ended_at_ms: number | null;
  last_activity_ms: number;
  output_bytes_total: number;
  output_tail: string;
  output_path: string | null;
  metadata_json: string;
}

function rowToRecord(row: SessionTerminalRow): SessionTerminalRecord {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  return {
    terminalId: row.terminal_id,
    sessionId: row.session_id,
    userId: row.user_id,
    ...(row.client_request_id ? { clientRequestId: row.client_request_id } : {}),
    toolName: row.tool_name,
    kind: row.kind as SessionTerminalKind,
    command: row.command,
    ...(row.description ? { description: row.description } : {}),
    ...(row.name ? { name: row.name } : {}),
    cwd: row.cwd,
    ...(row.pid !== null ? { pid: row.pid } : {}),
    status: row.status as SessionTerminalStatus,
    ...(row.exit_code !== null ? { exitCode: row.exit_code } : {}),
    startedAtMs: row.started_at_ms,
    ...(row.ended_at_ms !== null ? { endedAtMs: row.ended_at_ms } : {}),
    lastActivityMs: row.last_activity_ms,
    outputBytesTotal: row.output_bytes_total,
    outputTail: row.output_tail,
    ...(row.output_path ? { outputPath: row.output_path } : {}),
    metadata,
  };
}

function toSummary(record: SessionTerminalRecord): SessionTerminalSummary {
  const { userId: _u, metadata: _m, ...summary } = record;
  return summary;
}

/**
 * Returns the tail (last N bytes) of `text`, snapped to a valid utf-8
 * boundary. Used to keep `output_tail` ≤ TERMINAL_OUTPUT_TAIL_BYTES even
 * when the live partial output snapshot is much larger.
 */
function tailUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf-8');
  if (buf.length <= maxBytes) return text;
  // Move start forward until we land on a continuation-byte boundary
  // (high bits 10xxxxxx are continuation bytes — we want to start at
  // a non-continuation byte).
  let start = buf.length - maxBytes;
  while (start < buf.length && (buf[start]! & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }
  return buf.subarray(start).toString('utf-8');
}

function generateTerminalId(): string {
  return `term_${randomBytes(8).toString('hex')}`;
}

function isTerminalClosed(status: SessionTerminalStatus): boolean {
  return (
    status === 'exited' ||
    status === 'aborted' ||
    status === 'timeout' ||
    status === 'spawn_error' ||
    status === 'killed' ||
    status === 'stale' ||
    status === 'tmux-killed'
  );
}

function emitRunEvent(
  sessionId: string,
  clientRequestId: string | undefined,
  event: RunEvent,
): void {
  try {
    publishSessionRunEvent(sessionId, event, clientRequestId ? { clientRequestId } : undefined);
  } catch (error) {
    // Never let a publish failure cascade into the bash tool's hot path.
    console.warn(
      '[session-terminal-registry] publishSessionRunEvent failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Inserts a new terminal row and registers the live abort controller.
 * If `terminalId` is provided and already exists, the call upserts the
 * row (idempotent for tmux pseudo-terminals re-registered on resume).
 */
export function registerTerminal(input: RegisterTerminalInput): SessionTerminalRecord {
  const now = Date.now();
  const terminalId = input.terminalId ?? generateTerminalId();
  const initialStatus: SessionTerminalStatus = input.initialStatus ?? 'running';

  const existing = sqliteGet<SessionTerminalRow>(
    'SELECT * FROM session_terminals WHERE terminal_id = ?',
    [terminalId],
  );
  if (existing) {
    // Idempotent upsert path: only refresh mutable fields, keep started_at.
    sqliteRun(
      `UPDATE session_terminals
       SET status = ?, last_activity_ms = ?, command = ?, cwd = ?,
           description = ?, metadata_json = ?
       WHERE terminal_id = ?`,
      [
        initialStatus,
        now,
        input.command,
        input.cwd,
        input.description ?? null,
        JSON.stringify(input.metadata ?? {}),
        terminalId,
      ],
    );
  } else {
    sqliteRun(
      `INSERT INTO session_terminals
         (terminal_id, session_id, user_id, client_request_id, tool_name, kind,
          command, description, cwd, pid, status, exit_code,
          started_at_ms, ended_at_ms, last_activity_ms,
          output_bytes_total, output_tail, output_path, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, ?, 0, '', NULL, ?)`,
      [
        terminalId,
        input.sessionId,
        input.userId,
        input.clientRequestId ?? null,
        input.toolName,
        input.kind,
        input.command,
        input.description ?? null,
        input.cwd,
        initialStatus,
        now,
        now,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  const state: LiveTerminalState = {
    ...(input.abortController ? { abortController: input.abortController } : {}),
    lastEmitMs: 0,
    lastEmittedBytes: 0,
    pendingBytes: 0,
    trailingTimer: null,
    closed: isTerminalClosed(initialStatus),
  };
  liveTerminals.set(terminalId, state);

  const record: SessionTerminalRecord = {
    terminalId,
    sessionId: input.sessionId,
    userId: input.userId,
    ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    toolName: input.toolName,
    kind: input.kind,
    command: input.command,
    ...(input.description ? { description: input.description } : {}),
    cwd: input.cwd,
    status: initialStatus,
    startedAtMs: now,
    lastActivityMs: now,
    outputBytesTotal: 0,
    outputTail: '',
    metadata: input.metadata ?? {},
  };

  const startedChunk: StreamTerminalStartedChunk = {
    type: 'terminal_started',
    terminalId,
    sessionId: input.sessionId,
    toolName: input.toolName,
    kind: input.kind,
    command: input.command,
    ...(input.description ? { description: input.description } : {}),
    cwd: input.cwd,
    startedAtMs: now,
    ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    occurredAt: now,
  };
  emitRunEvent(input.sessionId, input.clientRequestId, startedChunk);

  // If we registered as already-closed (e.g. tmux-spawned which we treat
  // as an instant lifecycle marker), emit the exit event immediately
  // so the frontend can render the closed-state row without waiting.
  if (state.closed) {
    const exited: StreamTerminalExitedChunk = {
      type: 'terminal_exited',
      terminalId,
      status: initialStatus,
      endedAtMs: now,
      occurredAt: now,
    };
    sqliteRun('UPDATE session_terminals SET ended_at_ms = ? WHERE terminal_id = ?', [
      now,
      terminalId,
    ]);
    record.endedAtMs = now;
    emitRunEvent(input.sessionId, input.clientRequestId, exited);
  }

  return record;
}

/**
 * Record the OS pid for a terminal once the spawned process is alive.
 * The pid is used by killTerminal as a fallback when the abortController
 * path fails to terminate the process.
 */
export function setTerminalPid(terminalId: string, pid: number | undefined): void {
  const state = liveTerminals.get(terminalId);
  if (!state) return;
  state.pid = pid;
  sqliteRun('UPDATE session_terminals SET pid = ? WHERE terminal_id = ?', [
    pid ?? null,
    terminalId,
  ]);
}

/**
 * Update the running output snapshot. `snapshot` is the **cumulative**
 * stdout+stderr text since process start (matching bash-tools'
 * onPartialOutput contract). We compute byte length, store the trailing
 * tail, and broadcast a throttled terminal_output event.
 */
export function appendTerminalOutput(terminalId: string, snapshot: string): void {
  const state = liveTerminals.get(terminalId);
  if (!state || state.closed) return;
  const now = Date.now();
  const totalBytes = Buffer.byteLength(snapshot, 'utf-8');
  const tail = tailUtf8(snapshot, TERMINAL_OUTPUT_TAIL_BYTES);
  // Always persist the latest tail so list endpoints see fresh data even
  // if throttled emits are pending.
  sqliteRun(
    `UPDATE session_terminals
       SET output_bytes_total = MAX(output_bytes_total, ?),
           output_tail = ?,
           last_activity_ms = ?
     WHERE terminal_id = ?`,
    [totalBytes, tail, now, terminalId],
  );

  state.pendingTail = tail;
  state.pendingBytes = totalBytes;
  const elapsed = now - state.lastEmitMs;

  // Look up session_id + client_request_id once for the emit; cheap because
  // the row was just written above.
  const row = sqliteGet<{ session_id: string; client_request_id: string | null }>(
    'SELECT session_id, client_request_id FROM session_terminals WHERE terminal_id = ?',
    [terminalId],
  );
  if (!row) return;

  const flushEmit = () => {
    if (state.pendingTail === undefined) return;
    if (state.pendingBytes === state.lastEmittedBytes) {
      state.pendingTail = undefined;
      return;
    }
    state.lastEmitMs = Date.now();
    state.lastEmittedBytes = state.pendingBytes;
    const chunk: StreamTerminalOutputChunk = {
      type: 'terminal_output',
      terminalId,
      outputTail: state.pendingTail,
      outputBytesTotal: state.pendingBytes,
      occurredAt: state.lastEmitMs,
    };
    state.pendingTail = undefined;
    emitRunEvent(row.session_id, row.client_request_id ?? undefined, chunk);
  };

  if (elapsed >= OUTPUT_EMIT_THROTTLE_MS) {
    if (state.trailingTimer) {
      clearTimeout(state.trailingTimer);
      state.trailingTimer = null;
    }
    flushEmit();
    return;
  }
  if (state.trailingTimer) return; // already scheduled
  state.trailingTimer = setTimeout(() => {
    state.trailingTimer = null;
    flushEmit();
  }, OUTPUT_EMIT_THROTTLE_MS - elapsed);
}

export interface MarkTerminalExitedInput {
  terminalId: string;
  status: SessionTerminalStatus;
  exitCode?: number;
  outputPath?: string;
  finalSnapshot?: string;
}

/**
 * Finalize a terminal. After this call the in-memory state is cleared
 * (no more terminal_output emissions) and the row in `session_terminals`
 * reflects the final status / exit code / output path.
 */
export function markTerminalExited(input: MarkTerminalExitedInput): void {
  const state = liveTerminals.get(input.terminalId);
  const now = Date.now();
  let finalTail: string | undefined;
  let finalBytes: number | undefined;
  if (input.finalSnapshot !== undefined) {
    finalBytes = Buffer.byteLength(input.finalSnapshot, 'utf-8');
    finalTail = tailUtf8(input.finalSnapshot, TERMINAL_OUTPUT_TAIL_BYTES);
  }

  sqliteRun(
    `UPDATE session_terminals
       SET status = ?, exit_code = ?, ended_at_ms = ?, last_activity_ms = ?,
           output_path = COALESCE(?, output_path),
           output_tail = COALESCE(?, output_tail),
           output_bytes_total = CASE
             WHEN ? IS NULL THEN output_bytes_total
             ELSE MAX(output_bytes_total, ?)
           END
     WHERE terminal_id = ?`,
    [
      input.status,
      input.exitCode ?? null,
      now,
      now,
      input.outputPath ?? null,
      finalTail ?? null,
      finalBytes ?? null,
      finalBytes ?? null,
      input.terminalId,
    ],
  );

  if (state) {
    state.closed = true;
    if (state.trailingTimer) {
      clearTimeout(state.trailingTimer);
      state.trailingTimer = null;
    }
    state.pendingTail = undefined;
    // Keep the entry in liveTerminals for one tick so a late
    // appendTerminalOutput from spawnAndCollect drains as a no-op.
    setImmediate(() => liveTerminals.delete(input.terminalId));
  }

  const row = sqliteGet<{ session_id: string; client_request_id: string | null }>(
    'SELECT session_id, client_request_id FROM session_terminals WHERE terminal_id = ?',
    [input.terminalId],
  );
  if (!row) return;

  const chunk: StreamTerminalExitedChunk = {
    type: 'terminal_exited',
    terminalId: input.terminalId,
    status: input.status,
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    endedAtMs: now,
    occurredAt: now,
  };
  emitRunEvent(row.session_id, row.client_request_id ?? undefined, chunk);
}

export interface ListSessionTerminalsInput {
  sessionId: string;
  userId: string;
  /** When false, only returns rows whose status === 'running'. Defaults to true. */
  includeClosed?: boolean;
  limit?: number;
}

export function listSessionTerminals(input: ListSessionTerminalsInput): SessionTerminalRecord[] {
  const includeClosed = input.includeClosed !== false;
  const limit = Math.max(1, Math.min(200, input.limit ?? 50));
  const baseQuery = `SELECT * FROM session_terminals
                     WHERE session_id = ? AND user_id = ?`;
  // "Active" terminals include `running` (foreground/background bash
  // still streaming output) and `tmux-spawned` (live tmux sessions we
  // don't own a pid for but which exist outside our process).
  const finalQuery = includeClosed
    ? `${baseQuery} ORDER BY started_at_ms DESC LIMIT ?`
    : `${baseQuery} AND status IN ('running','tmux-spawned') ORDER BY started_at_ms DESC LIMIT ?`;
  const rows = sqliteAll<SessionTerminalRow>(finalQuery, [input.sessionId, input.userId, limit]);
  return rows.map(rowToRecord);
}

export function listSessionTerminalSummaries(
  input: ListSessionTerminalsInput,
): SessionTerminalSummary[] {
  return listSessionTerminals(input).map(toSummary);
}

export function getTerminal(terminalId: string, userId: string): SessionTerminalRecord | null {
  const row = sqliteGet<SessionTerminalRow>(
    'SELECT * FROM session_terminals WHERE terminal_id = ? AND user_id = ?',
    [terminalId, userId],
  );
  return row ? rowToRecord(row) : null;
}

export interface KillTerminalResult {
  found: boolean;
  alreadyClosed: boolean;
  killed: boolean;
}

/**
 * Attempt to kill a terminal. The actual exit event is emitted by the
 * spawn pipeline (bash-tools) when the child process really terminates;
 * this function only triggers the abort path and best-effort kills the
 * process group.
 */
export function killTerminal(input: { terminalId: string; userId: string }): KillTerminalResult {
  const record = getTerminal(input.terminalId, input.userId);
  if (!record) return { found: false, alreadyClosed: false, killed: false };
  if (isTerminalClosed(record.status)) {
    return { found: true, alreadyClosed: true, killed: false };
  }
  const state = liveTerminals.get(input.terminalId);
  let triggered = false;
  if (state?.abortController && !state.abortController.signal.aborted) {
    try {
      state.abortController.abort();
      triggered = true;
    } catch {
      /* ignore */
    }
  }
  const pid = state?.pid ?? record.pid;
  if (pid && pid > 0) {
    try {
      if (process.platform === 'win32') {
        // Best-effort: spawn taskkill — but we're not importing child_process
        // here on purpose. Caller paths in bash-tools already register a kill
        // controller, so this fallback only matters for restart edge cases.
        process.kill(pid);
      } else {
        process.kill(-pid, 'SIGTERM');
        setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            /* process already gone */
          }
        }, 3_000);
      }
      triggered = true;
    } catch {
      /* process already gone */
    }
  }
  // For tmux pseudo-terminals there is no process we own — we simply
  // flip the status to tmux-killed so the UI reflects the action; the
  // matching tmux kill-session command is dispatched by the caller.
  if (record.kind === 'tmux' && !triggered) {
    markTerminalExited({ terminalId: input.terminalId, status: 'tmux-killed' });
    return { found: true, alreadyClosed: false, killed: true };
  }
  // If no abort/kill path fired but the row is still "running", flip it
  // to `killed` so the UI doesn't show a permanently-stuck row.
  if (!triggered) {
    markTerminalExited({ terminalId: input.terminalId, status: 'killed' });
    return { found: true, alreadyClosed: false, killed: true };
  }
  return { found: true, alreadyClosed: false, killed: true };
}

/**
 * Boot-time cleanup. Rows still flagged `running` after a gateway
 * restart point at processes that died with the previous instance; we
 * mark them `stale` so the UI doesn't show ghost terminals.
 *
 * Returns the number of rows updated.
 */
export function reconcileStaleRunningTerminalsAtBoot(): number {
  const now = Date.now();
  const rows = sqliteAll<{ terminal_id: string }>(
    `SELECT terminal_id FROM session_terminals WHERE status = 'running'`,
  );
  for (const row of rows) {
    sqliteRun(
      `UPDATE session_terminals
         SET status = 'stale',
             ended_at_ms = COALESCE(ended_at_ms, ?),
             last_activity_ms = ?
       WHERE terminal_id = ?`,
      [now, now, row.terminal_id],
    );
  }
  return rows.length;
}

export function deleteTerminalRecord(input: { terminalId: string; userId: string }): {
  found: boolean;
  deleted: boolean;
  refusedRunning: boolean;
} {
  const record = getTerminal(input.terminalId, input.userId);
  if (!record) return { found: false, deleted: false, refusedRunning: false };
  // Refuse to delete rows that still represent something live. For bash
  // that's `running`; for interactive_bash pseudo-terminals it's
  // `tmux-spawned` (the underlying tmux session is still out there).
  if (record.status === 'running' || record.status === 'tmux-spawned') {
    return { found: true, deleted: false, refusedRunning: true };
  }
  sqliteRun('DELETE FROM session_terminals WHERE terminal_id = ? AND user_id = ?', [
    input.terminalId,
    input.userId,
  ]);
  return { found: true, deleted: true, refusedRunning: false };
}

/**
 * Rename a terminal — sets the user-defined display name. Pass `null`
 * or empty string to clear the custom name and revert to auto-naming.
 */
export function renameTerminal(input: {
  terminalId: string;
  userId: string;
  name: string | null;
}): { found: boolean; renamed: boolean } {
  const record = getTerminal(input.terminalId, input.userId);
  if (!record) return { found: false, renamed: false };
  const sanitized =
    input.name && input.name.trim().length > 0 ? input.name.trim().slice(0, 64) : null;
  sqliteRun('UPDATE session_terminals SET name = ? WHERE terminal_id = ? AND user_id = ?', [
    sanitized,
    input.terminalId,
    input.userId,
  ]);
  return { found: true, renamed: true };
}

/** Test hook — clears the in-memory map and DB rows. */
export function __resetSessionTerminalsForTest(): void {
  for (const state of liveTerminals.values()) {
    if (state.trailingTimer) clearTimeout(state.trailingTimer);
  }
  liveTerminals.clear();
  try {
    sqliteRun('DELETE FROM session_terminals');
  } catch {
    /* DB not initialized — ignore for unit tests that mock sqlite. */
  }
}

/** Test hook — exposes the in-memory map size. */
export function __liveTerminalCountForTest(): number {
  return liveTerminals.size;
}
