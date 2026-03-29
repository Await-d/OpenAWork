import { promises as fsp, type Dirent, type Stats } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { WORKSPACE_ROOT } from './db.js';
import { buildFileDiff, fileDiffSchema } from './file-diff-format.js';
import {
  getWorkspaceReviewDiff,
  listWorkspaceReviewChanges,
  revertWorkspaceReviewPath,
  type WorkspaceReviewChange,
} from './workspace-review.js';
import {
  isPathWithinRoot,
  validateWorkspacePath,
  validateWorkspaceRelativePath,
} from './workspace-paths.js';

interface WorkspaceTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: WorkspaceTreeNode[];
}

const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  '.DS_Store',
]);
const MAX_TREE_ENTRIES = 500;
const MAX_TREE_DEPTH = 4;
const MAX_FILE_BYTES = 100 * 1024;
const MAX_GLOB_MATCHES = 100;
const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;
const DEFAULT_READ_LIMIT = 2000;
const MAX_READ_LINE_LENGTH = 2000;
const MAX_READ_LINE_SUFFIX = `... (line truncated to ${MAX_READ_LINE_LENGTH} chars)`;
const MAX_READ_BYTES = 50 * 1024;
const MAX_READ_BYTES_LABEL = `${MAX_READ_BYTES / 1024} KB`;
const MAX_GREP_MATCHES = 100;
const MAX_GREP_LINE_LENGTH = 2000;

const LIST_IGNORE_PATTERNS = [
  'node_modules/',
  '__pycache__/',
  '.git/',
  'dist/',
  'build/',
  'target/',
  'vendor/',
  'bin/',
  'obj/',
  '.idea/',
  '.vscode/',
  '.zig-cache/',
  'zig-out',
  '.coverage',
  'coverage/',
  'vendor/',
  'tmp/',
  'temp/',
  '.cache/',
  'cache/',
  'logs/',
  '.venv/',
  'venv/',
  'env/',
] as const;

const workspaceTreeInputSchema = z.object({
  path: z.string().min(1),
  depth: z.number().int().min(1).max(MAX_TREE_DEPTH).default(2),
});

const workspaceTreeOutputSchema = z.object({
  path: z.string(),
  depth: z.number().int(),
  visitedEntries: z.number().int(),
  nodes: z.array(z.any()),
});

const workspaceReadFileInputSchema = z.object({
  path: z.string().min(1),
});

const workspaceReadFileOutputSchema = z.object({
  path: z.string(),
  content: z.string(),
  truncated: z.boolean(),
});

const _globInputSchema = z.object({
  path: z.string().min(1),
  pattern: z.string().min(1),
});

const _globOutputSchema = z.object({
  path: z.string(),
  pattern: z.string(),
  matches: z.array(z.string()),
});

const workspaceSearchInputSchema = z.object({
  path: z.string().min(1),
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(20),
});

const workspaceSearchOutputSchema = z.object({
  path: z.string(),
  query: z.string(),
  results: z.array(
    z.object({
      path: z.string(),
      line: z.number().int(),
      text: z.string(),
    }),
  ),
  scannedFiles: z.number().int(),
  skippedLargeFiles: z.number().int(),
});

const listInputSchema = z.object({
  path: z.string().min(1).optional(),
  ignore: z.array(z.string().min(1)).optional(),
});

const listOutputSchema = z.string();

const readInputSchema = z.object({
  filePath: z.string().min(1),
  offset: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

const readOutputSchema = z.string();

const globToolInputSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).optional(),
});

const globToolOutputSchema = z.string();

const grepInputSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).optional(),
  include: z.string().min(1).optional(),
});

const grepOutputSchema = z.string();

const workspaceReviewChangeSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  oldPath: z.string().optional(),
  linesAdded: z.number().int().optional(),
  linesDeleted: z.number().int().optional(),
});

const workspaceReviewStatusInputSchema = z.object({
  path: z.string().min(1),
});

const workspaceReviewStatusOutputSchema = z.object({
  path: z.string(),
  changes: z.array(workspaceReviewChangeSchema),
});

const workspaceReviewDiffInputSchema = z.object({
  path: z.string().min(1),
  filePath: z.string().min(1),
});

const workspaceReviewDiffOutputSchema = z.object({
  path: z.string(),
  filePath: z.string(),
  diff: z.string(),
});

const workspaceWriteFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const workspaceWriteFileOutputSchema = z.object({
  after: z.string(),
  before: z.string(),
  created: z.boolean(),
  filediff: fileDiffSchema,
  success: z.literal(true),
  path: z.string(),
  bytes: z.number().int(),
});

const writeInputSchema = workspaceWriteFileInputSchema;
const writeOutputSchema = workspaceWriteFileOutputSchema;

const workspaceCreateFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string().default(''),
});

const workspaceCreateFileOutputSchema = z.object({
  after: z.string(),
  before: z.string(),
  created: z.boolean(),
  filediff: fileDiffSchema,
  success: z.literal(true),
  path: z.string(),
  bytes: z.number().int(),
});

const workspaceCreateDirectoryInputSchema = z.object({
  path: z.string().min(1),
});

const workspaceCreateDirectoryOutputSchema = z.object({
  success: z.literal(true),
  path: z.string(),
});

const workspaceReviewRevertInputSchema = z.object({
  path: z.string().min(1),
  filePath: z.string().min(1),
});

const workspaceReviewRevertOutputSchema = z.object({
  ok: z.literal(true),
  path: z.string(),
  filePath: z.string(),
});

function assertAccessibleWorkspacePath(path: string, target: 'directory' | 'file'): string {
  const safePath = validateWorkspacePath(path);
  if (!safePath) {
    throw new Error(`Forbidden workspace path: ${path}`);
  }

  if (defaultIgnoreManager.shouldIgnore(safePath)) {
    throw new Error(`Access denied: ${target} "${safePath}" is protected by agentignore rules`);
  }

  return safePath;
}

function assertWritableWorkspacePath(path: string, target: 'directory' | 'file'): string {
  const safePath = validateWorkspacePath(path);
  if (!safePath) {
    throw new Error(`Forbidden workspace path: ${path}`);
  }

  if (defaultIgnoreManager.shouldIgnore(safePath)) {
    throw new Error(`Access denied: ${target} "${safePath}" is protected by agentignore rules`);
  }

  return safePath;
}

function assertSearchablePath(path: string): string {
  const safePath = validateWorkspacePath(path);
  if (!safePath) {
    throw new Error(`Forbidden workspace path: ${path}`);
  }

  return safePath;
}

async function assertDirectory(path: string): Promise<void> {
  const stat = await fsp.stat(path);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${path}`);
  }
}

async function assertFile(path: string): Promise<Stats> {
  const stat = await fsp.stat(path);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${path}`);
  }

  return stat;
}

async function readTree(
  dirPath: string,
  depth: number,
  counter: { count: number },
): Promise<WorkspaceTreeNode[]> {
  if (depth <= 0 || counter.count >= MAX_TREE_ENTRIES) {
    return [];
  }

  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: WorkspaceTreeNode[] = [];

  for (const entry of entries) {
    if (counter.count >= MAX_TREE_ENTRIES) {
      break;
    }

    if (IGNORED_NAMES.has(entry.name)) {
      continue;
    }

    const fullPath = join(dirPath, entry.name);
    if (defaultIgnoreManager.shouldIgnore(fullPath)) {
      continue;
    }

    counter.count += 1;
    const isDirectory = entry.isDirectory();
    const node: WorkspaceTreeNode = {
      path: fullPath,
      name: entry.name,
      type: isDirectory ? 'directory' : 'file',
    };

    if (isDirectory) {
      node.children = await readTree(fullPath, depth - 1, counter);
    }

    nodes.push(node);
  }

  return nodes.sort((left, right) => {
    if (left.type === right.type) {
      return left.name.localeCompare(right.name);
    }

    return left.type === 'directory' ? -1 : 1;
  });
}

function escapeRegex(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//u, '').replace(/^\/+/, '');
}

function expandGlobBraces(pattern: string): string[] {
  const start = pattern.indexOf('{');
  if (start === -1) {
    return [pattern];
  }

  let depth = 0;
  let end = -1;
  for (let index = start; index < pattern.length; index += 1) {
    const current = pattern[index];
    if (current === '{') {
      depth += 1;
    }
    if (current === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  if (end === -1) {
    return [pattern];
  }

  const prefix = pattern.slice(0, start);
  const suffix = pattern.slice(end + 1);
  const body = pattern.slice(start + 1, end);
  const parts = body.split(',');
  const expanded: string[] = [];
  for (const part of parts) {
    expanded.push(...expandGlobBraces(`${prefix}${part}${suffix}`));
  }
  return expanded;
}

function globPatternToRegex(pattern: string): RegExp {
  const normalizedPattern = normalizeRelativePath(pattern);
  let regex = '^';

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const current = normalizedPattern[index];
    if (current === undefined) {
      continue;
    }

    if (current === '*') {
      const next = normalizedPattern[index + 1];
      const afterNext = normalizedPattern[index + 2];
      if (next === '*') {
        if (afterNext === '/') {
          regex += '(?:.*/)?';
          index += 2;
          continue;
        }

        regex += '.*';
        index += 1;
        continue;
      }

      regex += '[^/]*';
      continue;
    }

    if (current === '?') {
      regex += '[^/]';
      continue;
    }

    regex += escapeRegex(current);
  }

  regex += '$';
  return new RegExp(regex);
}

function matchesGlobPattern(pattern: string, relativePath: string, isDirectory: boolean): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);
  const baseName = normalizedPath.split('/').at(-1) ?? normalizedPath;
  const pathWithDirectorySuffix = isDirectory
    ? `${normalizedPath.replace(/\/+$/u, '')}/`
    : normalizedPath;

  return expandGlobBraces(pattern).some((candidate) => {
    const normalizedPattern = normalizeRelativePath(candidate);
    if (normalizedPattern.endsWith('/')) {
      const prefix = normalizedPattern.slice(0, -1);
      return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
    }

    const regex = globPatternToRegex(normalizedPattern);
    if (regex.test(normalizedPath) || (isDirectory && regex.test(pathWithDirectorySuffix))) {
      return true;
    }

    if (!normalizedPattern.includes('/')) {
      return regex.test(baseName);
    }

    return false;
  });
}

function matchesIgnorePatterns(
  patterns: readonly string[],
  relativePath: string,
  isDirectory: boolean,
): boolean {
  return patterns.some((pattern) => matchesGlobPattern(pattern, relativePath, isDirectory));
}

function resolveWorkspaceSearchPath(pathValue?: string): string {
  return assertSearchablePath(pathValue ?? WORKSPACE_ROOT);
}

function assertAccessibleWorkspaceEntryPath(path: string): string {
  const safePath = validateWorkspacePath(path);
  if (!safePath) {
    throw new Error(`Forbidden workspace path: ${path}`);
  }

  if (defaultIgnoreManager.shouldIgnore(safePath)) {
    throw new Error(`Access denied: path "${safePath}" is protected by agentignore rules`);
  }

  return safePath;
}

function splitFileLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const lines = content.split(/\r?\n/u);
  if (/\r?\n$/u.test(content)) {
    lines.pop();
  }
  return lines;
}

function truncateReadLine(line: string): string {
  return line.length > MAX_READ_LINE_LENGTH
    ? `${line.slice(0, MAX_READ_LINE_LENGTH)}${MAX_READ_LINE_SUFFIX}`
    : line;
}

function truncateGrepLine(line: string): string {
  return line.length > MAX_GREP_LINE_LENGTH ? `${line.slice(0, MAX_GREP_LINE_LENGTH)}...` : line;
}

export function resolveWorkspaceReviewFilePath(rootPath: string, filePath: string): string {
  const normalizedRootPath = resolve(rootPath);
  const normalizedFilePath = filePath.trim();
  if (normalizedFilePath.length === 0) {
    throw new Error('filePath is required');
  }

  if (!isAbsolute(normalizedFilePath)) {
    const relativePath = validateWorkspaceRelativePath(normalizedRootPath, normalizedFilePath);
    if (!relativePath) {
      throw new Error(`Invalid filePath for workspace review: ${normalizedFilePath}`);
    }

    return relativePath;
  }

  const resolvedFilePath = resolve(normalizedFilePath);
  if (!isPathWithinRoot(resolvedFilePath, normalizedRootPath)) {
    throw new Error(`Invalid filePath for workspace review: ${normalizedFilePath}`);
  }

  return resolvedFilePath.slice(normalizedRootPath.length).replace(/^\//u, '');
}

async function runWorkspaceSearch(input: z.infer<typeof workspaceSearchInputSchema>) {
  const safePath = assertSearchablePath(input.path);
  await assertDirectory(safePath);

  const results: Array<{ path: string; line: number; text: string }> = [];
  let scannedFiles = 0;
  let skippedLargeFiles = 0;

  async function searchDirectory(dirPath: string): Promise<void> {
    if (results.length >= input.maxResults) {
      return;
    }

    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= input.maxResults) {
        break;
      }

      if (IGNORED_NAMES.has(entry.name)) {
        continue;
      }

      const fullPath = join(dirPath, entry.name);
      if (defaultIgnoreManager.shouldIgnore(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await searchDirectory(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      let stat: Stats;
      try {
        stat = await fsp.stat(fullPath);
      } catch {
        continue;
      }

      scannedFiles += 1;
      if (stat.size > MAX_SEARCH_FILE_BYTES) {
        skippedLargeFiles += 1;
        continue;
      }

      let content: string;
      try {
        content = await fsp.readFile(fullPath, 'utf8');
      } catch {
        continue;
      }

      const lines = content.split('\n');
      for (let index = 0; index < lines.length && results.length < input.maxResults; index += 1) {
        if (lines[index]?.includes(input.query)) {
          results.push({ path: fullPath, line: index + 1, text: lines[index]!.trim() });
        }
      }
    }
  }

  await searchDirectory(safePath);
  return {
    path: safePath,
    query: input.query,
    results,
    scannedFiles,
    skippedLargeFiles,
  };
}

async function runListTool(input: z.infer<typeof listInputSchema>): Promise<string> {
  const searchPath = resolveWorkspaceSearchPath(input.path);
  await assertDirectory(searchPath);

  const ignorePatterns = [...LIST_IGNORE_PATTERNS, ...(input.ignore ?? [])];
  const files: string[] = [];

  async function walk(dirPath: string): Promise<void> {
    if (files.length >= MAX_GLOB_MATCHES) {
      return;
    }

    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (files.length >= MAX_GLOB_MATCHES) {
        return;
      }

      const fullPath = join(dirPath, entry.name);
      if (!isPathWithinRoot(fullPath, searchPath) || defaultIgnoreManager.shouldIgnore(fullPath)) {
        continue;
      }

      const relativePath = normalizeRelativePath(fullPath.slice(searchPath.length));
      if (relativePath.length === 0) {
        continue;
      }

      if (matchesIgnorePatterns(ignorePatterns, relativePath, entry.isDirectory())) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      files.push(relativePath);
    }
  }

  await walk(searchPath);

  const dirs = new Set<string>();
  const filesByDir = new Map<string, string[]>();

  for (const file of files) {
    const fileDir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.';
    const parts = fileDir === '.' ? [] : fileDir.split('/');

    for (let index = 0; index <= parts.length; index += 1) {
      const dirPath = index === 0 ? '.' : parts.slice(0, index).join('/');
      dirs.add(dirPath);
    }

    if (!filesByDir.has(fileDir)) {
      filesByDir.set(fileDir, []);
    }
    filesByDir.get(fileDir)?.push(file.split('/').at(-1) ?? file);
  }

  function renderDir(dirPath: string, depth: number): string {
    const indent = '  '.repeat(depth);
    let output = '';

    if (depth > 0) {
      output += `${indent}${dirPath.split('/').at(-1) ?? dirPath}/\n`;
    }

    const childIndent = '  '.repeat(depth + 1);
    const children = Array.from(dirs)
      .filter((entry) => {
        if (entry === '.' || entry === dirPath) {
          return false;
        }

        const parent = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : '.';
        return parent === dirPath;
      })
      .sort((left, right) => left.localeCompare(right));

    for (const child of children) {
      output += renderDir(child, depth + 1);
    }

    const directoryFiles = filesByDir.get(dirPath) ?? [];
    for (const file of [...directoryFiles].sort((left, right) => left.localeCompare(right))) {
      output += `${childIndent}${file}\n`;
    }

    return output;
  }

  return `${searchPath}/\n${renderDir('.', 0)}`;
}

async function runGlobTool(input: z.infer<typeof globToolInputSchema>) {
  const safePath = resolveWorkspaceSearchPath(input.path);
  await assertDirectory(safePath);
  const matches: Array<{ path: string; modTime: number }> = [];
  let truncated = false;

  async function walk(dirPath: string): Promise<void> {
    if (truncated) {
      return;
    }

    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (truncated) {
        return;
      }

      if (IGNORED_NAMES.has(entry.name)) {
        continue;
      }

      const fullPath = join(dirPath, entry.name);
      if (!isPathWithinRoot(fullPath, safePath) || defaultIgnoreManager.shouldIgnore(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = normalizeRelativePath(fullPath.slice(safePath.length));
      if (!matchesGlobPattern(input.pattern, relativePath, false)) {
        continue;
      }

      const stat = await fsp.stat(fullPath).catch(() => null);
      if (matches.length >= MAX_GLOB_MATCHES) {
        truncated = true;
        return;
      }
      matches.push({ path: fullPath, modTime: stat?.mtime.getTime() ?? 0 });
    }
  }

  await walk(safePath);
  matches.sort((left, right) => right.modTime - left.modTime);

  if (matches.length === 0) {
    return 'No files found';
  }

  const output = matches.map((match) => match.path);
  if (truncated) {
    output.push('');
    output.push(
      `(Results are truncated: showing first ${MAX_GLOB_MATCHES} results. Consider using a more specific path or pattern.)`,
    );
  }

  return output.join('\n');
}

async function runReadTool(input: z.infer<typeof readInputSchema>): Promise<string> {
  const offset = input.offset ?? 1;
  const limit = input.limit ?? DEFAULT_READ_LIMIT;
  const filePath = isAbsolute(input.filePath)
    ? input.filePath
    : resolve(WORKSPACE_ROOT, input.filePath);
  const safePath = assertAccessibleWorkspaceEntryPath(filePath);
  const stat = await fsp.stat(safePath).catch(() => null);
  if (!stat) {
    throw new Error(`File not found: ${safePath}`);
  }

  if (stat.isDirectory()) {
    const entries = (await fsp.readdir(safePath, { withFileTypes: true }))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort((left, right) => left.localeCompare(right));

    const start = offset - 1;
    const sliced = entries.slice(start, start + limit);
    const truncated = start + sliced.length < entries.length;
    return [
      `<path>${safePath}</path>`,
      '<type>directory</type>',
      '<entries>',
      sliced.join('\n'),
      truncated
        ? `\n(Showing ${sliced.length} of ${entries.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
        : `\n(${entries.length} entries)`,
      '</entries>',
    ].join('\n');
  }

  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${safePath}`);
  }

  const content = await fsp.readFile(safePath, 'utf8');
  const lines = splitFileLines(content);
  if (lines.length < offset && !(lines.length === 0 && offset === 1)) {
    throw new Error(`Offset ${offset} is out of range for this file (${lines.length} lines)`);
  }

  const start = offset - 1;
  const raw: string[] = [];
  let bytes = 0;
  let truncatedByBytes = false;
  let hasMoreLines = false;

  for (let index = start; index < lines.length; index += 1) {
    if (raw.length >= limit) {
      hasMoreLines = true;
      break;
    }

    const line = truncateReadLine(lines[index] ?? '');
    const size = Buffer.byteLength(line, 'utf8') + (raw.length > 0 ? 1 : 0);
    if (bytes + size > MAX_READ_BYTES) {
      truncatedByBytes = true;
      hasMoreLines = true;
      break;
    }

    raw.push(line);
    bytes += size;
  }

  const rendered = raw.map((line, index) => `${index + offset}: ${line}`);
  let output = [`<path>${safePath}</path>`, '<type>file</type>', '<content>'].join('\n');
  output += rendered.join('\n');

  const totalLines = lines.length;
  const lastReadLine = offset + raw.length - 1;
  const nextOffset = lastReadLine + 1;
  if (truncatedByBytes) {
    output += `\n\n(Output capped at ${MAX_READ_BYTES_LABEL}. Showing lines ${offset}-${lastReadLine}. Use offset=${nextOffset} to continue.)`;
  } else if (hasMoreLines) {
    output += `\n\n(Showing lines ${offset}-${lastReadLine} of ${totalLines}. Use offset=${nextOffset} to continue.)`;
  } else {
    output += `\n\n(End of file - total ${totalLines} lines)`;
  }

  output += '\n</content>';
  return output;
}

async function runGrepTool(input: z.infer<typeof grepInputSchema>): Promise<string> {
  const safePath = resolveWorkspaceSearchPath(input.path);
  await assertDirectory(safePath);

  let regex: RegExp;
  try {
    regex = new RegExp(input.pattern);
  } catch (error) {
    throw new Error(
      `Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const matches: Array<{ path: string; lineNum: number; lineText: string; modTime: number }> = [];

  async function walk(dirPath: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (!isPathWithinRoot(fullPath, safePath) || defaultIgnoreManager.shouldIgnore(fullPath)) {
        continue;
      }

      if (IGNORED_NAMES.has(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = normalizeRelativePath(fullPath.slice(safePath.length));
      if (input.include && !matchesGlobPattern(input.include, relativePath, false)) {
        continue;
      }

      const stat = await fsp.stat(fullPath).catch(() => null);
      if (!stat) {
        continue;
      }

      let content: string;
      try {
        content = await fsp.readFile(fullPath, 'utf8');
      } catch {
        continue;
      }

      const lines = splitFileLines(content);
      for (let index = 0; index < lines.length; index += 1) {
        regex.lastIndex = 0;
        const line = lines[index] ?? '';
        if (!regex.test(line)) {
          continue;
        }

        matches.push({
          path: fullPath,
          lineNum: index + 1,
          lineText: line,
          modTime: stat.mtime.getTime(),
        });
      }
    }
  }

  await walk(safePath);
  if (matches.length === 0) {
    return 'No files found';
  }

  matches.sort((left, right) => right.modTime - left.modTime);
  const truncated = matches.length > MAX_GREP_MATCHES;
  const finalMatches = truncated ? matches.slice(0, MAX_GREP_MATCHES) : matches;
  const output = [
    `Found ${matches.length} matches${truncated ? ` (showing first ${MAX_GREP_MATCHES})` : ''}`,
  ];

  let currentFile = '';
  for (const match of finalMatches) {
    if (currentFile !== match.path) {
      if (currentFile !== '') {
        output.push('');
      }
      currentFile = match.path;
      output.push(`${match.path}:`);
    }
    output.push(`  Line ${match.lineNum}: ${truncateGrepLine(match.lineText)}`);
  }

  if (truncated) {
    output.push('');
    output.push(
      `(Results truncated: showing ${MAX_GREP_MATCHES} of ${matches.length} matches (${matches.length - MAX_GREP_MATCHES} hidden). Consider using a more specific path or pattern.)`,
    );
  }

  return output.join('\n');
}

function sanitizeReviewChanges(changes: WorkspaceReviewChange[]) {
  return changes.filter((change) => !defaultIgnoreManager.shouldIgnore(join('/', change.path)));
}

export const workspaceTreeTool: ToolDefinition<
  typeof workspaceTreeInputSchema,
  typeof workspaceTreeOutputSchema
> = {
  name: 'workspace_tree',
  description:
    'List a safe recursive tree for a workspace directory. Use this to inspect folders before reading files.',
  inputSchema: workspaceTreeInputSchema,
  outputSchema: workspaceTreeOutputSchema,
  timeout: 10000,
  execute: async (input) => {
    const safePath = assertSearchablePath(input.path);
    await assertDirectory(safePath);
    const counter = { count: 0 };
    const nodes = await readTree(safePath, input.depth, counter);
    return {
      path: safePath,
      depth: input.depth,
      visitedEntries: counter.count,
      nodes,
    };
  },
};

export const listTool: ToolDefinition<typeof listInputSchema, typeof listOutputSchema> = {
  name: 'list',
  description:
    'Lists files and directories in a given path. The path parameter must be absolute; omit it to use the current workspace directory. You can optionally provide an array of glob patterns to ignore with the ignore parameter. You should generally prefer the Glob and Grep tools, if you know which directories to search.',
  inputSchema: listInputSchema,
  outputSchema: listOutputSchema,
  timeout: 10000,
  execute: async (input) => runListTool(input),
};

export const workspaceReadFileTool: ToolDefinition<
  typeof workspaceReadFileInputSchema,
  typeof workspaceReadFileOutputSchema
> = {
  name: 'workspace_read_file',
  description:
    'Read a UTF-8 text file from the workspace with size limits and agentignore protection.',
  inputSchema: workspaceReadFileInputSchema,
  outputSchema: workspaceReadFileOutputSchema,
  timeout: 10000,
  execute: async (input) => {
    const safePath = assertAccessibleWorkspacePath(input.path, 'file');
    const stat = await assertFile(safePath);
    const truncated = stat.size > MAX_FILE_BYTES;
    const fd = await fsp.open(safePath, 'r');

    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES));
      await fd.read(buffer, 0, buffer.length, 0);
      return {
        path: safePath,
        content: buffer.toString('utf8'),
        truncated,
      };
    } finally {
      await fd.close();
    }
  },
};

export const readTool: ToolDefinition<typeof readInputSchema, typeof readOutputSchema> = {
  name: 'read',
  description: `Read a file or directory from the local filesystem. If the path does not exist, an error is returned.

Usage:
- The filePath parameter should be an absolute path.
- By default, this tool returns up to 2000 lines from the start of the file.
- The offset parameter is the line number to start reading from (1-indexed).
- To read later sections, call this tool again with a larger offset.
- Use the grep tool to find specific content in large files or files with long lines.
- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.
- Contents are returned with each line prefixed by its line number as <line>: <content>. For example, if a file has contents "foo\\n", you will receive "1: foo\\n". For directories, entries are returned one per line (without line numbers) with a trailing / for subdirectories.
- Any line longer than 2000 characters is truncated.
- Call this tool in parallel when you know there are multiple files you want to read.
- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.
- This tool can read image files and PDFs and return them as file attachments.`,
  inputSchema: readInputSchema,
  outputSchema: readOutputSchema,
  timeout: workspaceReadFileTool.timeout,
  execute: async (input) => runReadTool(input),
};

export const globTool: ToolDefinition<typeof globToolInputSchema, typeof globToolOutputSchema> = {
  name: 'glob',
  description: `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.`,
  inputSchema: globToolInputSchema,
  outputSchema: globToolOutputSchema,
  timeout: 10000,
  execute: async (input) => runGlobTool(input),
};

export const workspaceSearchTool: ToolDefinition<
  typeof workspaceSearchInputSchema,
  typeof workspaceSearchOutputSchema
> = {
  name: 'workspace_search',
  description:
    'Search literal text within workspace files. Use this to find symbols, strings, or implementation references.',
  inputSchema: workspaceSearchInputSchema,
  outputSchema: workspaceSearchOutputSchema,
  timeout: 15000,
  execute: runWorkspaceSearch,
};

export const grepTool: ToolDefinition<typeof grepInputSchema, typeof grepOutputSchema> = {
  name: 'grep',
  description: `- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with at least one match sorted by modification time
- Use this tool when you need to find files containing specific patterns
- If you need to identify/count the number of matches within files, use the Bash tool with \`rg\` (ripgrep) directly. Do NOT use \`grep\`.
- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead`,
  inputSchema: grepInputSchema,
  outputSchema: grepOutputSchema,
  timeout: workspaceSearchTool.timeout,
  execute: async (input) => runGrepTool(input),
};

export const workspaceReviewStatusTool: ToolDefinition<
  typeof workspaceReviewStatusInputSchema,
  typeof workspaceReviewStatusOutputSchema
> = {
  name: 'workspace_review_status',
  description:
    'List git working tree changes for a workspace root, including added, modified, deleted, and renamed files.',
  inputSchema: workspaceReviewStatusInputSchema,
  outputSchema: workspaceReviewStatusOutputSchema,
  timeout: 10000,
  execute: async (input) => {
    const safePath = assertSearchablePath(input.path);
    await assertDirectory(safePath);
    const changes = await listWorkspaceReviewChanges(safePath);
    return {
      path: safePath,
      changes: sanitizeReviewChanges(changes),
    };
  },
};

export const workspaceReviewDiffTool: ToolDefinition<
  typeof workspaceReviewDiffInputSchema,
  typeof workspaceReviewDiffOutputSchema
> = {
  name: 'workspace_review_diff',
  description: 'Read the git diff for a changed file inside a workspace root.',
  inputSchema: workspaceReviewDiffInputSchema,
  outputSchema: workspaceReviewDiffOutputSchema,
  timeout: 10000,
  execute: async (input) => {
    const safePath = assertSearchablePath(input.path);
    await assertDirectory(safePath);
    const relativeFilePath = resolveWorkspaceReviewFilePath(safePath, input.filePath);
    const absoluteFilePath = join(safePath, relativeFilePath);
    if (defaultIgnoreManager.shouldIgnore(absoluteFilePath)) {
      throw new Error(
        `Access denied: file "${absoluteFilePath}" is protected by agentignore rules`,
      );
    }

    const diff = await getWorkspaceReviewDiff(safePath, relativeFilePath);
    return {
      path: safePath,
      filePath: relativeFilePath,
      diff,
    };
  },
};

export const workspaceWriteFileTool: ToolDefinition<
  typeof workspaceWriteFileInputSchema,
  typeof workspaceWriteFileOutputSchema
> = {
  name: 'workspace_write_file',
  description: 'Overwrite an existing workspace file with UTF-8 text content.',
  inputSchema: workspaceWriteFileInputSchema,
  outputSchema: workspaceWriteFileOutputSchema,
  timeout: 10000,
  execute: async (input) => {
    const safePath = assertWritableWorkspacePath(input.path, 'file');
    await assertFile(safePath);
    const previousContent = await fsp.readFile(safePath, 'utf8');
    await fsp.writeFile(safePath, input.content, 'utf8');
    return {
      before: previousContent,
      after: input.content,
      created: false,
      filediff: buildFileDiff({ file: safePath, before: previousContent, after: input.content }),
      success: true,
      path: safePath,
      bytes: input.content.length,
    };
  },
};

export const writeTool: ToolDefinition<typeof writeInputSchema, typeof writeOutputSchema> = {
  name: 'write',
  description:
    'Write UTF-8 text into a workspace file, creating it when it does not exist and overwriting it when it already exists. Read the file first before modifying existing content.',
  inputSchema: writeInputSchema,
  outputSchema: writeOutputSchema,
  timeout: workspaceWriteFileTool.timeout,
  execute: async (input, signal) => {
    const safePath = assertWritableWorkspacePath(input.path, 'file');
    const stat = await fsp.stat(safePath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }

      throw error;
    });

    if (stat) {
      if (!stat.isFile()) {
        throw new Error(`Path is not a file: ${safePath}`);
      }

      return workspaceWriteFileTool.execute({ path: safePath, content: input.content }, signal);
    }

    return workspaceCreateFileTool.execute({ path: safePath, content: input.content }, signal);
  },
};

export const workspaceCreateFileTool: ToolDefinition<
  typeof workspaceCreateFileInputSchema,
  typeof workspaceCreateFileOutputSchema
> = {
  name: 'workspace_create_file',
  description: 'Create a new workspace file if it does not already exist.',
  inputSchema: workspaceCreateFileInputSchema,
  outputSchema: workspaceCreateFileOutputSchema,
  timeout: 10000,
  execute: async (input) => {
    const safePath = assertWritableWorkspacePath(input.path, 'file');
    const parentPath = resolve(join(safePath, '..'));
    const parentStat = await fsp.stat(parentPath);
    if (!parentStat.isDirectory()) {
      throw new Error(`Parent directory is invalid: ${parentPath}`);
    }

    const handle = await fsp.open(safePath, 'wx');
    try {
      await handle.writeFile(input.content, 'utf8');
    } finally {
      await handle.close();
    }

    return {
      before: '',
      after: input.content,
      created: true,
      filediff: buildFileDiff({ file: safePath, before: '', after: input.content }),
      success: true,
      path: safePath,
      bytes: input.content.length,
    };
  },
};

export const workspaceCreateDirectoryTool: ToolDefinition<
  typeof workspaceCreateDirectoryInputSchema,
  typeof workspaceCreateDirectoryOutputSchema
> = {
  name: 'workspace_create_directory',
  description: 'Create a new directory inside the workspace when the parent already exists.',
  inputSchema: workspaceCreateDirectoryInputSchema,
  outputSchema: workspaceCreateDirectoryOutputSchema,
  timeout: 10000,
  execute: async (input) => {
    const safePath = assertWritableWorkspacePath(input.path, 'directory');
    const parentPath = resolve(join(safePath, '..'));
    const parentStat = await fsp.stat(parentPath);
    if (!parentStat.isDirectory()) {
      throw new Error(`Parent directory is invalid: ${parentPath}`);
    }

    await fsp.mkdir(safePath);
    return {
      success: true,
      path: safePath,
    };
  },
};

export const workspaceReviewRevertTool: ToolDefinition<
  typeof workspaceReviewRevertInputSchema,
  typeof workspaceReviewRevertOutputSchema
> = {
  name: 'workspace_review_revert',
  description: 'Revert a changed file inside the workspace review set back to HEAD.',
  inputSchema: workspaceReviewRevertInputSchema,
  outputSchema: workspaceReviewRevertOutputSchema,
  timeout: 10000,
  execute: async (input) => {
    const safePath = assertSearchablePath(input.path);
    await assertDirectory(safePath);
    const relativeFilePath = resolveWorkspaceReviewFilePath(safePath, input.filePath);
    const absoluteFilePath = join(safePath, relativeFilePath);
    if (defaultIgnoreManager.shouldIgnore(absoluteFilePath)) {
      throw new Error(
        `Access denied: file "${absoluteFilePath}" is protected by agentignore rules`,
      );
    }

    await revertWorkspaceReviewPath(safePath, relativeFilePath);
    return {
      ok: true,
      path: safePath,
      filePath: relativeFilePath,
    };
  },
};

export const WORKSPACE_TOOL_NAMES = [
  workspaceTreeTool.name,
  listTool.name,
  workspaceReadFileTool.name,
  readTool.name,
  globTool.name,
  workspaceSearchTool.name,
  grepTool.name,
  workspaceReviewStatusTool.name,
  workspaceReviewDiffTool.name,
  workspaceWriteFileTool.name,
  writeTool.name,
  workspaceCreateFileTool.name,
  workspaceCreateDirectoryTool.name,
  workspaceReviewRevertTool.name,
] as const;
