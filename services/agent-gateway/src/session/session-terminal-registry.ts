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

/**
 * Max bytes retained in the per-terminal replay ring buffer. Reconnect
 * snapshots replay this whole buffer; the default of 512 KiB bounds memory
 * for long-lived terminals. Override via OPENAWORK_TERMINAL_RING_BUFFER_BYTES.
 */
export const TERMINAL_OUTPUT_RING_BYTES: number = resolveTerminalOutputRingBytes();

function resolveTerminalOutputRingBytes(): number {
  const DEFAULT_RING_BYTES = 512 * 1024;
  const raw = process.env['OPENAWORK_TERMINAL_RING_BUFFER_BYTES'];
  if (raw === undefined || raw === null || raw.trim() === '') return DEFAULT_RING_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RING_BYTES;
  return Math.floor(parsed);
}

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

interface ByteChunkBuffer {
  chunks: Buffer[];
  bytes: number;
}

interface LiveTerminalState {
  abortController?: AbortController;
  sessionId: string;
  clientRequestId?: string;
  /** Tail emitter throttle bookkeeping. */
  lastEmitMs: number;
  /** Last byte count emitted, so we can skip no-op emits. */
  lastEmittedBytes: number;
  /** Incremental text accumulated since the last broadcast (merged, ordered). */
  pendingDelta: string;
  /** Monotonic byte counter for the whole terminal lifetime (the `seq`). */
  totalBytes: number;
  /** Last legacy cumulative snapshot text; drives prefix-based delta extraction. */
  lastCumulativeText: string;
  /** Replay buffer holding the last TERMINAL_OUTPUT_RING_BYTES bytes. */
  ring: ByteChunkBuffer;
  /** Small buffer holding the last TERMINAL_OUTPUT_TAIL_BYTES bytes. */
  tail: ByteChunkBuffer;
  trailingTimer: NodeJS.Timeout | null;
  /** Process pid once known, for fallback kill path. */
  pid?: number;
  /** Already-finalized terminals are pruned from this map. */
  closed: boolean;
}

const liveTerminals = new Map<string, LiveTerminalState>();

/**
 * One synchronously-dispatched output chunk on the low-latency branch.
 * `seq`/`outputBytesTotal` are `state.totalBytes` after this delta was
 * appended — the exact same cursor the throttled `terminal_output` RunEvent
 * carries, so both transports agree on ordering.
 */
export interface TerminalOutputChunk {
  seq: number;
  data: string;
  outputBytesTotal: number;
}

/**
 * Per-terminal in-process listeners that fire SYNCHRONOUSLY on every PTY
 * delta, bypassing the 100ms run-event throttle. This is the low-latency
 * branch used by the per-terminal WebSocket transport; RunEvents continue to
 * feed the drawer on their own schedule. The immediate channel exists ONLY to
 * bypass the throttle — it never replaces run-event emission.
 */
const immediateOutputListeners = new Map<string, Set<(chunk: TerminalOutputChunk) => void>>();

/**
 * Subscribe to a terminal's synchronous output channel. The returned thunk
 * removes the listener (idempotent). Listeners are also cleared when the
 * terminal exits / is deleted, so a subscriber that never unsubscribes still
 * cannot outlive the terminal.
 */
export function subscribeTerminalOutputImmediate(
  terminalId: string,
  listener: (chunk: TerminalOutputChunk) => void,
): () => void {
  const listeners = immediateOutputListeners.get(terminalId) ?? new Set();
  listeners.add(listener);
  immediateOutputListeners.set(terminalId, listeners);
  return () => {
    const current = immediateOutputListeners.get(terminalId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) immediateOutputListeners.delete(terminalId);
  };
}

function notifyImmediateOutput(terminalId: string, chunk: TerminalOutputChunk): void {
  const listeners = immediateOutputListeners.get(terminalId);
  if (!listeners || listeners.size === 0) return;
  // Snapshot before dispatch: a listener may unsubscribe itself mid-dispatch
  // (the WS teardown path), and iterating the live Set would then skip peers.
  for (const listener of [...listeners]) {
    try {
      listener(chunk);
    } catch (error) {
      // A listener failure must never break the PTY hot path.
      console.warn(
        '[session-terminal-registry] immediate output listener failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function clearImmediateOutputListeners(terminalId: string): void {
  immediateOutputListeners.delete(terminalId);
}

function createByteChunkBuffer(): ByteChunkBuffer {
  return { chunks: [], bytes: 0 };
}

/**
 * Keeps the first retained byte on a UTF-8 code-point boundary after the
 * head has been dropped. `0b10xxxxxx` marks continuation bytes.
 */
function snapChunkHeadToUtf8Boundary(target: ByteChunkBuffer): void {
  const head = target.chunks[0];
  if (head === undefined || head.length === 0) return;
  let advance = 0;
  while (advance < head.length && (head[advance]! & 0b1100_0000) === 0b1000_0000) {
    advance += 1;
  }
  if (advance > 0) {
    target.chunks[0] = head.subarray(advance);
    target.bytes -= advance;
  }
}

function appendByteChunk(target: ByteChunkBuffer, chunk: Buffer, maxBytes: number): void {
  if (chunk.length === 0) return;
  target.chunks.push(chunk);
  target.bytes += chunk.length;
  while (target.bytes > maxBytes && target.chunks.length > 0) {
    const over = target.bytes - maxBytes;
    const head = target.chunks[0]!;
    if (head.length <= over) {
      target.chunks.shift();
      target.bytes -= head.length;
      continue;
    }
    let start = over;
    while (start < head.length && (head[start]! & 0b1100_0000) === 0b1000_0000) {
      start += 1;
    }
    target.chunks[0] = head.subarray(start);
    target.bytes -= start;
  }
  snapChunkHeadToUtf8Boundary(target);
}

function byteChunkText(target: ByteChunkBuffer): string {
  if (target.chunks.length === 0) return '';
  const head = target.chunks[0]!;
  if (target.chunks.length === 1) return head.toString('utf-8');
  return Buffer.concat(target.chunks, target.bytes).toString('utf-8');
}

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
    sessionId: input.sessionId,
    ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    lastEmitMs: 0,
    lastEmittedBytes: 0,
    pendingDelta: '',
    totalBytes: 0,
    lastCumulativeText: '',
    ring: createByteChunkBuffer(),
    tail: createByteChunkBuffer(),
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
 * Append a fully-decoded increment to the ring/tail buffers, bump the
 * monotonic byte counter, persist the fresh tail, and schedule a throttled
 * broadcast. Throttled windows merge multiple deltas into one ordered chunk.
 */
function appendDeltaInternal(terminalId: string, state: LiveTerminalState, delta: Buffer): void {
  if (delta.length === 0) return;
  state.totalBytes += delta.length;
  appendByteChunk(state.ring, delta, TERMINAL_OUTPUT_RING_BYTES);
  appendByteChunk(state.tail, delta, TERMINAL_OUTPUT_TAIL_BYTES);
  const deltaText = delta.toString('utf-8');
  state.pendingDelta =
    state.pendingDelta.length === 0 ? deltaText : `${state.pendingDelta}${deltaText}`;

  // Fire the synchronous (unthrottled) branch AFTER `totalBytes` advanced so
  // `seq` matches the run-event cursor exactly. `data` is precisely the text
  // appended to `pendingDelta` for this delta.
  notifyImmediateOutput(terminalId, {
    seq: state.totalBytes,
    data: deltaText,
    outputBytesTotal: state.totalBytes,
  });

  const now = Date.now();
  sqliteRun(
    `UPDATE session_terminals
       SET output_bytes_total = MAX(output_bytes_total, ?),
           output_tail = ?,
           last_activity_ms = ?
     WHERE terminal_id = ?`,
    [state.totalBytes, byteChunkText(state.tail), now, terminalId],
  );

  scheduleEmit(terminalId, state);
}

function flushEmit(terminalId: string, state: LiveTerminalState): void {
  if (state.closed) return;
  if (state.pendingDelta.length === 0 && state.totalBytes === state.lastEmittedBytes) return;
  state.lastEmitMs = Date.now();
  state.lastEmittedBytes = state.totalBytes;
  const chunk: StreamTerminalOutputChunk = {
    type: 'terminal_output',
    terminalId,
    seq: state.totalBytes,
    data: state.pendingDelta,
    outputTail: byteChunkText(state.tail),
    outputBytesTotal: state.totalBytes,
    occurredAt: state.lastEmitMs,
  };
  state.pendingDelta = '';
  emitRunEvent(state.sessionId, state.clientRequestId, chunk);
}

function scheduleEmit(terminalId: string, state: LiveTerminalState): void {
  const elapsed = Date.now() - state.lastEmitMs;
  if (elapsed >= OUTPUT_EMIT_THROTTLE_MS) {
    if (state.trailingTimer) {
      clearTimeout(state.trailingTimer);
      state.trailingTimer = null;
    }
    flushEmit(terminalId, state);
    return;
  }
  if (state.trailingTimer) return; // already scheduled
  state.trailingTimer = setTimeout(() => {
    state.trailingTimer = null;
    flushEmit(terminalId, state);
  }, OUTPUT_EMIT_THROTTLE_MS - elapsed);
}

/**
 * PTY incremental path. `delta` is the text produced by this chunk only;
 * it is appended to the ring buffer, the byte counter (`seq`) advances and
 * a throttled `terminal_output` broadcast is scheduled.
 */
export function appendTerminalOutputDelta(terminalId: string, delta: string): void {
  const state = liveTerminals.get(terminalId);
  if (!state || state.closed) return;
  appendDeltaInternal(terminalId, state, Buffer.from(delta, 'utf-8'));
}

/**
 * Legacy cumulative path (still called by bash-tools). `snapshot` is the
 * cumulative stdout+stderr text since process start; we internally diff it
 * against the previous snapshot by string prefix to obtain the appended text
 * and route it through the incremental path above. If the snapshot does not
 * extend the previous one (new process / reset / divergent prefix) the whole
 * snapshot is re-sent.
 */
export function appendTerminalOutput(terminalId: string, snapshot: string): void {
  const state = liveTerminals.get(terminalId);
  if (!state || state.closed) return;
  const previous = state.lastCumulativeText;
  if (snapshot === previous) return;
  state.lastCumulativeText = snapshot;
  if (!snapshot.startsWith(previous)) {
    appendDeltaInternal(terminalId, state, Buffer.from(snapshot, 'utf-8'));
    return;
  }
  const delta = snapshot.slice(previous.length);
  if (delta.length === 0) return;
  appendDeltaInternal(terminalId, state, Buffer.from(delta, 'utf-8'));
}

/**
 * Reconnect snapshot: the whole retained ring buffer plus the current
 * monotonic `seq`. Returns null when the terminal is no longer live (the
 * route then falls back to the persisted `outputTail`).
 */
export function getTerminalOutputSnapshot(
  terminalId: string,
): { seq: number; data: string; outputBytesTotal: number } | null {
  const state = liveTerminals.get(terminalId);
  if (!state) return null;
  return {
    seq: state.totalBytes,
    data: byteChunkText(state.ring),
    outputBytesTotal: state.totalBytes,
  };
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
  // No output can follow an exit, so drop the low-latency subscribers here
  // rather than waiting for their own teardown to run.
  clearImmediateOutputListeners(input.terminalId);
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
    state.pendingDelta = '';
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

/**
 * 该用户当前「活着且有 pid」的终端 —— 供只读端口枚举做归属匹配。
 *
 * 只取 `running` / `idle`：`markTerminalExited` 不会清掉 pid 列，已结束行的 pid
 * 可能早被系统复用给无关进程，用陈旧 pid 匹配会给出错误归属（指向错误终端）。
 * `tmux-spawned` 没有本网关持有的 pid，天然不会出现在结果里。
 * 与 `ports/listening-ports.ts` 的注入契约结构同形（路由层接线，由 TS 校验）。
 */
export function listOwnedTerminalPids(userId: string): Array<{
  pid: number;
  sessionId: string;
  terminalId: string;
}> {
  const rows = sqliteAll<{ pid: number | null; session_id: string; terminal_id: string }>(
    `SELECT pid, session_id, terminal_id FROM session_terminals
      WHERE user_id = ? AND pid IS NOT NULL AND pid > 0
        AND status IN ('running', 'idle')
      ORDER BY started_at_ms DESC`,
    [userId],
  );
  const result: Array<{ pid: number; sessionId: string; terminalId: string }> = [];
  for (const row of rows) {
    if (row.pid === null || !Number.isInteger(row.pid) || row.pid <= 0) continue;
    result.push({ pid: row.pid, sessionId: row.session_id, terminalId: row.terminal_id });
  }
  return result;
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
  let staleCount = 0;
  for (const row of rows) {
    // Per-row resilience: one row's UPDATE throwing (DB lock / disk error)
    // must not abort the rest of the sweep — that would leave the remaining
    // ghost terminals stuck showing `running` in the UI after a restart. This
    // runs at boot, so isolate per row + warn, and return the ACTUAL number of
    // rows flipped to `stale` rather than the planned row count. (§0.104 class.)
    try {
      sqliteRun(
        `UPDATE session_terminals
           SET status = 'stale',
               ended_at_ms = COALESCE(ended_at_ms, ?),
               last_activity_ms = ?
         WHERE terminal_id = ?`,
        [now, now, row.terminal_id],
      );
      staleCount += 1;
    } catch (error) {
      console.warn(
        `[session-terminals] boot 期标记陈旧终端失败，已跳过：${row.terminal_id}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return staleCount;
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
  // The row is gone, so no further output will be produced — release any
  // low-latency subscribers that outlived the teardown.
  clearImmediateOutputListeners(input.terminalId);
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
  immediateOutputListeners.clear();
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

/**
 * Test hook — number of live immediate-output listeners, either for one
 * terminal or summed across all terminals. Proves the WS route releases its
 * subscription on close.
 */
export function __immediateOutputListenerCountForTest(terminalId?: string): number {
  if (terminalId !== undefined) {
    return immediateOutputListeners.get(terminalId)?.size ?? 0;
  }
  let total = 0;
  for (const listeners of immediateOutputListeners.values()) total += listeners.size;
  return total;
}
