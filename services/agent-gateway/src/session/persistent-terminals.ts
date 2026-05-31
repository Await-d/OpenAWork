/**
 * Persistent terminal manager — runs long-lived `bash -i` (or PowerShell
 * on Windows) child processes that the user can keep typing into after
 * the agent finished its initial command. Sits next to
 * `bash-tools.ts` (one-shot agent commands) and
 * `interactive-bash-tools.ts` (tmux-only) but solves a different need:
 * an editor-style integrated terminal.
 *
 * Lifecycle:
 *   spawn() → status='running' (PTY-less, but stdio piped both ways)
 *           → status flips between 'running' (active stdout) and 'idle'
 *             (no output for >300ms, prompt visible, ready for input)
 *           → close() / process exit / abort → 'exited' | 'killed'
 *
 * NOTE: This is intentionally **not** a real PTY. Programs that need a
 * controlling tty (vim, top, htop, less with paging, anything that
 * checks `isatty(0)`) will degrade or refuse. For the chat-style
 * "let me re-run a quick command" workflow, plain pipes are enough,
 * and they avoid pulling in `node-pty` (a native addon with awkward
 * cross-platform prebuilds).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  appendTerminalOutput,
  markTerminalExited,
  registerTerminal,
  setTerminalPid,
  type SessionTerminalRecord,
} from './session-terminal-registry.js';

interface PersistentEntry {
  terminalId: string;
  sessionId: string;
  userId: string;
  child: ChildProcess;
  cwd: string;
  /** Cumulative stdout+stderr buffer (capped at MAX_BYTES). */
  buffer: Buffer[];
  totalBytes: number;
  /** True after we've emitted the exit event to the registry. */
  closed: boolean;
  /**
   * True when the user explicitly hit "close" / kill — distinguishes
   * a graceful exit (`exited`) from a deliberate teardown (`killed`)
   * even though both end up triggering the same SIGTERM path.
   */
  userInitiatedClose: boolean;
}

const persistentByTerminalId = new Map<string, PersistentEntry>();
const MAX_BYTES = 256 * 1024; // keep last 256KB so a long session doesn't OOM

/**
 * Per-session cap on concurrently-live persistent terminals. Each spawn holds
 * a real child process plus two OS pipes and an in-memory buffer; without a
 * ceiling a buggy frontend retry loop (or a malicious client) hammering
 * `POST /sessions/:id/terminals` could spawn shells without bound and exhaust
 * the host's PIDs / file descriptors. The default is generous for legitimate
 * multi-pane use; tune via `OPENAWORK_MAX_PERSISTENT_TERMINALS_PER_SESSION`
 * (<=0 disables the cap).
 */
const DEFAULT_MAX_PERSISTENT_TERMINALS_PER_SESSION = 20;

/** Raised by {@link spawnPersistentTerminal} when the per-session cap is hit. */
export class PersistentTerminalLimitError extends Error {
  readonly limit: number;
  readonly sessionId: string;
  constructor(sessionId: string, limit: number) {
    super(
      `session ${sessionId} already has the maximum of ${limit} live terminals; ` +
        'close an existing terminal before opening another',
    );
    this.name = 'PersistentTerminalLimitError';
    this.limit = limit;
    this.sessionId = sessionId;
  }
}

function resolveMaxPersistentTerminalsPerSession(): number {
  const raw = process.env['OPENAWORK_MAX_PERSISTENT_TERMINALS_PER_SESSION'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_MAX_PERSISTENT_TERMINALS_PER_SESSION;
  }
  const parsed = Number(raw);
  // Non-positive / NaN means "cap disabled", matching sibling dead-switch envs.
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

/** Count live (not-yet-closed) persistent terminals for a session. */
function countLivePersistentTerminals(sessionId: string): number {
  let count = 0;
  for (const entry of persistentByTerminalId.values()) {
    if (entry.sessionId === sessionId && !entry.closed) count += 1;
  }
  return count;
}

function getShell(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return { shell: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] };
  }
  // Use a non-login interactive shell. We lose .bashrc aliases for
  // login-only setup but that's a fair trade for predictable behaviour.
  return { shell: process.env['SHELL'] || '/bin/bash', args: ['-i'] };
}

function appendToBuffer(entry: PersistentEntry, chunk: Buffer): void {
  entry.buffer.push(chunk);
  entry.totalBytes += chunk.length;
  while (entry.totalBytes > MAX_BYTES && entry.buffer.length > 1) {
    const dropped = entry.buffer.shift();
    if (dropped) entry.totalBytes -= dropped.length;
  }
}

export interface SpawnPersistentTerminalInput {
  sessionId: string;
  userId: string;
  cwd: string;
  /** Optional initial command piped into stdin once the shell is ready. */
  initialCommand?: string;
  /** Marks this row as user-created vs agent-created. */
  source: 'agent' | 'user';
  toolName?: string;
  description?: string;
}

export interface SpawnPersistentTerminalResult {
  terminal: SessionTerminalRecord;
}

export function spawnPersistentTerminal(
  input: SpawnPersistentTerminalInput,
): SpawnPersistentTerminalResult {
  // Enforce the per-session concurrency cap before spawning so a runaway
  // caller can't exhaust host processes / file descriptors. Checked against
  // the live in-memory entries (exited/killed terminals are removed from the
  // map), so closed terminals never count against the budget.
  const maxPerSession = resolveMaxPersistentTerminalsPerSession();
  if (maxPerSession > 0 && countLivePersistentTerminals(input.sessionId) >= maxPerSession) {
    throw new PersistentTerminalLimitError(input.sessionId, maxPerSession);
  }

  const { shell, args } = getShell();
  let child: ChildProcess;
  try {
    child = spawn(shell, args, {
      cwd: input.cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
  } catch (error) {
    // spawn() can throw synchronously for invalid cwd / shell on some
    // Node versions. Re-throw with a readable message so the route can
    // surface it to the user instead of crashing the request handler.
    throw new Error(
      `Failed to spawn shell '${shell}' in '${input.cwd}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const initialCommand = input.initialCommand?.trim() ?? '';
  const labelCommand =
    initialCommand.length > 0
      ? initialCommand
      : input.source === 'user'
        ? '(交互终端)'
        : '(持久终端)';

  const abortController = new AbortController();
  const record = registerTerminal({
    sessionId: input.sessionId,
    userId: input.userId,
    toolName: input.toolName ?? (input.source === 'user' ? 'quick_terminal' : 'bash'),
    kind: 'foreground',
    command: labelCommand,
    ...(input.description ? { description: input.description } : {}),
    cwd: input.cwd,
    initialStatus: 'running',
    abortController,
    metadata: {
      persistent: true,
      source: input.source,
      shell,
    },
  });

  const entry: PersistentEntry = {
    terminalId: record.terminalId,
    sessionId: input.sessionId,
    userId: input.userId,
    child,
    cwd: input.cwd,
    buffer: [],
    totalBytes: 0,
    closed: false,
    userInitiatedClose: false,
  };
  persistentByTerminalId.set(record.terminalId, entry);

  setTerminalPid(record.terminalId, child.pid);

  const emitSnapshot = (): void => {
    if (entry.closed) return;
    const merged = Buffer.concat(entry.buffer);
    const text =
      merged.length > MAX_BYTES
        ? merged.subarray(merged.length - MAX_BYTES).toString('utf-8')
        : merged.toString('utf-8');
    appendTerminalOutput(record.terminalId, text);
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    appendToBuffer(entry, chunk);
    emitSnapshot();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    appendToBuffer(entry, chunk);
    emitSnapshot();
  });

  child.on('error', (error) => {
    if (entry.closed) return;
    entry.closed = true;
    persistentByTerminalId.delete(record.terminalId);
    markTerminalExited({
      terminalId: record.terminalId,
      status: 'spawn_error',
      finalSnapshot: `${Buffer.concat(entry.buffer).toString('utf-8')}\n[spawn error] ${error.message}`,
    });
  });

  child.on('exit', (code, signal) => {
    if (entry.closed) return;
    entry.closed = true;
    persistentByTerminalId.delete(record.terminalId);
    const exitCode = code ?? (signal ? 128 : 0);
    // 'killed' covers both kill API calls (which abort the controller)
    // and user-initiated panel close. 'exited' is the natural shell
    // exit (Ctrl-D, `exit`, parent terminated).
    const wasKilled = abortController.signal.aborted || entry.userInitiatedClose;
    markTerminalExited({
      terminalId: record.terminalId,
      status: wasKilled ? 'killed' : 'exited',
      exitCode,
      finalSnapshot: Buffer.concat(entry.buffer).toString('utf-8'),
    });
  });

  if (initialCommand.length > 0) {
    // Append a newline so the shell actually executes it.
    try {
      child.stdin?.write(`${initialCommand}\n`);
    } catch {
      // ignore — exit handler will fire
    }
  }

  return { terminal: record };
}

export interface WriteStdinResult {
  ok: boolean;
  error?: string;
}

export function writeStdinToTerminal(terminalId: string, data: string): WriteStdinResult {
  const entry = persistentByTerminalId.get(terminalId);
  if (!entry) return { ok: false, error: 'terminal_not_persistent' };
  if (entry.closed) return { ok: false, error: 'terminal_closed' };
  try {
    entry.child.stdin?.write(data);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface ResizeTerminalInput {
  terminalId: string;
  cols: number;
  rows: number;
}

/**
 * No-op for the pipe-based persistent terminals (we have no pty to
 * resize). Kept as a stable API surface so the frontend can call it
 * without worrying which backend path is in use; once we add a real
 * PTY this is the hook point.
 */
export function resizeTerminal(_input: ResizeTerminalInput): { ok: boolean } {
  return { ok: true };
}

export function isPersistentTerminal(terminalId: string): boolean {
  return persistentByTerminalId.has(terminalId);
}

export interface ClosePersistentTerminalResult {
  ok: boolean;
  error?: string;
}

export function closePersistentTerminal(terminalId: string): ClosePersistentTerminalResult {
  const entry = persistentByTerminalId.get(terminalId);
  if (!entry) return { ok: false, error: 'terminal_not_persistent' };
  if (entry.closed) return { ok: true };
  // Mark before sending the kill so the exit handler labels the row
  // 'killed' instead of 'exited'.
  entry.userInitiatedClose = true;
  try {
    entry.child.stdin?.end();
  } catch {
    /* ignore */
  }
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(entry.child.pid), '/f', '/t'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      // taskkill may be missing / unresolved on PATH; its async 'error'
      // event would otherwise crash the process as an unhandled exception.
      killer.on('error', () => {
        /* best-effort kill — nothing more we can do here */
      });
    } else if (entry.child.pid) {
      process.kill(-entry.child.pid, 'SIGTERM');
      setTimeout(() => {
        if (!entry.closed && entry.child.pid) {
          try {
            process.kill(-entry.child.pid, 'SIGKILL');
          } catch {
            /* gone */
          }
        }
      }, 3000);
    }
  } catch {
    /* gone */
  }
  return { ok: true };
}

/** Test hook — kills every persistent process. */
export function __resetPersistentTerminalsForTest(): void {
  for (const entry of persistentByTerminalId.values()) {
    try {
      entry.child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
  persistentByTerminalId.clear();
}
