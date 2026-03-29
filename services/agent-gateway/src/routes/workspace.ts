import { promises as fsp, type Dirent, type Stats } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import {
  WORKSPACE_ACCESS_MODE,
  WORKSPACE_ACCESS_RESTRICTED,
  WORKSPACE_BROWSER_ROOT,
  WORKSPACE_ROOT,
  WORKSPACE_ROOTS,
} from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { validateWorkspacePath, validateWorkspaceRelativePath } from '../workspace-paths.js';
import {
  getWorkspaceReviewDiff,
  listWorkspaceReviewChanges,
  revertWorkspaceReviewPath,
} from '../workspace-review.js';

interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

const IGNORED = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.DS_Store']);
const MAX_ENTRIES = 500;
const MAX_DEPTH = 4;
const MAX_FILE_BYTES = 100 * 1024;
const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;

async function readTree(
  dirPath: string,
  depth: number,
  counter: { count: number },
): Promise<FileTreeNode[]> {
  if (depth <= 0 || counter.count >= MAX_ENTRIES) return [];

  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    if (counter.count >= MAX_ENTRIES) break;

    const fullPath = join(dirPath, entry.name);
    const isDirectory = entry.isDirectory();
    counter.count++;

    const node: FileTreeNode = {
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
    if (left.type === right.type) return left.name.localeCompare(right.name);
    return left.type === 'directory' ? -1 : 1;
  });
}

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/workspace/root',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'workspace.root.get');
      const roots = WORKSPACE_ACCESS_RESTRICTED ? WORKSPACE_ROOTS : [WORKSPACE_BROWSER_ROOT];
      const root = WORKSPACE_ACCESS_RESTRICTED ? WORKSPACE_ROOT : WORKSPACE_BROWSER_ROOT;
      step.succeed(undefined, {
        mode: WORKSPACE_ACCESS_MODE,
        restricted: WORKSPACE_ACCESS_RESTRICTED,
        roots: roots.length,
      });
      return reply.send({
        accessMode: WORKSPACE_ACCESS_MODE,
        restricted: WORKSPACE_ACCESS_RESTRICTED,
        root,
        roots,
      });
    },
  );

  app.get(
    '/workspace/validate',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.validate');
      const schema = z.object({ path: z.string() });

      const parseStep = child('parse-query');
      const parsed = schema.safeParse(request.query);
      if (!parsed.success) {
        parseStep.fail('missing path');
        step.fail('missing path');
        return reply.status(400).send({ valid: false, path: '', error: 'Missing path' });
      }
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.data.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ valid: false, path: parsed.data.path, error: 'Forbidden' });
      }
      pathStep.succeed();

      const statStep = child('stat');
      try {
        const stat = await fsp.stat(safePath);
        if (!stat.isDirectory()) {
          statStep.fail('not a directory');
          step.succeed(undefined, { valid: false });
          return reply.send({ valid: false, path: safePath, error: 'Not a directory' });
        }
        statStep.succeed(undefined, { isDirectory: true });
        step.succeed(undefined, { valid: true });
        return reply.send({ valid: true, path: safePath });
      } catch {
        statStep.fail('path does not exist');
        step.succeed(undefined, { valid: false });
        return reply.send({ valid: false, path: safePath, error: 'Path does not exist' });
      }
    },
  );

  app.get(
    '/workspace/tree',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.tree');
      const schema = z.object({
        path: z.string(),
        depth: z.coerce.number().int().min(1).max(MAX_DEPTH).default(2),
      });

      const parseStep = child('parse-query');
      const parsed = schema.safeParse(request.query);
      if (!parsed.success) {
        parseStep.fail('invalid query');
        step.fail('invalid query');
        return reply.status(400).send({ nodes: [] });
      }
      parseStep.succeed(undefined, { depth: parsed.data.depth });

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.data.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ nodes: [] });
      }
      pathStep.succeed();

      const statStep = child('stat');
      try {
        const stat = await fsp.stat(safePath);
        if (!stat.isDirectory()) {
          statStep.fail('not a directory');
          step.fail('not a directory');
          return reply.status(400).send({ nodes: [] });
        }
        statStep.succeed(undefined, { isDirectory: true });
      } catch {
        statStep.fail('path not found');
        step.fail('path not found');
        return reply.status(404).send({ nodes: [] });
      }

      const readStep = child('read-tree', undefined, {
        depth: parsed.data.depth,
        maxDepth: MAX_DEPTH,
        maxEntries: MAX_ENTRIES,
      });
      const counter = { count: 0 };
      const nodes = await readTree(safePath, parsed.data.depth, counter);
      readStep.succeed(undefined, { returnedNodes: nodes.length, visitedEntries: counter.count });
      step.succeed(undefined, { returnedNodes: nodes.length, visitedEntries: counter.count });

      return reply.send({ nodes });
    },
  );

  app.get(
    '/workspace/file',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.file.get');
      const schema = z.object({ path: z.string() });

      const parseStep = child('parse-query');
      const parsed = schema.safeParse(request.query);
      if (!parsed.success) {
        parseStep.fail('missing path');
        step.fail('missing path');
        return reply.status(400).send({ error: 'Missing path' });
      }
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.data.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: 'Forbidden' });
      }
      pathStep.succeed();

      const statStep = child('stat');
      let stat: Stats;
      try {
        stat = await fsp.stat(safePath);
      } catch {
        statStep.fail('file not found');
        step.fail('file not found');
        return reply.status(404).send({ error: 'File not found' });
      }

      if (!stat.isFile()) {
        statStep.fail('not a file');
        step.fail('not a file');
        return reply.status(400).send({ error: 'Not a file' });
      }
      statStep.succeed(undefined, { size: stat.size });

      const truncated = stat.size > MAX_FILE_BYTES;
      const readStep = child('read', undefined, { truncated });
      const fd = await fsp.open(safePath, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES));
        await fd.read(buffer, 0, buffer.length, 0);
        const content = buffer.toString('utf8');
        readStep.succeed(undefined, { bytesRead: buffer.length, truncated });
        step.succeed(undefined, { bytesRead: buffer.length, truncated });
        return reply.send({ path: safePath, content, truncated });
      } finally {
        await fd.close();
      }
    },
  );

  app.put(
    '/workspace/file',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.file.put');
      const schema = z.object({ path: z.string(), content: z.string() });

      const parseStep = child('parse-body');
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        parseStep.fail('invalid body');
        step.fail('invalid body');
        return reply.status(400).send({ error: 'Missing path or content' });
      }
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.data.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: 'Forbidden' });
      }
      pathStep.succeed();

      const writeStep = child('write');
      try {
        await fsp.writeFile(safePath, parsed.data.content, 'utf8');
        writeStep.succeed(undefined, { bytes: parsed.data.content.length });
        step.succeed(undefined, { bytes: parsed.data.content.length });
        return reply.send({ success: true, path: safePath });
      } catch (err) {
        writeStep.fail(String(err));
        step.fail(String(err));
        return reply.status(500).send({ error: 'Write failed' });
      }
    },
  );

  app.post(
    '/workspace/file',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.file.post');
      const schema = z.object({ path: z.string(), content: z.string().default('') });

      const parseStep = child('parse-body');
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        parseStep.fail('invalid body');
        step.fail('invalid body');
        return reply.status(400).send({ error: 'Missing path' });
      }
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.data.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: 'Forbidden' });
      }
      pathStep.succeed();

      const parentPath = resolve(join(safePath, '..'));
      const parentStep = child('parent-directory');
      try {
        const parentStat = await fsp.stat(parentPath);
        if (!parentStat.isDirectory()) {
          parentStep.fail('parent is not a directory');
          step.fail('parent is not a directory');
          return reply.status(400).send({ error: 'Parent directory is invalid' });
        }
        parentStep.succeed();
      } catch {
        parentStep.fail('parent directory not found');
        step.fail('parent directory not found');
        return reply.status(404).send({ error: 'Parent directory not found' });
      }

      const writeStep = child('create-file');
      try {
        const handle = await fsp.open(safePath, 'wx');
        try {
          await handle.writeFile(parsed.data.content, 'utf8');
        } finally {
          await handle.close();
        }
        writeStep.succeed(undefined, { bytes: parsed.data.content.length });
        step.succeed(undefined, { bytes: parsed.data.content.length });
        return reply.send({ success: true, path: safePath });
      } catch (error) {
        if (error instanceof Error && 'code' in error) {
          const code = String(error.code);
          if (code === 'EEXIST') {
            writeStep.fail('file already exists');
            step.fail('file already exists');
            return reply.status(409).send({ error: 'File already exists' });
          }

          if (code === 'EISDIR') {
            writeStep.fail('path is a directory');
            step.fail('path is a directory');
            return reply.status(400).send({ error: 'Target path is a directory' });
          }
        }

        writeStep.fail(String(error));
        step.fail(String(error));
        return reply.status(500).send({ error: 'Create file failed' });
      }
    },
  );

  app.post(
    '/workspace/directory',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.directory.post');
      const schema = z.object({ path: z.string() });

      const parseStep = child('parse-body');
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        parseStep.fail('invalid body');
        step.fail('invalid body');
        return reply.status(400).send({ error: 'Missing path' });
      }
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.data.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: 'Forbidden' });
      }
      pathStep.succeed();

      const mkdirStep = child('mkdir');
      try {
        await fsp.mkdir(safePath);
        mkdirStep.succeed();
        step.succeed();
        return reply.send({ success: true, path: safePath });
      } catch (error) {
        if (error instanceof Error && 'code' in error) {
          const code = String(error.code);
          if (code === 'EEXIST') {
            mkdirStep.fail('directory already exists');
            step.fail('directory already exists');
            return reply.status(409).send({ error: 'Directory already exists' });
          }

          if (code === 'ENOENT') {
            mkdirStep.fail('parent directory not found');
            step.fail('parent directory not found');
            return reply.status(404).send({ error: 'Parent directory not found' });
          }
        }

        mkdirStep.fail(String(error));
        step.fail(String(error));
        return reply.status(500).send({ error: 'Create directory failed' });
      }
    },
  );

  app.get(
    '/workspace/review/status',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.review.status');
      const schema = z.object({ path: z.string() });
      const parsed = schema.safeParse(request.query);
      if (!parsed.success) {
        step.fail('missing path');
        return reply.status(400).send({ changes: [] });
      }

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.data.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ changes: [] });
      }
      pathStep.succeed();

      const readStep = child('list-review-changes');
      const changes = await listWorkspaceReviewChanges(safePath);
      readStep.succeed(undefined, { changes: changes.length });
      step.succeed(undefined, { changes: changes.length });
      return reply.send({ changes });
    },
  );

  app.get(
    '/workspace/review/diff',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.review.diff');
      const schema = z.object({ path: z.string(), filePath: z.string() });
      const parsed = schema.safeParse(request.query);
      if (!parsed.success) {
        step.fail('missing path or filePath');
        return reply.status(400).send({ diff: '' });
      }

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.data.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ diff: '' });
      }

      const relativeFilePath = validateWorkspaceRelativePath(safePath, parsed.data.filePath);
      if (!relativeFilePath) {
        pathStep.fail('invalid filePath');
        step.fail('invalid filePath');
        return reply.status(400).send({ diff: '' });
      }
      pathStep.succeed();

      const diffStep = child('load-diff');
      const diff = await getWorkspaceReviewDiff(safePath, relativeFilePath);
      diffStep.succeed(undefined, { diffLength: diff.length });
      step.succeed(undefined, { diffLength: diff.length });
      return reply.send({ diff });
    },
  );

  app.post(
    '/workspace/review/revert',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.review.revert');
      const schema = z.object({ path: z.string(), filePath: z.string() });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        step.fail('missing path or filePath');
        return reply.status(400).send({ ok: false });
      }

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.data.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ ok: false });
      }

      const relativeFilePath = validateWorkspaceRelativePath(safePath, parsed.data.filePath);
      if (!relativeFilePath) {
        pathStep.fail('invalid filePath');
        step.fail('invalid filePath');
        return reply.status(400).send({ ok: false });
      }
      pathStep.succeed();

      const revertStep = child('revert');
      await revertWorkspaceReviewPath(safePath, relativeFilePath);
      revertStep.succeed(undefined, { filePath: relativeFilePath });
      step.succeed(undefined, { filePath: relativeFilePath });
      return reply.send({ ok: true });
    },
  );

  app.get(
    '/workspace/search',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.search');
      const schema = z.object({
        q: z.string().min(1),
        path: z.string(),
        maxResults: z.coerce.number().int().min(1).max(MAX_SEARCH_RESULTS).default(20),
      });

      const parseStep = child('parse-query');
      const parsed = schema.safeParse(request.query);
      if (!parsed.success) {
        parseStep.fail('missing q or path');
        step.fail('missing q or path');
        return reply.status(400).send({ results: [], error: 'Missing q or path' });
      }
      parseStep.succeed(undefined, { maxResults: parsed.data.maxResults });

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.data.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ results: [] });
      }
      pathStep.succeed();

      const { maxResults, q } = parsed.data;
      const results: Array<{ path: string; line: number; text: string }> = [];
      let scannedFiles = 0;
      let skippedLargeFiles = 0;

      const scanStep = child('scan', undefined, { maxResults });
      async function searchDirectory(dirPath: string): Promise<void> {
        if (results.length >= maxResults) return;

        let entries: Dirent[];
        try {
          entries = await fsp.readdir(dirPath, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (IGNORED.has(entry.name)) continue;

          const fullPath = join(dirPath, entry.name);
          if (entry.isDirectory()) {
            await searchDirectory(fullPath);
          } else if (entry.isFile()) {
            let stat: Stats;
            try {
              stat = await fsp.stat(fullPath);
            } catch {
              continue;
            }

            scannedFiles++;
            if (stat.size > MAX_SEARCH_FILE_BYTES) {
              skippedLargeFiles++;
              continue;
            }

            let content: string;
            try {
              content = await fsp.readFile(fullPath, 'utf8');
            } catch {
              continue;
            }

            const lines = content.split('\n');
            for (let index = 0; index < lines.length && results.length < maxResults; index++) {
              if (lines[index]!.includes(q)) {
                results.push({ path: fullPath, line: index + 1, text: lines[index]!.trim() });
              }
            }
          }
        }
      }

      await searchDirectory(safePath);
      scanStep.succeed(undefined, {
        results: results.length,
        scannedFiles,
        skippedLargeFiles,
      });
      step.succeed(undefined, {
        results: results.length,
        scannedFiles,
        skippedLargeFiles,
      });

      return reply.send({ results });
    },
  );
}
