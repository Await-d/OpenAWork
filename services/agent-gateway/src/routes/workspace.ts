import { promises as fsp, type Dirent, type Stats } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import {
  WORKSPACE_ACCESS_MODE,
  WORKSPACE_ACCESS_RESTRICTED,
  WORKSPACE_BROWSER_ROOT,
  WORKSPACE_ROOT,
  WORKSPACE_ROOTS,
} from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  validateWorkspacePath,
  validateWorkspaceRelativePath,
  isPathWithinRoot,
} from '../workspace/workspace-paths.js';
import { ensureIgnoreRulesLoadedForPath } from '../workspace/workspace-safety.js';
import { isPathInUserAllowlist } from '../workspace/user-workspace-allowlist.js';
import {
  getWorkspaceReviewDiff,
  listWorkspaceReviewChanges,
  revertWorkspaceReviewPath,
} from '../workspace/workspace-review.js';

/**
 * Reject workspace operations that target a path outside the user's
 * registered workspace set. Used as a second-level check on top of
 * `validateWorkspacePath` (which only enforces the global
 * `WORKSPACE_ROOTS` whitelist) to prevent one logged-in user from
 * reading another user's project just because both happen to live
 * under the same root. Returns true when access is allowed.
 */
function checkUserWorkspaceAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  safePath: string,
): boolean {
  // In unrestricted mode the global WORKSPACE_ROOTS check (via
  // validateWorkspacePath) is sufficient — the per-user allowlist
  // only makes sense when access IS restricted and multiple users
  // share the same root.
  if (!WORKSPACE_ACCESS_RESTRICTED) {
    return true;
  }
  const user = request.user as JwtPayload | undefined;
  if (!user?.sub) {
    reply.status(401).send({ error: '未授权或登录已失效。' });
    return false;
  }
  if (!isPathInUserAllowlist(user.sub, safePath)) {
    reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.userWorkspaceForbidden });
    return false;
  }
  return true;
}

interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

const WORKSPACE_ERROR_MESSAGES = {
  forbiddenPath: '工作区路径不在允许范围内。',
  forbiddenWorkspaceRoot: '指定的工作区根目录不在允许范围内。',
  pathOutsideWorkspace: '目标路径超出当前工作区范围。',
  forbiddenByIgnoreRules: '目标路径已被工作区忽略规则拦截。',
  userWorkspaceForbidden: '当前账号无权访问该工作区路径。',
  pathNotDirectory: '目标路径不是文件夹。',
  pathDoesNotExist: '目标路径不存在。',
  fileNotFound: '目标文件不存在。',
  pathNotFile: '目标路径不是文件。',
  fileTooLargeForPreview: '文件体积超过预览限制，暂不支持预览。',
  fileWriteFailed: '写入文件失败。',
  parentDirectoryInvalid: '父目录无效。',
  parentDirectoryNotFound: '父目录不存在。',
  fileAlreadyExists: '目标文件已存在。',
  targetPathIsDirectory: '目标路径是文件夹，无法创建文件。',
  createFileFailed: '创建文件失败。',
  directoryAlreadyExists: '目标文件夹已存在。',
  createDirectoryFailed: '创建文件夹失败。',
  invalidReviewFilePath: '目标文件路径无效。',
} as const;

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
    if (defaultIgnoreManager.shouldIgnore(fullPath)) continue;
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
      const parsed = parseQuery(schema, request.query);
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          valid: false,
          path: parsed.path,
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);
      if (defaultIgnoreManager.shouldIgnore(safePath)) {
        step.fail('ignored path');
        return reply.status(403).send({
          valid: false,
          path: safePath,
          error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules,
        });
      }
      await ensureIgnoreRulesLoadedForPath(safePath);

      const statStep = child('stat');
      try {
        const stat = await fsp.stat(safePath);
        if (!stat.isDirectory()) {
          statStep.fail('not a directory');
          step.succeed(undefined, { valid: false });
          return reply.send({
            valid: false,
            path: safePath,
            error: WORKSPACE_ERROR_MESSAGES.pathNotDirectory,
          });
        }
        statStep.succeed(undefined, { isDirectory: true });
        step.succeed(undefined, { valid: true });
        return reply.send({ valid: true, path: safePath });
      } catch {
        statStep.fail('path does not exist');
        step.succeed(undefined, { valid: false });
        return reply.send({
          valid: false,
          path: safePath,
          error: WORKSPACE_ERROR_MESSAGES.pathDoesNotExist,
        });
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
      const parsed = parseQuery(schema, request.query);
      parseStep.succeed(undefined, { depth: parsed.depth });

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          nodes: [],
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);
      if (defaultIgnoreManager.shouldIgnore(safePath)) {
        step.fail('ignored path');
        return reply.status(403).send({
          nodes: [],
          error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules,
        });
      }
      await ensureIgnoreRulesLoadedForPath(safePath);

      const statStep = child('stat');
      try {
        const stat = await fsp.stat(safePath);
        if (!stat.isDirectory()) {
          statStep.fail('not a directory');
          step.fail('not a directory');
          return reply.status(400).send({
            nodes: [],
            error: WORKSPACE_ERROR_MESSAGES.pathNotDirectory,
          });
        }
        statStep.succeed(undefined, { isDirectory: true });
      } catch {
        statStep.fail('path not found');
        step.fail('path not found');
        return reply.status(404).send({
          nodes: [],
          error: WORKSPACE_ERROR_MESSAGES.pathDoesNotExist,
        });
      }

      const readStep = child('read-tree', undefined, {
        depth: parsed.depth,
        maxDepth: MAX_DEPTH,
        maxEntries: MAX_ENTRIES,
      });
      const counter = { count: 0 };
      const nodes = await readTree(safePath, parsed.depth, counter);
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
      const schema = z.object({
        path: z.string(),
        // Optional caller-supplied workspace boundary. When present
        // the requested file MUST live under this root, not just
        // under any allowed WORKSPACE_ROOT. Front-end callers should
        // always supply the user's active workspace root so opening
        // a file in chat / file tree / search hit can never leak a
        // file from a sibling project that the same login also
        // happens to own. The server still applies its own root
        // safety check on top, so a client that omits this parameter
        // (e.g. legacy code paths) keeps working.
        workspaceRoot: z.string().optional(),
      });

      const parseStep = child('parse-query');
      const parsed = parseQuery(schema, request.query);
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      // Caller-supplied root narrows the safe set to that one root.
      // We resolve + validate the root the same way so a malformed /
      // non-workspace root is rejected before being used for the
      // prefix check.
      if (parsed.workspaceRoot !== undefined) {
        const safeRoot = validateWorkspacePath(parsed.workspaceRoot);
        if (!safeRoot) {
          pathStep.fail('forbidden workspace root');
          step.fail('forbidden workspace root');
          return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenWorkspaceRoot });
        }
        if (!isPathWithinRoot(safePath, safeRoot)) {
          pathStep.fail('path outside workspace root');
          step.fail('path outside workspace root');
          return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.pathOutsideWorkspace });
        }
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);
      if (defaultIgnoreManager.shouldIgnore(safePath)) {
        step.fail('ignored path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules });
      }

      const statStep = child('stat');
      let stat: Stats;
      try {
        stat = await fsp.stat(safePath);
      } catch {
        statStep.fail('file not found');
        step.fail('file not found');
        return reply.status(404).send({ error: WORKSPACE_ERROR_MESSAGES.fileNotFound });
      }

      if (!stat.isFile()) {
        statStep.fail('not a file');
        step.fail('not a file');
        return reply.status(400).send({ error: WORKSPACE_ERROR_MESSAGES.pathNotFile });
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

  /**
   * GET /workspace/file/binary?path=&workspaceRoot=
   *
   * Returns the file as raw bytes with a guessed Content-Type.
   * Distinct from /workspace/file (which utf-8-decodes into a JSON
   * string field) — needed for binary previewables like .docx,
   * .xlsx, .pdf where any decode would corrupt the bytes.
   *
   * Same workspace + user allowlist + ignore-rules safety as the
   * text endpoint. Size capped at MAX_FILE_BYTES so a malicious
   * user can't pull GB-sized files.
   */
  app.get(
    '/workspace/file/binary',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'workspace.file.get-binary');
      const schema = z.object({
        path: z.string(),
        workspaceRoot: z.string().optional(),
      });
      const parsed = parseQuery(schema, request.query);

      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      if (parsed.workspaceRoot !== undefined) {
        const safeRoot = validateWorkspacePath(parsed.workspaceRoot);
        if (!safeRoot || !isPathWithinRoot(safePath, safeRoot)) {
          step.fail('path outside workspace root');
          return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.pathOutsideWorkspace });
        }
      }
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);
      if (defaultIgnoreManager.shouldIgnore(safePath)) {
        step.fail('ignored path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules });
      }

      let stat: Stats;
      try {
        stat = await fsp.stat(safePath);
      } catch {
        step.fail('file not found');
        return reply.status(404).send({ error: WORKSPACE_ERROR_MESSAGES.fileNotFound });
      }
      if (!stat.isFile()) {
        step.fail('not a file');
        return reply.status(400).send({ error: WORKSPACE_ERROR_MESSAGES.pathNotFile });
      }
      if (stat.size > MAX_FILE_BYTES) {
        step.fail('file too large');
        return reply.status(413).send({ error: WORKSPACE_ERROR_MESSAGES.fileTooLargeForPreview });
      }

      const ext = (safePath.split('.').pop() ?? '').toLowerCase();
      const contentType =
        ext === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : ext === 'xlsx'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : ext === 'pptx'
              ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
              : ext === 'pdf'
                ? 'application/pdf'
                : ext === 'doc'
                  ? 'application/msword'
                  : ext === 'xls'
                    ? 'application/vnd.ms-excel'
                    : 'application/octet-stream';

      const fd = await fsp.open(safePath, 'r');
      try {
        const buffer = Buffer.alloc(stat.size);
        await fd.read(buffer, 0, buffer.length, 0);
        step.succeed(undefined, { bytesRead: buffer.length, contentType });
        reply.header('Content-Type', contentType);
        reply.header('Content-Length', String(buffer.length));
        // Cache-Control: short cache so repeated previews of the
        // same file (e.g. switching between tabs) don't re-fetch.
        reply.header('Cache-Control', 'private, max-age=30');
        return reply.send(buffer);
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
      const parsed = parseBody(schema, request.body);
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      await ensureIgnoreRulesLoadedForPath(safePath);
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

      const writeStep = child('write');
      try {
        await fsp.writeFile(safePath, parsed.content, 'utf8');
        writeStep.succeed(undefined, { bytes: parsed.content.length });
        step.succeed(undefined, { bytes: parsed.content.length });
        return reply.send({ success: true, path: safePath });
      } catch (err) {
        writeStep.fail(String(err));
        step.fail(String(err));
        return reply.status(500).send({ error: WORKSPACE_ERROR_MESSAGES.fileWriteFailed });
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
      const parsed = parseBody(schema, request.body);
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

      const parentPath = resolve(join(safePath, '..'));
      const parentStep = child('parent-directory');
      try {
        const parentStat = await fsp.stat(parentPath);
        if (!parentStat.isDirectory()) {
          parentStep.fail('parent is not a directory');
          step.fail('parent is not a directory');
          return reply.status(400).send({ error: WORKSPACE_ERROR_MESSAGES.parentDirectoryInvalid });
        }
        parentStep.succeed();
      } catch {
        parentStep.fail('parent directory not found');
        step.fail('parent directory not found');
        return reply.status(404).send({ error: WORKSPACE_ERROR_MESSAGES.parentDirectoryNotFound });
      }

      const writeStep = child('create-file');
      try {
        const handle = await fsp.open(safePath, 'wx');
        try {
          await handle.writeFile(parsed.content, 'utf8');
        } finally {
          await handle.close();
        }
        writeStep.succeed(undefined, { bytes: parsed.content.length });
        step.succeed(undefined, { bytes: parsed.content.length });
        return reply.send({ success: true, path: safePath });
      } catch (error) {
        if (error instanceof Error && 'code' in error) {
          const code = String(error.code);
          if (code === 'EEXIST') {
            writeStep.fail('file already exists');
            step.fail('file already exists');
            return reply.status(409).send({ error: WORKSPACE_ERROR_MESSAGES.fileAlreadyExists });
          }

          if (code === 'EISDIR') {
            writeStep.fail('path is a directory');
            step.fail('path is a directory');
            return reply
              .status(400)
              .send({ error: WORKSPACE_ERROR_MESSAGES.targetPathIsDirectory });
          }
        }

        writeStep.fail(String(error));
        step.fail(String(error));
        return reply.status(500).send({ error: WORKSPACE_ERROR_MESSAGES.createFileFailed });
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
      const parsed = parseBody(schema, request.body);
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

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
            return reply
              .status(409)
              .send({ error: WORKSPACE_ERROR_MESSAGES.directoryAlreadyExists });
          }

          if (code === 'ENOENT') {
            mkdirStep.fail('parent directory not found');
            step.fail('parent directory not found');
            return reply
              .status(404)
              .send({ error: WORKSPACE_ERROR_MESSAGES.parentDirectoryNotFound });
          }
        }

        mkdirStep.fail(String(error));
        step.fail(String(error));
        return reply.status(500).send({ error: WORKSPACE_ERROR_MESSAGES.createDirectoryFailed });
      }
    },
  );

  app.get(
    '/workspace/review/status',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.review.status');
      const schema = z.object({ path: z.string() });
      const parsed = parseQuery(schema, request.query);

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          changes: [],
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

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
      const parsed = parseQuery(schema, request.query);

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          diff: '',
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }

      const relativeFilePath = validateWorkspaceRelativePath(safePath, parsed.filePath);
      if (!relativeFilePath) {
        pathStep.fail('invalid filePath');
        step.fail('invalid filePath');
        return reply.status(400).send({
          diff: '',
          error: WORKSPACE_ERROR_MESSAGES.invalidReviewFilePath,
        });
      }
      if (defaultIgnoreManager.shouldIgnore(join(safePath, relativeFilePath))) {
        step.fail('ignored path');
        return reply.status(403).send({
          diff: '',
          error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

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
      const parsed = parseBody(schema, request.body);

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          ok: false,
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      await ensureIgnoreRulesLoadedForPath(safePath);

      const relativeFilePath = validateWorkspaceRelativePath(safePath, parsed.filePath);
      if (!relativeFilePath) {
        pathStep.fail('invalid filePath');
        step.fail('invalid filePath');
        return reply.status(400).send({
          ok: false,
          error: WORKSPACE_ERROR_MESSAGES.invalidReviewFilePath,
        });
      }
      if (defaultIgnoreManager.shouldIgnore(join(safePath, relativeFilePath))) {
        step.fail('ignored path');
        return reply.status(403).send({
          ok: false,
          error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

      const revertStep = child('revert');
      await revertWorkspaceReviewPath(safePath, relativeFilePath);
      revertStep.succeed(undefined, { filePath: relativeFilePath });
      step.succeed(undefined, { filePath: relativeFilePath });
      return reply.send({ ok: true });
    },
  );

  app.get(
    '/workspace/find-by-name',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Resolve a bare filename (e.g. `create_quotation.py`) to all
      // file paths under `path` whose basename matches. Distinct from
      // `/workspace/search` which is a content grep — for "user clicked
      // a filename in chat, find the actual file" we need a basename
      // lookup, not a content lookup.
      //
      // Returns up to `maxResults` matches. Callers (notably the chat
      // path-ref click handler) should prefer the shortest path among
      // exact basename matches when multiple are returned.
      const { step, child } = startRequestWorkflow(request, 'workspace.find-by-name');
      const schema = z.object({
        name: z.string().min(1),
        path: z.string(),
        maxResults: z.coerce.number().int().min(1).max(50).default(8),
      });
      const parsed = parseQuery(schema, request.query);
      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        step.fail('forbidden path');
        return reply.status(403).send({
          results: [],
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);

      const { name, maxResults } = parsed;
      const results: Array<{ path: string }> = [];
      const scanStep = child('scan', undefined, { maxResults });

      async function walk(dirPath: string): Promise<void> {
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
          if (defaultIgnoreManager.shouldIgnore(fullPath)) continue;
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile() && entry.name === name) {
            results.push({ path: fullPath });
          }
        }
      }

      await walk(safePath);
      scanStep.succeed(undefined, { results: results.length });
      step.succeed(undefined, { results: results.length });
      return reply.send({ results });
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
      const parsed = parseQuery(schema, request.query);
      parseStep.succeed(undefined, { maxResults: parsed.maxResults });

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePath(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          results: [],
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);

      const { maxResults, q } = parsed;
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
          if (defaultIgnoreManager.shouldIgnore(fullPath)) continue;
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
