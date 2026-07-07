import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { MCPToolDef } from '@openAwork/mcp-client';
import {
  assertSessionWorkingDirectory,
  assertSessionWorkspacePath,
} from '../workspace/workspace-safety.js';
import type { MCPCallInput } from './mcp-runtime.js';
import { EMPTY_SCHEMA } from './virtual-mcp-tool-schemas.js';

const GIT_BASH_TOOLS = [
  {
    name: 'which_bash',
    description: '解析 git_bash MCP 将使用的 Git Bash bash.exe 路径。',
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: 'diagnose',
    description: '报告当前主机是否可用 Git Bash 命令执行能力。',
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: 'run',
    description:
      '在原生 Windows 上通过 Git Bash 执行 shell 命令；非 Windows 或未安装时会返回错误。',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令。' },
        timeout: { type: 'integer', minimum: 1, maximum: 1_800_000 },
        workdir: { type: 'string', description: '工作目录；省略时使用当前会话工作目录。' },
        description: { type: 'string' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
] satisfies readonly MCPToolDef[];

export function listGitBashVirtualMcpTools(): MCPToolDef[] {
  return process.platform === 'win32' ? [...GIT_BASH_TOOLS] : GIT_BASH_TOOLS.slice(0, 2);
}

export async function callGitBashVirtualMcp(
  sessionId: string,
  input: MCPCallInput,
): Promise<unknown> {
  switch (input.toolName) {
    case 'which_bash':
      return resolveGitBash();
    case 'diagnose':
      return diagnoseGitBash();
    case 'run':
      return runGitBashTool(sessionId, input.arguments ?? {});
    default:
      throw new Error(`Unsupported git_bash MCP tool: ${input.toolName}`);
  }
}

function resolveGitBash(): {
  found: boolean;
  path: string | null;
  source: string;
  checkedPaths: string[];
} {
  if (process.platform !== 'win32') {
    return { found: true, path: null, source: 'not-required', checkedPaths: [] };
  }

  const checkedPaths: string[] = [];
  const envPath = process.env.OPENAWORK_GIT_BASH_PATH ?? process.env.OMO_CODEX_GIT_BASH_PATH;
  if (envPath && envPath.trim().length > 0) {
    checkedPaths.push(envPath);
    return existsSync(envPath)
      ? { found: true, path: envPath, source: 'env', checkedPaths }
      : { found: false, path: null, source: 'missing-env', checkedPaths };
  }

  for (const candidate of [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]) {
    checkedPaths.push(candidate);
    if (existsSync(candidate)) {
      return { found: true, path: candidate, source: 'program-files', checkedPaths };
    }
  }

  const where = spawnSync('where.exe', ['bash'], { encoding: 'utf8', windowsHide: true });
  for (const candidate of where.stdout.split(/\r?\n/).map((line) => line.trim())) {
    if (!candidate) continue;
    checkedPaths.push(candidate);
    if (candidate.toLowerCase().endsWith('bash.exe') && existsSync(candidate)) {
      return { found: true, path: candidate, source: 'path', checkedPaths };
    }
  }

  return { found: false, path: null, source: 'not-found', checkedPaths };
}

function diagnoseGitBash(): unknown {
  const resolution = resolveGitBash();
  const enabled = process.platform === 'win32' && resolution.found && resolution.path !== null;
  return {
    platform: process.platform,
    enabled,
    status:
      process.platform === 'win32'
        ? enabled
          ? 'ready'
          : 'missing-git-bash'
        : 'disabled: git_bash command execution is only exposed on native Windows',
    resolution,
  };
}

async function runGitBashTool(sessionId: string, args: Record<string, unknown>): Promise<unknown> {
  const resolution = resolveGitBash();
  if (process.platform !== 'win32' || !resolution.found || resolution.path === null) {
    return {
      isError: true,
      message: 'git_bash run is only available on native Windows with Git Bash installed.',
      resolution,
    };
  }

  const command = typeof args['command'] === 'string' ? args['command'].trim() : '';
  if (!command) return { isError: true, message: 'run.command must be a non-empty string.' };
  const workdir =
    typeof args['workdir'] === 'string' && args['workdir'].trim().length > 0
      ? assertSessionWorkspacePath({ path: args['workdir'], sessionId })
      : assertSessionWorkingDirectory(sessionId);
  const timeout = typeof args['timeout'] === 'number' ? Math.floor(args['timeout']) : 120_000;
  return spawnGitBash(resolution.path, command, workdir, timeout);
}

function spawnGitBash(
  bashPath: string,
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; cwd: string; output: string; timedOut: boolean }> {
  return new Promise((resolveRun) => {
    const child = spawn(bashPath, ['-lc', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolveRun({
        exitCode: typeof code === 'number' ? code : timedOut ? 124 : 1,
        cwd,
        output: Buffer.concat(chunks).toString('utf8') || '(no output)',
        timedOut,
      });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveRun({ exitCode: 1, cwd, output: error.message, timedOut });
    });
  });
}
