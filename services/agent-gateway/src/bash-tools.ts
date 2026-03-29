import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { ToolDefinition } from '@openAwork/agent-core';
import { WORKSPACE_ROOT } from './db.js';
import { validateWorkspacePath } from './workspace-paths.js';
import { z } from 'zod';

const MAX_BASH_TIMEOUT_MS = 120000;
const DEFAULT_BASH_TIMEOUT_MS = 120000;

const BASH_TOOL_DESCRIPTION = `Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

All commands run in current working directory by default. Use the \`workdir\` parameter if you need to run a command in a different directory. AVOID using \`cd <directory> && <command>\` patterns - use \`workdir\` instead.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Usage notes:
- The command argument is required.
- You can specify an optional timeout in milliseconds. If not specified, commands will time out after 120000ms (2 minutes).
- It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
- Avoid using Bash with the \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or when these commands are truly necessary for the task.
- AVOID using \`cd <directory> && <command>\`. Use the \`workdir\` parameter to change directories instead.`;

const bashInputSchema = z.object({
  command: z.string().min(1),
  timeout: z.number().int().min(1).max(MAX_BASH_TIMEOUT_MS).optional(),
  workdir: z.string().min(1).optional(),
  description: z.string().min(1),
});

const bashOutputSchema = z.object({
  command: z.string(),
  cwd: z.string(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});

function buildBashPermissionScope(command: string, cwd: string): string {
  const digest = createHash('sha256').update(`${cwd}\n${command}`).digest('hex').slice(0, 12);
  return `bash:${cwd}:${digest}`;
}

function assertSafeBashCommand(command: string): string {
  const trimmedCommand = command.trim();
  if (trimmedCommand.length === 0) {
    throw new Error('bash command is required');
  }

  return trimmedCommand;
}

async function resolveBashWorkdir(workdir: string): Promise<string> {
  const safeWorkdir = validateWorkspacePath(workdir);
  if (!safeWorkdir) {
    throw new Error(`Forbidden workspace path: ${workdir}`);
  }

  const statResult = await stat(safeWorkdir);
  if (!statResult.isDirectory()) {
    throw new Error(`Path is not a directory: ${safeWorkdir}`);
  }

  return safeWorkdir;
}

export interface BashExecutionResult {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runBashCommand(
  input: z.infer<typeof bashInputSchema>,
): Promise<BashExecutionResult> {
  const command = assertSafeBashCommand(input.command);
  const cwd = await resolveBashWorkdir(input.workdir ?? WORKSPACE_ROOT);
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    const result = (await execFileAsync('bash', ['-lc', command], {
      cwd,
      timeout: input.timeout ?? DEFAULT_BASH_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    })) as { stdout: string; stderr: string };
    return {
      command,
      cwd,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      command,
      cwd,
      exitCode: typeof execError.code === 'number' ? execError.code : 1,
      stdout: execError.stdout ?? '',
      stderr: execError.stderr ?? (execError.message || String(error)),
    };
  }
}

export const bashToolDefinition: ToolDefinition<typeof bashInputSchema, typeof bashOutputSchema> = {
  name: 'bash',
  description: BASH_TOOL_DESCRIPTION,
  inputSchema: bashInputSchema,
  outputSchema: bashOutputSchema,
  timeout: MAX_BASH_TIMEOUT_MS,
  execute: async () => {
    throw new Error('bash must execute through the gateway-managed sandbox path');
  },
};

export { buildBashPermissionScope };
