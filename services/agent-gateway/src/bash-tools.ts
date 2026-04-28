import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { FileDiffContent } from '@openAwork/shared';
import type { ToolDefinition } from '@openAwork/agent-core';
import { WORKSPACE_ROOT } from './db.js';
import {
  captureWorkspaceReconcileSnapshot,
  collectWorkspaceReconcileDiffs,
} from './workspace-reconcile.js';
import { validateWorkspacePath } from './workspace-paths.js';
import { bashCommandScope } from './bash-arity.js';
import { truncateBashOutput } from './bash-output-truncator.js';
import { z } from 'zod';

const MAX_BASH_TIMEOUT_MS = 120000;
const DEFAULT_BASH_TIMEOUT_MS = 30000;

const MAX_DIFFS_COUNT = 20;
const MAX_DIFF_CONTENT_CHARS = 10_000;

function slimDiffsForOutput(diffs: FileDiffContent[]): FileDiffContent[] {
  const sliced = diffs.length > MAX_DIFFS_COUNT ? diffs.slice(0, MAX_DIFFS_COUNT) : diffs;
  return sliced.map((d) => ({
    ...d,
    before:
      d.before.length > MAX_DIFF_CONTENT_CHARS
        ? d.before.slice(0, MAX_DIFF_CONTENT_CHARS) + '\n...[truncated]'
        : d.before,
    after:
      d.after.length > MAX_DIFF_CONTENT_CHARS
        ? d.after.slice(0, MAX_DIFF_CONTENT_CHARS) + '\n...[truncated]'
        : d.after,
  }));
}

const bashInputSchema = z.object({
  command: z.string().min(1),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(MAX_BASH_TIMEOUT_MS)
    .optional()
    .default(DEFAULT_BASH_TIMEOUT_MS),
  workdir: z.string().min(1).optional().default(WORKSPACE_ROOT),
});

const bashOutputSchema = z.object({
  command: z.string(),
  cwd: z.string(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  diffs: z
    .array(
      z.object({
        file: z.string(),
        before: z.string(),
        after: z.string(),
        additions: z.number().int(),
        deletions: z.number().int(),
        status: z.enum(['added', 'deleted', 'modified']).optional(),
        sourceKind: z.literal('workspace_reconcile').optional(),
        guaranteeLevel: z.literal('weak').optional(),
      }),
    )
    .optional()
    .default([]),
});

const DISALLOWED_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /[`]/u, message: 'bash command cannot contain backticks' },
  { pattern: /\$\(/u, message: 'bash command cannot contain command substitution' },
  {
    pattern: /[;&|><]/u,
    message: 'bash command cannot contain shell chaining, piping, or redirection operators',
  },
  { pattern: /\r|\n/u, message: 'bash command must be a single line' },
  {
    pattern: /\bPATH\s*=|\bLD_[A-Z_]*\s*=|\bDYLD_[A-Z_]*\s*=/u,
    message: 'bash command cannot override PATH or dynamic loader environment variables',
  },
  { pattern: /\bsudo\b/u, message: 'bash command cannot use sudo' },
];

function buildBashPermissionScope(command: string, cwd: string): string {
  const scope = bashCommandScope(command);
  const digest = createHash('sha256').update(`${cwd}\n${command}`).digest('hex').slice(0, 12);
  return `bash:${scope}:${digest}`;
}

function assertSafeBashCommand(command: string): string {
  const trimmedCommand = command.trim();
  if (trimmedCommand.length === 0) {
    throw new Error('bash command is required');
  }

  for (const { pattern, message } of DISALLOWED_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      throw new Error(message);
    }
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
  diffs: FileDiffContent[];
  exitCode: number;
  stdout: string;
  stderr: string;
  /** When stdout was truncated, this holds the path to the full output file */
  stdoutOutputPath?: string;
}

export async function runBashCommand(
  input: z.infer<typeof bashInputSchema>,
): Promise<BashExecutionResult> {
  const command = assertSafeBashCommand(input.command);
  const cwd = await resolveBashWorkdir(input.workdir);
  const beforeSnapshot = await captureWorkspaceReconcileSnapshot(cwd);
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    const result = (await execFileAsync('bash', ['-lc', command], {
      cwd,
      timeout: input.timeout,
      maxBuffer: 4 * 1024 * 1024,
    })) as { stdout: string; stderr: string };
    const truncated = await truncateBashOutput(result.stdout);
    const rawDiffs = await collectWorkspaceReconcileDiffs({
      workspaceRoot: cwd,
      before: beforeSnapshot,
      after: await captureWorkspaceReconcileSnapshot(cwd),
    });
    return {
      command,
      cwd,
      diffs: slimDiffsForOutput(rawDiffs),
      exitCode: 0,
      stdout: truncated.content,
      stderr: result.stderr,
      stdoutOutputPath: truncated.outputPath,
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    const rawStdout = execError.stdout ?? '';
    const truncated = rawStdout.length > 0 ? await truncateBashOutput(rawStdout) : { content: rawStdout, truncated: false };
    const rawDiffs = await collectWorkspaceReconcileDiffs({
      workspaceRoot: cwd,
      before: beforeSnapshot,
      after: await captureWorkspaceReconcileSnapshot(cwd),
    });
    return {
      command,
      cwd,
      diffs: slimDiffsForOutput(rawDiffs),
      exitCode: typeof execError.code === 'number' ? execError.code : 1,
      stdout: truncated.content,
      stderr: execError.stderr ?? (execError.message || String(error)),
      stdoutOutputPath: 'outputPath' in truncated ? truncated.outputPath : undefined,
    };
  }
}

export const bashToolDefinition: ToolDefinition<typeof bashInputSchema, typeof bashOutputSchema> = {
  name: 'bash',
  description:
    'Execute a single approved shell command inside the workspace. Use this only when file tools are insufficient and the command does not require shell chaining or redirection. Required JSON input: {"command":"pwd","workdir":"/absolute/workspace/path"}.',
  inputSchema: bashInputSchema,
  outputSchema: bashOutputSchema,
  timeout: MAX_BASH_TIMEOUT_MS,
  execute: async () => {
    throw new Error('bash must execute through the gateway-managed sandbox path');
  },
};

export { buildBashPermissionScope };
