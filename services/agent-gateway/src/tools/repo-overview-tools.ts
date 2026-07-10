/**
 * repo-overview-tools — `repo_overview` tool for the P1-SCOUT scout
 * agent.
 *
 * Ported from opencode `packages/opencode/src/tool/repo_overview.ts`
 * (commit 40d5ea1cf, #24149). Differences from upstream:
 *
 *   - **No effect-ts**. Plain async/await + `node:fs/promises`.
 *   - **No external-directory permission**. The tool operates on
 *     either (a) a cached repo under the gateway repos directory or
 *     (b) an absolute path the caller provides. To avoid making this
 *     a "read any path on disk" tool, when `path` is provided we
 *     refuse anything that escapes the repos cache root unless the
 *     caller explicitly opted in via
 *     `OPENAWORK_REPO_OVERVIEW_ALLOW_ANY_PATH=1`. Future iterations
 *     can layer the existing workspace-permission system on top.
 *   - **Dependency injection**. `createRepoOverviewTool({ gitRun })`
 *     keeps unit tests self-contained.
 */

import { promises as fsp } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import path from 'node:path';

import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

import { parseRepositoryReference, repositoryCachePath } from '../workspace/repo-reference.js';
import { resolveGatewayReposDir } from '../infra/storage-paths.js';
import { defaultGitRunner, type GitRunner } from './repo-clone-tools.js';

const STRUCTURE_LIMIT = 200;
const DEFAULT_DEPTH = 3;
const MAX_DEPTH = 6;

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'dist',
  'build',
  '.next',
  'target',
  'vendor',
]);

const DEPENDENCY_FILES = [
  'package.json',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'yarn.lock',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'build.gradle',
  'build.gradle.kts',
  'pom.xml',
  'composer.json',
];

const COMMON_ENTRYPOINT_FILES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.mjs',
  'main.ts',
  'main.js',
  'src/index.ts',
  'src/index.tsx',
  'src/index.js',
  'src/main.ts',
  'src/main.js',
];

const repoOverviewInputSchema = z
  .object({
    repository: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Cached repository to inspect, as a git URL, host/path reference, or GitHub owner/repo shorthand',
      ),
    path: z
      .string()
      .min(1)
      .optional()
      .describe('Absolute directory path to inspect instead of a cached repository'),
    depth: z
      .number()
      .int()
      .min(1)
      .max(MAX_DEPTH)
      .optional()
      .default(DEFAULT_DEPTH)
      .describe('Maximum structure depth to include. Defaults to 3.'),
  })
  .refine((value) => Boolean(value.repository ?? value.path), {
    message: 'Either repository or path is required',
  });

const repoOverviewOutputSchema = z.object({
  path: z.string(),
  repository: z.string().optional(),
  branch: z.string().optional(),
  head: z.string().optional(),
  packageManager: z.string().optional(),
  ecosystems: z.array(z.string()),
  dependencyFiles: z.array(z.string()),
  entrypoints: z.array(z.string()),
  depth: z.number().int(),
  truncated: z.boolean(),
  structure: z.array(z.string()),
});

export type RepoOverviewInput = z.infer<typeof repoOverviewInputSchema>;
export type RepoOverviewOutput = z.infer<typeof repoOverviewOutputSchema>;

export function detectPackageManager(files: ReadonlySet<string>): string | undefined {
  if (files.has('bun.lock') || files.has('bun.lockb')) return 'bun';
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('package-lock.json')) return 'npm';
  return undefined;
}

export function detectEcosystems(files: ReadonlySet<string>): string[] {
  const list: string[] = [];
  if (files.has('package.json')) list.push('Node.js');
  if (files.has('pyproject.toml') || files.has('requirements.txt')) list.push('Python');
  if (files.has('go.mod')) list.push('Go');
  if (files.has('Cargo.toml')) list.push('Rust');
  if (files.has('Gemfile')) list.push('Ruby');
  if (files.has('build.gradle') || files.has('build.gradle.kts') || files.has('pom.xml')) {
    list.push('Java/Kotlin');
  }
  if (files.has('composer.json')) list.push('PHP');
  return list;
}

export function detectCommonEntrypoints(files: ReadonlySet<string>): string[] {
  return COMMON_ENTRYPOINT_FILES.filter((file) => files.has(file));
}

interface ResolveTargetResult {
  absolutePath: string;
  repository?: string;
}

function resolveTargetPath(input: RepoOverviewInput): ResolveTargetResult {
  if (input.path) {
    if (!path.isAbsolute(input.path)) {
      throw new Error('repo_overview path must be absolute');
    }
    const reposRoot = resolveGatewayReposDir();
    const resolved = path.resolve(input.path);
    const allowAny = process.env['OPENAWORK_REPO_OVERVIEW_ALLOW_ANY_PATH'] === '1';
    if (!allowAny) {
      const reposRootResolved = path.resolve(reposRoot);
      const inside =
        resolved === reposRootResolved || resolved.startsWith(reposRootResolved + path.sep);
      if (!inside) {
        throw new Error(
          `repo_overview path must live under the repos cache (${reposRootResolved}). Set OPENAWORK_REPO_OVERVIEW_ALLOW_ANY_PATH=1 to override.`,
        );
      }
    }
    const result: ResolveTargetResult = { absolutePath: resolved };
    if (input.repository) result.repository = input.repository;
    return result;
  }

  if (!input.repository) {
    throw new Error('Either repository or path is required');
  }

  const reference = parseRepositoryReference(input.repository);
  if (!reference) {
    throw new Error(
      'Repository must be a git URL, host/path reference, or GitHub owner/repo shorthand',
    );
  }
  return { absolutePath: repositoryCachePath(reference), repository: reference.label };
}

interface DirectoryEntry {
  name: string;
  full: string;
  directory: boolean;
}

interface StructureResult {
  lines: string[];
  truncated: boolean;
}

async function listDirSorted(dir: string): Promise<DirectoryEntry[]> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const filtered: DirectoryEntry[] = [];
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    filtered.push({
      name: entry.name,
      full: path.join(dir, entry.name),
      directory: entry.isDirectory(),
    });
  }
  filtered.sort(
    (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
  );
  return filtered;
}

async function buildStructure(root: string, depth: number): Promise<StructureResult> {
  const lines: string[] = [];
  let truncated = false;

  async function visit(dir: string, level: number): Promise<void> {
    if (level >= depth || lines.length >= STRUCTURE_LIMIT) {
      if (lines.length >= STRUCTURE_LIMIT) truncated = true;
      return;
    }
    const entries = await listDirSorted(dir);
    for (const entry of entries) {
      if (lines.length >= STRUCTURE_LIMIT) {
        truncated = true;
        return;
      }
      lines.push(`${'  '.repeat(level)}${entry.name}${entry.directory ? '/' : ''}`);
      if (entry.directory) await visit(entry.full, level + 1);
    }
  }

  await visit(root, 0);
  return { lines, truncated };
}

async function readPackageJson(target: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fsp.readFile(path.join(target, 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Missing / invalid package.json — fall through.
  }
  return undefined;
}

function packageJsonEntrypoints(pkg: Record<string, unknown> | undefined): string[] {
  if (!pkg) return [];
  const out: string[] = [];
  if (typeof pkg['main'] === 'string') out.push(`main: ${pkg['main']}`);
  if (typeof pkg['module'] === 'string') out.push(`module: ${pkg['module']}`);
  if (typeof pkg['types'] === 'string') out.push(`types: ${pkg['types']}`);
  if (typeof pkg['bin'] === 'string') out.push(`bin: ${pkg['bin']}`);
  if (pkg['bin'] && typeof pkg['bin'] === 'object' && !Array.isArray(pkg['bin'])) {
    for (const name of Object.keys(pkg['bin'])) {
      out.push(`bin: ${name}`);
    }
  }
  if (pkg['exports'] && typeof pkg['exports'] === 'object' && !Array.isArray(pkg['exports'])) {
    for (const name of Object.keys(pkg['exports']).slice(0, 10)) {
      out.push(`exports: ${name}`);
    }
  }
  return out;
}

interface CreateRepoOverviewToolDeps {
  gitRun?: GitRunner;
}

export function createRepoOverviewTool(
  deps: CreateRepoOverviewToolDeps = {},
): ToolDefinition<typeof repoOverviewInputSchema, typeof repoOverviewOutputSchema> {
  const gitRun = deps.gitRun ?? defaultGitRunner;

  return {
    name: 'repo_overview',
    description:
      'Summarize a cloned repository or local directory: detected ecosystems, dependency files, package manager, likely entrypoints, and a compact structure tree (depth-limited). Use AFTER repo_clone to orient quickly before deeper Read/Glob/Grep. Either `repository` (cached) or `path` (absolute) is required.',
    inputSchema: repoOverviewInputSchema,
    outputSchema: repoOverviewOutputSchema,
    timeout: 60_000,
    execute: async (input, signal) => executeRepoOverview(input, signal, gitRun),
  };
}

async function executeRepoOverview(
  input: RepoOverviewInput,
  signal: AbortSignal | undefined,
  gitRun: GitRunner,
): Promise<RepoOverviewOutput> {
  const target = resolveTargetPath(input);
  const depth = input.depth ?? DEFAULT_DEPTH;

  let stat: Stats;
  try {
    stat = await fsp.stat(target.absolutePath);
  } catch {
    if (target.repository) {
      throw new Error(`Repository is not cloned: ${target.repository}. Use repo_clone first.`);
    }
    throw new Error(`Directory not found: ${target.absolutePath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${target.absolutePath}`);
  }

  const topLevelEntries = await listDirSorted(target.absolutePath);
  const topLevel = new Set(topLevelEntries.map((entry) => entry.name));
  const dependencyFiles = DEPENDENCY_FILES.filter((file) => topLevel.has(file));
  const pkg = topLevel.has('package.json') ? await readPackageJson(target.absolutePath) : undefined;

  const srcEntrypointFiles = topLevelEntries.some(
    (entry) => entry.directory && entry.name === 'src',
  )
    ? COMMON_ENTRYPOINT_FILES.filter((file) => file.startsWith('src/'))
    : [];
  // For common-entrypoint detection we union the top-level files with
  // a synthetic entry for known src/ files so detectCommonEntrypoints
  // reports them when present even though listDirSorted only yields
  // direct children.
  const fileLookup = new Set<string>([...topLevel, ...srcEntrypointFiles]);
  for (const file of srcEntrypointFiles) {
    try {
      const stats = await fsp.stat(path.join(target.absolutePath, file));
      if (!stats.isFile()) fileLookup.delete(file);
    } catch {
      fileLookup.delete(file);
    }
  }
  const common = detectCommonEntrypoints(fileLookup);

  const structure = await buildStructure(target.absolutePath, depth);

  let branch: string | undefined;
  let head: string | undefined;
  // `topLevelEntries` is post-filtered for the structure tree (it
  // hides `.git`/`node_modules`/etc.), so check `.git` existence via
  // a direct stat instead.
  let gitDirExists = false;
  try {
    const gitStat = await fsp.stat(path.join(target.absolutePath, '.git'));
    gitDirExists = gitStat.isDirectory();
  } catch {
    gitDirExists = false;
  }
  if (gitDirExists) {
    const branchResult = await gitRun(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd: target.absolutePath,
      ...(signal ? { signal } : {}),
    });
    branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() || undefined : undefined;

    const headResult = await gitRun(['rev-parse', 'HEAD'], {
      cwd: target.absolutePath,
      ...(signal ? { signal } : {}),
    });
    head = headResult.exitCode === 0 ? headResult.stdout.trim() || undefined : undefined;
  }

  const ecosystems = detectEcosystems(topLevel);
  const packageManager = detectPackageManager(topLevel);
  const entrypoints = [...packageJsonEntrypoints(pkg), ...common.map((file) => `file: ${file}`)];

  return {
    path: target.absolutePath,
    ...(target.repository ? { repository: target.repository } : {}),
    ...(branch ? { branch } : {}),
    ...(head ? { head } : {}),
    ...(packageManager ? { packageManager } : {}),
    ecosystems,
    dependencyFiles,
    entrypoints,
    depth,
    truncated: structure.truncated,
    structure: structure.lines,
  };
}

export const repoOverviewToolDefinition = createRepoOverviewTool();
