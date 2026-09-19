/**
 * Persistent terminal manager — runs long-lived `bash -i` (or PowerShell
 * on Windows) child processes that the user can keep typing into after
 * the agent finished its initial command. Sits next to
 * `bash-tools.ts` (one-shot agent commands) and
 * `interactive-bash-tools.ts` (tmux-only) but solves a different need:
 * an editor-style integrated terminal.
 *
 * Lifecycle:
 *   spawn() → status='running'
 *           → status flips between 'running' (active stdout) and 'idle'
 *             (no output for >300ms, prompt visible, ready for input)
 *           → close() / process exit / abort → 'exited' | 'killed'
 *
 * Backend selection is delegated to `pty-backend.ts`: on Bun (non-Windows)
 * we allocate a real PTY so `isatty(0)`, `vim`/`top`/`htop` and resize-aware
 * TUIs work; under Node and on Windows we degrade to piped stdio (input /
 * output still flow, but resize is a no-op). This avoids pulling in
 * `node-pty` (a native addon with awkward cross-platform prebuilds).
 */

import { StringDecoder } from 'node:string_decoder';
import {
  getTerminalOutputSnapshot,
  markTerminalExited,
  registerTerminal,
  setTerminalPid,
  appendTerminalOutputDelta,
  type SessionTerminalRecord,
} from './session-terminal-registry.js';
import {
  spawnTerminalProcess,
  type TerminalProcess,
  type SpawnTerminalProcessInput,
} from './pty-backend.js';
import { resolveShellChoiceForPlatform } from '../tools/shell-choice.js';
import { resolveShellForSpawn } from './shell-profiles.js';

interface PersistentEntry {
  terminalId: string;
  sessionId: string;
  userId: string;
  process: TerminalProcess;
  cwd: string;
  /** Decodes PTY bytes across chunk boundaries so multi-byte runes survive. */
  decoder: StringDecoder;
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

/** Initial PTY geometry; the frontend immediately sends a fit-resize. */
const DEFAULT_TERMINAL_COLS = 80;
const DEFAULT_TERMINAL_ROWS = 24;

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
  const choice = resolveShellChoiceForPlatform(process.platform, process.env);
  if (choice.isPowerShell) {
    return { shell: choice.shell, args: ['-NoLogo', '-NoProfile'] };
  }
  // Use a non-login interactive shell. We lose .bashrc aliases for
  // login-only setup but that's a fair trade for predictable behaviour.
  return { shell: choice.shell, args: ['-i'] };
}

/**
 * Resolve the shell for a spawn. The client only ever supplies an opaque
 * `shellProfileId`; the executable and argv both come from the server-side
 * allowlist (`shell-profiles.ts`). `resolveShellForSpawn` throws a typed
 * `InvalidShellProfileError` for an unknown id, so spawn is never reached.
 */
function resolveSpawnShell(shellProfileId: string | undefined): {
  shell: string;
  args: string[];
  shellProfileId?: string;
} {
  const fallback = getShell();
  return resolveShellForSpawn({
    ...(shellProfileId !== undefined ? { shellProfileId } : {}),
    platform: process.platform,
    env: process.env,
    defaultShell: fallback.shell,
    defaultArgs: fallback.args,
    onFallback: ({ requestedId, missingShell }) => {
      console.warn(
        `[persistent-terminals] shell profile '${requestedId}' resolved to missing executable '${missingShell}'; falling back to the default shell`,
      );
    },
  });
}

function terminalSnapshotText(terminalId: string): string {
  return getTerminalOutputSnapshot(terminalId)?.data ?? '';
}

export interface SpawnPersistentTerminalInput {
  /** 仅由服务端注入；SSH 通道复用持久终端的注册、限额与输入输出生命周期。 */
  processFactory?: (input: SpawnTerminalProcessInput) => TerminalProcess;
  sessionId: string;
  userId: string;
  cwd: string;
  /** Optional initial command piped into stdin once the shell is ready. */
  initialCommand?: string;
  /** Marks this row as user-created vs agent-created. */
  source: 'agent' | 'user';
  toolName?: string;
  description?: string;
  /**
   * Opaque server-allowlisted shell profile id. Absent → today's default
   * shell. Clients must never supply a shell path, argv or env.
   */
  shellProfileId?: string;
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

  const resolvedShell = input.processFactory
    ? { shell: '(remote default)', args: [], shellProfileId: undefined }
    : resolveSpawnShell(input.shellProfileId);
  const { shell, args } = resolvedShell;
  const abortController = new AbortController();
  const decoder = new StringDecoder('utf8');
  let entry: PersistentEntry | undefined;

  const onData = (chunk: Uint8Array): void => {
    if (entry === undefined) return;
    const text = entry.decoder.write(Buffer.from(chunk));
    if (text.length > 0) appendTerminalOutputDelta(entry.terminalId, text);
  };

  const onError = (error: Error): void => {
    if (entry === undefined || entry.closed) return;
    entry.closed = true;
    persistentByTerminalId.delete(entry.terminalId);
    markTerminalExited({
      terminalId: entry.terminalId,
      status: 'spawn_error',
      finalSnapshot: `${terminalSnapshotText(entry.terminalId)}\n[spawn error] ${error.message}`,
    });
  };

  const onExit = (code: number | null, signal: string | null): void => {
    if (entry === undefined || entry.closed) return;
    entry.closed = true;
    persistentByTerminalId.delete(entry.terminalId);
    const exitCode = code ?? (signal ? 128 : 0);
    // 'killed' covers both kill API calls (which abort the controller)
    // and user-initiated panel close. 'exited' is the natural shell
    // exit (Ctrl-D, `exit`, parent terminated).
    const wasKilled = abortController.signal.aborted || entry.userInitiatedClose;
    markTerminalExited({
      terminalId: entry.terminalId,
      status: wasKilled ? 'killed' : 'exited',
      exitCode,
      finalSnapshot: terminalSnapshotText(entry.terminalId),
    });
  };

  let terminalProcess: TerminalProcess;
  try {
    terminalProcess = (input.processFactory ?? spawnTerminalProcess)({
      shell,
      args,
      cwd: input.cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
      onData,
      onExit,
      onError,
    });
  } catch (error) {
    // spawn can throw synchronously for an invalid cwd / shell. Re-throw
    // with a readable message so the route can surface it to the user
    // instead of crashing the request handler.
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
      ...(resolvedShell.shellProfileId ? { shellProfileId: resolvedShell.shellProfileId } : {}),
      backend: terminalProcess.backend,
    },
  });

  entry = {
    terminalId: record.terminalId,
    sessionId: input.sessionId,
    userId: input.userId,
    process: terminalProcess,
    cwd: input.cwd,
    decoder,
    closed: false,
    userInitiatedClose: false,
  };
  persistentByTerminalId.set(record.terminalId, entry);

  abortController.signal.addEventListener(
    'abort',
    () => {
      terminalProcess.kill();
    },
    { once: true },
  );
  setTerminalPid(record.terminalId, terminalProcess.pid);

  if (initialCommand.length > 0) {
    // Append a newline so the shell actually executes it.
    terminalProcess.write(`${initialCommand}\n`);
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
    entry.process.write(data);
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
 * Dispatches a resize to the terminal process. The PTY backend applies it
 * and the shell receives SIGWINCH; the pipe backend is a no-op. Always
 * reports `ok: true` for a known terminal so the frontend fit-addon can
 * call it without branching on the backend.
 */
export function resizeTerminal(input: ResizeTerminalInput): { ok: boolean } {
  const entry = persistentByTerminalId.get(input.terminalId);
  if (entry !== undefined && !entry.closed) {
    entry.process.resize(input.cols, input.rows);
  }
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
  // Mark before tearing down so the exit handler labels the row
  // 'killed' instead of 'exited'.
  entry.userInitiatedClose = true;
  entry.process.close();
  entry.process.kill();
  return { ok: true };
}

/** Test hook — kills every persistent process. */
export function __resetPersistentTerminalsForTest(): void {
  for (const entry of persistentByTerminalId.values()) {
    try {
      entry.process.kill();
    } catch {
      /* ignore */
    }
  }
  persistentByTerminalId.clear();
}
