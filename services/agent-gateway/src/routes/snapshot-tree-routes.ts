/**
 * Snapshot Tree Routes
 * ────────────────────
 *
 * 暴露基于 shadow git 的精细化恢复 API：
 *
 *  GET  /sessions/:sessionId/snapshot-trees                 列出 session 的所有 tree
 *  GET  /sessions/:sessionId/snapshot-trees/:treeHash       查看单个 tree 的详情
 *  POST /sessions/:sessionId/restore/to-tree                恢复到指定 tree（preview / apply）
 *
 * 这些路由是新建的，与现有的 /restore/preview & /restore/apply 共存。
 * 设计文档：docs/design/ultra-file-change-tracking.md
 */

import { promises as fsp } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseParams } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { sqliteGet } from '../infra/db.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { resolveSessionWorkspacePath } from '../session/session-workspace-resolution.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { buildFileDiff } from '../tools/file-diff-format.js';
import { getSnapshotEngine } from '../snapshot/snapshot-engine.js';
import {
  getSnapshotTreeByHash,
  getSnapshotTreeAtOrBefore,
  listSnapshotFileEntries,
  listSnapshotTreesForRequest,
  listSnapshotTreesForSession,
  persistSnapshotTree,
  traceSnapshotTreeChain,
} from '../snapshot/snapshot-tree-store.js';

// ─── 路径与 schema ──────────────────────────────────────────────────────

const sessionIdParamsSchema = z.object({
  sessionId: z.string().min(1),
});

const treeHashParamsSchema = z.object({
  sessionId: z.string().min(1),
  treeHash: z.string().min(7).max(128),
});

const restoreToTreeSchema = z.object({
  treeHash: z.string().min(7).max(128),
  mode: z.enum(['preview', 'apply']).default('preview'),
  files: z.array(z.string().min(1)).optional(),
  deleteMissing: z.boolean().optional().default(false),
});

const cherryPickRestoreSchema = z.object({
  /** 要保留的快照 hash 列表（按时间从旧到新排列） */
  keep: z.array(z.string().min(7).max(128)).min(1),
  /** 要回滚的快照 hash 列表 */
  revert: z.array(z.string().min(7).max(128)).min(1),
  mode: z.enum(['preview', 'apply']).default('preview'),
  deleteMissing: z.boolean().optional().default(false),
});

const restoreAtTimeSchema = z.object({
  /** ISO 8601 UTC timestamp (e.g. "2025-05-20 14:30:00") */
  timestamp: z.string().min(10).max(30),
  mode: z.enum(['preview', 'apply']).default('preview'),
  files: z.array(z.string().min(1)).optional(),
  deleteMissing: z.boolean().optional().default(false),
});

const restoreFromSessionSchema = z.object({
  /** 源 session ID */
  sourceSessionId: z.string().min(1),
  /** 源 session 中的 tree hash */
  treeHash: z.string().min(7).max(128),
  mode: z.enum(['preview', 'apply']).default('preview'),
  files: z.array(z.string().min(1)).optional(),
  deleteMissing: z.boolean().optional().default(false),
});

type SnapshotTreeRouteErrorCode =
  | 'session_not_found'
  | 'tree_not_found'
  | 'workspace_root_unavailable'
  | 'shadow_git_unavailable'
  | 'restore_failed'
  | 'no_snapshot_at_time'
  | 'source_session_not_found'
  | 'source_tree_not_found'
  | 'workspace_mismatch';

const SNAPSHOT_TREE_ROUTE_ERROR_MESSAGES: Record<SnapshotTreeRouteErrorCode, string> = {
  session_not_found: '目标会话不存在。',
  tree_not_found: '目标快照树不存在。',
  workspace_root_unavailable: '当前会话未绑定可用工作区，无法执行快照恢复。',
  shadow_git_unavailable: '当前会话未启用 shadow git，无法执行快照树恢复。',
  restore_failed: '执行快照恢复失败。',
  no_snapshot_at_time: '指定时间点之前没有可用快照。',
  source_session_not_found: '源会话不存在。',
  source_tree_not_found: '源会话中的快照树不存在。',
  workspace_mismatch: '源会话与目标会话的工作区不一致，无法跨会话恢复。',
};

function snapshotTreeRouteErrorPayload(
  code: SnapshotTreeRouteErrorCode,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    error: SNAPSHOT_TREE_ROUTE_ERROR_MESSAGES[code],
    code,
    ...(extra ?? {}),
  };
}

// ─── 工具：解析 session 与 workspace ────────────────────────────────────

interface SessionRow {
  user_id: string;
  metadata_json: string;
}

function loadSessionRow(sessionId: string, userId: string): SessionRow | null {
  return (
    sqliteGet<SessionRow>(
      'SELECT user_id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
      [sessionId, userId],
    ) ?? null
  );
}

function resolveWorkspaceRoot(
  metadataJson: string,
  options?: { sessionId?: string; userId?: string },
): string | null {
  // 先尝试直接读取当前 session 的 workingDirectory
  const metadata = parseSessionMetadataJson(metadataJson);
  const value = metadata['workingDirectory'];
  if (typeof value === 'string' && value.length > 0) {
    // Defense in depth: only accept paths within the gateway's allowlist.
    return validateWorkspacePath(value);
  }

  // 当前 session 没有 workingDirectory 时，递归向上查找父 session 链
  if (options?.sessionId && options?.userId) {
    const resolved = resolveSessionWorkspacePath({
      metadataJson,
      sessionId: options.sessionId,
      userId: options.userId,
    });
    if (resolved) {
      return validateWorkspacePath(resolved);
    }
  }

  return null;
}

async function readWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<{ content: string; exists: boolean }> {
  const safeAbsolute = isAbsolute(relativePath)
    ? validateWorkspacePath(relativePath)
    : validateWorkspacePath(resolve(join(workspaceRoot, relativePath)));
  if (!safeAbsolute) return { content: '', exists: false };
  try {
    return { content: await fsp.readFile(safeAbsolute, 'utf8'), exists: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { content: '', exists: false };
    }
    // Per-file resilience: these reads feed snapshot preview diffs and the
    // restore audit log, and run inside `Promise.all(targetFiles.map(...))`.
    // A single unreadable file (EACCES / EISDIR / EIO / ELOOP) used to reject
    // the whole batch — failing the entire multi-file preview, or 500ing an
    // ALREADY-APPLIED restore during after-state reads. The actual git restore
    // (`restoreSelective`) does not depend on these reads, so degrade an
    // unreadable file to "absent" (same shape as ENOENT) + warn instead of
    // throwing, so one bad file can't blank or fail the whole operation.
    console.warn(
      `[snapshot-tree] 工作区文件读取失败（${code ?? 'unknown'}），按缺失处理：${relativePath}`,
    );
    return { content: '', exists: false };
  }
}

// ─── 路由插件 ───────────────────────────────────────────────────────────

export async function snapshotTreeRoutes(app: FastifyInstance): Promise<void> {
  // ── 列表：session 维度 ──────────────────────────────────────────────
  app.get(
    '/sessions/:sessionId/snapshot-trees',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'snapshot-trees.list');
      const user = request.user as JwtPayload;
      const userId = user.sub;
      const params = parseParams(sessionIdParamsSchema, request.params);

      const session = loadSessionRow(params.sessionId, userId);
      if (!session) {
        step.fail(undefined, { reason: 'session_not_found' });
        return reply.status(404).send(snapshotTreeRouteErrorPayload('session_not_found'));
      }

      const requestQueryRaw =
        typeof (request.query as Record<string, unknown> | undefined)?.['clientRequestId'] ===
        'string'
          ? ((request.query as Record<string, string>)['clientRequestId'] as string)
          : undefined;

      const trees = requestQueryRaw
        ? listSnapshotTreesForRequest({
            sessionId: params.sessionId,
            userId,
            clientRequestId: requestQueryRaw,
          })
        : listSnapshotTreesForSession({ sessionId: params.sessionId, userId });

      step.succeed(undefined, { count: trees.length });
      return reply.send({
        trees: trees.map((tree) => ({
          treeHash: tree.treeHash,
          parentTreeHash: tree.parentTreeHash,
          clientRequestId: tree.clientRequestId,
          scopeKind: tree.scopeKind,
          sourceKind: tree.sourceKind,
          guaranteeLevel: tree.guaranteeLevel,
          filesChanged: tree.filesChanged,
          additions: tree.additions,
          deletions: tree.deletions,
          toolName: tree.toolName,
          toolCallId: tree.toolCallId,
          createdAt: tree.createdAt,
        })),
      });
    },
  );

  // ── 详情：单个 tree ────────────────────────────────────────────────
  app.get(
    '/sessions/:sessionId/snapshot-trees/:treeHash',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'snapshot-trees.detail');
      const user = request.user as JwtPayload;
      const userId = user.sub;
      const params = parseParams(treeHashParamsSchema, request.params);

      const session = loadSessionRow(params.sessionId, userId);
      if (!session) {
        step.fail(undefined, { reason: 'session_not_found' });
        return reply.status(404).send(snapshotTreeRouteErrorPayload('session_not_found'));
      }

      const tree = getSnapshotTreeByHash({
        sessionId: params.sessionId,
        treeHash: params.treeHash,
      });
      if (!tree || tree.userId !== userId) {
        step.fail(undefined, { reason: 'tree_not_found' });
        return reply.status(404).send(snapshotTreeRouteErrorPayload('tree_not_found'));
      }

      const fileEntries = listSnapshotFileEntries(tree.id);
      const chain = traceSnapshotTreeChain({
        sessionId: params.sessionId,
        treeHash: params.treeHash,
      });

      step.succeed(undefined, { files: fileEntries.length, chainDepth: chain.length });
      return reply.send({
        tree: {
          treeHash: tree.treeHash,
          parentTreeHash: tree.parentTreeHash,
          clientRequestId: tree.clientRequestId,
          scopeKind: tree.scopeKind,
          sourceKind: tree.sourceKind,
          guaranteeLevel: tree.guaranteeLevel,
          filesChanged: tree.filesChanged,
          additions: tree.additions,
          deletions: tree.deletions,
          toolName: tree.toolName,
          toolCallId: tree.toolCallId,
          createdAt: tree.createdAt,
        },
        files: fileEntries,
        chain: chain.map((node) => ({
          treeHash: node.treeHash,
          parentTreeHash: node.parentTreeHash,
          scopeKind: node.scopeKind,
          createdAt: node.createdAt,
        })),
      });
    },
  );

  // ── 恢复：to-tree（preview / apply 双模式） ────────────────────────
  app.post(
    '/sessions/:sessionId/restore/to-tree',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'snapshot-trees.restore.to-tree');
      const user = request.user as JwtPayload;
      const userId = user.sub;
      const params = parseParams(sessionIdParamsSchema, request.params);
      const body = parseBody(restoreToTreeSchema, request.body);

      const session = loadSessionRow(params.sessionId, userId);
      if (!session) {
        step.fail(undefined, { reason: 'session_not_found' });
        return reply.status(404).send(snapshotTreeRouteErrorPayload('session_not_found'));
      }

      const workspaceRoot = resolveWorkspaceRoot(session.metadata_json, {
        sessionId: params.sessionId,
        userId,
      });
      if (!workspaceRoot) {
        step.fail(undefined, { reason: 'workspace_root_unavailable' });
        return reply.status(400).send(snapshotTreeRouteErrorPayload('workspace_root_unavailable'));
      }

      const tree = getSnapshotTreeByHash({
        sessionId: params.sessionId,
        treeHash: body.treeHash,
      });
      if (!tree || tree.userId !== userId) {
        step.fail(undefined, { reason: 'tree_not_found' });
        return reply.status(404).send(snapshotTreeRouteErrorPayload('tree_not_found'));
      }

      const engine = getSnapshotEngine();
      if (!(await engine.isShadowGitEnabled())) {
        step.fail(undefined, { reason: 'shadow_git_unavailable' });
        return reply.status(503).send({
          ...snapshotTreeRouteErrorPayload('shadow_git_unavailable'),
          message:
            'This session was not captured with shadow-git, restore-to-tree is not available. Use /restore/apply instead.',
        });
      }

      const targetFiles = body.files ?? listSnapshotFileEntries(tree.id).map((e) => e.filePath);

      // Preview: compute real diffs (current workspace → target snapshot)
      if (body.mode === 'preview') {
        const previewStep = child('preview');
        const previews = await Promise.all(
          targetFiles.map(async (filePath) => {
            const [current, target] = await Promise.all([
              readWorkspaceFile(workspaceRoot, filePath),
              engine.readFileAt({
                workspaceRoot,
                snapshot: { kind: 'git', hash: body.treeHash },
                filePath,
              }),
            ]);
            const targetContent = target ?? '';
            const changed = current.content !== targetContent;
            const diff = changed
              ? buildFileDiff({ file: filePath, before: current.content, after: targetContent })
              : null;
            return {
              filePath,
              currentExists: current.exists,
              targetExists: target !== null,
              changed,
              ...(diff
                ? { additions: diff.additions, deletions: diff.deletions, status: diff.status }
                : {}),
            };
          }),
        );
        const changedCount = previews.filter((p) => p.changed).length;
        previewStep.succeed(undefined, { files: previews.length, changed: changedCount });
        step.succeed(undefined, { mode: 'preview', files: previews.length });
        return reply.send({
          mode: 'preview',
          treeHash: body.treeHash,
          files: previews,
          summary: {
            total: previews.length,
            changed: changedCount,
            additions: previews.reduce((s, p) => s + (p.additions ?? 0), 0),
            deletions: previews.reduce((s, p) => s + (p.deletions ?? 0), 0),
          },
        });
      }

      // Apply: capture before-state for audit, then restore
      const applyStep = child('apply');

      // Read current content for each file so we can produce meaningful diffs
      const beforeStates = await Promise.all(
        targetFiles.map(async (filePath) => ({
          filePath,
          ...(await readWorkspaceFile(workspaceRoot, filePath)),
        })),
      );

      try {
        await engine.restoreSelective({
          workspaceRoot,
          snapshot: { kind: 'git', hash: body.treeHash },
          files: targetFiles,
          deleteMissing: body.deleteMissing,
        });
      } catch (error) {
        applyStep.fail(undefined, {
          reason: 'restore_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        step.fail(undefined, { reason: 'restore_failed' });
        return reply.status(500).send(
          snapshotTreeRouteErrorPayload('restore_failed', {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      }

      // Read after-state and compute real diffs for the audit row
      const afterStates = await Promise.all(
        targetFiles.map(async (filePath) => ({
          filePath,
          ...(await readWorkspaceFile(workspaceRoot, filePath)),
        })),
      );

      const auditDiffs = targetFiles
        .map((filePath, i) => {
          const before = beforeStates[i]?.content ?? '';
          const after = afterStates[i]?.content ?? '';
          return buildFileDiff({ file: filePath, before, after });
        })
        .filter((d) => d.before !== d.after);

      // Capture an auditable post-restore tree to link cause→effect.
      const afterCapture = await engine.capture({ workspaceRoot });
      if (afterCapture.ref.kind === 'git') {
        persistSnapshotTree({
          sessionId: params.sessionId,
          userId,
          treeHash: afterCapture.ref.hash,
          parentTreeHash: tree.treeHash,
          scopeKind: 'restore',
          sourceKind: 'restore_replay',
          guaranteeLevel: afterCapture.guaranteeLevel,
          fileDiffs: auditDiffs,
        });
      }

      applyStep.succeed(undefined, { files: targetFiles.length, changed: auditDiffs.length });
      step.succeed(undefined, { mode: 'apply', files: targetFiles.length });
      return reply.send({
        mode: 'apply',
        treeHash: body.treeHash,
        files: targetFiles,
        changed: auditDiffs.length,
        afterTreeHash: afterCapture.ref.kind === 'git' ? afterCapture.ref.hash : null,
      });
    },
  );

  // ── Cherry-pick 恢复：保留某些 step 的修改，回滚其他 ──────────────
  //
  // 算法：
  //   1. 从 revert 列表中收集所有涉及的文件
  //   2. 对每个文件，在 keep 链中找到它最后一次出现的快照
  //   3. 将该文件恢复到 keep 链中的版本（如果 keep 链中不存在，恢复到 baseline）
  //
  // 这超越了 opencode 和 Claude Code 的能力：它们只能回到某个时间点，
  // 而 cherry-pick 可以"保留 step 3 和 5 的修改，只回滚 step 4"。
  app.post(
    '/sessions/:sessionId/restore/cherry-pick',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'snapshot-trees.restore.cherry-pick');
      const user = request.user as JwtPayload;
      const userId = user.sub;
      const params = parseParams(sessionIdParamsSchema, request.params);
      const body = parseBody(cherryPickRestoreSchema, request.body);

      const session = loadSessionRow(params.sessionId, userId);
      if (!session) {
        step.fail(undefined, { reason: 'session_not_found' });
        return reply.status(404).send(snapshotTreeRouteErrorPayload('session_not_found'));
      }

      const workspaceRoot = resolveWorkspaceRoot(session.metadata_json, {
        sessionId: params.sessionId,
        userId,
      });
      if (!workspaceRoot) {
        step.fail(undefined, { reason: 'workspace_root_unavailable' });
        return reply.status(400).send(snapshotTreeRouteErrorPayload('workspace_root_unavailable'));
      }

      const engine = getSnapshotEngine();
      if (!(await engine.isShadowGitEnabled())) {
        step.fail(undefined, { reason: 'shadow_git_unavailable' });
        return reply.status(503).send(snapshotTreeRouteErrorPayload('shadow_git_unavailable'));
      }

      // Validate all referenced trees exist and belong to this user/session
      const allHashes = [...body.keep, ...body.revert];
      for (const hash of allHashes) {
        const tree = getSnapshotTreeByHash({ sessionId: params.sessionId, treeHash: hash });
        if (!tree || tree.userId !== userId) {
          step.fail(undefined, { reason: 'tree_not_found', treeHash: hash });
          return reply
            .status(404)
            .send(snapshotTreeRouteErrorPayload('tree_not_found', { treeHash: hash }));
        }
      }

      // Step 1: Collect all files affected by the revert set
      const revertFiles = new Set<string>();
      for (const hash of body.revert) {
        const tree = getSnapshotTreeByHash({ sessionId: params.sessionId, treeHash: hash });
        if (!tree) continue;
        const entries = listSnapshotFileEntries(tree.id);
        entries.forEach((e) => revertFiles.add(e.filePath));
      }

      if (revertFiles.size === 0) {
        step.succeed(undefined, { mode: body.mode, files: 0, reason: 'no_files_to_revert' });
        return reply.send({
          mode: body.mode,
          files: [],
          changed: 0,
          message: '当前回退集合未命中任何文件，无需恢复。',
        });
      }

      // Step 2: For each file, find its target state from the keep chain
      // (last snapshot in keep that touches this file → use that version)
      const targetStates = new Map<string, { hash: string; filePath: string }>();
      for (const filePath of revertFiles) {
        let targetHash: string | null = null;
        // Walk keep list from newest to oldest to find the last version
        for (let i = body.keep.length - 1; i >= 0; i--) {
          const keepHash = body.keep[i]!;
          const tree = getSnapshotTreeByHash({ sessionId: params.sessionId, treeHash: keepHash });
          if (!tree) continue;
          const entries = listSnapshotFileEntries(tree.id);
          if (entries.some((e) => e.filePath === filePath)) {
            targetHash = keepHash;
            break;
          }
        }
        // If no keep snapshot touches this file, use the first keep hash as baseline
        targetStates.set(filePath, {
          hash: targetHash ?? body.keep[0]!,
          filePath,
        });
      }

      const targetFiles = Array.from(targetStates.keys());

      // Preview mode: compute diffs without writing
      if (body.mode === 'preview') {
        const previewStep = child('preview');
        const previews = await Promise.all(
          targetFiles.map(async (filePath) => {
            const target = targetStates.get(filePath)!;
            const [current, targetContent] = await Promise.all([
              readWorkspaceFile(workspaceRoot, filePath),
              engine.readFileAt({
                workspaceRoot,
                snapshot: { kind: 'git', hash: target.hash },
                filePath,
              }),
            ]);
            const after = targetContent ?? '';
            const changed = current.content !== after;
            const diff = changed
              ? buildFileDiff({ file: filePath, before: current.content, after })
              : null;
            return {
              filePath,
              targetHash: target.hash,
              currentExists: current.exists,
              targetExists: targetContent !== null,
              changed,
              ...(diff
                ? { additions: diff.additions, deletions: diff.deletions, status: diff.status }
                : {}),
            };
          }),
        );
        const changedCount = previews.filter((p) => p.changed).length;
        previewStep.succeed(undefined, { files: previews.length, changed: changedCount });
        step.succeed(undefined, { mode: 'preview', files: previews.length });
        return reply.send({
          mode: 'preview',
          files: previews,
          summary: {
            total: previews.length,
            changed: changedCount,
            additions: previews.reduce((s, p) => s + (p.additions ?? 0), 0),
            deletions: previews.reduce((s, p) => s + (p.deletions ?? 0), 0),
          },
          keep: body.keep,
          revert: body.revert,
        });
      }

      // Apply mode: restore each file to its target hash version
      const applyStep = child('apply');

      const beforeStates = await Promise.all(
        targetFiles.map(async (filePath) => ({
          filePath,
          ...(await readWorkspaceFile(workspaceRoot, filePath)),
        })),
      );

      // Group files by target hash for batch restore
      const filesByHash = new Map<string, string[]>();
      for (const [filePath, target] of targetStates) {
        const existing = filesByHash.get(target.hash) ?? [];
        existing.push(filePath);
        filesByHash.set(target.hash, existing);
      }

      try {
        for (const [hash, files] of filesByHash) {
          await engine.restoreSelective({
            workspaceRoot,
            snapshot: { kind: 'git', hash },
            files,
            deleteMissing: body.deleteMissing,
          });
        }
      } catch (error) {
        applyStep.fail(undefined, {
          reason: 'restore_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        step.fail(undefined, { reason: 'restore_failed' });
        return reply.status(500).send(
          snapshotTreeRouteErrorPayload('restore_failed', {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      }

      // Compute audit diffs
      const afterStates = await Promise.all(
        targetFiles.map(async (filePath) => ({
          filePath,
          ...(await readWorkspaceFile(workspaceRoot, filePath)),
        })),
      );

      const auditDiffs = targetFiles
        .map((filePath, i) => {
          const before = beforeStates[i]?.content ?? '';
          const after = afterStates[i]?.content ?? '';
          return buildFileDiff({ file: filePath, before, after });
        })
        .filter((d) => d.before !== d.after);

      // Capture post-restore tree for audit
      const afterCapture = await engine.capture({ workspaceRoot });
      if (afterCapture.ref.kind === 'git') {
        persistSnapshotTree({
          sessionId: params.sessionId,
          userId,
          treeHash: afterCapture.ref.hash,
          parentTreeHash: body.keep[body.keep.length - 1] ?? null,
          scopeKind: 'restore',
          sourceKind: 'restore_replay',
          guaranteeLevel: afterCapture.guaranteeLevel,
          fileDiffs: auditDiffs,
        });
      }

      applyStep.succeed(undefined, { files: targetFiles.length, changed: auditDiffs.length });
      step.succeed(undefined, { mode: 'apply', files: targetFiles.length });
      return reply.send({
        mode: 'apply',
        files: targetFiles,
        changed: auditDiffs.length,
        keep: body.keep,
        revert: body.revert,
        afterTreeHash: afterCapture.ref.kind === 'git' ? afterCapture.ref.hash : null,
      });
    },
  );

  // ── 时间点恢复：恢复到指定时间之前的最近快照 ──────────────────────
  app.post(
    '/sessions/:sessionId/restore/at-time',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'snapshot-trees.restore.at-time');
      const user = request.user as JwtPayload;
      const userId = user.sub;
      const params = parseParams(sessionIdParamsSchema, request.params);
      const body = parseBody(restoreAtTimeSchema, request.body);

      const session = loadSessionRow(params.sessionId, userId);
      if (!session) {
        step.fail(undefined, { reason: 'session_not_found' });
        return reply.status(404).send(snapshotTreeRouteErrorPayload('session_not_found'));
      }

      const tree = getSnapshotTreeAtOrBefore({
        sessionId: params.sessionId,
        userId,
        timestamp: body.timestamp,
      });
      if (!tree) {
        step.fail(undefined, { reason: 'no_snapshot_at_time' });
        return reply.status(404).send({
          ...snapshotTreeRouteErrorPayload('no_snapshot_at_time'),
          message: `No snapshot found at or before ${body.timestamp}`,
        });
      }

      // Delegate to the to-tree handler logic by forwarding internally
      // (reuse the same request object with modified body)
      step.succeed(undefined, { resolvedTreeHash: tree.treeHash, timestamp: body.timestamp });
      const forwardedBody = {
        treeHash: tree.treeHash,
        mode: body.mode,
        ...(body.files ? { files: body.files } : {}),
        deleteMissing: body.deleteMissing,
      };

      // Re-inject as a to-tree call
      const forwarded = await app.inject({
        method: 'POST',
        url: `/sessions/${params.sessionId}/restore/to-tree`,
        payload: forwardedBody,
        headers: request.headers,
      });

      return reply.status(forwarded.statusCode).send(JSON.parse(forwarded.body));
    },
  );

  // ── 跨 session 恢复：从另一个 session 的快照恢复文件 ──────────────
  app.post(
    '/sessions/:sessionId/restore/from-session',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'snapshot-trees.restore.from-session');
      const user = request.user as JwtPayload;
      const userId = user.sub;
      const params = parseParams(sessionIdParamsSchema, request.params);
      const body = parseBody(restoreFromSessionSchema, request.body);

      // Validate target session
      const session = loadSessionRow(params.sessionId, userId);
      if (!session) {
        step.fail(undefined, { reason: 'session_not_found' });
        return reply.status(404).send(snapshotTreeRouteErrorPayload('session_not_found'));
      }

      // Validate source session (must belong to same user)
      const sourceSession = loadSessionRow(body.sourceSessionId, userId);
      if (!sourceSession) {
        step.fail(undefined, { reason: 'source_session_not_found' });
        return reply.status(404).send(snapshotTreeRouteErrorPayload('source_session_not_found'));
      }

      // Validate the tree exists in the source session
      const sourceTree = getSnapshotTreeByHash({
        sessionId: body.sourceSessionId,
        treeHash: body.treeHash,
      });
      if (!sourceTree || sourceTree.userId !== userId) {
        step.fail(undefined, { reason: 'source_tree_not_found' });
        return reply.status(404).send(snapshotTreeRouteErrorPayload('source_tree_not_found'));
      }

      const workspaceRoot = resolveWorkspaceRoot(session.metadata_json, {
        sessionId: params.sessionId,
        userId,
      });
      if (!workspaceRoot) {
        step.fail(undefined, { reason: 'workspace_root_unavailable' });
        return reply.status(400).send(snapshotTreeRouteErrorPayload('workspace_root_unavailable'));
      }

      // Verify source workspace matches target workspace (shadow git is per-workspace)
      const sourceWorkspaceRoot = resolveWorkspaceRoot(sourceSession.metadata_json, {
        sessionId: body.sourceSessionId,
        userId,
      });
      if (sourceWorkspaceRoot !== workspaceRoot) {
        step.fail(undefined, { reason: 'workspace_mismatch' });
        return reply.status(400).send({
          ...snapshotTreeRouteErrorPayload('workspace_mismatch'),
          message:
            'Source and target sessions must share the same workspace root for cross-session restore.',
        });
      }

      const engine = getSnapshotEngine();
      if (!(await engine.isShadowGitEnabled())) {
        step.fail(undefined, { reason: 'shadow_git_unavailable' });
        return reply.status(503).send(snapshotTreeRouteErrorPayload('shadow_git_unavailable'));
      }

      const targetFiles =
        body.files ?? listSnapshotFileEntries(sourceTree.id).map((e) => e.filePath);

      if (body.mode === 'preview') {
        const previewStep = child('preview');
        const previews = await Promise.all(
          targetFiles.map(async (filePath) => {
            const [current, target] = await Promise.all([
              readWorkspaceFile(workspaceRoot, filePath),
              engine.readFileAt({
                workspaceRoot,
                snapshot: { kind: 'git', hash: body.treeHash },
                filePath,
              }),
            ]);
            const targetContent = target ?? '';
            const changed = current.content !== targetContent;
            const diff = changed
              ? buildFileDiff({ file: filePath, before: current.content, after: targetContent })
              : null;
            return {
              filePath,
              currentExists: current.exists,
              targetExists: target !== null,
              changed,
              ...(diff
                ? { additions: diff.additions, deletions: diff.deletions, status: diff.status }
                : {}),
            };
          }),
        );
        const changedCount = previews.filter((p) => p.changed).length;
        previewStep.succeed(undefined, { files: previews.length, changed: changedCount });
        step.succeed(undefined, { mode: 'preview', files: previews.length });
        return reply.send({
          mode: 'preview',
          sourceSessionId: body.sourceSessionId,
          treeHash: body.treeHash,
          files: previews,
          summary: {
            total: previews.length,
            changed: changedCount,
            additions: previews.reduce((s, p) => s + (p.additions ?? 0), 0),
            deletions: previews.reduce((s, p) => s + (p.deletions ?? 0), 0),
          },
        });
      }

      // Apply
      const applyStep = child('apply');
      const beforeStates = await Promise.all(
        targetFiles.map(async (filePath) => ({
          filePath,
          ...(await readWorkspaceFile(workspaceRoot, filePath)),
        })),
      );

      try {
        await engine.restoreSelective({
          workspaceRoot,
          snapshot: { kind: 'git', hash: body.treeHash },
          files: targetFiles,
          deleteMissing: body.deleteMissing,
        });
      } catch (error) {
        applyStep.fail(undefined, {
          reason: 'restore_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        step.fail(undefined, { reason: 'restore_failed' });
        return reply.status(500).send(
          snapshotTreeRouteErrorPayload('restore_failed', {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      }

      const afterStates = await Promise.all(
        targetFiles.map(async (filePath) => ({
          filePath,
          ...(await readWorkspaceFile(workspaceRoot, filePath)),
        })),
      );

      const auditDiffs = targetFiles
        .map((filePath, i) => {
          const before = beforeStates[i]?.content ?? '';
          const after = afterStates[i]?.content ?? '';
          return buildFileDiff({ file: filePath, before, after });
        })
        .filter((d) => d.before !== d.after);

      // Audit: record in the TARGET session
      const afterCapture = await engine.capture({ workspaceRoot });
      if (afterCapture.ref.kind === 'git') {
        persistSnapshotTree({
          sessionId: params.sessionId,
          userId,
          treeHash: afterCapture.ref.hash,
          parentTreeHash: body.treeHash,
          scopeKind: 'restore',
          sourceKind: 'restore_replay',
          guaranteeLevel: afterCapture.guaranteeLevel,
          fileDiffs: auditDiffs,
        });
      }

      applyStep.succeed(undefined, { files: targetFiles.length, changed: auditDiffs.length });
      step.succeed(undefined, { mode: 'apply', files: targetFiles.length });
      return reply.send({
        mode: 'apply',
        sourceSessionId: body.sourceSessionId,
        treeHash: body.treeHash,
        files: targetFiles,
        changed: auditDiffs.length,
        afterTreeHash: afterCapture.ref.kind === 'git' ? afterCapture.ref.hash : null,
      });
    },
  );
}
