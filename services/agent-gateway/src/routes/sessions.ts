import { randomUUID } from 'crypto';
import { makeOrderedMessageId } from '../infra/ordered-id.js';
import { promises as fsp } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RunEvent } from '@openAwork/shared';
import { trackEvent } from '../telemetry/telemetry-service.js';
import {
  AgentTaskManagerImpl,
  AgentTaskStoreImpl,
  HashAnchoredEditorImpl,
} from '@openAwork/agent-core';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { ApiError } from '../infra/error-response.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { WORKSPACE_ROOT, sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { buildSqlitePlaceholders, chunkSqliteBindValues } from '../infra/sqlite-batch.js';
import { filterVisibleSessionMessages } from '../session/session-message-store.js';
import {
  hydrateLegacySessionMessagesForSearch,
  searchSessionMessages,
} from '../session/session-search-store.js';
import {
  deleteSessionMessageRating,
  hasSessionMessage,
  listSessionMessageRatings,
  upsertSessionMessageRating,
} from '../session/session-message-rating-store.js';
import {
  collectSessionBackupStoragePaths,
  captureBeforeWriteBackup,
  garbageCollectBackupStoragePaths,
  getSessionFileBackup,
  readSessionFileBackupContent,
} from '../session/session-file-backup-store.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { buildFileDiff } from '../tools/file-diff-format.js';
import { registerSessionSharedReadRoutes } from './session-shared-read-routes.js';
import { buildSessionTaskProjection, type SessionTaskResponse } from './session-task-projection.js';
import {
  slimMessagesForRecovery,
  toPublicSessionResponse,
  validateImportedMessagesPayload,
} from './session-route-helpers.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { invalidateUserWorkspaceAllowlist } from '../workspace/user-workspace-allowlist.js';
import { listWorkspaceReviewChangesWithAvailability } from '../workspace/workspace-review.js';
import {
  extractSessionWorkingDirectory,
  isSessionWorkspaceRebindingAttempt,
  mergeSessionMetadataForUpdate,
  normalizeIncomingSessionMetadata,
  parseSessionMetadataJson,
  sanitizeSessionMetadataJson,
  validateSessionMetadataPatch,
} from '../session/session-workspace-metadata.js';
import { filterSessionsByPath } from '../session/session-path-filter.js';
import { listSessionTodoLanes, listSessionTodos } from '../tools/todo-tools.js';
import { terminateChildSession } from '../tools/tool-sandbox.js';
import { clearPendingTaskParentAutoResumesForSession } from '../task/task-parent-auto-resume.js';
import { resetDoomLoopHistory } from '../session/doom-loop-detector.js';
import { clearExternalAccessTracking } from '../workspace/external-directory-guard.js';
import { clearSubstateTrackingForSession } from '../handoff/store/substate-store.js';
import {
  getLatestSessionRunEventSeqByRequest,
  listSessionRunEvents,
  listSessionRunEventsByRequest,
} from '../session/session-run-events.js';
import {
  getAnyInFlightStreamRequestForSession,
  stopAllInFlightStreamRequestsForSession,
} from './stream-cancellation.js';
import { reconcileSessionRuntime } from '../session/session-runtime-reconciler.js';
import { deleteSessionWithMalformedRecovery } from '../session/session-delete-recovery.js';
import {
  buildSessionFileChangesProjection,
  buildSessionTurnDiffReadModel,
} from '../session/session-file-changes-projection.js';
import {
  listRequestFileDiffs,
  listRequestFileDiffsWithText,
  listSessionFileDiffs,
  listSessionFileDiffsWithText,
  persistSessionFileDiffs,
} from '../session/session-file-diff-store.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';
import {
  compareSessionSnapshots,
  createRequestSnapshotRef,
  getSessionSnapshotByRef,
  listRequestSnapshots,
  listSessionSnapshots,
  persistSessionSnapshot,
} from '../session/session-snapshot-store.js';
import {
  getFreshSessionRuntimeThread,
  hasFreshSessionRuntimeThread,
} from '../session/session-runtime-thread-store.js';
import { hasPendingSessionInteraction } from '../session/session-runtime-state.js';
import {
  listSessionMessagesV2,
  listRuntimeSafeSessionMessagesV2,
  truncateSessionMessagesAfterV2 as truncateSessionMessagesAfter,
} from '../message/message-v2-adapter.js';
import { countUserMessages } from '../message/message-store-v2.js';
import { mergeRuntimeSafeSessionMessages } from '../session/runtime-safe-message-merge.js';

const createSessionSchema = z.object({
  metadata: z.record(z.unknown()).optional().default({}),
  workingDirectory: z.string().optional(),
});

export interface SessionRow {
  id: string;
  user_id: string;
  messages_json: string;
  state_status: string;
  paused?: number | null;
  metadata_json: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Team layering parent link. This is a real `sessions` COLUMN (set by
   * `createTeamSession`), deliberately distinct from `metadata.parentSessionId`
   * (the subagent message-tree link). Optional here because most SELECTs in
   * this file don't project it; the session-delete path explicitly does so the
   * deletion tree can follow team children (pm1/pm2/executor/reviewer).
   */
  team_parent_session_id?: string | null;
  /**
   * Team layering semantics (reception/pm1/pm2/executor/reviewer). Real column,
   * projected by the recovery / single-session SELECTs so the team page can
   * render the reception empty-state card + init checklist (which gate on
   * role_layer === 'reception'). Most other SELECTs omit it → optional.
   */
  role_layer?: string | null;
  /** Team L1.3 substate machine position. Real column, optionally projected. */
  substate?: string | null;
}

interface RecoveryPermissionRequestRow {
  created_at: string;
  decision: 'once' | 'session' | 'permanent' | 'reject' | null;
  id: string;
  preview_action: string | null;
  reason: string;
  risk_level: 'low' | 'medium' | 'high';
  scope: string;
  session_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  tool_name: string;
}

interface RecoveryQuestionRequestRow {
  created_at: string;
  id: string;
  questions_json: string;
  session_id: string;
  status: 'pending' | 'answered' | 'dismissed';
  title: string;
  tool_name: string;
}

const snapshotCompareQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  includeText: z
    .preprocess((value) => {
      if (value === undefined) return undefined;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0' || normalized === '') return false;
      }
      return value;
    }, z.boolean().optional())
    .default(false),
});

const fileChangesQuerySchema = z.object({
  includeText: z
    .preprocess((value) => {
      if (value === undefined) return undefined;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0' || normalized === '') return false;
      }
      return value;
    }, z.boolean().optional())
    .default(false),
});

const searchSessionsQuerySchema = z.object({
  limit: z
    .preprocess((value) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        return Number(value);
      }
      return value;
    }, z.number().int().min(1).max(20).optional())
    .default(8),
  q: z.string().trim().min(1),
});

const sessionMessageRatingSchema = z.object({
  notes: z.string().trim().max(500).optional(),
  rating: z.enum(['up', 'down']),
  reason: z.string().trim().max(120).optional(),
});

const restorePreviewSchema = z
  .object({
    backupId: z.string().min(1).optional(),
    includeText: z
      .preprocess((value) => {
        if (value === undefined) return undefined;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
          const normalized = value.trim().toLowerCase();
          if (normalized === 'true' || normalized === '1') return true;
          if (normalized === 'false' || normalized === '0' || normalized === '') return false;
        }
        return value;
      }, z.boolean().optional())
      .default(false),
    snapshotRef: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.backupId ? 1 : 0) + (value.snapshotRef ? 1 : 0) !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '必须且只能提供 backupId 或 snapshotRef 其中之一。',
        path: ['backupId'],
      });
    }
  });

const restoreApplySchema = z
  .object({
    backupId: z.string().min(1).optional(),
    forceConflicts: z.boolean().optional().default(false),
    includeText: z
      .preprocess((value) => {
        if (value === undefined) return undefined;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
          const normalized = value.trim().toLowerCase();
          if (normalized === 'true' || normalized === '1') return true;
          if (normalized === 'false' || normalized === '0' || normalized === '') return false;
        }
        return value;
      }, z.boolean().optional())
      .default(false),
    snapshotRef: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.backupId ? 1 : 0) + (value.snapshotRef ? 1 : 0) !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '必须且只能提供 backupId 或 snapshotRef 其中之一。',
        path: ['backupId'],
      });
    }
  });

function buildSessionFileChangesSummary(input: { sessionId: string; userId: string }) {
  return buildSessionFileChangesProjection({
    fileDiffs: listSessionFileDiffs({ sessionId: input.sessionId, userId: input.userId }),
    snapshots: listSessionSnapshots({ sessionId: input.sessionId, userId: input.userId }),
  }).summary;
}

function toPublicFileDiff(
  diff: ReturnType<typeof listSessionFileDiffs>[number],
  includeText: boolean,
) {
  return includeText
    ? diff
    : {
        file: diff.file,
        additions: diff.additions,
        deletions: diff.deletions,
        ...(diff.status ? { status: diff.status } : {}),
        ...(diff.clientRequestId ? { clientRequestId: diff.clientRequestId } : {}),
        ...(diff.requestId ? { requestId: diff.requestId } : {}),
        ...(diff.toolName ? { toolName: diff.toolName } : {}),
        ...(diff.toolCallId ? { toolCallId: diff.toolCallId } : {}),
        ...(diff.sourceKind ? { sourceKind: diff.sourceKind } : {}),
        ...(diff.guaranteeLevel ? { guaranteeLevel: diff.guaranteeLevel } : {}),
      };
}

function toPublicSnapshot(input: {
  includeText: boolean;
  snapshot: {
    clientRequestId?: string;
    createdAt: string;
    files?: ReturnType<typeof listSessionFileDiffs>;
    scopeKind: 'request' | 'backup' | 'scope' | 'unknown';
    snapshotRef: string;
    summary: {
      additions: number;
      deletions: number;
      files: number;
      guaranteeLevel?: 'strong' | 'medium' | 'weak';
      sourceKinds?: Array<
        | 'structured_tool_diff'
        | 'session_snapshot'
        | 'restore_replay'
        | 'workspace_reconcile'
        | 'manual_revert'
      >;
    };
  };
}) {
  return input.includeText
    ? input.snapshot
    : {
        snapshotRef: input.snapshot.snapshotRef,
        clientRequestId: input.snapshot.clientRequestId,
        scopeKind: input.snapshot.scopeKind,
        summary: {
          files: input.snapshot.summary.files,
          additions: input.snapshot.summary.additions,
          deletions: input.snapshot.summary.deletions,
          ...(input.snapshot.summary.guaranteeLevel
            ? { guaranteeLevel: input.snapshot.summary.guaranteeLevel }
            : {}),
          ...(input.snapshot.summary.sourceKinds
            ? { sourceKinds: input.snapshot.summary.sourceKinds }
            : {}),
        },
        createdAt: input.snapshot.createdAt,
      };
}

function toPublicBackup(input: {
  backup: ReturnType<typeof getSessionFileBackup> extends infer T ? Exclude<T, null> : never;
}) {
  return {
    backupId: input.backup.backupId,
    kind: input.backup.kind,
    filePath: input.backup.filePath,
    contentHash: input.backup.contentHash,
    contentTier: input.backup.contentTier,
    ...(input.backup.contentFormat ? { contentFormat: input.backup.contentFormat } : {}),
    ...(input.backup.sourceTool ? { sourceTool: input.backup.sourceTool } : {}),
    ...(input.backup.requestId ? { requestId: input.backup.requestId } : {}),
    ...(input.backup.toolCallId ? { toolCallId: input.backup.toolCallId } : {}),
    ...(input.backup.createdAt ? { createdAt: input.backup.createdAt } : {}),
  };
}

async function buildHashValidationForPreview(input: {
  currentContent: string;
  currentExists: boolean;
  expectedAfter: string;
  expectedBefore?: string;
  safePath?: string;
  validPath: boolean;
}) {
  if (!input.validPath || !input.currentExists) {
    return { available: false };
  }

  try {
    if (!input.safePath) {
      return { available: false };
    }
    const hashes = await new HashAnchoredEditorImpl().computeLineHashes(input.safePath);
    return {
      available: true,
      lineCount: hashes.length,
      matchesExpectedAfter: input.currentContent === input.expectedAfter,
      ...(input.expectedBefore !== undefined
        ? { matchesExpectedBefore: input.currentContent === input.expectedBefore }
        : {}),
    };
  } catch {
    return { available: false };
  }
}

function toWorkspaceRelativeCandidate(rootPath: string, filePath: string): string {
  const resolvedRoot = resolve(rootPath);
  const resolvedPath = isAbsolute(filePath) ? resolve(filePath) : resolve(join(rootPath, filePath));
  if (resolvedPath.startsWith(`${resolvedRoot}/`)) {
    return resolvedPath.slice(resolvedRoot.length + 1);
  }
  return filePath.replace(/^\//, '');
}

async function buildWorkspaceReviewSummary(input: { filePaths: string[]; workspaceRoot: string }) {
  const review = await listWorkspaceReviewChangesWithAvailability(input.workspaceRoot);
  if (!review.available) {
    return {
      available: false,
      reason: review.reason,
      workspaceRoot: input.workspaceRoot,
      dirtyCount: 0,
      conflicts: [] as Array<Record<string, unknown>>,
    };
  }
  const changePaths = new Map(
    review.changes.flatMap((change) => {
      const entries: Array<[string, typeof change]> = [[change.path, change]];
      if (change.oldPath) {
        entries.push([change.oldPath, change]);
      }
      return entries;
    }),
  );
  const conflicts = input.filePaths.flatMap((filePath) => {
    const change = changePaths.get(toWorkspaceRelativeCandidate(input.workspaceRoot, filePath));
    return change ? [{ filePath, change }] : [];
  });
  return {
    available: true,
    workspaceRoot: input.workspaceRoot,
    dirtyCount: review.changes.length,
    conflicts,
  };
}

function resolveRestoreTargetPath(input: {
  filePath: string;
  workspaceRoot: string;
}): string | null {
  if (isAbsolute(input.filePath)) {
    return validateWorkspacePath(input.filePath);
  }

  return validateWorkspacePath(resolve(join(input.workspaceRoot, input.filePath)));
}

async function readWorkspaceContentForPreview(input: {
  filePath: string;
  workspaceRoot: string;
  // When true, a non-ENOENT read error (EACCES / EISDIR / EIO / ELOOP) degrades
  // to "absent" + warn instead of throwing. Set ONLY on the read-only
  // validate/preview path so one unreadable file can't reject the whole
  // `Promise.all(snapshot.files.map(...))` and 500 the entire preview (§0.95
  // class). The restore-APPLY path must leave this false (default): there the
  // read feeds the before-write backup, so silently treating an
  // unreadable-but-existing file as absent would overwrite it without a backup.
  tolerateUnreadable?: boolean;
}): Promise<{
  content: string;
  exists: boolean;
  safePath?: string;
  validPath: boolean;
}> {
  const safePath = resolveRestoreTargetPath(input);
  if (!safePath) {
    return { validPath: false, exists: false, content: '' };
  }
  try {
    return {
      validPath: true,
      exists: true,
      content: await fsp.readFile(safePath, 'utf8'),
      safePath,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { validPath: true, exists: false, content: '', safePath };
    }
    if (input.tolerateUnreadable) {
      console.warn(
        `[sessions] 恢复预览读取工作区文件失败（${code ?? 'unknown'}），按缺失处理：${input.filePath}`,
      );
      return { validPath: true, exists: false, content: '', safePath };
    }
    throw error;
  }
}

type RestorePreviewFile = {
  changed: boolean;
  currentExists: boolean;
  deleteFile: boolean;
  diff: ReturnType<typeof buildFileDiff>;
  filePath: string;
  hashValidation: Awaited<ReturnType<typeof buildHashValidationForPreview>>;
  targetContent: string;
  validPath: boolean;
  safePath?: string;
};

async function buildBackupRestorePreviewState(input: {
  backup: Exclude<ReturnType<typeof getSessionFileBackup>, null>;
  backupContent: string | null;
  includeText: boolean;
  workspaceRoot: string;
  // Read-only validate/preview routes set this so one unreadable file degrades
  // instead of 500ing the whole preview; the apply route leaves it false.
  tolerateUnreadable?: boolean;
}) {
  const current = await readWorkspaceContentForPreview({
    filePath: input.backup.filePath,
    workspaceRoot: input.workspaceRoot,
    ...(input.tolerateUnreadable ? { tolerateUnreadable: true } : {}),
  });
  const diff = buildFileDiff({
    file: input.backup.filePath,
    before: current.content,
    after: input.backupContent ?? '',
  });
  const hashValidation = await buildHashValidationForPreview({
    safePath: current.safePath,
    validPath: current.validPath,
    currentExists: current.exists,
    currentContent: current.content,
    expectedAfter: input.backupContent ?? '',
  });
  const workspaceReview = await buildWorkspaceReviewSummary({
    workspaceRoot: input.workspaceRoot,
    filePaths: [input.backup.filePath],
  });

  return {
    canRestore: current.validPath && input.backupContent !== null,
    current,
    diff,
    hashValidation,
    preview: {
      changed: diff.before !== diff.after,
      diff: input.includeText ? diff : toPublicFileDiff(diff, false),
    },
    workspaceReview,
  };
}

async function buildSnapshotRestorePreviewState(input: {
  includeText: boolean;
  snapshot: Exclude<ReturnType<typeof getSessionSnapshotByRef>, null>;
  workspaceRoot: string;
  // Read-only validate/preview routes set this so one unreadable file degrades
  // instead of 500ing the whole preview; the apply route leaves it false.
  tolerateUnreadable?: boolean;
}) {
  const previews: RestorePreviewFile[] = await Promise.all(
    input.snapshot.files.map(async (file) => {
      const current = await readWorkspaceContentForPreview({
        filePath: file.file,
        workspaceRoot: input.workspaceRoot,
        ...(input.tolerateUnreadable ? { tolerateUnreadable: true } : {}),
      });
      const diff = buildFileDiff({
        file: file.file,
        before: current.content,
        after: file.after,
      });
      const hashValidation = await buildHashValidationForPreview({
        safePath: current.safePath,
        validPath: current.validPath,
        currentExists: current.exists,
        currentContent: current.content,
        expectedAfter: file.after,
        expectedBefore: file.before,
      });
      return {
        filePath: file.file,
        targetContent: file.after,
        validPath: current.validPath,
        currentExists: current.exists,
        safePath: current.safePath,
        deleteFile: file.status === 'deleted',
        changed: diff.before !== diff.after,
        diff,
        hashValidation,
      };
    }),
  );

  const workspaceReview = await buildWorkspaceReviewSummary({
    workspaceRoot: input.workspaceRoot,
    filePaths: input.snapshot.files.map((file) => file.file),
  });

  return {
    canRestore: previews.every((preview) => preview.validPath),
    previews,
    workspaceReview,
    responsePreview: previews.map((preview) => ({
      changed: preview.changed,
      currentExists: preview.currentExists,
      validPath: preview.validPath,
      hashValidation: preview.hashValidation,
      diff: input.includeText ? preview.diff : toPublicFileDiff(preview.diff, false),
    })),
  };
}

async function applyRestoreOperations(input: {
  clientRequestId: string;
  operations: Array<{
    currentContent: string;
    currentExists: boolean;
    deleteFile: boolean;
    filePath: string;
    safePath?: string;
    targetContent: string;
    validPath: boolean;
  }>;
  sessionId: string;
  userId: string;
}) {
  const requestId = `restore-apply:${input.clientRequestId}`;
  const diffs: ReturnType<typeof listSessionFileDiffs> = [];

  for (const operation of input.operations) {
    if (!operation.validPath || !operation.safePath) {
      throw new Error(`Invalid restore path: ${operation.filePath}`);
    }

    const backupBeforeRef = operation.currentExists
      ? await captureBeforeWriteBackup({
          sessionId: input.sessionId,
          userId: input.userId,
          requestId,
          toolCallId: 'restore-apply',
          toolName: 'restore_apply',
          filePath: operation.filePath,
          content: operation.currentContent,
          kind: 'before_write',
        })
      : undefined;

    if (operation.deleteFile) {
      await fsp.rm(operation.safePath, { force: true });
    } else {
      await fsp.mkdir(dirname(operation.safePath), { recursive: true });
      await fsp.writeFile(operation.safePath, operation.targetContent, 'utf8');
    }

    diffs.push({
      ...buildFileDiff({
        file: operation.filePath,
        before: operation.currentContent,
        after: operation.targetContent,
      }),
      clientRequestId: input.clientRequestId,
      requestId,
      toolName: 'restore_apply',
      toolCallId: 'restore-apply',
      sourceKind: 'restore_replay',
      guaranteeLevel: 'strong',
      ...(backupBeforeRef ? { backupBeforeRef } : {}),
    });
  }

  await persistSessionFileDiffs({
    sessionId: input.sessionId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
    requestId,
    toolName: 'restore_apply',
    toolCallId: 'restore-apply',
    sourceKind: 'restore_replay',
    guaranteeLevel: 'strong',
    diffs,
  });
  persistSessionSnapshot({
    sessionId: input.sessionId,
    userId: input.userId,
    snapshotRef: createRequestSnapshotRef(input.clientRequestId),
    fileDiffs: diffs,
  });

  return { clientRequestId: input.clientRequestId, diffs };
}

/**
 * 构建 sessions 表的安全 SELECT 列列表。
 *
 * 旧数据库可能缺少 Team Phase B 新增的列（role_layer、team_parent_session_id、
 * substate 等）。直接 SELECT 这些列会抛 "no such column" 异常，导致整个
 * recovery API 返回 500。此函数在运行时检测列是否存在，只 SELECT 实际
 * 存在的列，让旧数据库上的查询也能正常工作（缺失列的字段值为 undefined）。
 *
 * migrate() 的 ensureTeamSchemaSafe() 兜底块会补上这些列，但为了在
 * migrate 尚未执行或部分失败的过渡期内保持可用性，这里仍做防御。
 */
function buildSafeSessionSelectColumns(): string {
  const baseColumns = [
    'id',
    'user_id',
    'messages_json',
    'state_status',
    'metadata_json',
    'title',
    'created_at',
    'updated_at',
  ];
  const optionalColumns = [
    'team_parent_session_id',
    'role_layer',
    'substate',
    'handoff_state',
    'structural_depth',
    'execution_depth',
    'paused',
    'last_heartbeat',
  ];
  const existing = new Set(
    sqliteAll<{ name: string }>('PRAGMA table_info(sessions)').map((row) => row.name),
  );
  const safeColumns = [...baseColumns];
  for (const col of optionalColumns) {
    if (existing.has(col)) {
      safeColumns.push(col);
    }
  }
  return safeColumns.join(', ');
}

function collectDescendantSessionIds(sessions: SessionRow[], rootSessionId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();

  const linkChild = (parentSessionId: string | null | undefined, childId: string): void => {
    if (!parentSessionId || parentSessionId === childId) {
      return;
    }

    const existingChildren = childrenByParent.get(parentSessionId) ?? [];
    existingChildren.push(childId);
    childrenByParent.set(parentSessionId, existingChildren);
  };

  for (const session of sessions) {
    linkChild(parseParentSessionId(session.metadata_json), session.id);
    linkChild(session.team_parent_session_id ?? null, session.id);
  }

  const includedSessionIds = new Set<string>([rootSessionId]);
  const queue = [rootSessionId];

  while (queue.length > 0) {
    const currentSessionId = queue.shift();
    if (!currentSessionId) {
      continue;
    }

    for (const childSessionId of childrenByParent.get(currentSessionId) ?? []) {
      if (includedSessionIds.has(childSessionId)) {
        continue;
      }

      includedSessionIds.add(childSessionId);
      queue.push(childSessionId);
    }
  }

  return includedSessionIds;
}

function collectAncestorSessionIds(
  sessionsById: ReadonlyMap<string, SessionRow>,
  sessionId: string,
): string[] {
  const collectedSessionIds: string[] = [];
  const visited = new Set<string>();
  const queue = [sessionId];

  while (queue.length > 0) {
    const currentSessionId = queue.shift();
    if (!currentSessionId || visited.has(currentSessionId)) {
      continue;
    }

    collectedSessionIds.push(currentSessionId);
    visited.add(currentSessionId);

    const currentSession = sessionsById.get(currentSessionId);
    if (!currentSession) {
      continue;
    }

    for (const parentSessionId of getSessionParentIds(currentSession)) {
      if (!visited.has(parentSessionId)) {
        queue.push(parentSessionId);
      }
    }
  }

  return collectedSessionIds;
}

function getSessionParentIds(session: SessionRow): string[] {
  const parentIds = [
    parseParentSessionId(session.metadata_json),
    session.team_parent_session_id ?? null,
  ];
  return parentIds.filter(
    (parentId, index): parentId is string =>
      typeof parentId === 'string' &&
      parentId.length > 0 &&
      parentId !== session.id &&
      parentIds.indexOf(parentId) === index,
  );
}

function readRuntimeSessionParentSessionId(session: SessionRow): string | null {
  return session.team_parent_session_id ?? parseParentSessionId(session.metadata_json);
}

function buildSessionDeletionRows(sessions: SessionRow[], rootSessionId: string): SessionRow[] {
  const rowsById = new Map(sessions.map((session) => [session.id, session]));
  const childrenByParent = new Map<string, string[]>();

  const linkChild = (parentSessionId: string | null | undefined, childId: string): void => {
    if (!parentSessionId || parentSessionId === childId) {
      return;
    }
    const existingChildren = childrenByParent.get(parentSessionId) ?? [];
    existingChildren.push(childId);
    childrenByParent.set(parentSessionId, existingChildren);
  };

  for (const session of sessions) {
    // Two distinct parent links must BOTH be followed or the tree leaks rows:
    //   1. metadata.parentSessionId — subagent / message-tree children.
    //   2. team_parent_session_id (a real column) — team-layer children
    //      (pm1/pm2/executor/reviewer) created by `createTeamSession`, which
    //      never writes metadata.parentSessionId. There is NO FK CASCADE on
    //      this column, so without following it here, deleting a reception root
    //      deletes only the root row and orphans every team descendant (plus
    //      their CASCADE-linked message_v2 / handoff_records / inbound rows).
    linkChild(parseParentSessionId(session.metadata_json), session.id);
    linkChild(session.team_parent_session_id ?? null, session.id);
  }

  const queue: Array<{ depth: number; sessionId: string }> = [
    { depth: 0, sessionId: rootSessionId },
  ];
  const visited = new Set<string>();
  const deletionRows: Array<{ depth: number; row: SessionRow }> = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.sessionId)) {
      continue;
    }

    visited.add(current.sessionId);
    const row = rowsById.get(current.sessionId);
    if (!row) {
      continue;
    }

    deletionRows.push({ depth: current.depth, row });
    for (const childSessionId of childrenByParent.get(current.sessionId) ?? []) {
      queue.push({ depth: current.depth + 1, sessionId: childSessionId });
    }
  }

  return deletionRows.sort((left, right) => right.depth - left.depth).map(({ row }) => row);
}

function findSessionDeletionBlocker(
  sessionsToDelete: ReadonlyArray<SessionRow>,
  userId: string,
): {
  reason: 'pendingInteraction' | 'runtimeThread' | 'state' | 'stream';
  session: SessionRow;
} | null {
  for (const session of sessionsToDelete) {
    if (getAnyInFlightStreamRequestForSession({ sessionId: session.id, userId })) {
      return { reason: 'stream', session };
    }

    if (hasFreshSessionRuntimeThread({ sessionId: session.id, userId })) {
      return { reason: 'runtimeThread', session };
    }

    if (hasPendingSessionInteraction(session.id)) {
      return { reason: 'pendingInteraction', session };
    }

    if (session.state_status !== 'idle') {
      return { reason: 'state', session };
    }
  }

  return null;
}

async function deleteSessionTree(input: {
  sessionsToDelete: ReadonlyArray<SessionRow>;
  userId: string;
}): Promise<void> {
  const backupStoragePaths: string[] = [];

  try {
    for (const session of input.sessionsToDelete) {
      const candidatePaths = collectSessionBackupStoragePaths({
        sessionId: session.id,
        userId: input.userId,
      });
      clearPendingTaskParentAutoResumesForSession({ sessionId: session.id, userId: input.userId });
      // Purge per-session in-memory state that keys on sessionId. These maps
      // never evict on their own, so without this a deleted session leaks one
      // entry per map for the process lifetime (unbounded over many sessions).
      clearSubstateTrackingForSession(session.id);
      clearExternalAccessTracking(session.id);
      resetDoomLoopHistory(session.id);

      try {
        sqliteRun('DELETE FROM sessions WHERE id = ? AND user_id = ?', [session.id, input.userId]);
      } catch (error) {
        if (!isSqliteMalformedError(error)) {
          throw error;
        }

        deleteSessionWithMalformedRecovery({ sessionId: session.id, userId: input.userId });
      }

      backupStoragePaths.push(...candidatePaths);
      await taskStore.deleteGraph(WORKSPACE_ROOT, session.id);
    }
  } finally {
    await garbageCollectBackupStoragePaths(backupStoragePaths);
  }
}

function mergeTaskProjections(
  projections: ReadonlyArray<ReadonlyArray<SessionTaskResponse>>,
): SessionTaskResponse[] {
  const merged = new Map<string, SessionTaskResponse>();

  for (const projection of projections) {
    for (const task of projection) {
      const existing = merged.get(task.id);
      if (!existing || task.updatedAt > existing.updatedAt) {
        merged.set(task.id, task);
      }
    }
  }

  return Array.from(merged.values()).sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }

    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    return left.updatedAt - right.updatedAt;
  });
}

export async function buildMergedSessionTaskProjection(input: {
  includedSessionIds: ReadonlySet<string>;
  sessions: ReadonlyArray<SessionRow>;
  sessionId: string;
}): Promise<{ tasks: SessionTaskResponse[]; updatedAt: number }> {
  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]));
  const visibleSessionIds = new Set<string>([
    ...collectAncestorSessionIds(sessionsById, input.sessionId),
    ...input.includedSessionIds,
  ]);
  const graphSessionIds = new Set<string>(visibleSessionIds);
  const childSessionIds = [...input.includedSessionIds].filter(
    (sessionId) => sessionId !== input.sessionId,
  );

  const parentSessionIds = childSessionIds
    .flatMap((childSessionId) => {
      const childRow = sessionsById.get(childSessionId);

      return childRow ? getSessionParentIds(childRow) : [];
    })
    .filter(
      (sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0,
    );

  parentSessionIds.forEach((sessionId) => {
    graphSessionIds.add(sessionId);
  });

  const graphs = await Promise.all(
    Array.from(graphSessionIds).map(async (graphSessionId) => ({
      graph: await taskManager.loadOrCreate(WORKSPACE_ROOT, graphSessionId),
      graphSessionId,
    })),
  );

  return {
    tasks: mergeTaskProjections(
      graphs.map(({ graph }) =>
        buildSessionTaskProjection(graph, input.sessionId, visibleSessionIds),
      ),
    ).map((task) => {
      if (!task.sessionId) {
        return task;
      }

      const taskSession = sessionsById.get(task.sessionId);
      if (!taskSession) {
        return task;
      }

      const taskSessionMetadata = parseSessionMetadataJson(taskSession.metadata_json);
      const terminalReason = taskSessionMetadata['terminalReason'];
      const timeoutSource = taskSessionMetadata['timeoutSource'];
      return {
        ...task,
        ...(typeof terminalReason === 'string' && terminalReason.length > 0
          ? { terminalReason }
          : {}),
        ...(timeoutSource === 'first_response' ? { timeoutSource } : {}),
      };
    }),
    updatedAt: graphs.reduce(
      (latestUpdatedAt, { graph }) => Math.max(latestUpdatedAt, graph.updatedAt),
      0,
    ),
  };
}

async function findVisibleTaskEntry(input: {
  includedSessionIds: ReadonlySet<string>;
  sessionId: string;
  sessions: ReadonlyArray<SessionRow>;
  taskId: string;
}): Promise<{
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  graphSessionId: string;
  task: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>['tasks'][string];
} | null> {
  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]));
  const visibleSessionIds = new Set<string>([
    ...collectAncestorSessionIds(sessionsById, input.sessionId),
    ...input.includedSessionIds,
  ]);
  const graphSessionIds = collectAncestorSessionIds(sessionsById, input.sessionId);

  for (const graphSessionId of graphSessionIds) {
    const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, graphSessionId);
    const task = graph.tasks[input.taskId];
    if (!task) {
      continue;
    }

    if (task.sessionId && !visibleSessionIds.has(task.sessionId)) {
      continue;
    }

    return { graph, graphSessionId, task };
  }

  return null;
}

const childSessionQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0),
});

const taskManager = new AgentTaskManagerImpl();
const taskStore = new AgentTaskStoreImpl();
const SESSION_ROUTE_ERROR_MESSAGES = {
  backupNotFound: '目标备份不存在。',
  deleteBlocked: '仅当相关会话全部处于空闲状态时才能删除。',
  messageNotFound: '目标消息不存在。',
  metadataInvalid: '会话元数据无效。',
  parentNotFound: '目标父会话不存在。',
  restoreBlocked: '当前工作区状态不满足恢复条件，暂不能应用恢复。',
  selfParent: '会话不能将自己设为父会话。',
  snapshotNotFound: '目标快照不存在。',
  taskNotCancellable: '当前任务状态不支持取消。',
  taskNotFound: '目标任务不存在。',
  workspaceForbidden: '工作区路径不在允许范围内。',
} as const;
const SESSION_WORKSPACE_IMMUTABLE_ERROR = '当前会话已绑定工作区，不能直接修改。';
const SESSION_PARENT_IMMUTABLE_ERROR = '当前会话已绑定父会话，不能直接修改。';

async function reconcileSessionRuntimeForResponse(
  session: SessionRow,
  userId: string,
): Promise<SessionRow> {
  // Per-session resilience: reconcileSessionRuntime does DB writes plus
  // finalizeChildTaskRun and can throw. This runs inside
  // `Promise.all(sessions.map(...))` for the main `/sessions` list and 7 other
  // routes, so one session's reconciliation failure used to reject the whole
  // batch and 500 the entire listing. Degrade to the already-loaded row (its
  // persisted state_status) + warn instead, mirroring the batch
  // `reconcileAllSessionRuntimes` which collects failures rather than aborting.
  let reconciliation: Awaited<ReturnType<typeof reconcileSessionRuntime>>;
  try {
    reconciliation = await reconcileSessionRuntime({ sessionId: session.id, userId });
  } catch (error) {
    console.warn(
      `[sessions] 会话 ${session.id} 运行时协调失败，沿用持久状态：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return session;
  }

  if (!reconciliation.status) {
    return session;
  }

  const refreshedSession = sqliteGet<SessionRow>(
    `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
    [session.id, userId],
  );
  if (refreshedSession) {
    return refreshedSession;
  }

  if (reconciliation.status === session.state_status) {
    return session;
  }

  return {
    ...session,
    state_status: reconciliation.status,
  };
}

async function reconcileSessionRuntimeRowsForResponse(
  sessions: SessionRow[],
  userId: string,
): Promise<SessionRow[]> {
  return Promise.all(
    sessions.map((session) => reconcileSessionRuntimeForResponse(session, userId)),
  );
}

function mapRecoveryPermissionRequestRow(row: RecoveryPermissionRequestRow) {
  return {
    requestId: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    scope: row.scope,
    reason: row.reason,
    riskLevel: row.risk_level,
    previewAction: row.preview_action ?? undefined,
    status: row.status,
    decision: row.decision ?? undefined,
    createdAt: row.created_at,
  };
}

// Corrupt-row tolerance (§0.89-§0.93 class): `questions_json` is persisted via
// `JSON.stringify`, but a crash mid-write / disk error / hand-edited DB can
// leave it invalid. This is used via `.map(...)` in the recovery listing, so a
// single corrupt row used to throw and 500 the whole pending-question recovery
// list. Return `null` + warn so the caller can skip the bad row.
function mapRecoveryQuestionRequestRow(row: RecoveryQuestionRequestRow) {
  let questions: unknown;
  try {
    questions = JSON.parse(row.questions_json) as unknown;
  } catch (error) {
    console.warn(
      `[sessions] 恢复提问请求 ${row.id} questions_json 解析失败，已跳过：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
  return {
    requestId: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    title: row.title,
    questions,
    status: row.status,
    createdAt: row.created_at,
  };
}

function listRecoveryPermissionRequests(sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return [];
  }

  const rows = chunkSqliteBindValues(sessionIds).flatMap((batchSessionIds) => {
    const placeholders = buildSqlitePlaceholders(batchSessionIds.length, ', ');
    return sqliteAll<RecoveryPermissionRequestRow>(
      `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, created_at
       FROM permission_requests
       WHERE session_id IN (${placeholders}) AND status = 'pending'
       ORDER BY created_at ASC`,
      batchSessionIds,
    );
  });
  rows.sort((left, right) => left.created_at.localeCompare(right.created_at));
  return rows.map(mapRecoveryPermissionRequestRow);
}

function listRecoveryQuestionRequests(sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return [];
  }

  const rows = chunkSqliteBindValues(sessionIds).flatMap((batchSessionIds) => {
    const placeholders = buildSqlitePlaceholders(batchSessionIds.length, ', ');
    return sqliteAll<RecoveryQuestionRequestRow>(
      `SELECT id, session_id, tool_name, title, questions_json, status, created_at
       FROM question_requests
       WHERE session_id IN (${placeholders}) AND status = 'pending'
       ORDER BY created_at ASC`,
      batchSessionIds,
    );
  });
  rows.sort((left, right) => left.created_at.localeCompare(right.created_at));
  return rows.flatMap((row) => {
    const mapped = mapRecoveryQuestionRequestRow(row);
    return mapped ? [mapped] : [];
  });
}

async function buildSessionStatusReadModel(input: { session: SessionRow; userId: string }) {
  const sessionId = input.session.id;
  const safeSessionCols = buildSafeSessionSelectColumns();
  const allSessions = sqliteAll<SessionRow>(
    `SELECT ${safeSessionCols} FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`,
    [input.userId],
  );
  const descendantSessionIds = [...collectDescendantSessionIds(allSessions, sessionId)].filter(
    (candidateSessionId) => candidateSessionId !== sessionId,
  );
  const sessionRowsById = new Map(allSessions.map((session) => [session.id, session] as const));
  const descendantRows = descendantSessionIds
    .map((childSessionId) => sessionRowsById.get(childSessionId) ?? null)
    .filter((session): session is SessionRow => session !== null);

  const reconciledDescendants = await reconcileSessionRuntimeRowsForResponse(
    descendantRows,
    input.userId,
  );

  const children = reconciledDescendants.map((session) =>
    toPublicSessionResponse(
      {
        ...session,
        metadata_json: sanitizeSessionMetadataJson(session.metadata_json),
      },
      [], // Skip message queries for status endpoint
    ),
  );

  const relevantSessionIds = [sessionId, ...children.map((child) => child.id)];

  let tasks: SessionTaskResponse[] = [];
  if (descendantRows.length > 0) {
    const allRows = [input.session, ...reconciledDescendants];
    const includedSessionIds = new Set(allRows.map((s) => s.id));
    const projection = await buildMergedSessionTaskProjection({
      includedSessionIds,
      sessions: allRows,
      sessionId,
    });
    tasks = projection.tasks;
  }

  const activeThread = getFreshSessionRuntimeThread({ sessionId, userId: input.userId });

  return {
    activeStream: activeThread
      ? {
          clientRequestId: activeThread.clientRequestId,
          heartbeatAtMs: activeThread.heartbeatAtMs,
          lastSeq: getLatestSessionRunEventSeqByRequest({
            sessionId,
            clientRequestId: activeThread.clientRequestId,
          }),
          sessionId,
          startedAtMs: activeThread.startedAtMs,
        }
      : null,
    children,
    pendingPermissions: listRecoveryPermissionRequests(relevantSessionIds),
    pendingQuestions: listRecoveryQuestionRequests(relevantSessionIds),
    tasks,
    todoLanes: listSessionTodoLanes(sessionId),
  };
}

async function buildSessionRecoveryReadModel(input: {
  session: SessionRow;
  userId: string;
  messageLimit?: number;
  since?: number;
}) {
  const reconciledSession = await reconcileSessionRuntimeForResponse(input.session, input.userId);
  const sessionId = input.session.id;
  const sessions = sqliteAll<SessionRow>(
    `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`,
    [input.userId],
  );
  const descendantSessionIds = [...collectDescendantSessionIds(sessions, sessionId)].filter(
    (candidateSessionId) => candidateSessionId !== sessionId,
  );
  const childRows = await reconcileSessionRuntimeRowsForResponse(
    descendantSessionIds
      .map((childSessionId) => sessions.find((session) => session.id === childSessionId) ?? null)
      .filter((session): session is SessionRow => session !== null),
    input.userId,
  );
  const children = childRows.map((session) =>
    toPublicSessionResponse(
      {
        ...session,
        parentSessionId: readRuntimeSessionParentSessionId(session),
        metadata_json: sanitizeSessionMetadataJson(session.metadata_json),
      },
      filterVisibleSessionMessages(
        mergeRuntimeSafeSessionMessages({
          legacyMessages: listSessionMessagesV2({
            sessionId: session.id,
            userId: input.userId,
          }),
          runtimeMessages: listRuntimeSafeSessionMessagesV2({
            sessionId: session.id,
            userId: input.userId,
          }),
        }),
      ),
    ),
  );

  const relevantSessionIds = [sessionId, ...children.map((child) => child.id)];

  const sessionsById = new Map(sessions.map((candidate) => [candidate.id, candidate] as const));
  const visibleSessionIds = new Set<string>([
    ...collectAncestorSessionIds(sessionsById, sessionId),
    ...collectDescendantSessionIds(sessions, sessionId),
  ]);
  const reconciledSessions = await reconcileSessionRuntimeRowsForResponse(
    sessions.filter((candidate) => visibleSessionIds.has(candidate.id)),
    input.userId,
  );
  const reconciledSessionsById = new Map(
    reconciledSessions.map((candidate) => [candidate.id, candidate] as const),
  );
  const mergedSessions = sessions.map(
    (candidate) => reconciledSessionsById.get(candidate.id) ?? candidate,
  );
  const includedSessionIds = collectDescendantSessionIds(mergedSessions, sessionId);
  const { tasks } = await buildMergedSessionTaskProjection({
    includedSessionIds,
    sessions: mergedSessions,
    sessionId,
  });

  const activeThread = getFreshSessionRuntimeThread({ sessionId, userId: input.userId });

  // Resolve messages with optional turn limit — when messageLimit is set, treat
  // it as a conversation-turn limit (counted by user messages) so that complete
  // assistant responses are always included regardless of how many raw messages
  // they span.
  const hasTurnLimit = typeof input.messageLimit === 'number' && input.messageLimit > 0;
  const allVisibleMessages = filterVisibleSessionMessages(
    mergeRuntimeSafeSessionMessages({
      legacyMessages: listSessionMessagesV2({
        sessionId,
        userId: input.userId,
        turnLimit: hasTurnLimit ? input.messageLimit : undefined,
      }),
      runtimeMessages: listRuntimeSafeSessionMessagesV2({
        sessionId,
        userId: input.userId,
      }),
    }),
  );
  const totalTurnCount = hasTurnLimit
    ? countUserMessages({ sessionId, userId: input.userId })
    : undefined;
  const totalMessageCount = totalTurnCount ?? allVisibleMessages.length;

  // Resolve runEvents — when loading with turnLimit, only fetch events for the
  // active stream (if any) so the frontend can resume in-progress tool calls.
  // Historical runEvents are redundant — completed messages already contain the
  // full tool results.
  let filteredRunEvents: RunEvent[];
  if (hasTurnLimit) {
    filteredRunEvents = activeThread
      ? listSessionRunEventsByRequest({
          sessionId,
          clientRequestId: activeThread.clientRequestId,
        })
      : [];
  } else {
    const allRunEvents = listSessionRunEvents(sessionId);
    filteredRunEvents =
      typeof input.since === 'number'
        ? allRunEvents.filter(
            (event) => typeof event.occurredAt !== 'number' || event.occurredAt >= input.since!,
          )
        : allRunEvents;
  }

  const slimmedMessages = hasTurnLimit
    ? slimMessagesForRecovery(allVisibleMessages)
    : allVisibleMessages;

  const sessionResponse = toPublicSessionResponse(
    {
      ...reconciledSession,
      parentSessionId: readRuntimeSessionParentSessionId(reconciledSession),
      metadata_json: sanitizeSessionMetadataJson(reconciledSession.metadata_json),
    },
    slimmedMessages,
    listSessionTodos(sessionId),
    filteredRunEvents,
  );

  return {
    activeStream: activeThread
      ? {
          clientRequestId: activeThread.clientRequestId,
          heartbeatAtMs: activeThread.heartbeatAtMs,
          lastSeq: getLatestSessionRunEventSeqByRequest({
            sessionId,
            clientRequestId: activeThread.clientRequestId,
          }),
          sessionId,
          startedAtMs: activeThread.startedAtMs,
        }
      : null,
    children,
    pendingPermissions: listRecoveryPermissionRequests(relevantSessionIds),
    pendingQuestions: listRecoveryQuestionRequests(relevantSessionIds),
    ratings: listSessionMessageRatings({ sessionId, userId: input.userId }),
    session: {
      ...sessionResponse,
      fileChangesSummary: buildSessionFileChangesSummary({ sessionId, userId: input.userId }),
    },
    tasks,
    todoLanes: listSessionTodoLanes(sessionId),
    totalMessageCount,
    totalTurnCount: totalTurnCount ?? null,
  };
}

export async function sessionsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/sessions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'session.create');
      const user = request.user as JwtPayload;
      const body = parseBody(createSessionSchema, request.body);

      const { metadata, workingDirectory } = body;
      const metadataPatch = validateSessionMetadataPatch(metadata);
      if (!metadataPatch.success) {
        throw ApiError.badRequest(SESSION_ROUTE_ERROR_MESSAGES.metadataInvalid, {
          kind: 'Body',
          issues: metadataPatch.error.issues,
        });
      }
      const mergedMetadata =
        workingDirectory !== undefined
          ? { ...metadataPatch.data, workingDirectory }
          : metadataPatch.data;
      const normalizedMetadata = normalizeIncomingSessionMetadata(mergedMetadata);
      if (normalizedMetadata.workingDirectory === null) {
        const pathStep = child('path-safety');
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: SESSION_ROUTE_ERROR_MESSAGES.workspaceForbidden });
      }
      const requestedParentSessionId = extractParentSessionIdFromMetadata(
        normalizedMetadata.metadata,
      );
      const parentValidation = validateParentSessionBinding({
        userId: user.sub,
        parentSessionId: requestedParentSessionId,
      });
      if (!parentValidation.ok) {
        step.fail(parentValidation.reason);
        return reply.status(parentValidation.statusCode).send({ error: parentValidation.error });
      }

      const id = randomUUID();
      sqliteRun(
        'INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json) VALUES (?, ?, ?, ?, ?)',
        [id, user.sub, '[]', 'idle', JSON.stringify(normalizedMetadata.metadata)],
      );
      // Invalidate the workspace allowlist so the user can immediately
      // hit /workspace/* endpoints against the working directory of
      // the freshly-created session.
      invalidateUserWorkspaceAllowlist(user.sub);
      trackEvent(user.sub, 'session_created', { sessionSource: 'manual' });
      step.succeed(undefined, { sessionId: id });
      return reply.status(201).send({ sessionId: id });
    },
  );

  app.get(
    '/sessions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.list');
      const user = request.user as JwtPayload;
      const query = parseQuery(
        z.object({
          limit: z.coerce.number().min(1).max(100).default(20),
          offset: z.coerce.number().min(0).default(0),
          // P3-PATH (opencode #24849): optional absolute path that scopes the
          // list to sessions whose resolved `workingDirectory` sits under it.
          // `includeDescendants` defaults to true so callers opt in to strict
          // equality by explicitly passing "0" / "false".
          path: z.string().min(1).optional(),
          includeDescendants: z.coerce.boolean().optional().default(true),
          // 当 excludeTeam=true 时，排除所有 team 会话（通过 role_layer 列
          // 或 metadata_json 中的 teamWorkspaceId 标识）。chat 侧边栏使用此参数。
          excludeTeam: z.coerce.boolean().optional().default(false),
        }),
        (request as FastifyRequest & { query: unknown }).query,
      );

      const { limit, offset, path, includeDescendants, excludeTeam } = query;

      // team 会话通过三种标识之一识别：
      //   1. role_layer 列有值（reception/pm1/pm2/executor/reviewer）
      //   2. team_parent_session_id 列有值（team 子会话）
      //   3. metadata_json 包含 teamWorkspaceId（team 根会话）
      // 当 excludeTeam=true 时，在 SQL 层面完整过滤，避免 team 会话占用 limit 配额。
      // 旧数据库可能缺少 role_layer / team_parent_session_id 列，此时退化为只用
      // metadata_json 过滤（第三种标识），不会因列缺失而崩溃。
      const safeSessionCols = buildSafeSessionSelectColumns();
      const hasRoleLayerColumn = safeSessionCols.includes('role_layer');
      const hasTeamParentColumn = safeSessionCols.includes('team_parent_session_id');
      const teamFilter = excludeTeam
        ? ` AND (${hasRoleLayerColumn ? 'role_layer IS NULL AND ' : ''}${hasTeamParentColumn ? 'team_parent_session_id IS NULL AND ' : ''}metadata_json NOT LIKE '%"teamWorkspaceId"%')`
        : '';

      // When a path filter is requested we have to pull the full candidate
      // set first, filter, and only then apply pagination — otherwise the
      // SQL LIMIT/OFFSET windows would exclude valid matches that happen
      // to fall outside the top-20 most-recently-updated rows.
      const baseRows = path
        ? sqliteAll<SessionRow>(
            `SELECT ${safeSessionCols} FROM sessions WHERE user_id = ?${teamFilter} ORDER BY updated_at DESC`,
            [user.sub],
          )
        : sqliteAll<SessionRow>(
            `SELECT ${safeSessionCols} FROM sessions WHERE user_id = ?${teamFilter} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
            [user.sub, limit, offset],
          );

      const sanitized = baseRows.map((session) => ({
        ...session,
        metadata_json: sanitizeSessionMetadataJson(session.metadata_json),
      }));

      const filtered = path
        ? filterSessionsByPath(sanitized, { path, includeDescendants }).slice(
            offset,
            offset + limit,
          )
        : sanitized;

      const sessions = await reconcileSessionRuntimeRowsForResponse(filtered, user.sub).then(
        (rows) =>
          rows.map((session) => ({
            ...session,
            fileChangesSummary: buildSessionFileChangesSummary({
              sessionId: session.id,
              userId: user.sub,
            }),
          })),
      );
      step.succeed(undefined, {
        count: sessions.length,
        ...(path ? { pathFiltered: true, includeDescendants } : {}),
      });
      return reply.send({ sessions });
    },
  );

  app.get(
    '/sessions/search',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const query = parseQuery(
        searchSessionsQuerySchema,
        (request as FastifyRequest & { query: unknown }).query,
      );
      const { step } = startRequestWorkflow(request, 'session.search');

      hydrateLegacySessionMessagesForSearch(user.sub);

      const results = searchSessionMessages({
        limit: query.limit,
        query: query.q,
        userId: user.sub,
      });
      step.succeed(undefined, { count: results.length });
      return reply.send({ results });
    },
  );
  await registerSessionSharedReadRoutes(app);

  app.get(
    '/sessions/:sessionId/message-ratings',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.message-ratings.list', undefined, {
        sessionId,
      });

      const ratings = listSessionMessageRatings({ sessionId, userId: user.sub });
      step.succeed(undefined, { count: ratings.length });
      return reply.send({ ratings });
    },
  );

  app.put(
    '/sessions/:sessionId/messages/:messageId/rating',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { messageId, sessionId } = request.params as { messageId: string; sessionId: string };
      const body = parseBody(sessionMessageRatingSchema, request.body);
      const { step } = startRequestWorkflow(request, 'session.message-ratings.upsert', undefined, {
        messageId,
        sessionId,
      });

      if (!hasSessionMessage({ messageId, sessionId, userId: user.sub })) {
        throw ApiError.notFound(SESSION_ROUTE_ERROR_MESSAGES.messageNotFound);
      }

      const record = upsertSessionMessageRating({
        messageId,
        notes: body.notes,
        rating: body.rating,
        reason: body.reason,
        sessionId,
        userId: user.sub,
      });
      step.succeed(undefined, { rating: record.rating });
      return reply.send({ rating: record });
    },
  );

  app.delete(
    '/sessions/:sessionId/messages/:messageId/rating',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { messageId, sessionId } = request.params as { messageId: string; sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.message-ratings.delete', undefined, {
        messageId,
        sessionId,
      });

      deleteSessionMessageRating({ messageId, sessionId, userId: user.sub });
      step.succeed();
      return reply.status(204).send();
    },
  );

  app.get(
    '/sessions/:sessionId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.get', undefined, { sessionId });

      const session = sqliteGet<SessionRow>(
        `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
        [sessionId, user.sub],
      );

      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }
      const reconciledSession = await reconcileSessionRuntimeForResponse(session, user.sub);
      step.succeed();
      const todos = listSessionTodos(sessionId);
      const response = toPublicSessionResponse(
        {
          ...reconciledSession,
          metadata_json: sanitizeSessionMetadataJson(reconciledSession.metadata_json),
        },
        filterVisibleSessionMessages(
          mergeRuntimeSafeSessionMessages({
            legacyMessages: listSessionMessagesV2({
              sessionId,
              userId: user.sub,
            }),
            runtimeMessages: listRuntimeSafeSessionMessagesV2({
              sessionId,
              userId: user.sub,
            }),
          }),
        ),
        todos,
        listSessionRunEvents(sessionId),
      );
      return reply.send({
        session: {
          ...response,
          fileChangesSummary: buildSessionFileChangesSummary({ sessionId, userId: user.sub }),
        },
      });
    },
  );

  app.get(
    '/sessions/:sessionId/status',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.status.get', undefined, {
        sessionId,
      });

      const session = sqliteGet<SessionRow>(
        `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
        [sessionId, user.sub],
      );

      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const status = await buildSessionStatusReadModel({ session, userId: user.sub });
      step.succeed(undefined, {
        childCount: status.children.length,
        pendingPermissionCount: status.pendingPermissions.length,
        pendingQuestionCount: status.pendingQuestions.length,
        sessionId,
        taskCount: status.tasks.length,
      });

      return reply.send({ status });
    },
  );

  app.get(
    '/sessions/:sessionId/recovery',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.recovery.get', undefined, {
        sessionId,
      });

      const session = sqliteGet<SessionRow>(
        `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
        [sessionId, user.sub],
      );

      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const query = request.query as Record<string, string | undefined>;
      const messageLimit =
        typeof query.messageLimit === 'string' && /^\d+$/u.test(query.messageLimit)
          ? Number(query.messageLimit)
          : undefined;
      const since =
        typeof query.since === 'string' && /^\d+$/u.test(query.since)
          ? Number(query.since)
          : undefined;

      const recovery = await buildSessionRecoveryReadModel({
        session,
        userId: user.sub,
        messageLimit,
        since,
      });
      step.succeed(undefined, {
        childCount: recovery.children.length,
        pendingPermissionCount: recovery.pendingPermissions.length,
        pendingQuestionCount: recovery.pendingQuestions.length,
        sessionId,
        taskCount: recovery.tasks.length,
      });

      return reply.send({ recovery });
    },
  );

  app.get(
    '/sessions/:sessionId/file-changes/read-model',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.file-changes.read-model', undefined, {
        sessionId,
      });

      const session = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const readModel = buildSessionTurnDiffReadModel({
        sessionId,
        fileDiffs: listSessionFileDiffs({ sessionId, userId: user.sub }),
        snapshots: listSessionSnapshots({ sessionId, userId: user.sub }),
      });
      step.succeed(undefined, {
        turnCount: readModel.sessionSummary.turnCount,
        totalFileDiffs: readModel.sessionSummary.totalFileDiffs,
      });
      return reply.send({ readModel });
    },
  );

  app.get(
    '/sessions/:sessionId/file-changes',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const query = parseQuery(
        fileChangesQuerySchema,
        (request as FastifyRequest & { query: unknown }).query,
      );
      const { step } = startRequestWorkflow(request, 'session.file-changes.get', undefined, {
        sessionId,
      });

      const session = sqliteGet<{ id: string; metadata_json: string }>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const fileDiffs = query.includeText
        ? await listSessionFileDiffsWithText({ sessionId, userId: user.sub })
        : listSessionFileDiffs({ sessionId, userId: user.sub });
      const fileChanges = buildSessionFileChangesProjection({
        fileDiffs,
        snapshots: listSessionSnapshots({ sessionId, userId: user.sub }),
      });
      step.succeed(undefined, {
        diffCount: fileChanges.summary.totalFileDiffs,
        snapshotCount: fileChanges.summary.snapshotCount,
      });
      return reply.send({
        fileChanges: {
          ...fileChanges,
          fileDiffs: fileChanges.fileDiffs.map((diff) => toPublicFileDiff(diff, query.includeText)),
          snapshots: fileChanges.snapshots.map((snapshot) =>
            toPublicSnapshot({ includeText: query.includeText, snapshot }),
          ),
        },
      });
    },
  );

  app.get(
    '/sessions/:sessionId/requests/:clientRequestId/file-changes',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { clientRequestId, sessionId } = request.params as {
        clientRequestId: string;
        sessionId: string;
      };
      const query = parseQuery(
        fileChangesQuerySchema,
        (request as FastifyRequest & { query: unknown }).query,
      );
      const { step } = startRequestWorkflow(
        request,
        'session.request-file-changes.get',
        undefined,
        {
          clientRequestId,
          sessionId,
        },
      );

      const session = sqliteGet<{ id: string; metadata_json: string }>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const fileDiffs = query.includeText
        ? await listRequestFileDiffsWithText({ clientRequestId, sessionId, userId: user.sub })
        : listRequestFileDiffs({ clientRequestId, sessionId, userId: user.sub });
      const fileChanges = buildSessionFileChangesProjection({
        fileDiffs,
        snapshots: listRequestSnapshots({ clientRequestId, sessionId, userId: user.sub }),
      });
      step.succeed(undefined, {
        clientRequestId,
        diffCount: fileChanges.summary.totalFileDiffs,
        snapshotCount: fileChanges.summary.snapshotCount,
      });
      return reply.send({
        clientRequestId,
        fileChanges: {
          ...fileChanges,
          fileDiffs: fileChanges.fileDiffs.map((diff) => toPublicFileDiff(diff, query.includeText)),
          snapshots: fileChanges.snapshots.map((snapshot) =>
            toPublicSnapshot({ includeText: query.includeText, snapshot }),
          ),
        },
      });
    },
  );

  app.get(
    '/sessions/:sessionId/snapshots',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.snapshots.list', undefined, {
        sessionId,
      });

      const session = sqliteGet<{ id: string; metadata_json: string }>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const snapshots = listSessionSnapshots({ sessionId, userId: user.sub }).map((snapshot) =>
        toPublicSnapshot({ includeText: false, snapshot }),
      );
      step.succeed(undefined, { count: snapshots.length });
      return reply.send({ snapshots });
    },
  );

  app.get(
    '/sessions/:sessionId/snapshots/compare',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.snapshots.compare', undefined, {
        sessionId,
      });
      const query = parseQuery(
        snapshotCompareQuerySchema,
        (request as FastifyRequest & { query: unknown }).query,
      );

      const session = sqliteGet<{ id: string; metadata_json: string }>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const fromSnapshot = getSessionSnapshotByRef({
        sessionId,
        userId: user.sub,
        snapshotRef: query.from,
      });
      const toSnapshot = getSessionSnapshotByRef({
        sessionId,
        userId: user.sub,
        snapshotRef: query.to,
      });
      if (!fromSnapshot || !toSnapshot) {
        throw ApiError.notFound(SESSION_ROUTE_ERROR_MESSAGES.snapshotNotFound);
      }

      const comparison = compareSessionSnapshots({ from: fromSnapshot, to: toSnapshot }).map(
        (item) =>
          query.includeText
            ? item
            : {
                file: item.file,
                fromExists: item.fromExists,
                toExists: item.toExists,
                changed: item.changed,
                fromStatus: item.fromStatus,
                toStatus: item.toStatus,
              },
      );
      step.succeed(undefined, { fileCount: comparison.length });
      return reply.send({
        comparison,
        from: toPublicSnapshot({ includeText: query.includeText, snapshot: fromSnapshot }),
        to: toPublicSnapshot({ includeText: query.includeText, snapshot: toSnapshot }),
      });
    },
  );

  app.get(
    '/sessions/:sessionId/snapshots/:snapshotRef',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId, snapshotRef } = request.params as {
        sessionId: string;
        snapshotRef: string;
      };
      const query = parseQuery(
        fileChangesQuerySchema,
        (request as FastifyRequest & { query: unknown }).query,
      );
      const { step } = startRequestWorkflow(request, 'session.snapshot.get', undefined, {
        sessionId,
        snapshotRef,
      });

      const session = sqliteGet<{ id: string; metadata_json: string }>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const snapshot = getSessionSnapshotByRef({ sessionId, userId: user.sub, snapshotRef });
      if (!snapshot) {
        throw ApiError.notFound(SESSION_ROUTE_ERROR_MESSAGES.snapshotNotFound);
      }

      step.succeed(undefined, { fileCount: snapshot.files.length, snapshotRef });
      return reply.send({
        snapshot: toPublicSnapshot({ includeText: query.includeText, snapshot }),
      });
    },
  );

  app.post(
    '/sessions/:sessionId/restore/preview',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const body = parseBody(restorePreviewSchema, request.body);
      const { step } = startRequestWorkflow(request, 'session.restore.preview', undefined, {
        sessionId,
      });

      const session = sqliteGet<{ id: string; metadata_json: string }>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }
      const workspaceRoot =
        extractSessionWorkingDirectory(parseSessionMetadataJson(session.metadata_json)) ??
        WORKSPACE_ROOT;

      if (body.backupId) {
        const backup = getSessionFileBackup({
          backupId: body.backupId,
          sessionId,
          userId: user.sub,
        });
        if (!backup) {
          step.fail('backup not found');
          throw ApiError.notFound(SESSION_ROUTE_ERROR_MESSAGES.backupNotFound);
        }

        const backupContent = await readSessionFileBackupContent({
          backupId: body.backupId,
          sessionId,
          userId: user.sub,
        });
        const previewState = await buildBackupRestorePreviewState({
          backup,
          backupContent,
          includeText: body.includeText,
          workspaceRoot,
          // Read-only preview: tolerate unreadable current files (degrade to
          // absent) so one bad file can't 500 the whole preview (§0.95 class).
          tolerateUnreadable: true,
        });
        step.succeed(undefined, {
          mode: 'backup',
          canRestore: previewState.canRestore,
          file: backup.filePath,
        });
        return reply.send({
          validateOnly: true,
          mode: 'backup',
          target: toPublicBackup({ backup }),
          validation: {
            canRestore: previewState.canRestore,
            currentExists: previewState.current.exists,
            validPath: previewState.current.validPath,
            backupContentAvailable: backupContent !== null,
          },
          hashValidation: previewState.hashValidation,
          workspaceReview: previewState.workspaceReview,
          preview: previewState.preview,
        });
      }

      const snapshot = getSessionSnapshotByRef({
        sessionId,
        userId: user.sub,
        snapshotRef: body.snapshotRef!,
      });
      if (!snapshot) {
        throw ApiError.notFound(SESSION_ROUTE_ERROR_MESSAGES.snapshotNotFound);
      }

      const previewState = await buildSnapshotRestorePreviewState({
        snapshot,
        includeText: body.includeText,
        workspaceRoot,
        // Read-only preview: tolerate unreadable current files (degrade to
        // absent) so one bad file can't 500 the whole preview (§0.95 class).
        tolerateUnreadable: true,
      });
      step.succeed(undefined, {
        mode: 'snapshot',
        canRestore: previewState.canRestore,
        fileCount: previewState.previews.length,
      });
      return reply.send({
        validateOnly: true,
        mode: 'snapshot',
        target: toPublicSnapshot({ includeText: body.includeText, snapshot }),
        validation: {
          canRestore: previewState.canRestore,
          fileCount: previewState.previews.length,
        },
        workspaceReview: previewState.workspaceReview,
        preview: previewState.responsePreview,
      });
    },
  );

  app.post(
    '/sessions/:sessionId/restore/apply',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const body = parseBody(restoreApplySchema, request.body);
      const { step } = startRequestWorkflow(request, 'session.restore.apply', undefined, {
        sessionId,
      });

      const session = sqliteGet<{ id: string; metadata_json: string }>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }
      const workspaceRoot =
        extractSessionWorkingDirectory(parseSessionMetadataJson(session.metadata_json)) ??
        WORKSPACE_ROOT;

      if (body.backupId) {
        const backup = getSessionFileBackup({
          backupId: body.backupId,
          sessionId,
          userId: user.sub,
        });
        if (!backup) {
          step.fail('backup not found');
          throw ApiError.notFound(SESSION_ROUTE_ERROR_MESSAGES.backupNotFound);
        }
        const backupContent = await readSessionFileBackupContent({
          backupId: body.backupId,
          sessionId,
          userId: user.sub,
        });
        const previewState = await buildBackupRestorePreviewState({
          backup,
          backupContent,
          includeText: body.includeText,
          workspaceRoot,
        });
        const hasConflicts =
          previewState.workspaceReview.available &&
          previewState.workspaceReview.conflicts.length > 0;
        if (!previewState.canRestore || (hasConflicts && !body.forceConflicts)) {
          step.fail('restore blocked', { mode: 'backup', hasConflicts });
          return reply.status(409).send({
            error: SESSION_ROUTE_ERROR_MESSAGES.restoreBlocked,
            validateOnly: true,
            mode: 'backup',
            target: toPublicBackup({ backup }),
            validation: {
              canRestore: previewState.canRestore,
              currentExists: previewState.current.exists,
              validPath: previewState.current.validPath,
              backupContentAvailable: backupContent !== null,
            },
            hashValidation: previewState.hashValidation,
            workspaceReview: previewState.workspaceReview,
            preview: previewState.preview,
          });
        }

        const clientRequestId = `restore-apply-${randomUUID()}`;
        const applyResult = await applyRestoreOperations({
          clientRequestId,
          sessionId,
          userId: user.sub,
          operations: [
            {
              deleteFile: false,
              filePath: backup.filePath,
              safePath: previewState.current.safePath,
              validPath: previewState.current.validPath,
              currentExists: previewState.current.exists,
              currentContent: previewState.current.content,
              targetContent: backupContent ?? '',
            },
          ],
        });
        step.succeed(undefined, { mode: 'backup', fileCount: applyResult.diffs.length });
        return reply.send({
          applied: true,
          mode: 'backup',
          clientRequestId,
          fileCount: applyResult.diffs.length,
        });
      }

      const snapshot = getSessionSnapshotByRef({
        sessionId,
        userId: user.sub,
        snapshotRef: body.snapshotRef!,
      });
      if (!snapshot) {
        throw ApiError.notFound(SESSION_ROUTE_ERROR_MESSAGES.snapshotNotFound);
      }
      const previewState = await buildSnapshotRestorePreviewState({
        snapshot,
        includeText: body.includeText,
        workspaceRoot,
      });
      const hasConflicts =
        previewState.workspaceReview.available && previewState.workspaceReview.conflicts.length > 0;
      if (!previewState.canRestore || (hasConflicts && !body.forceConflicts)) {
        step.fail('restore blocked', { mode: 'snapshot', hasConflicts });
        return reply.status(409).send({
          error: SESSION_ROUTE_ERROR_MESSAGES.restoreBlocked,
          validateOnly: true,
          mode: 'snapshot',
          target: toPublicSnapshot({ includeText: body.includeText, snapshot }),
          validation: {
            canRestore: previewState.canRestore,
            fileCount: previewState.previews.length,
          },
          workspaceReview: previewState.workspaceReview,
          preview: previewState.responsePreview,
        });
      }

      const clientRequestId = `restore-apply-${randomUUID()}`;
      const applyResult = await applyRestoreOperations({
        clientRequestId,
        sessionId,
        userId: user.sub,
        operations: previewState.previews.map((preview) => ({
          deleteFile: preview.deleteFile,
          filePath: preview.filePath,
          safePath: preview.safePath,
          validPath: preview.validPath,
          currentExists: preview.currentExists,
          currentContent: preview.diff.before,
          targetContent: preview.targetContent,
        })),
      });
      step.succeed(undefined, { mode: 'snapshot', fileCount: applyResult.diffs.length });
      return reply.send({
        applied: true,
        mode: 'snapshot',
        clientRequestId,
        fileCount: applyResult.diffs.length,
      });
    },
  );

  app.get(
    '/sessions/:sessionId/todos',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.todos.get', undefined, { sessionId });

      const session = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const todos = listSessionTodos(sessionId);
      step.succeed(undefined, { count: todos.length });
      return reply.send({ todos });
    },
  );

  app.get(
    '/sessions/:sessionId/todo-lanes',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.todo-lanes.get', undefined, {
        sessionId,
      });

      const session = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const todoLanes = listSessionTodoLanes(sessionId);
      step.succeed(undefined, {
        mainCount: todoLanes.main.length,
        tempCount: todoLanes.temp.length,
      });
      return reply.send(todoLanes);
    },
  );

  const truncateMessagesSchema = z.object({
    messageId: z.string().min(1),
    inclusive: z.boolean().optional().default(true),
    messageText: z.string().optional(),
  });

  app.post(
    '/sessions/:sessionId/messages/truncate',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.messages.truncate', undefined, {
        sessionId,
      });
      const body = parseBody(truncateMessagesSchema, request.body);

      const session = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const messages = truncateSessionMessagesAfter({
        sessionId,
        userId: user.sub,
        messageId: body.messageId,
        inclusive: body.inclusive,
        messageText: body.messageText,
      });
      step.succeed(undefined, { count: messages.length });
      return reply.send({ messages });
    },
  );

  app.delete(
    '/sessions/:sessionId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.delete', undefined, { sessionId });

      const session = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const sessions = sqliteAll<SessionRow>(
        `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`,
        [user.sub],
      );
      const sessionsToDelete = buildSessionDeletionRows(sessions, sessionId);
      await Promise.all(
        sessionsToDelete.map((candidate) =>
          stopAllInFlightStreamRequestsForSession({ sessionId: candidate.id, userId: user.sub }),
        ),
      );
      const reconciledSessionsToDelete = await reconcileSessionRuntimeRowsForResponse(
        sessionsToDelete,
        user.sub,
      );
      const blockingSession = findSessionDeletionBlocker(reconciledSessionsToDelete, user.sub);
      if (blockingSession) {
        step.fail('session not deletable', {
          blockReason: blockingSession.reason,
          blockingSessionId: blockingSession.session.id,
          blockingSessionState: blockingSession.session.state_status,
        });
        return reply.status(409).send({
          blockReason: blockingSession.reason,
          error: SESSION_ROUTE_ERROR_MESSAGES.deleteBlocked,
          sessionId: blockingSession.session.id,
          state_status: blockingSession.session.state_status,
        });
      }

      await deleteSessionTree({ sessionsToDelete: reconciledSessionsToDelete, userId: user.sub });
      step.succeed(undefined, { deletedCount: reconciledSessionsToDelete.length });
      return reply.send({
        deletedSessionIds: reconciledSessionsToDelete.map((candidate) => candidate.id),
        ok: true,
      });
    },
  );

  const patchSessionSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    state_status: z.enum(['idle', 'running', 'paused']).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  app.patch(
    '/sessions/:sessionId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step, child } = startRequestWorkflow(request, 'session.patch', undefined, {
        sessionId,
      });
      const body = parseBody(patchSessionSchema, request.body);

      const session = sqliteGet<SessionRow>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      let nextMetadataJson: string | null = null;
      if (body.metadata !== undefined) {
        const metadataPatch = validateSessionMetadataPatch(body.metadata);
        if (!metadataPatch.success) {
          step.fail('invalid metadata');
          return reply.status(400).send({
            error: SESSION_ROUTE_ERROR_MESSAGES.metadataInvalid,
            issues: metadataPatch.error.issues,
          });
        }
        const currentMetadata = parseSessionMetadataJson(session.metadata_json);
        const requestedWorkingDirectory = getRequestedWorkingDirectory(metadataPatch.data);
        if (
          requestedWorkingDirectory === null &&
          typeof metadataPatch.data['workingDirectory'] === 'string'
        ) {
          const pathStep = child('path-safety');
          pathStep.fail('forbidden path');
          step.fail('forbidden path');
          return reply.status(403).send({ error: SESSION_ROUTE_ERROR_MESSAGES.workspaceForbidden });
        }
        const currentParentSessionId = extractParentSessionIdFromMetadata(currentMetadata);
        const requestedParentSessionId =
          extractParentSessionIdFromMetadata(metadataPatch.data) ?? undefined;
        const parentValidation = validateParentSessionBinding({
          currentParentSessionId,
          parentSessionId: requestedParentSessionId,
          sessionId,
          userId: user.sub,
        });
        if (!parentValidation.ok) {
          step.fail(parentValidation.reason);
          return reply.status(parentValidation.statusCode).send({ error: parentValidation.error });
        }
        if (isSessionWorkspaceRebindingAttempt(currentMetadata, requestedWorkingDirectory)) {
          step.fail('workspace immutable');
          return reply.status(409).send({ error: SESSION_WORKSPACE_IMMUTABLE_ERROR });
        }
        const normalizedMetadata = mergeSessionMetadataForUpdate(
          currentMetadata,
          metadataPatch.data,
        );
        if (normalizedMetadata.workingDirectory === null) {
          const pathStep = child('path-safety');
          pathStep.fail('forbidden path');
          step.fail('forbidden path');
          return reply.status(403).send({ error: SESSION_ROUTE_ERROR_MESSAGES.workspaceForbidden });
        }

        nextMetadataJson = JSON.stringify(normalizedMetadata.metadata);
      }

      if (body.title !== undefined && nextMetadataJson !== null) {
        sqliteRun(
          "UPDATE sessions SET title = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
          [body.title, nextMetadataJson, sessionId, user.sub],
        );
      } else if (body.title !== undefined) {
        sqliteRun(
          "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
          [body.title, sessionId, user.sub],
        );
      } else if (nextMetadataJson !== null) {
        sqliteRun(
          "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
          [nextMetadataJson, sessionId, user.sub],
        );
      }

      // Workspace metadata may have changed (working directory etc).
      // Invalidate the per-user allowlist cache so the next workspace
      // endpoint call sees the new value.
      if (nextMetadataJson !== null) {
        invalidateUserWorkspaceAllowlist(user.sub);
      }

      step.succeed();
      return reply.send({ ok: true });
    },
  );

  // P3-WARP stage 0 (workflow 260509): the legacy contract bound a
  // session to its first workspace forever via
  // `isSessionWorkspaceRebindingAttempt`, which the ADR identified as
  // the primary blocker for "continue this session in another
  // workspace". The endpoint now accepts an explicit `force=true`
  // opt-in: by default the immutable lock still applies (existing
  // callers continue to get 409 if they try to rebind), but a caller
  // that knows what it is doing can flip the toggle to warp the
  // session forward. Each successful warp is logged into
  // `metadata.workspaceWarpHistory` so the workspace-resolution chain
  // and operators can audit the move trail.
  const patchWorkspaceSchema = z.object({
    workingDirectory: z.string().nullable(),
    force: z.boolean().optional(),
  });

  app.patch(
    '/sessions/:sessionId/workspace',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step, child } = startRequestWorkflow(request, 'session.patch.workspace', undefined, {
        sessionId,
      });
      const body = parseBody(patchWorkspaceSchema, request.body);

      const session = sqliteGet<SessionRow>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const metadata = parseSessionMetadataJson(session.metadata_json);
      const currentWorkingDirectory = extractSessionWorkingDirectory(metadata);
      const { workingDirectory, force } = body;
      const isForcedWarp = force === true;
      let safeWorkingDirectory: string | null = null;
      if (workingDirectory === null) {
        if (!isForcedWarp && isSessionWorkspaceRebindingAttempt(metadata, null)) {
          step.fail('workspace immutable');
          return reply.status(409).send({ error: SESSION_WORKSPACE_IMMUTABLE_ERROR });
        }
        delete metadata['workingDirectory'];
      } else {
        safeWorkingDirectory = validateWorkspacePath(workingDirectory);
        if (!safeWorkingDirectory) {
          const pathStep = child('path-safety');
          pathStep.fail('forbidden path');
          step.fail('forbidden path');
          return reply.status(403).send({ error: SESSION_ROUTE_ERROR_MESSAGES.workspaceForbidden });
        }

        if (!isForcedWarp && isSessionWorkspaceRebindingAttempt(metadata, safeWorkingDirectory)) {
          step.fail('workspace immutable');
          return reply.status(409).send({ error: SESSION_WORKSPACE_IMMUTABLE_ERROR });
        }

        metadata['workingDirectory'] = safeWorkingDirectory;
      }
      if (currentWorkingDirectory === safeWorkingDirectory) {
        step.succeed(undefined, { unchanged: true });
        return reply.send({ ok: true, workingDirectory: currentWorkingDirectory });
      }

      // Append a warp-history entry whenever we accept a forced rebind
      // so future audits can reconstruct which workspaces the session
      // has visited. We never throw on a malformed history blob — it
      // is purely additive metadata.
      if (isForcedWarp && currentWorkingDirectory !== null) {
        const existing = metadata['workspaceWarpHistory'];
        const history = Array.isArray(existing) ? [...existing] : [];
        history.push({
          from: currentWorkingDirectory,
          to: safeWorkingDirectory,
          at: new Date().toISOString(),
        });
        // Cap the history to a reasonable size so a runaway script
        // can't unbound-grow the metadata blob.
        const TRIM = 50;
        metadata['workspaceWarpHistory'] = history.slice(-TRIM);
      }

      sqliteRun(
        "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [JSON.stringify(metadata), sessionId, user.sub],
      );

      step.succeed(undefined, isForcedWarp ? { warped: true } : undefined);
      // Workspace warp may have introduced a new working directory.
      // Refresh the per-user allowlist cache.
      invalidateUserWorkspaceAllowlist(user.sub);
      return reply.send({
        ok: true,
        workingDirectory: safeWorkingDirectory,
        ...(isForcedWarp ? { warped: true } : {}),
      });
    },
  );

  app.get(
    '/sessions/:sessionId/children',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.children.list', undefined, {
        sessionId,
      });
      const query = parseQuery(
        childSessionQuerySchema,
        (request as FastifyRequest & { query: unknown }).query,
      );

      const parent = sqliteGet<SessionRow>(
        `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
        [sessionId, user.sub],
      );

      if (!parent) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const sessions = sqliteAll<SessionRow>(
        `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`,
        [user.sub],
      );

      const descendantSessionIds = [...collectDescendantSessionIds(sessions, sessionId)].filter(
        (childSessionId) => childSessionId !== sessionId,
      );

      const childRows = await reconcileSessionRuntimeRowsForResponse(
        descendantSessionIds
          .map(
            (childSessionId) => sessions.find((session) => session.id === childSessionId) ?? null,
          )
          .filter((session): session is SessionRow => session !== null)
          .slice(query.offset, query.offset + query.limit),
        user.sub,
      );

      const children = childRows.map((session) =>
        toPublicSessionResponse(
          {
            ...session,
            metadata_json: sanitizeSessionMetadataJson(session.metadata_json),
          },
          filterVisibleSessionMessages(
            listSessionMessagesV2({
              sessionId: session.id,
              userId: user.sub,
            }),
          ),
        ),
      );

      step.succeed(undefined, { count: children.length });
      return reply.send({ sessions: children });
    },
  );

  app.get(
    '/sessions/:sessionId/tasks',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.tasks.get', undefined, { sessionId });

      const session = sqliteGet<SessionRow>(
        `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
        [sessionId, user.sub],
      );

      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const sessions = sqliteAll<SessionRow>(
        `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`,
        [user.sub],
      );
      const sessionsById = new Map(sessions.map((candidate) => [candidate.id, candidate]));
      const visibleSessionIds = new Set<string>([
        ...collectAncestorSessionIds(sessionsById, sessionId),
        ...collectDescendantSessionIds(sessions, sessionId),
      ]);
      const reconciledSessions = await reconcileSessionRuntimeRowsForResponse(
        sessions.filter((candidate) => visibleSessionIds.has(candidate.id)),
        user.sub,
      );
      const reconciledSessionsById = new Map(
        reconciledSessions.map((candidate) => [candidate.id, candidate] as const),
      );
      const mergedSessions = sessions.map(
        (candidate) => reconciledSessionsById.get(candidate.id) ?? candidate,
      );
      const includedSessionIds = collectDescendantSessionIds(mergedSessions, sessionId);
      const { tasks, updatedAt } = await buildMergedSessionTaskProjection({
        includedSessionIds,
        sessions: mergedSessions,
        sessionId,
      });
      step.succeed(undefined, { count: tasks.length });
      return reply.send({ tasks, updatedAt });
    },
  );

  app.post(
    '/sessions/:sessionId/tasks/:taskId/cancel',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId, taskId } = request.params as { sessionId: string; taskId: string };
      const { step } = startRequestWorkflow(request, 'session.task.cancel', undefined, {
        sessionId,
        taskId,
      });

      const session = sqliteGet<SessionRow>(
        `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
        [sessionId, user.sub],
      );
      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const sessions = sqliteAll<SessionRow>(
        `SELECT ${buildSafeSessionSelectColumns()} FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`,
        [user.sub],
      );
      const includedSessionIds = collectDescendantSessionIds(sessions, sessionId);
      const taskEntry = await findVisibleTaskEntry({
        includedSessionIds,
        sessionId,
        sessions,
        taskId,
      });
      if (!taskEntry) {
        step.fail('task not found');
        return reply.status(404).send({ error: SESSION_ROUTE_ERROR_MESSAGES.taskNotFound });
      }

      if (
        taskEntry.task.status === 'completed' ||
        taskEntry.task.status === 'failed' ||
        taskEntry.task.status === 'cancelled'
      ) {
        step.fail('task not cancellable');
        return reply.status(409).send({ error: SESSION_ROUTE_ERROR_MESSAGES.taskNotCancellable });
      }

      const childSessionId = taskEntry.task.sessionId;
      if (childSessionId) {
        const result = await terminateChildSession({
          childSessionId,
          graphSessionId: taskEntry.graphSessionId,
          reason: 'cancelled',
          taskId,
          userId: user.sub,
        });
        step.succeed(undefined, { cancelled: result.terminated, stopped: result.stopped });
        return reply.send({ cancelled: result.terminated, stopped: result.stopped });
      }

      taskManager.cancelTask(taskEntry.graph, taskId);
      await taskManager.save(taskEntry.graph);

      step.succeed(undefined, { cancelled: true, stopped: false });
      return reply.send({ cancelled: true, stopped: false });
    },
  );

  const importSessionSchema = z.object({
    id: z.string().optional(),
    messages: z.array(z.unknown()).default([]),
    exportedAt: z.string().optional(),
  });

  app.post(
    '/sessions/import',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.import');
      const user = request.user as JwtPayload;
      const body = parseBody(importSessionSchema, request.body);

      const id = randomUUID();
      const normalizedMessages = normalizeImportedMessages(body.messages);
      const validation = validateImportedMessagesPayload(normalizedMessages);
      if (!validation.ok) {
        step.fail('import too large');
        return reply.status(413).send({ error: validation.error });
      }
      sqliteRun(
        'INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json) VALUES (?, ?, ?, ?, ?)',
        [id, user.sub, validation.serializedMessages, 'idle', '{}'],
      );
      step.succeed(undefined, {
        sessionId: id,
        messages: normalizedMessages.length,
      });
      return reply.status(201).send({ sessionId: id });
    },
  );
}

function normalizeImportedMessages(messages: unknown[]): unknown[] {
  return messages.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return message;
    }
    return {
      ...(message as Record<string, unknown>),
      id: makeOrderedMessageId(),
    };
  });
}

export function extractParentSessionIdFromMetadata(
  metadata: Record<string, unknown>,
): string | null {
  const parentSessionId = metadata['parentSessionId'];
  return typeof parentSessionId === 'string' ? parentSessionId : null;
}

function getRequestedWorkingDirectory(
  metadata: Record<string, unknown>,
): string | null | undefined {
  const workingDirectory = metadata['workingDirectory'];
  if (typeof workingDirectory !== 'string') {
    return undefined;
  }

  return validateWorkspacePath(workingDirectory);
}

export function validateParentSessionBinding(input: {
  currentParentSessionId?: string | null;
  parentSessionId?: string | null;
  sessionId?: string;
  userId: string;
}): { ok: true } | { error: string; ok: false; reason: string; statusCode: number } {
  if (!input.parentSessionId) {
    return { ok: true };
  }

  if (input.sessionId && input.parentSessionId === input.sessionId) {
    return {
      ok: false,
      statusCode: 400,
      reason: 'invalid parent',
      error: SESSION_ROUTE_ERROR_MESSAGES.selfParent,
    };
  }

  if (input.currentParentSessionId && input.currentParentSessionId !== input.parentSessionId) {
    return {
      ok: false,
      statusCode: 409,
      reason: 'parent immutable',
      error: SESSION_PARENT_IMMUTABLE_ERROR,
    };
  }

  const parentSession = sqliteGet<{ id: string }>(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.parentSessionId, input.userId],
  );
  if (!parentSession) {
    return {
      ok: false,
      statusCode: 404,
      reason: 'parent not found',
      error: SESSION_ROUTE_ERROR_MESSAGES.parentNotFound,
    };
  }

  return { ok: true };
}

function parseParentSessionId(metadataJson: string): string | null {
  try {
    const parsed = JSON.parse(metadataJson) as { parentSessionId?: unknown };
    return typeof parsed.parentSessionId === 'string' ? parsed.parentSessionId : null;
  } catch {
    return null;
  }
}

export { normalizeImportedMessages };
