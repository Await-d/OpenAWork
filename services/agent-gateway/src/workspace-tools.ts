import { promises as fsp, type Dirent, type Stats } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import type { ToolDefinition } from '@openAwork/agent-core';
import type { FileBackupRef } from '@openAwork/shared';
import { z } from 'zod';
import { WORKSPACE_ROOT } from './db.js';
import { ensureIgnoreRulesLoadedForPath } from './workspace-safety.js';
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
import { lspManager } from './lsp/router.js';
import { getPostWriteDiagnostics, postWriteDiagnosticSchema } from './lsp-tools.js';

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

const workspaceReadFileInputSchema = z
  .object({
    path: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (!value.path && !value.filePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either path or filePath is required',
        path: ['path'],
      });
    }
  });

const workspaceReadFileOutputSchema = z.object({
  path: z.string(),
  content: z.string(),
  truncated: z.boolean(),
});

const globInputSchema = z.object({
  path: z.string().min(1).optional(),
  pattern: z.string().min(1),
});

const globOutputSchema = z.string();

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

const readInputSchema = workspaceReadFileInputSchema;
const readOutputSchema = workspaceReadFileOutputSchema;

const globToolInputSchema = globInputSchema;
const globToolOutputSchema = globOutputSchema;

const grepInputSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).optional(),
  include: z.string().min(1).optional(),
  output_mode: z
    .enum(['content', 'files_with_matches', 'count'])
    .optional()
    .default('files_with_matches'),
  head_limit: z.number().int().min(0).max(500).optional().default(0),
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

const workspaceWriteFileInputSchema = z
  .object({
    path: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
    content: z.string(),
  })
  .superRefine((value, context) => {
    if (!value.path && !value.filePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either path or filePath is required',
        path: ['path'],
      });
    }
  });

const workspaceWriteFileOutputSchema = z.object({
  after: z.string(),
  before: z.string(),
  created: z.boolean(),
  filediff: fileDiffSchema,
  success: z.literal(true),
  path: z.string(),
  bytes: z.number().int(),
  diagnostics: z.array(postWriteDiagnosticSchema).optional(),
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
  diagnostics: z.array(postWriteDiagnosticSchema).optional(),
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

function pickPathInput(input: { path?: string; filePath?: string }): string {
  const value = input.path ?? input.filePath;
  if (!value) {
    throw new Error('Either path or filePath is required');
  }
  return value;
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

function globPatternToRegex(pattern: string): RegExp {
  const normalizedPattern = pattern.replace(/\\/g, '/');
  let regex = '^';

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const current = normalizedPattern[index];
    if (!current) {
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
  await ensureIgnoreRulesLoadedForPath(safePath);
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

async function runGlobTool(input: z.infer<typeof globToolInputSchema>) {
  const safePath = assertSearchablePath(input.path ?? WORKSPACE_ROOT);
  await ensureIgnoreRulesLoadedForPath(safePath);
  await assertDirectory(safePath);
  const patternRegex = globPatternToRegex(input.pattern);
  const matches: string[] = [];

  async function walk(dirPath: string): Promise<void> {
    if (matches.length >= MAX_GLOB_MATCHES) {
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
      if (matches.length >= MAX_GLOB_MATCHES) {
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

      const relativePath = fullPath.slice(safePath.length).replace(/^\//u, '').replace(/\\/g, '/');
      if (!patternRegex.test(relativePath)) {
        continue;
      }

      matches.push(fullPath);
    }
  }

  await walk(safePath);

  if (matches.length === 0) {
    return 'No files found';
  }
  return matches.join('\n');
}

async function runCanonicalGrep(input: z.infer<typeof grepInputSchema>) {
  const safePath = assertSearchablePath(input.path ?? WORKSPACE_ROOT);
  await ensureIgnoreRulesLoadedForPath(safePath);
  await assertDirectory(safePath);
  const matcher = new RegExp(input.pattern);
  const includeRegex = input.include ? globPatternToRegex(input.include) : null;
  const matches: Array<{ path: string; line: number; text: string }> = [];
  const counts = new Map<string, number>();

  async function searchDirectory(dirPath: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        input.head_limit > 0 &&
        input.output_mode !== 'count' &&
        matches.length >= input.head_limit
      ) {
        return;
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
      const relativePath = fullPath.slice(safePath.length).replace(/^\//u, '').replace(/\\/g, '/');
      if (includeRegex && !includeRegex.test(relativePath)) {
        continue;
      }
      let stat: Stats;
      try {
        stat = await fsp.stat(fullPath);
      } catch {
        continue;
      }
      if (stat.size > MAX_SEARCH_FILE_BYTES) {
        continue;
      }
      let content: string;
      try {
        content = await fsp.readFile(fullPath, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        const text = lines[index] ?? '';
        if (!matcher.test(text)) {
          continue;
        }
        counts.set(fullPath, (counts.get(fullPath) ?? 0) + 1);
        if (input.output_mode === 'count') {
          continue;
        }
        matches.push({ path: fullPath, line: index + 1, text: text.trim() });
        if (input.head_limit > 0 && matches.length >= input.head_limit) {
          return;
        }
      }
    }
  }

  await searchDirectory(safePath);
  if (input.output_mode === 'count') {
    if (counts.size === 0) {
      return 'No files found';
    }
    return [...counts.entries()].map(([filePath, count]) => `${filePath}: ${count}`).join('\n');
  }
  if (input.output_mode === 'files_with_matches') {
    const files = [...new Set(matches.map((match) => match.path))];
    return files.length > 0 ? files.join('\n') : 'No files found';
  }
  return matches.length > 0
    ? matches.map((match) => `${match.path}:${match.line}: ${match.text}`).join('\n')
    : 'No files found';
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

export const listTool: ToolDefinition<
  typeof workspaceTreeInputSchema,
  typeof workspaceTreeOutputSchema
> = {
  name: 'list',
  description:
    'List files and directories in a workspace path. Use this first to inspect folder structure before reading files. Required JSON input: {"path":"/absolute/workspace/path","depth":2}.',
  inputSchema: workspaceTreeInputSchema,
  outputSchema: workspaceTreeOutputSchema,
  timeout: workspaceTreeTool.timeout,
  execute: async (input, signal) => workspaceTreeTool.execute(input, signal),
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
    const safePath = assertAccessibleWorkspacePath(pickPathInput(input), 'file');
    await ensureIgnoreRulesLoadedForPath(safePath);
    const stat = await assertFile(safePath);
    const truncated = stat.size > MAX_FILE_BYTES;
    const fd = await fsp.open(safePath, 'r');

    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES));
      await fd.read(buffer, 0, buffer.length, 0);
      const result = {
        path: safePath,
        content: buffer.toString('utf8'),
        truncated,
      };
      lspManager.touchFile(safePath, false).catch((_e: unknown) => undefined);
      return result;
    } finally {
      await fd.close();
    }
  },
};

export const readTool: ToolDefinition<typeof readInputSchema, typeof readOutputSchema> = {
  name: 'read',
  description:
    'Read a UTF-8 text file from the workspace. Use list first when you need to inspect folders before choosing a file to read.',
  inputSchema: readInputSchema,
  outputSchema: readOutputSchema,
  timeout: workspaceReadFileTool.timeout,
  execute: async (input, signal) => workspaceReadFileTool.execute(input, signal),
};

export const globTool: ToolDefinition<typeof globToolInputSchema, typeof globToolOutputSchema> = {
  name: 'glob',
  description: 'Fast file pattern matching tool with safety limits (60s timeout, 100 file limit).',
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
  description: 'Fast content search tool with safety limits (60s timeout, 256KB output).',
  inputSchema: grepInputSchema,
  outputSchema: grepOutputSchema,
  timeout: workspaceSearchTool.timeout,
  execute: async (input) => runCanonicalGrep(input),
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
    await ensureIgnoreRulesLoadedForPath(safePath);
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
    await ensureIgnoreRulesLoadedForPath(safePath);
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
  execute: async (input) => executeWorkspaceWriteFile(input),
};

export async function executeWorkspaceWriteFile(
  input: z.infer<typeof workspaceWriteFileInputSchema>,
  options?: {
    beforeWriteBackup?: (input: {
      content: string;
      filePath: string;
    }) => Promise<FileBackupRef | undefined>;
  },
): Promise<z.infer<typeof workspaceWriteFileOutputSchema>> {
  const safePath = assertWritableWorkspacePath(pickPathInput(input), 'file');
  await ensureIgnoreRulesLoadedForPath(safePath);
  await assertFile(safePath);
  const previousContent = await fsp.readFile(safePath, 'utf8');
  const backupBeforeRef = options?.beforeWriteBackup
    ? await options.beforeWriteBackup({
        filePath: safePath,
        content: previousContent,
      })
    : undefined;
  await fsp.writeFile(safePath, input.content, 'utf8');
  lspManager.touchFile(safePath, true).catch((_e: unknown) => undefined);
  const diagnostics = await getPostWriteDiagnostics([safePath]);
  return {
    before: previousContent,
    after: input.content,
    created: false,
    filediff: {
      ...buildFileDiff({ file: safePath, before: previousContent, after: input.content }),
      ...(backupBeforeRef ? { backupBeforeRef } : {}),
    },
    success: true,
    path: safePath,
    bytes: input.content.length,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}

export const writeTool: ToolDefinition<typeof writeInputSchema, typeof writeOutputSchema> = {
  name: 'write',
  description:
    'Write UTF-8 text into a workspace file, creating it when it does not exist and overwriting it when it already exists. Read the file first before modifying existing content.',
  inputSchema: writeInputSchema,
  outputSchema: writeOutputSchema,
  timeout: workspaceWriteFileTool.timeout,
  execute: async (input, signal) => {
    return executeWriteTool(input, signal);
  },
};

export async function executeWriteTool(
  input: z.infer<typeof writeInputSchema>,
  _signal: AbortSignal | undefined,
  options?: {
    beforeWriteBackup?: (input: {
      content: string;
      filePath: string;
    }) => Promise<FileBackupRef | undefined>;
  },
): Promise<z.infer<typeof writeOutputSchema>> {
  const safePath = assertWritableWorkspacePath(pickPathInput(input), 'file');
  await ensureIgnoreRulesLoadedForPath(safePath);
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

    return executeWorkspaceWriteFile({ path: safePath, content: input.content }, options);
  }

  return executeWorkspaceCreateFile({ path: safePath, content: input.content });
}

export const workspaceCreateFileTool: ToolDefinition<
  typeof workspaceCreateFileInputSchema,
  typeof workspaceCreateFileOutputSchema
> = {
  name: 'workspace_create_file',
  description: 'Create a new workspace file if it does not already exist.',
  inputSchema: workspaceCreateFileInputSchema,
  outputSchema: workspaceCreateFileOutputSchema,
  timeout: 10000,
  execute: async (input) => executeWorkspaceCreateFile(input),
};

export async function executeWorkspaceCreateFile(
  input: z.infer<typeof workspaceCreateFileInputSchema>,
): Promise<z.infer<typeof workspaceCreateFileOutputSchema>> {
  const safePath = assertWritableWorkspacePath(input.path, 'file');
  await ensureIgnoreRulesLoadedForPath(safePath);
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

  lspManager.touchFile(safePath, true).catch((_e: unknown) => undefined);
  const diagnostics = await getPostWriteDiagnostics([safePath]);
  return {
    before: '',
    after: input.content,
    created: true,
    filediff: buildFileDiff({ file: safePath, before: '', after: input.content }),
    success: true,
    path: safePath,
    bytes: input.content.length,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}

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
    await ensureIgnoreRulesLoadedForPath(safePath);
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
    await ensureIgnoreRulesLoadedForPath(safePath);
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
