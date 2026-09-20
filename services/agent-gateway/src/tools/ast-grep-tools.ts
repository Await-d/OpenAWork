import { execFile } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { isPathWithinRoot } from '../workspace/workspace-paths.js';

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
  // 必须使用 run 子命令，不能用 scan：ast-grep 0.44 实测 `scan --pattern ...` 直接以退出码 2
  // 报 "unexpected argument '--pattern' found"（scan 只接受 `--json[=<STYLE>] --after <NUM> [PATHS]...`），
  // 只有 run（主命令，版本间稳定）接受 --pattern/--rewrite。
  // 公共参数刻意不含 --json：写盘路径带了它会静默丢弃 --update-all（原因见 executeAstGrepReplace）。
  const args = ['run', '--pattern', pattern, '--lang', lang];
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

function formatAstGrepAppliedOutput(stdout: string): string {
  const summary = stdout.trim();
  if (summary.length === 0) {
    return '无任何替换被应用。';
  }
  return `已应用替换：${summary}`;
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

function isAstGrepNoMatchFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = 'code' in error ? error.code : undefined;
  if (code !== 1) {
    return false;
  }
  const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '';
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  // ast-grep 在“无任何匹配”时以退出码 1 且 stdout/stderr 均为空结束（0.44 实测）；
  // 缺文件等真实错误会往 stderr 写内容，必须继续抛出，不能一并吞掉。
  return stdout.trim() === '' && stderr.trim() === '';
}

async function runAstGrepRaw(args: string[], options?: { cwd?: string }): Promise<string> {
  const binary = await resolveAstGrepBinary();
  if (!binary) {
    throw new Error(
      'ast-grep binary not found. Set AST_GREP_BIN or install ast-grep in PATH as "ast-grep".',
    );
  }
  try {
    const { stdout } = await execFileAsync(binary, args, {
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (isAstGrepNoMatchFailure(error)) {
      return '';
    }
    throw error;
  }
}

async function runAstGrep(
  args: string[],
  options?: { cwd?: string },
): Promise<AstGrepResultItem[]> {
  return parseAstGrepStdout(await runAstGrepRaw(args, options));
}

function normalizeAstGrepPaths(paths: string[], workspaceRoot?: string): string[] {
  if (!workspaceRoot) {
    return paths;
  }
  const normalizedRoot = resolve(workspaceRoot);
  return paths.map((entry) => {
    const resolvedPath = isAbsolute(entry) ? resolve(entry) : resolve(normalizedRoot, entry);
    if (!isPathWithinRoot(resolvedPath, normalizedRoot)) {
      throw new Error(`Target path is outside current session workspace: ${resolvedPath}`);
    }
    return resolvedPath;
  });
}

export async function executeAstGrepReplace(
  input: z.infer<typeof astGrepReplaceInputSchema>,
  workspaceRoot?: string,
): Promise<string> {
  const normalizedPaths = normalizeAstGrepPaths(input.paths, workspaceRoot);
  const args = buildCommonArgs(input.pattern, input.lang, normalizedPaths, input.globs);
  args.push('--rewrite', input.rewrite);
  if (input.dryRun) {
    // 试运行不写盘，可以带 --json 拿结构化匹配（含 replacement 字段）做预览。
    args.push('--json=stream');
    const preview = await runAstGrep(args, workspaceRoot ? { cwd: workspaceRoot } : undefined);
    return formatAstGrepReplaceResults(preview, true);
  }
  // 写盘模式绝对不能带 --json：ast-grep 0.44 实测 --json 与 --update-all 同时出现时，
  // 命令只打印 JSON 并以退出码 0 结束，但不会改写任何文件（静默丢写）。
  // 因此这里只保留 --rewrite + --update-all，结果以此命令自身的 "Applied N changes" 摘要为准。
  args.push('--update-all');
  const stdout = await runAstGrepRaw(args, workspaceRoot ? { cwd: workspaceRoot } : undefined);
  return formatAstGrepAppliedOutput(stdout);
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
    // 检索只读、不落盘，保留 JSON 流以复用 parseAstGrepStdout：
    // 0.44 实测 `run --json=stream` 的字段（file/range.start/lines）与既有解析器一致。
    args.push('--json=stream');
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
    return executeAstGrepReplace(input);
  },
};
