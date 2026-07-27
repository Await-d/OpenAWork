import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { resolveUnboundSessionWorkspaceFallback } from '../workspace/workspace-safety.js';

const execFileAsync = promisify(execFile);

const interactiveBashInputSchema = z.object({
  tmux_command: z.string().min(1),
});

const BLOCKED_TMUX_SUBCOMMANDS = [
  'capture-pane',
  'capturep',
  'save-buffer',
  'saveb',
  'show-buffer',
  'showb',
  'pipe-pane',
  'pipep',
] as const;

/**
 * Tmux lifecycle subcommands we want to mirror into the
 * session_terminals registry. `new-session`/`new` spawn tracked rows
 * (kind='tmux', status='tmux-spawned'); `kill-session`/`kill-server`
 * close them. Anything else is opaque to the registry.
 */
const TMUX_SPAWN_SUBCOMMANDS = new Set(['new-session', 'new']);
const TMUX_KILL_SUBCOMMANDS = new Set(['kill-session', 'kill-server']);

/**
 * Extract a tmux session name from the parts array. Supports the common
 * `-s <name>` (used by new-session) and `-t <name>` (used by kill-session
 * and most lookup commands) flags. Returns null when neither flag is
 * present; in that case we fall back to a stable hash of the command
 * text so re-running the same command idempotently updates the same
 * registry row.
 */
function extractTmuxSessionName(parts: readonly string[]): string | null {
  for (let i = 1; i < parts.length; i += 1) {
    const token = parts[i];
    if (token !== '-s' && token !== '-t') continue;
    const next = parts[i + 1];
    if (next && next.length > 0 && !next.startsWith('-')) {
      return next;
    }
  }
  return null;
}

function buildTmuxTerminalId(sessionName: string): string {
  const hash = createHash('sha1').update(sessionName).digest('hex').slice(0, 12);
  return `term_tmux_${hash}`;
}

export interface InteractiveBashRunContext {
  sessionId: string;
  userId?: string;
  clientRequestId?: string;
  toolCallId?: string;
  workingDirectory?: string;
}

export function tokenizeTmuxCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
      continue;
    }
    if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
      continue;
    }
    if (char === ' ' && !inQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function explainBlockedTmuxCommand(parts: string[]): string {
  return `Error: '${parts[0]}' is blocked in interactive_bash. Use the bash tool for capture/pipe buffer commands instead.`;
}

/**
 * Run a tmux subcommand and (optionally) mirror its lifecycle into the
 * session_terminals registry. Lifecycle is best-effort: only
 * `new-session`/`new` and `kill-session`/`kill-server` are tracked,
 * because they have a clear before/after that maps to row insert and
 * row close. All other subcommands are pass-through.
 *
 * The registry registration happens *after* the tmux command succeeds —
 * we don't want to record a spawn that errored out, and we don't want
 * to flip a session to `tmux-killed` if `kill-session` failed.
 */
export async function runInteractiveBashCommand(
  tmuxCommand: string,
  trackingContext?: InteractiveBashRunContext,
): Promise<string> {
  const parts = tokenizeTmuxCommand(tmuxCommand);
  if (parts.length === 0) {
    return 'Error: Empty tmux command';
  }
  const subcommand = parts[0]?.toLowerCase() ?? '';
  if (BLOCKED_TMUX_SUBCOMMANDS.includes(subcommand as (typeof BLOCKED_TMUX_SUBCOMMANDS)[number])) {
    return explainBlockedTmuxCommand(parts);
  }

  const tmuxPath = process.env['TMUX_PATH']?.trim() || 'tmux';
  let outputText: string;
  let outputIsError = false;
  try {
    const { stdout, stderr } = await execFileAsync(tmuxPath, parts, {
      ...(trackingContext?.workingDirectory ? { cwd: trackingContext.workingDirectory } : {}),
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (stderr.trim().length > 0) {
      outputText = stderr.trim();
      outputIsError = true;
    } else {
      outputText = stdout.trim().length > 0 ? stdout : '(no output)';
    }
  } catch (error) {
    outputText = `Error: ${error instanceof Error ? error.message : String(error)}`;
    outputIsError = true;
  }

  if (trackingContext?.userId && !outputIsError) {
    try {
      if (TMUX_SPAWN_SUBCOMMANDS.has(subcommand)) {
        const sessionName = extractTmuxSessionName(parts) ?? tmuxCommand;
        // Lazy import to keep the module purely functional for tests
        // that mock `session-terminal-registry`.
        const { registerTerminal } = await import('../session/session-terminal-registry.js');
        registerTerminal({
          sessionId: trackingContext.sessionId,
          userId: trackingContext.userId,
          ...(trackingContext.clientRequestId
            ? { clientRequestId: trackingContext.clientRequestId }
            : {}),
          ...(trackingContext.toolCallId ? { toolCallId: trackingContext.toolCallId } : {}),
          toolName: 'interactive_bash',
          kind: 'tmux',
          command: tmuxCommand,
          description: `tmux ${subcommand} ${sessionName}`.trim(),
          // 已绑定：用会话路径；未绑定：回退到桌面端默认目录（禁止 process.cwd() 落到盘符根）。
          cwd: trackingContext.workingDirectory ?? resolveUnboundSessionWorkspaceFallback(),
          terminalId: buildTmuxTerminalId(sessionName),
          initialStatus: 'tmux-spawned',
          metadata: { tmuxSessionName: sessionName },
        });
      } else if (TMUX_KILL_SUBCOMMANDS.has(subcommand)) {
        const { markTerminalExited } = await import('../session/session-terminal-registry.js');
        if (subcommand === 'kill-server') {
          // kill-server tears down every tracked tmux row for this user
          // in this session. We don't know names — pull them from the DB.
          const { listSessionTerminals } = await import('../session/session-terminal-registry.js');
          const open = listSessionTerminals({
            sessionId: trackingContext.sessionId,
            userId: trackingContext.userId,
            includeClosed: false,
            limit: 200,
          }).filter((t) => t.kind === 'tmux');
          for (const t of open) {
            markTerminalExited({ terminalId: t.terminalId, status: 'tmux-killed' });
          }
        } else {
          const sessionName = extractTmuxSessionName(parts);
          if (sessionName) {
            markTerminalExited({
              terminalId: buildTmuxTerminalId(sessionName),
              status: 'tmux-killed',
            });
          }
        }
      }
    } catch (registryError) {
      console.warn(
        '[interactive-bash] failed to mirror tmux lifecycle:',
        registryError instanceof Error ? registryError.message : String(registryError),
      );
    }
  }

  return outputText;
}

export const interactiveBashToolDefinition: ToolDefinition<
  typeof interactiveBashInputSchema,
  z.ZodString
> = {
  name: 'interactive_bash',
  description: '注意：本工具仅用于 TMUX。直接传 tmux 子命令（不要带 tmux 前缀）。',
  inputSchema: interactiveBashInputSchema,
  outputSchema: z.string(),
  timeout: 60000,
  execute: async (input) => runInteractiveBashCommand(input.tmux_command),
};
