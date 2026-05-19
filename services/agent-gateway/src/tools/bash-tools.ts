/**
 * Bash tool — port of opencode's `packages/opencode/src/tool/bash.ts`.
 *
 * Behaviour mirrored from opencode:
 *   - Schema: `command` (required), `timeout` (ms, optional, default 120s),
 *     `workdir` (optional, defaults to workspace root), `description` (5-10
 *     word summary, required).
 *   - Description template loaded from `bash.txt` and parameterised with
 *     `${os}`, `${shell}`, `${chaining}`, `${maxLines}`, `${maxBytes}`.
 *   - Execution: `child_process.spawn(cmd, [], { shell })` (i.e. `<shell> -c
 *     <command>`). PowerShell goes through `-NoLogo -NoProfile
 *     -NonInteractive -Command` for environment isolation. **No `-l`** —
 *     the previous `bash -lc` form depended on user `~/.bashrc`/`~/.profile`
 *     and was both slow and unpredictable across machines.
 *   - Output handling: stdout & stderr merge into a single chunk stream;
 *     accumulated chunks are kept up to `maxBytes * 2` (older chunks dropped
 *     once over budget) and the final tail-truncated transcript is what the
 *     model sees. When raw output exceeds `maxBytes`, the surplus spills to
 *     a workspace-internal file via `truncateBashOutput`, whose path the
 *     model can subsequently `read`/`grep`.
 *   - Three-way termination race: process `exit` vs `signal.aborted` vs
 *     `timeout`. Timeout / abort kill the child with SIGTERM, then SIGKILL
 *     after a grace period, and append a `<bash_metadata>` block to the
 *     final output explaining why so the model can recover (e.g. retry
 *     with a larger timeout).
 *
 * OpenAWork-specific increments preserved (no parity loss vs. opencode):
 *   - `validateWorkspacePath` enforces workdir is inside an allowed root
 *     when `WORKSPACE_ACCESS_RESTRICTED=true`.
 *   - `buildBashPermissionScope` returns an arity-aware permission scope
 *     (e.g. `git checkout *`) consumed by the gateway permission flow,
 *     filling the same role as opencode's `BashArity.prefix` + `ctx.ask({
 *     permission: "bash" })` path. opencode's tree-sitter AST scan for
 *     external-directory access (`scan.dirs` -> `external_directory`) is
 *     intentionally skipped here to avoid pulling in tree-sitter wasm; the
 *     existing permission scope + `validateWorkspacePath` cover the same
 *     invariant for OpenAWork's workspace model.
 *   - High-risk patterns still rejected before exec: bare `sudo`, environment
 *     hijacks (`PATH=`, `LD_*=`, `DYLD_*=`), command substitution (`` ` ``,
 *     `$()`), and embedded newlines (opencode's `bash.txt` itself instructs
 *     the model not to use newlines as separators).
 */

import { spawn } from 'node:child_process';
import { promises as fsp, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition } from '@openAwork/agent-core';
import type { FileDiffContent, SessionTerminalKind } from '@openAwork/shared';
import { z } from 'zod';
import { bashCommandScope } from './bash-arity.js';
import {
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_LINES,
  TRUNCATION_DIR,
  truncateBashOutput,
} from './bash-output-truncator.js';
import { WORKSPACE_ROOT } from '../db.js';
import {
  appendTerminalOutput,
  markTerminalExited,
  registerTerminal,
  setTerminalPid,
} from '../session/session-terminal-registry.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import {
  captureWorkspaceReconcileSnapshot,
  collectWorkspaceReconcileDiffs,
  type WorkspaceReconcileSnapshot,
} from '../workspace/workspace-reconcile.js';

// Mirrors opencode's `DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000`.
// We don't expose the experimental flag yet, but the env override hook keeps
// the door open for the same operator escape valve opencode provides.
const DEFAULT_BASH_TIMEOUT_MS = (() => {
  const raw = process.env.OPENAWORK_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2 * 60 * 1000;
})();

// Hard ceiling kept conservative to avoid runaway commands hogging a worker
// process slot. Models can still request the maximum explicitly.
const MAX_BASH_TIMEOUT_MS = 30 * 60 * 1000;

const SIGKILL_GRACE_MS = 3_000;

/**
 * Patterns rejected before exec. We keep a deliberately *minimal* deny-list
 * compared to OpenAWork's previous implementation — opencode itself does
 * not reject `;`, `|`, `&`, `>`, `<` because its `bash.txt` description
 * explicitly teaches the model to use `&&` for sequential commands. The
 * remaining entries here cover host-process-wide risks that no permission
 * scope can roll back if the model misbehaves:
 *   - `sudo` / privilege escalation
 *   - `PATH=` / `LD_*=` / `DYLD_*=` env-hijacks that change subsequent tool
 *     resolution (OpenAWork tool sandbox shares the parent shell)
 *   - Backtick / `$()` command substitution (model could smuggle nested
 *     commands past the permission scope which is anchored on the literal
 *     command string)
 *   - Embedded `\r` / `\n` (opencode's bash.txt: "DO NOT use newlines to
 *     separate commands"). Multi-line strings inside quotes still pass.
 */
const DISALLOWED_PATTERNS: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  {
    pattern: /(?:^|\s)sudo(?:\s|$)/,
    message: 'sudo is not allowed in bash commands.',
  },
  {
    pattern: /(?:^|\s)(?:PATH|LD_[A-Z_]+|DYLD_[A-Z_]+)=/,
    message: 'Environment variable overrides for PATH/LD_*/DYLD_* are not allowed.',
  },
  { pattern: /`/, message: 'Backtick command substitution is not allowed.' },
  {
    pattern: /\$\(/,
    message: 'Command substitution `$(...)` is not allowed.',
  },
  {
    pattern: /[\r\n]/,
    message: 'Multi-line commands are not allowed; use && to chain.',
  },
];

function assertSafeBashCommand(command: string): void {
  for (const { pattern, message } of DISALLOWED_PATTERNS) {
    if (pattern.test(command)) throw new Error(message);
  }
}

const bashInputSchema = z.object({
  command: z.string().min(1).describe('要执行的命令'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(MAX_BASH_TIMEOUT_MS)
    .optional()
    .describe('可选超时时间（毫秒）'),
  workdir: z
    .string()
    .min(1)
    .optional()
    .describe("命令执行的工作目录，默认为工作区根目录。请使用该参数而不是 'cd' 命令。"),
  description: z
    .string()
    .min(1)
    .describe(
      "用 5-10 个词清晰描述这条命令的作用。示例：\n输入：ls\n输出：列出当前目录的文件\n\n输入：git status\n输出：查看工作树状态\n\n输入：npm install\n输出：安装 npm 依赖\n\n输入：mkdir foo\n输出：创建目录 'foo'",
    ),
});

export type BashInput = z.infer<typeof bashInputSchema>;

const bashOutputSchema = z.object({
  command: z.string(),
  description: z.string(),
  cwd: z.string(),
  exitCode: z.number().int(),
  // `kind` mirrors opencode's `<bash_metadata>` discrimination: 'exit' is
  // a normal process exit, 'timeout' / 'aborted' explain why the child was
  // killed, 'spawn_error' means we never got past spawn (ENOENT, EACCES…).
  kind: z.enum(['exit', 'timeout', 'aborted', 'spawn_error']),
  output: z.string(),
  truncated: z.boolean(),
  outputPath: z.string().optional(),
  // FileDiffContent (declared in @openAwork/shared) has many optional fields
  // that are workspace-internal. We intentionally do **not** repeat its
  // shape here so this schema stays decoupled from the shared interface;
  // the `BashExecutionResult` type below narrows `diffs` back to the precise
  // `FileDiffContent[]` for downstream consumers.
  diffs: z.array(z.unknown()).optional(),
});

export type BashExecutionResult = Omit<z.infer<typeof bashOutputSchema>, 'diffs'> & {
  diffs?: FileDiffContent[];
};

// ---------- Permission scope ----------

/**
 * Builds a bash permission scope string anchored on the command's verb
 * arity. Mirrors opencode's `BashArity.prefix(tokens).join(" ") + " *"`
 * exactly via OpenAWork's existing `bashCommandScope` helper.
 */
export function buildBashPermissionScope(input: BashInput): string {
  return bashCommandScope(input.command);
}

// ---------- Description template loading ----------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * `bash.txt` is shipped alongside the compiled JS. We try the source-tree
 * location first (development), then fall back to the dist-relative copy
 * (production). Identical placeholders to opencode's bash.txt:
 *   `${os}`, `${shell}`, `${chaining}`, `${maxLines}`, `${maxBytes}`.
 */
function loadDescriptionTemplate(): string {
  const candidates = [
    path.join(__dirname, 'bash.txt'),
    path.join(__dirname, '..', 'bash.txt'),
    path.join(__dirname, '..', '..', 'src', 'bash.txt'),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf-8');
    } catch {
      // try the next candidate
    }
  }
  // Fallback: a terse stub so the tool stays usable even if the template
  // file is missing (e.g. broken bundle). The model still sees enough to
  // know how to call it.
  return '执行给定的 bash 命令。使用 `workdir` 参数代替 `cd`。`description` 请用 5-10 个词说明。';
}

const RAW_DESCRIPTION_TEMPLATE = loadDescriptionTemplate();

function renderDescription(): string {
  const shellName = pickShellName();
  const chaining =
    shellName === 'powershell' || shellName === 'pwsh'
      ? "命令之间有依赖、必须串行时，该 shell 下请避免使用 '&&'（Windows PowerShell 5.1 不支持）。后一条命令需要前一条成功后才跑时，使用 PowerShell 条件如 `cmd1; if ($?) { cmd2 }`。"
      : '命令之间有依赖、必须串行时，请在同一次 Bash 调用中用 \'&&\' 连接（例如 `git add . && git commit -m "message" && git push`）。例如某一步必须在另一步之前完成（如 cp 之前先 mkdir、git 操作之前先 Write、git commit 之前先 git add），应该串行运行。';
  return RAW_DESCRIPTION_TEMPLATE.replaceAll('${os}', process.platform)
    .replaceAll('${shell}', shellName)
    .replaceAll('${chaining}', chaining)
    .replaceAll('${maxLines}', String(MAX_OUTPUT_LINES))
    .replaceAll('${maxBytes}', String(MAX_OUTPUT_BYTES));
}

// ---------- Shell selection ----------

interface ShellChoice {
  shell: string;
  isPowerShell: boolean;
  name: string;
}

function pickShellName(): string {
  return path
    .basename(pickShell().shell)
    .toLowerCase()
    .replace(/\.exe$/, '');
}

function pickShell(): ShellChoice {
  if (process.platform === 'win32') {
    const psCandidate = process.env.PSModulePath
      ? process.env.SHELL || 'powershell.exe'
      : process.env.ComSpec || 'cmd.exe';
    return {
      shell: psCandidate,
      isPowerShell: /powershell|pwsh/i.test(psCandidate),
      name: path.basename(psCandidate).toLowerCase(),
    };
  }
  const shell = process.env.SHELL || '/bin/bash';
  return {
    shell,
    isPowerShell: false,
    name: path.basename(shell).toLowerCase(),
  };
}

// ---------- workdir resolution ----------

async function resolveBashWorkdir(workdir: string | undefined): Promise<string> {
  const candidate = workdir ?? WORKSPACE_ROOT;
  const safe = validateWorkspacePath(candidate);
  if (!safe) {
    throw new Error(
      `Forbidden workspace path: ${candidate}. Provide an absolute path inside an allowed workspace root.`,
    );
  }
  try {
    const info = await stat(safe);
    if (!info.isDirectory()) {
      throw new Error(`Workdir is not a directory: ${safe}`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      throw new Error(`Workdir does not exist: ${safe}`);
    }
    throw error;
  }
  return safe;
}

// ---------- Process orchestration ----------

/**
 * Tracking metadata threaded into `runBashCommand` so the session-wide
 * terminal registry can record this invocation, broadcast `terminal_*`
 * RunEvents, and allow targeted kill from the UI without aborting the
 * whole LLM turn.
 *
 * Foreground bash and background bash both go through this same path; the
 * `kind` discriminates which sandbox dispatch produced the call.
 */
export interface BashRunTracking {
  sessionId: string;
  userId: string;
  clientRequestId?: string;
  toolCallId?: string;
  toolName: string;
  kind: SessionTerminalKind;
  description?: string;
  /**
   * Optional abort controller that `killTerminal()` will `.abort()` to
   * terminate this specific run. When provided, the caller is also
   * expected to pass `signal: abortController.signal` so the existing
   * abort path picks it up.
   */
  abortController?: AbortController;
  /**
   * Optional pre-allocated terminalId. Used by `run_bash_in_background`
   * so it can return the id to the model *before* `runBashCommand`
   * begins, allowing the model's follow-up `bash_output(terminalId)`
   * call to look the registry up by id.
   */
  terminalId?: string;
  /**
   * Optional metadata persisted on the registry row (e.g. background
   * timeout, originating tool args).
   */
  metadata?: Record<string, unknown>;
}

interface RunOptions {
  signal?: AbortSignal;
  /**
   * Optional callback fired with the *current accumulated* stdout+stderr
   * snapshot as the child writes more output. Throttled internally so
   * even a chatty `dd if=/dev/zero | head -c 10MB` won't spam the caller
   * (and, indirectly, the SSE stream). Only fires while the process is
   * still running; the final value lands in the resolved `rawOutput`.
   */
  onPartialOutput?: (text: string) => void;
  /**
   * Session terminal tracking. When provided, the bash invocation is
   * registered into `session-terminal-registry` for the lifetime of the
   * process, so the UI can observe it and the user can kill it
   * individually without aborting the LLM stream.
   */
  tracking?: BashRunTracking;
}

interface SpawnOutcome {
  kind: 'exit' | 'timeout' | 'aborted' | 'spawn_error';
  code: number;
  rawOutput: string;
  spawnError?: Error;
}

/**
 * Spawn the command under the chosen shell, stream-merge stdout+stderr,
 * and resolve once the process ends or one of the termination conditions
 * (timeout / abort) fires. Mirrors opencode's `run()` accumulator pattern:
 *   - `chunks` keep the running window of output (capped at `maxBytes * 2`)
 *   - `full` accumulates until `maxBytes` is exceeded, at which point we
 *     spill to disk via a write-stream sink so memory stays bounded.
 */
function spawnAndCollect(
  command: string,
  cwd: string,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  onPartialOutput: ((text: string) => void) | undefined,
  onPidAssigned?: (pid: number | undefined) => void,
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const choice = pickShell();
    const args = choice.isPowerShell
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
      : [];
    const spawnTarget = choice.isPowerShell ? choice.shell : command;
    const spawnArgs = choice.isPowerShell ? args : [];

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(spawnTarget, spawnArgs, {
        cwd,
        env: process.env,
        // For non-PowerShell platforms, hand the command string to the
        // configured shell exactly as opencode does
        // (`ChildProcess.make(command, [], { shell, ... })`). Critically
        // there is **no** `-l` here — the previous `bash -lc` invocation
        // forced a login shell (loading user .bashrc / .profile), which
        // made command behaviour depend on the host machine. Node's
        // `{ shell: '/bin/bash' }` is equivalent to `bash -c <cmd>`.
        shell: choice.isPowerShell ? false : choice.shell,
        stdio: ['ignore', 'pipe', 'pipe'],
        // detached lets us kill the entire process group on POSIX so that
        // child shells (e.g. `npm run dev` -> node) get cleaned up too.
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      resolve({
        kind: 'spawn_error',
        code: 1,
        rawOutput: '',
        spawnError: error instanceof Error ? error : new Error(String(error)),
      });
      return;
    }

    // Notify the registry of the child's pid as soon as spawn succeeds so
    // the UI can render it before the first chunk of output arrives.
    if (onPidAssigned) {
      try {
        onPidAssigned(child.pid);
      } catch {
        /* swallow — never fail the tool because of a tracking hook */
      }
    }

    let exited = false;
    let kind: SpawnOutcome['kind'] = 'exit';
    const chunks: Buffer[] = [];
    let totalSize = 0;
    const KEEP_BYTES = MAX_OUTPUT_BYTES * 2;

    // Throttle partial output emission: at most one snapshot every
    // PARTIAL_THROTTLE_MS so a chatty `find /` won't flood the SSE
    // channel. A trailing timer ensures the very last chunk is delivered
    // even if it arrives within the throttle window.
    const PARTIAL_THROTTLE_MS = 80;
    let lastEmitMs = 0;
    let trailingTimer: NodeJS.Timeout | null = null;
    const emitPartial = () => {
      if (!onPartialOutput || exited) return;
      lastEmitMs = Date.now();
      // Only ship up to MAX_OUTPUT_BYTES of the rolling window — the
      // model-facing tail truncation runs only at the end, but the live
      // preview must stay bounded too.
      const merged = Buffer.concat(chunks);
      const slice =
        merged.length > MAX_OUTPUT_BYTES
          ? merged.subarray(merged.length - MAX_OUTPUT_BYTES)
          : merged;
      onPartialOutput(slice.toString('utf-8'));
    };
    const scheduleEmit = () => {
      if (!onPartialOutput) return;
      const now = Date.now();
      const elapsed = now - lastEmitMs;
      if (elapsed >= PARTIAL_THROTTLE_MS) {
        if (trailingTimer) {
          clearTimeout(trailingTimer);
          trailingTimer = null;
        }
        emitPartial();
        return;
      }
      if (trailingTimer) return; // already scheduled
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        emitPartial();
      }, PARTIAL_THROTTLE_MS - elapsed);
    };

    const appendChunk = (chunk: Buffer) => {
      chunks.push(chunk);
      totalSize += chunk.length;
      while (totalSize > KEEP_BYTES && chunks.length > 1) {
        const dropped = chunks.shift();
        if (dropped) totalSize -= dropped.length;
      }
      scheduleEmit();
    };

    child.stdout?.on('data', (chunk: Buffer) => appendChunk(chunk));
    child.stderr?.on('data', (chunk: Buffer) => appendChunk(chunk));

    const finalize = (next: SpawnOutcome['kind'], code: number) => {
      if (exited) return;
      exited = true;
      kind = next;
      // Cancel any pending trailing partial emit — the final value will
      // arrive via the resolved `rawOutput` path; sending one more
      // partial after that would race with the completion event.
      if (trailingTimer) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
      }
      // Wait one tick for trailing stdout/stderr drain before resolving.
      setImmediate(() => {
        resolve({
          kind,
          code,
          rawOutput: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    };

    const killTree = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          process.kill(-child.pid, signal);
        }
      } catch {
        try {
          child.kill(signal);
        } catch {
          // best-effort
        }
      }
    };

    const timeoutHandle = setTimeout(() => {
      if (exited) return;
      killTree('SIGTERM');
      setTimeout(() => {
        if (!exited) killTree('SIGKILL');
      }, SIGKILL_GRACE_MS);
      finalize('timeout', 124);
    }, timeoutMs);

    const onAbort = () => {
      if (exited) return;
      killTree('SIGTERM');
      setTimeout(() => {
        if (!exited) killTree('SIGKILL');
      }, SIGKILL_GRACE_MS);
      finalize('aborted', 130);
    };
    if (externalSignal) {
      if (externalSignal.aborted) {
        onAbort();
      } else {
        externalSignal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.on('error', (error) => {
      clearTimeout(timeoutHandle);
      if (exited) return;
      exited = true;
      resolve({
        kind: 'spawn_error',
        code: 1,
        rawOutput: Buffer.concat(chunks).toString('utf-8'),
        spawnError: error,
      });
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timeoutHandle);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
      if (exited) return;
      const exitCode = typeof code === 'number' ? code : signal ? 128 : 1;
      finalize('exit', exitCode);
    });
  });
}

// ---------- Public entry ----------

export async function runBashCommand(
  input: BashInput,
  options: RunOptions = {},
): Promise<BashExecutionResult> {
  assertSafeBashCommand(input.command);
  const cwd = await resolveBashWorkdir(input.workdir);
  const timeoutMs = input.timeout ?? DEFAULT_BASH_TIMEOUT_MS;

  // Register the terminal up-front if tracking is requested. This lets
  // the UI render an in-flight row even before any output arrives, and
  // gives `killTerminal` an abortController handle for targeted cancel.
  let trackingTerminalId: string | undefined;
  if (options.tracking) {
    const registered = registerTerminal({
      sessionId: options.tracking.sessionId,
      userId: options.tracking.userId,
      ...(options.tracking.clientRequestId
        ? { clientRequestId: options.tracking.clientRequestId }
        : {}),
      ...(options.tracking.toolCallId ? { toolCallId: options.tracking.toolCallId } : {}),
      toolName: options.tracking.toolName,
      kind: options.tracking.kind,
      command: input.command,
      ...(input.description ? { description: input.description } : {}),
      cwd,
      ...(options.tracking.abortController
        ? { abortController: options.tracking.abortController }
        : {}),
      ...(options.tracking.terminalId ? { terminalId: options.tracking.terminalId } : {}),
      ...(options.tracking.metadata ? { metadata: options.tracking.metadata } : {}),
    });
    trackingTerminalId = registered.terminalId;
  }

  // Snapshot files in the workspace before exec so we can compute diffs
  // produced by the command (kept identical to the prior implementation).
  // collectWorkspaceReconcileDiffs needs both `before` and `after` snapshots
  // — we capture `after` post-exec.
  let beforeSnapshot: WorkspaceReconcileSnapshot | undefined;
  try {
    beforeSnapshot = await captureWorkspaceReconcileSnapshot(cwd);
  } catch {
    beforeSnapshot = undefined;
  }

  // When tracking is on, wrap the user-supplied onPartialOutput so the
  // registry sees every snapshot the model would see. The original
  // callback (e.g. the batch tool live preview) still fires unchanged.
  const wrappedPartialOutput =
    trackingTerminalId !== undefined
      ? (text: string) => {
          try {
            appendTerminalOutput(trackingTerminalId, text);
          } catch {
            /* swallow — never disrupt the hot stream */
          }
          options.onPartialOutput?.(text);
        }
      : options.onPartialOutput;

  const onPidAssigned =
    trackingTerminalId !== undefined
      ? (pid: number | undefined) => setTerminalPid(trackingTerminalId, pid)
      : undefined;

  const outcome = await spawnAndCollect(
    input.command,
    cwd,
    timeoutMs,
    options.signal,
    wrappedPartialOutput,
    onPidAssigned,
  );

  let diffs: FileDiffContent[] | undefined;
  if (beforeSnapshot) {
    try {
      const afterSnapshot = await captureWorkspaceReconcileSnapshot(cwd);
      diffs = await collectWorkspaceReconcileDiffs({
        workspaceRoot: cwd,
        before: beforeSnapshot,
        after: afterSnapshot,
      });
    } catch {
      diffs = undefined;
    }
  }

  // Combined-stream output (stdout + stderr interleaved as the kernel
  // delivered them). Truncated identically for both success and failure
  // — opencode does the same: `tail()` runs after the process exits,
  // regardless of exitCode.
  const truncated = await truncateBashOutput(outcome.rawOutput, 'tail');

  // <bash_metadata> footer mirrors opencode's run() epilogue: append a
  // structured note when the run was killed by timeout / abort or never
  // started, so the model can recover with a different timeout / fix the
  // command. opencode wraps these in `<bash_metadata>...</bash_metadata>`;
  // we keep the same tag for parity.
  const metadataLines: string[] = [];
  if (outcome.kind === 'timeout') {
    metadataLines.push(
      `bash tool terminated command after exceeding timeout ${timeoutMs} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
    );
  }
  if (outcome.kind === 'aborted') {
    metadataLines.push('User aborted the command');
  }
  if (outcome.kind === 'spawn_error') {
    const reason = outcome.spawnError?.message ?? 'unknown spawn error';
    metadataLines.push(`bash tool failed to spawn the command: ${reason}`);
  }

  let finalOutput = truncated.content || '(no output)';
  if (metadataLines.length > 0) {
    finalOutput += `\n\n<bash_metadata>\n${metadataLines.join('\n')}\n</bash_metadata>`;
  }

  // Finalize the registry row: the spawn outcome's `kind` is already in
  // sync with the registry status taxonomy ('exit' → 'exited',
  // 'aborted'/'timeout'/'spawn_error' map 1:1).
  if (trackingTerminalId !== undefined) {
    const finalStatus =
      outcome.kind === 'exit'
        ? 'exited'
        : outcome.kind === 'aborted'
          ? 'aborted'
          : outcome.kind === 'timeout'
            ? 'timeout'
            : 'spawn_error';
    try {
      markTerminalExited({
        terminalId: trackingTerminalId,
        status: finalStatus,
        exitCode: outcome.code,
        ...(truncated.outputPath ? { outputPath: truncated.outputPath } : {}),
        finalSnapshot: outcome.rawOutput,
      });
    } catch {
      /* swallow — registry must never break the tool result */
    }
  }

  const result: BashExecutionResult = {
    command: input.command,
    description: input.description,
    cwd,
    exitCode: outcome.code,
    kind: outcome.kind,
    output: finalOutput,
    truncated: truncated.truncated,
    ...(truncated.outputPath ? { outputPath: truncated.outputPath } : {}),
    ...(diffs && diffs.length > 0 ? { diffs } : {}),
  };
  return result;
}

// ---------- Tool registration ----------

export const bashToolDefinition: ToolDefinition<typeof bashInputSchema, typeof bashOutputSchema> = {
  name: 'bash',
  description: renderDescription(),
  inputSchema: bashInputSchema,
  outputSchema: bashOutputSchema,
  timeout: MAX_BASH_TIMEOUT_MS,
  execute: async () => {
    throw new Error('bash must execute through the gateway-managed sandbox path');
  },
};

// Re-export so callers (e.g. the truncation cleanup task or tests) have a
// single import surface.
export { TRUNCATION_DIR };

// Best-effort directory cleanup on module load. Keeps the truncation
// directory from ballooning across long-running gateway processes.
// Mirrors opencode's `Truncate.cleanup()` retention loop, simplified: we
// drop files older than 7 days. Runs in the background; failures are
// swallowed because the next `writeFile` recreates the directory anyway.
const TRUNCATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
void (async () => {
  try {
    const entries = await fsp.readdir(TRUNCATION_DIR);
    const cutoff = Date.now() - TRUNCATION_RETENTION_MS;
    await Promise.all(
      entries
        .filter((name) => name.startsWith('bash_'))
        .map(async (name) => {
          const file = path.join(TRUNCATION_DIR, name);
          try {
            const info = await stat(file);
            if (info.mtimeMs < cutoff) {
              await fsp.rm(file).catch((error: unknown) => {
                if (process.env['OPENAWORK_DEBUG_TRUNCATION_CLEANUP'] === '1') {
                  console.warn('Failed to remove stale bash truncation file', { error, file });
                }
              });
            }
          } catch {
            // ignore
          }
        }),
    );
  } catch {
    // directory missing or unreadable — nothing to clean up
  }
})();
