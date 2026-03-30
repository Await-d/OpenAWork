import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

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

export const interactiveBashToolDefinition: ToolDefinition<
  typeof interactiveBashInputSchema,
  z.ZodString
> = {
  name: 'interactive_bash',
  description: 'WARNING: This is TMUX ONLY. Pass tmux subcommands directly (without tmux prefix).',
  inputSchema: interactiveBashInputSchema,
  outputSchema: z.string(),
  timeout: 60000,
  execute: async (input) => {
    const parts = tokenizeTmuxCommand(input.tmux_command);
    if (parts.length === 0) {
      return 'Error: Empty tmux command';
    }
    const subcommand = parts[0]?.toLowerCase() ?? '';
    if (
      BLOCKED_TMUX_SUBCOMMANDS.includes(subcommand as (typeof BLOCKED_TMUX_SUBCOMMANDS)[number])
    ) {
      return explainBlockedTmuxCommand(parts);
    }

    const tmuxPath = process.env['TMUX_PATH']?.trim() || 'tmux';
    try {
      const { stdout, stderr } = await execFileAsync(tmuxPath, parts, {
        timeout: 60000,
        maxBuffer: 2 * 1024 * 1024,
      });
      if (stderr.trim().length > 0) {
        return stderr.trim();
      }
      return stdout.trim().length > 0 ? stdout : '(no output)';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  },
};
