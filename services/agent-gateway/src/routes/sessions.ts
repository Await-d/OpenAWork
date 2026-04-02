import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AgentTaskManagerImpl, AgentTaskStoreImpl } from '@openAwork/agent-core';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { WORKSPACE_ROOT, sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import { listSessionMessages, truncateSessionMessagesAfter } from '../session-message-store.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { buildSessionTaskProjection, type SessionTaskResponse } from './session-task-projection.js';
import {
  toPublicSessionResponse,
  validateImportedMessagesPayload,
} from './session-route-helpers.js';
import { validateWorkspacePath } from '../workspace-paths.js';
import {
  extractSessionWorkingDirectory,
  isSessionWorkspaceRebindingAttempt,
  mergeSessionMetadataForUpdate,
  normalizeIncomingSessionMetadata,
  parseSessionMetadataJson,
  sanitizeSessionMetadataJson,
  validateSessionMetadataPatch,
} from '../session-workspace-metadata.js';
import { listSessionTodoLanes, listSessionTodos } from '../todo-tools.js';
import {
  buildTaskUpdateEvent,
  readTaskParentToolReference,
  syncParentTaskToolResult,
} from '../tool-sandbox.js';
import {
  clearPendingTaskParentAutoResumesForSession,
  clearTaskParentAutoResumeContext,
} from '../task-parent-auto-resume.js';
import { publishSessionRunEvent } from '../session-run-events.js';
import {
  getAnyInFlightStreamRequestForSession,
  stopAllInFlightStreamRequestsForSession,
} from './stream-cancellation.js';
import { reconcileSessionRuntime } from '../session-runtime-reconciler.js';
import { deleteSessionWithMalformedRecovery } from '../session-delete-recovery.js';
import { buildSessionFileChangesProjection } from '../session-file-changes-projection.js';
import { listRequestFileDiffs, listSessionFileDiffs } from '../session-file-diff-store.js';
import { isSqliteMalformedError } from '../sqlite-error-utils.js';
import {
  compareSessionSnapshots,
  getSessionSnapshotByRef,
  listRequestSnapshots,
  listSessionSnapshots,
} from '../session-snapshot-store.js';
import { hasFreshSessionRuntimeThread } from '../session-runtime-thread-store.js';
import { hasPendingSessionInteraction } from '../session-runtime-state.js';

const createSessionSchema = z.object({
  metadata: z.record(z.unknown()).optional().default({}),
  workingDirectory: z.string().optional(),
});

interface SessionRow {
  id: string;
  user_id: string;
  messages_json: string;
  state_status: string;
  metadata_json: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

const snapshotCompareQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  includeText: z.coerce.boolean().optional().default(false),
});

const fileChangesQuerySchema = z.object({
  includeText: z.coerce.boolean().optional().default(false),
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

function collectDescendantSessionIds(sessions: SessionRow[], rootSessionId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();

  for (const session of sessions) {
    const parentSessionId = parseParentSessionId(session.metadata_json);
    if (!parentSessionId) {
      continue;
    }

    const existingChildren = childrenByParent.get(parentSessionId) ?? [];
    existingChildren.push(session.id);
    childrenByParent.set(parentSessionId, existingChildren);
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
  let currentSessionId: string | null = sessionId;

  while (currentSessionId && !visited.has(currentSessionId)) {
    collectedSessionIds.push(currentSessionId);
    visited.add(currentSessionId);

    const currentSession = sessionsById.get(currentSessionId);
    currentSessionId = currentSession ? parseParentSessionId(currentSession.metadata_json) : null;
  }

  return collectedSessionIds;
}

function buildSessionDeletionRows(sessions: SessionRow[], rootSessionId: string): SessionRow[] {
  const rowsById = new Map(sessions.map((session) => [session.id, session]));
  const childrenByParent = new Map<string, string[]>();

  for (const session of sessions) {
    const parentSessionId = parseParentSessionId(session.metadata_json);
    if (!parentSessionId) {
      continue;
    }

    const existingChildren = childrenByParent.get(parentSessionId) ?? [];
    existingChildren.push(session.id);
    childrenByParent.set(parentSessionId, existingChildren);
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
  for (const session of input.sessionsToDelete) {
    clearPendingTaskParentAutoResumesForSession({ sessionId: session.id, userId: input.userId });

    try {
      sqliteRun('DELETE FROM sessions WHERE id = ? AND user_id = ?', [session.id, input.userId]);
    } catch (error) {
      if (!isSqliteMalformedError(error)) {
        throw error;
      }

      deleteSessionWithMalformedRecovery({ sessionId: session.id, userId: input.userId });
    }

    await taskStore.deleteGraph(WORKSPACE_ROOT, session.id);
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

async function buildMergedSessionTaskProjection(input: {
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
    .map((childSessionId) => {
      const childRow = sessionsById.get(childSessionId);

      return childRow ? parseParentSessionId(childRow.metadata_json) : null;
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
    ),
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

function parseRequestedSkillsFromMetadata(metadata: Record<string, unknown>): string[] {
  const requestedSkills = metadata['requestedSkills'];
  return Array.isArray(requestedSkills)
    ? requestedSkills.filter(
        (skill): skill is string => typeof skill === 'string' && skill.length > 0,
      )
    : [];
}

const childSessionQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0),
});

const taskManager = new AgentTaskManagerImpl();
const taskStore = new AgentTaskStoreImpl();
const SESSION_WORKSPACE_IMMUTABLE_ERROR = 'Session workspace cannot be moved after binding';
const SESSION_PARENT_IMMUTABLE_ERROR = 'Session parent cannot be changed after binding';

async function reconcileSessionRuntimeForResponse(
  session: SessionRow,
  userId: string,
): Promise<SessionRow> {
  const reconciliation = await reconcileSessionRuntime({ sessionId: session.id, userId });

  if (!reconciliation.status || reconciliation.status === session.state_status) {
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

export async function sessionsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/sessions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'session.create');
      const user = request.user as JwtPayload;
      const body = createSessionSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const { metadata, workingDirectory } = body.data;
      const metadataPatch = validateSessionMetadataPatch(metadata);
      if (!metadataPatch.success) {
        step.fail('invalid metadata');
        return reply
          .status(400)
          .send({ error: 'Invalid metadata', issues: metadataPatch.error.issues });
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
        return reply.status(403).send({ error: 'Forbidden' });
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
      const query = z
        .object({
          limit: z.coerce.number().min(1).max(100).default(20),
          offset: z.coerce.number().min(0).default(0),
        })
        .safeParse((request as FastifyRequest & { query: unknown }).query);

      if (!query.success) {
        step.fail('invalid query params');
        return reply.status(400).send({ error: 'Invalid query params' });
      }

      const { limit, offset } = query.data;
      const sessions = await reconcileSessionRuntimeRowsForResponse(
        sqliteAll<SessionRow>(
          'SELECT id, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
          [user.sub, limit, offset],
        ).map((session) => ({
          ...session,
          metadata_json: sanitizeSessionMetadataJson(session.metadata_json),
        })),
        user.sub,
      ).then((rows) =>
        rows.map((session) => ({
          ...session,
          fileChangesSummary: buildSessionFileChangesSummary({
            sessionId: session.id,
            userId: user.sub,
          }),
        })),
      );
      step.succeed(undefined, { count: sessions.length });
      return reply.send({ sessions });
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
        'SELECT id, messages_json, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );

      if (!session) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }
      const reconciledSession = await reconcileSessionRuntimeForResponse(session, user.sub);
      step.succeed();
      const todos = listSessionTodos(sessionId);
      const response = toPublicSessionResponse(
        {
          ...reconciledSession,
          metadata_json: sanitizeSessionMetadataJson(reconciledSession.metadata_json),
        },
        listSessionMessages({
          sessionId,
          userId: user.sub,
          legacyMessagesJson: session.messages_json,
        }),
        todos,
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
    '/sessions/:sessionId/file-changes',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const query = fileChangesQuerySchema.safeParse(
        (request as FastifyRequest & { query: unknown }).query,
      );
      const { step } = startRequestWorkflow(request, 'session.file-changes.get', undefined, {
        sessionId,
      });
      if (!query.success) {
        step.fail('invalid query');
        return reply
          .status(400)
          .send({ error: 'Invalid query params', issues: query.error.issues });
      }

      const session = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const fileChanges = buildSessionFileChangesProjection({
        fileDiffs: listSessionFileDiffs({ sessionId, userId: user.sub }),
        snapshots: listSessionSnapshots({ sessionId, userId: user.sub }),
      });
      step.succeed(undefined, {
        diffCount: fileChanges.summary.totalFileDiffs,
        snapshotCount: fileChanges.summary.snapshotCount,
      });
      return reply.send({
        fileChanges: {
          ...fileChanges,
          fileDiffs: fileChanges.fileDiffs.map((diff) =>
            toPublicFileDiff(diff, query.data.includeText),
          ),
          snapshots: fileChanges.snapshots.map((snapshot) =>
            toPublicSnapshot({ includeText: query.data.includeText, snapshot }),
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
      const query = fileChangesQuerySchema.safeParse(
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
      if (!query.success) {
        step.fail('invalid query');
        return reply
          .status(400)
          .send({ error: 'Invalid query params', issues: query.error.issues });
      }

      const session = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const fileChanges = buildSessionFileChangesProjection({
        fileDiffs: listRequestFileDiffs({ clientRequestId, sessionId, userId: user.sub }),
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
          fileDiffs: fileChanges.fileDiffs.map((diff) =>
            toPublicFileDiff(diff, query.data.includeText),
          ),
          snapshots: fileChanges.snapshots.map((snapshot) =>
            toPublicSnapshot({ includeText: query.data.includeText, snapshot }),
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

      const session = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
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
      const query = snapshotCompareQuerySchema.safeParse(
        (request as FastifyRequest & { query: unknown }).query,
      );
      if (!query.success) {
        step.fail('invalid query');
        return reply
          .status(400)
          .send({ error: 'Invalid query params', issues: query.error.issues });
      }

      const session = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const fromSnapshot = getSessionSnapshotByRef({
        sessionId,
        userId: user.sub,
        snapshotRef: query.data.from,
      });
      const toSnapshot = getSessionSnapshotByRef({
        sessionId,
        userId: user.sub,
        snapshotRef: query.data.to,
      });
      if (!fromSnapshot || !toSnapshot) {
        step.fail('snapshot not found');
        return reply.status(404).send({ error: 'Snapshot not found' });
      }

      const comparison = compareSessionSnapshots({ from: fromSnapshot, to: toSnapshot }).map(
        (item) =>
          query.data.includeText
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
        from: toPublicSnapshot({ includeText: query.data.includeText, snapshot: fromSnapshot }),
        to: toPublicSnapshot({ includeText: query.data.includeText, snapshot: toSnapshot }),
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
      const query = fileChangesQuerySchema.safeParse(
        (request as FastifyRequest & { query: unknown }).query,
      );
      const { step } = startRequestWorkflow(request, 'session.snapshot.get', undefined, {
        sessionId,
        snapshotRef,
      });
      if (!query.success) {
        step.fail('invalid query');
        return reply
          .status(400)
          .send({ error: 'Invalid query params', issues: query.error.issues });
      }

      const session = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const snapshot = getSessionSnapshotByRef({ sessionId, userId: user.sub, snapshotRef });
      if (!snapshot) {
        step.fail('snapshot not found');
        return reply.status(404).send({ error: 'Snapshot not found' });
      }

      step.succeed(undefined, { fileCount: snapshot.files.length, snapshotRef });
      return reply.send({
        snapshot: toPublicSnapshot({ includeText: query.data.includeText, snapshot }),
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
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
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
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
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
      const body = truncateMessagesSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const session = sqliteGet<SessionRow>(
        'SELECT id, messages_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const messages = truncateSessionMessagesAfter({
        sessionId,
        userId: user.sub,
        messageId: body.data.messageId,
        legacyMessagesJson: session.messages_json,
        inclusive: body.data.inclusive,
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
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const sessions = sqliteAll<SessionRow>(
        'SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC',
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
          error: 'Session can only be deleted when every related session is idle',
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
      const body = patchSessionSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const session = sqliteGet<SessionRow>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      let nextMetadataJson: string | null = null;
      if (body.data.metadata !== undefined) {
        const metadataPatch = validateSessionMetadataPatch(body.data.metadata);
        if (!metadataPatch.success) {
          step.fail('invalid metadata');
          return reply
            .status(400)
            .send({ error: 'Invalid metadata', issues: metadataPatch.error.issues });
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
          return reply.status(403).send({ error: 'Forbidden' });
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
          return reply.status(403).send({ error: 'Forbidden' });
        }

        nextMetadataJson = JSON.stringify(normalizedMetadata.metadata);
      }

      if (body.data.title !== undefined && nextMetadataJson !== null) {
        sqliteRun(
          "UPDATE sessions SET title = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
          [body.data.title, nextMetadataJson, sessionId, user.sub],
        );
      } else if (body.data.title !== undefined) {
        sqliteRun(
          "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
          [body.data.title, sessionId, user.sub],
        );
      } else if (nextMetadataJson !== null) {
        sqliteRun(
          "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
          [nextMetadataJson, sessionId, user.sub],
        );
      }

      step.succeed();
      return reply.send({ ok: true });
    },
  );

  const patchWorkspaceSchema = z.object({
    workingDirectory: z.string().nullable(),
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
      const body = patchWorkspaceSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const session = sqliteGet<SessionRow>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const metadata = parseSessionMetadataJson(session.metadata_json);
      const currentWorkingDirectory = extractSessionWorkingDirectory(metadata);
      const { workingDirectory } = body.data;
      let safeWorkingDirectory: string | null = null;
      if (workingDirectory === null) {
        if (isSessionWorkspaceRebindingAttempt(metadata, null)) {
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
          return reply.status(403).send({ error: 'Forbidden' });
        }

        if (isSessionWorkspaceRebindingAttempt(metadata, safeWorkingDirectory)) {
          step.fail('workspace immutable');
          return reply.status(409).send({ error: SESSION_WORKSPACE_IMMUTABLE_ERROR });
        }

        metadata['workingDirectory'] = safeWorkingDirectory;
      }
      if (currentWorkingDirectory === safeWorkingDirectory) {
        step.succeed(undefined, { unchanged: true });
        return reply.send({ ok: true, workingDirectory: currentWorkingDirectory });
      }

      sqliteRun(
        "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [JSON.stringify(metadata), sessionId, user.sub],
      );

      step.succeed();
      return reply.send({ ok: true, workingDirectory: safeWorkingDirectory });
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
      const query = childSessionQuerySchema.safeParse(
        (request as FastifyRequest & { query: unknown }).query,
      );
      if (!query.success) {
        step.fail('invalid query params');
        return reply.status(400).send({ error: 'Invalid query params' });
      }

      const parent = sqliteGet<SessionRow>(
        'SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );

      if (!parent) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const sessions = sqliteAll<SessionRow>(
        'SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC',
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
          .slice(query.data.offset, query.data.offset + query.data.limit),
        user.sub,
      );

      const children = childRows.map((session) =>
        toPublicSessionResponse(
          {
            ...session,
            metadata_json: sanitizeSessionMetadataJson(session.metadata_json),
          },
          listSessionMessages({
            sessionId: session.id,
            userId: user.sub,
            legacyMessagesJson: session.messages_json,
          }),
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
        'SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );

      if (!session) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const sessions = sqliteAll<SessionRow>(
        'SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC',
        [user.sub],
      );
      const sessionsById = new Map(sessions.map((candidate) => [candidate.id, candidate]));
      const visibleSessionIds = new Set<string>([
        ...collectAncestorSessionIds(sessionsById, sessionId),
        ...collectDescendantSessionIds(sessions, sessionId),
      ]);
      await reconcileSessionRuntimeRowsForResponse(
        sessions.filter((candidate) => visibleSessionIds.has(candidate.id)),
        user.sub,
      );
      const includedSessionIds = collectDescendantSessionIds(sessions, sessionId);
      const { tasks, updatedAt } = await buildMergedSessionTaskProjection({
        includedSessionIds,
        sessions,
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
        'SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!session) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      const sessions = sqliteAll<SessionRow>(
        'SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC',
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
        return reply.status(404).send({ error: 'Task not found' });
      }

      if (
        taskEntry.task.status === 'completed' ||
        taskEntry.task.status === 'failed' ||
        taskEntry.task.status === 'cancelled'
      ) {
        step.fail('task not cancellable');
        return reply.status(409).send({ error: 'Task is not cancellable' });
      }

      taskManager.cancelTask(taskEntry.graph, taskId);
      await taskManager.save(taskEntry.graph);

      const childSessionId = taskEntry.task.sessionId;
      if (childSessionId) {
        clearTaskParentAutoResumeContext({ childSessionId, userId: user.sub });
        sqliteRun(
          "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
          [childSessionId, user.sub],
        );
      }

      const stopped = childSessionId
        ? (await stopAllInFlightStreamRequestsForSession({
            sessionId: childSessionId,
            userId: user.sub,
          })) > 0
        : false;

      if (!stopped && childSessionId) {
        const childSession = sqliteGet<{ metadata_json: string }>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [childSessionId, user.sub],
        );
        const childMetadata = childSession
          ? parseSessionMetadataJson(childSession.metadata_json)
          : {};
        syncParentTaskToolResult({
          assignedAgent:
            taskEntry.task.assignedAgent ??
            (typeof childMetadata['subagentType'] === 'string'
              ? childMetadata['subagentType']
              : 'task'),
          category:
            typeof childMetadata['taskCategory'] === 'string'
              ? childMetadata['taskCategory']
              : undefined,
          parentSessionId: taskEntry.graphSessionId,
          parentToolReference: readTaskParentToolReference(childMetadata),
          requestedSkills: parseRequestedSkillsFromMetadata(childMetadata),
          sessionId: childSessionId,
          status: 'cancelled',
          taskId,
          userId: user.sub,
        });
        publishSessionRunEvent(
          taskEntry.graphSessionId,
          buildTaskUpdateEvent({
            assignedAgent:
              taskEntry.task.assignedAgent ??
              (typeof childMetadata['subagentType'] === 'string'
                ? childMetadata['subagentType']
                : 'task'),
            category:
              typeof childMetadata['taskCategory'] === 'string'
                ? childMetadata['taskCategory']
                : undefined,
            childSessionId,
            parentSessionId: taskEntry.graphSessionId,
            requestedSkills: parseRequestedSkillsFromMetadata(childMetadata),
            status: 'cancelled',
            taskId,
            taskTitle: taskEntry.task.title,
          }),
        );
      }

      step.succeed(undefined, { cancelled: true, stopped });
      return reply.send({ cancelled: true, stopped });
    },
  );

  const importSchema = z.object({
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
      const body = importSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid import data');
        return reply.status(400).send({ error: 'Invalid import data', issues: body.error.issues });
      }

      const id = randomUUID();
      const normalizedMessages = normalizeImportedMessages(body.data.messages);
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
      id: randomUUID(),
    };
  });
}

function extractParentSessionIdFromMetadata(metadata: Record<string, unknown>): string | null {
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

function validateParentSessionBinding(input: {
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
      error: 'Session cannot be its own parent',
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
      error: 'Parent session not found',
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
