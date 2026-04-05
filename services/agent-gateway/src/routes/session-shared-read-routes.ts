import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteGet } from '../db.js';
import {
  createSharedSessionComment,
  listSharedSessionComments,
} from '../session-shared-comment-store.js';
import { filterVisibleSessionMessages, listSessionMessages } from '../session-message-store.js';
import {
  getSharedSessionForRecipient,
  listSharedSessionsForRecipient,
} from '../session-shared-access.js';
import { buildSessionFileChangesProjection } from '../session-file-changes-projection.js';
import { listSessionFileDiffs } from '../session-file-diff-store.js';
import { listSessionRunEvents } from '../session-run-events.js';
import { listSessionSnapshots } from '../session-snapshot-store.js';
import { reconcileSessionRuntime } from '../session-runtime-reconciler.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { sanitizeSessionMetadataJson } from '../session-workspace-metadata.js';
import { listSessionTodos } from '../todo-tools.js';
import { toPublicSessionResponse } from './session-route-helpers.js';

interface SessionRow {
  created_at: string;
  id: string;
  messages_json: string;
  metadata_json: string;
  state_status: string;
  title: string | null;
  updated_at: string;
  user_id: string;
}

const sharedSessionsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

const sharedSessionCommentSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

function canWriteSharedComment(permission: 'view' | 'comment' | 'operate'): boolean {
  return permission === 'comment' || permission === 'operate';
}

function buildSessionFileChangesSummary(input: { sessionId: string; userId: string }) {
  return buildSessionFileChangesProjection({
    fileDiffs: listSessionFileDiffs({ sessionId: input.sessionId, userId: input.userId }),
    snapshots: listSessionSnapshots({ sessionId: input.sessionId, userId: input.userId }),
  }).summary;
}

async function reconcileSessionRuntimeForResponse(
  session: SessionRow,
  userId: string,
): Promise<SessionRow> {
  const reconciliation = await reconcileSessionRuntime({ sessionId: session.id, userId });

  if (!reconciliation.status) {
    return session;
  }

  const refreshedSession = sqliteGet<SessionRow>(
    'SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
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

export async function registerSessionSharedReadRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/sessions/shared-with-me',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { step } = startRequestWorkflow(request, 'session.shared.list');
      const query = sharedSessionsQuerySchema.safeParse(
        (request as FastifyRequest & { query: unknown }).query,
      );
      if (!query.success) {
        step.fail('invalid query params');
        return reply.status(400).send({ error: 'Invalid query params' });
      }

      const shares = listSharedSessionsForRecipient({
        email: user.email,
        limit: query.data.limit,
        offset: query.data.offset,
      }).map((share) => ({
        sessionId: share.session.id,
        title: share.session.title,
        stateStatus: share.session.stateStatus,
        workspacePath: share.session.workspacePath,
        sharedByEmail: share.sharedByEmail,
        permission: share.permission,
        createdAt: share.session.createdAt,
        updatedAt: share.session.updatedAt,
        shareCreatedAt: share.shareCreatedAt,
        shareUpdatedAt: share.shareUpdatedAt,
      }));

      step.succeed(undefined, { count: shares.length });
      return reply.send({ sessions: shares });
    },
  );

  app.get(
    '/sessions/shared-with-me/:sessionId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.shared.get', undefined, {
        sessionId,
      });

      const sharedAccess = getSharedSessionForRecipient({ email: user.email, sessionId });
      if (!sharedAccess) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Shared session not found' });
      }

      const sessionRow: SessionRow = {
        id: sharedAccess.session.id,
        user_id: sharedAccess.ownerUserId,
        messages_json: sharedAccess.messagesJson,
        state_status: sharedAccess.session.stateStatus,
        metadata_json: sharedAccess.session.metadataJson,
        title: sharedAccess.session.title,
        created_at: sharedAccess.session.createdAt,
        updated_at: sharedAccess.session.updatedAt,
      };
      const reconciledSession = await reconcileSessionRuntimeForResponse(
        sessionRow,
        sharedAccess.ownerUserId,
      );
      const session = toPublicSessionResponse(
        {
          ...reconciledSession,
          metadata_json: sanitizeSessionMetadataJson(reconciledSession.metadata_json),
        },
        filterVisibleSessionMessages(
          listSessionMessages({
            sessionId,
            userId: sharedAccess.ownerUserId,
            legacyMessagesJson: sharedAccess.messagesJson,
          }),
        ),
        listSessionTodos(sessionId),
        listSessionRunEvents(sessionId),
      );

      step.succeed(undefined, { permission: sharedAccess.permission, sessionId });
      return reply.send({
        share: {
          sessionId: sharedAccess.session.id,
          title: sharedAccess.session.title,
          stateStatus: reconciledSession.state_status,
          workspacePath: sharedAccess.session.workspacePath,
          sharedByEmail: sharedAccess.sharedByEmail,
          permission: sharedAccess.permission,
          createdAt: sharedAccess.session.createdAt,
          updatedAt: sharedAccess.session.updatedAt,
          shareCreatedAt: sharedAccess.shareCreatedAt,
          shareUpdatedAt: sharedAccess.shareUpdatedAt,
        },
        comments: listSharedSessionComments({
          ownerUserId: sharedAccess.ownerUserId,
          sessionId,
        }),
        session: {
          ...session,
          fileChangesSummary: buildSessionFileChangesSummary({
            sessionId,
            userId: sharedAccess.ownerUserId,
          }),
        },
      });
    },
  );

  app.post(
    '/sessions/shared-with-me/:sessionId/comments',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'session.shared.comment.create', undefined, {
        sessionId,
      });
      const body = sharedSessionCommentSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const sharedAccess = getSharedSessionForRecipient({ email: user.email, sessionId });
      if (!sharedAccess) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Shared session not found' });
      }

      if (!canWriteSharedComment(sharedAccess.permission)) {
        step.fail('forbidden');
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const comment = createSharedSessionComment({
        ownerUserId: sharedAccess.ownerUserId,
        sessionId,
        authorUserId: user.sub,
        authorEmail: user.email,
        content: body.data.content,
      });
      step.succeed(undefined, { commentId: comment.id });
      return reply.status(201).send({ comment });
    },
  );
}
