import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

export const AST_GREP_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'elixir',
  'go',
  'haskell',
  'html',
  'java',
  'javascript',
  'json',
  'kotlin',
  'lua',
  'nix',
  'php',
  'python',
  'ruby',
  'rust',
  'scala',
  'solidity',
  'swift',
  'typescript',
  'tsx',
  'yaml',
] as const;

type AstGrepLanguage = (typeof AST_GREP_LANGUAGES)[number];

const astGrepSearchInputSchema = z.object({
  pattern: z.string().min(1),
  lang: z.enum(AST_GREP_LANGUAGES),
  paths: z.array(z.string().min(1)).optional().default(['.']),
  globs: z.array(z.string().min(1)).optional().default([]),
  context: z.number().int().min(0).max(20).optional().default(0),
});

const astGrepReplaceInputSchema = z.object({
  pattern: z.string().min(1),
  rewrite: z.string().min(1),
  lang: z.enum(AST_GREP_LANGUAGES),
  paths: z.array(z.string().min(1)).optional().default(['.']),
  globs: z.array(z.string().min(1)).optional().default([]),
  dryRun: z.boolean().optional().default(true),
});

interface AstGrepResultItem {
  file?: string;
  range?: {
    start?: { line?: number; column?: number };
  };
  lines?: string;
  replacement?: string;
}

function getAstGrepBinary(): string | null {
  return process.env['AST_GREP_BIN']?.trim() || null;
}

async function resolveAstGrepBinary(): Promise<string | null> {
  const configured = getAstGrepBinary();
  const candidates = configured
    ? [configured, 'ast-grep', 'ast-grep.exe']
    : ['ast-grep', 'ast-grep.exe'];
  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate, ['--version'], { timeout: 3000 });
      const output = `${stdout}\n${stderr}`.toLowerCase();
      if (output.includes('ast-grep')) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function buildCommonArgs(
  pattern: string,
  lang: AstGrepLanguage,
  paths: string[],
  globs: string[],
): string[] {
  const args = ['scan', '--json=stream', '--pattern', pattern, '--lang', lang];
  globs.forEach((glob) => {
    args.push('--globs', glob);
  });
  args.push(...paths);
  return args;
}

function parseAstGrepStdout(stdout: string): AstGrepResultItem[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AstGrepResultItem];
      } catch {
        return [];
      }
    });
}

function formatAstGrepSearchResults(results: AstGrepResultItem[], context: number): string {
  if (results.length === 0) {
    return '未找到匹配。';
  }
  const header =
    context > 0
      ? `找到 ${results.length} 处匹配（上下文=${context}）：`
      : `找到 ${results.length} 处匹配：`;
  return [
    header,
    ...results.map((result) => {
      const line = (result.range?.start?.line ?? 0) + 1;
      const column = (result.range?.start?.column ?? 0) + 1;
      return `${result.file ?? 'unknown'}:${line}:${column}\n${(result.lines ?? '').trim()}`;
    }),
  ].join('\n\n');
}

function formatAstGrepReplaceResults(results: AstGrepResultItem[], dryRun: boolean): string {
  if (results.length === 0) {
    return dryRun ? '试运行：无可应用的改动。' : '无任何替换被应用。';
  }
  const prefix = dryRun ? '试运行预览：' : '已应用替换：';
  return [
    prefix,
    ...results.map((result) => {
      const line = (result.range?.start?.line ?? 0) + 1;
      const column = (result.range?.start?.column ?? 0) + 1;
      return `${result.file ?? 'unknown'}:${line}:${column}\n${(result.lines ?? '').trim()}`;
    }),
    ...(dryRun ? ['\n如需真正写入改动，请传 dryRun=false。'] : []),
  ].join('\n\n');
}

async function runAstGrep(args: string[]): Promise<AstGrepResultItem[]> {
  const binary = await resolveAstGrepBinary();
  if (!binary) {
    throw new Error(
      'ast-grep binary not found. Set AST_GREP_BIN or install ast-grep in PATH as "ast-grep".',
    );
  }
  const { stdout } = await execFileAsync(binary, args, {
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseAstGrepStdout(stdout);
}

export const astGrepSearchToolDefinition: ToolDefinition<
  typeof astGrepSearchInputSchema,
  z.ZodString
> = {
  name: 'ast_grep_search',
  description: '在文件系统上基于 AST 感知匹配代码模式。支持 25 种语言。',
  inputSchema: astGrepSearchInputSchema,
  outputSchema: z.string(),
  timeout: 60000,
  execute: async (input) => {
    const args = buildCommonArgs(input.pattern, input.lang, input.paths, input.globs);
    if (input.context > 0) {
      args.push('--context', String(input.context));
    }
    const results = await runAstGrep(args);
    return formatAstGrepSearchResults(results, input.context);
  },
};

export const astGrepReplaceToolDefinition: ToolDefinition<
  typeof astGrepReplaceInputSchema,
  z.ZodString
> = {
  name: 'ast_grep_replace',
  description: '在文件系统上基于 AST 感知重写代码模式。默认 dry-run。',
  inputSchema: astGrepReplaceInputSchema,
  outputSchema: z.string(),
  timeout: 60000,
  execute: async (input) => {
    const args = buildCommonArgs(input.pattern, input.lang, input.paths, input.globs);
    args.push('--rewrite', input.rewrite);
    if (!input.dryRun) {
      args.push('--update-all');
    }
    const results = await runAstGrep(args);
    return formatAstGrepReplaceResults(results, input.dryRun);
  },
};
