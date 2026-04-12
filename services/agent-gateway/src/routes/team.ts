import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';
import {
  normalizeIncomingSessionMetadata,
  parseSessionMetadataJson,
  validateSessionMetadataPatch,
} from '../session-workspace-metadata.js';
import { resolveSessionWorkspacePath } from '../session-workspace-resolution.js';
import { mergeRuntimeTaskGroups } from '../team-runtime-task-groups.js';
import { listSharedSessionsForRecipient } from '../session-shared-access.js';
import { listTeamAuditLogs, logTeamAudit, type TeamAuditAction } from '../team-audit-store.js';
import {
  buildMergedSessionTaskProjection,
  extractParentSessionIdFromMetadata,
  normalizeImportedMessages,
  type SessionRow,
  validateParentSessionBinding,
} from './sessions.js';
import { validateImportedMessagesPayload } from './session-route-helpers.js';

const createMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
  avatarUrl: z.string().url().optional(),
});

const createWorkspaceSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  visibility: z.enum(['open', 'closed', 'private']).default('private'),
  defaultWorkingRoot: z.string().min(1).nullable().optional(),
});

const updateWorkspaceSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    visibility: z.enum(['open', 'closed', 'private']).optional(),
    defaultWorkingRoot: z.string().min(1).nullable().optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.description !== undefined ||
      input.visibility !== undefined ||
      input.defaultWorkingRoot !== undefined,
    {
      message: 'At least one field is required',
    },
  );

const createThreadSchema = z.object({
  metadata: z.record(z.unknown()).optional().default({}),
  title: z.string().min(1).max(200).optional(),
});

const importWorkspaceSessionSchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.unknown()).default([]),
  exportedAt: z.string().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  assigneeId: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'done']).default('pending'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

const updateTaskSchema = z.object({
  assigneeId: z.string().nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'done', 'failed']).optional(),
  result: z.string().nullable().optional(),
});

const createMessageSchema = z.object({
  senderId: z.string().optional(),
  content: z.string().min(1),
  type: z.enum(['update', 'question', 'result', 'error']).default('update'),
});

const createSessionShareSchema = z.object({
  memberId: z.string().min(1),
  permission: z.enum(['view', 'comment', 'operate']).default('view'),
  sessionId: z.string().min(1),
});

const updateSessionShareSchema = z.object({
  permission: z.enum(['view', 'comment', 'operate']),
});

const auditLogsQuerySchema = z.object({
  limit: z
    .preprocess((value) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        return Number(value);
      }
      return value;
    }, z.number().int().min(1).max(100).optional())
    .default(20),
});

interface SessionShareRow {
  created_at: string;
  id: string;
  label: string | null;
  member_email: string;
  member_id: string;
  member_name: string;
  permission: 'view' | 'comment' | 'operate';
  session_id: string;
  session_metadata_json: string;
  updated_at: string;
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  status: string;
  created_at: string;
}

interface TeamWorkspaceRow {
  created_at: string;
  default_working_root: string | null;
  description: string | null;
  id: string;
  name: string;
  updated_at: string;
  user_id: string;
  visibility: 'open' | 'closed' | 'private';
}

interface TaskRow {
  id: string;
  title: string;
  assignee_id: string | null;
  status: string;
  priority: string;
  result: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  sender_id: string | null;
  content: string;
  type: string;
  created_at: string;
}

interface TeamRuntimeTaskGroupRecord {
  sessionIds: string[];
  tasks: Awaited<ReturnType<typeof buildMergedSessionTaskProjection>>['tasks'];
  updatedAt: number;
  workspacePath: string | null;
}

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  const normalizeMemberStatus = (status: string): 'idle' | 'working' | 'done' | 'error' => {
    if (status === 'working' || status === 'done' || status === 'error') return status;
    return 'idle';
  };

  const getWorkspacePathFromMetadataJson = (input: {
    metadataJson: string;
    sessionId: string;
    userId: string;
  }): string | null =>
    resolveSessionWorkspacePath({
      metadataJson: input.metadataJson,
      sessionId: input.sessionId,
      userId: input.userId,
    });

  const mapSessionShareRow = (userId: string, row: SessionShareRow) => ({
    id: row.id,
    sessionId: row.session_id,
    memberId: row.member_id,
    memberName: row.member_name,
    memberEmail: row.member_email,
    permission: row.permission,
    sessionLabel: row.label ?? row.session_id,
    workspacePath: getWorkspacePathFromMetadataJson({
      metadataJson: row.session_metadata_json,
      sessionId: row.session_id,
      userId,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const getSessionShareForUser = (userId: string, shareId: string): SessionShareRow | undefined =>
    sqliteGet<SessionShareRow>(
      `SELECT
          ss.id,
          ss.session_id,
          ss.member_id,
          ss.permission,
          ss.created_at,
          ss.updated_at,
          tm.name AS member_name,
          tm.email AS member_email,
          sess.title AS label,
          sess.metadata_json AS session_metadata_json
        FROM session_shares ss
        JOIN team_members tm ON tm.id = ss.member_id
        JOIN sessions sess ON sess.id = ss.session_id
       WHERE ss.id = ? AND ss.user_id = ?
       LIMIT 1`,
      [shareId, userId],
    );

  const mapWorkspaceRow = (row: TeamWorkspaceRow) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    defaultWorkingRoot: row.default_working_root,
    createdByUserId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const mapRuntimeSessionRow = (userId: string, row: SessionRow) => ({
    id: row.id,
    metadataJson: row.metadata_json,
    parentSessionId:
      typeof parseSessionMetadataJson(row.metadata_json)['parentSessionId'] === 'string'
        ? (parseSessionMetadataJson(row.metadata_json)['parentSessionId'] as string) || null
        : null,
    title: row.title ?? null,
    updatedAt: row.updated_at,
    workspacePath: getWorkspacePathFromMetadataJson({
      metadataJson: row.metadata_json,
      sessionId: row.id,
      userId,
    }),
  });

  const buildWorkspaceRuntimeTaskGroups = async (input: {
    sessionRows: SessionRow[];
    teamWorkspaceId: string;
    userId: string;
  }): Promise<TeamRuntimeTaskGroupRecord[]> => {
    const scopedSessionRows = input.sessionRows.filter((row) => {
      const metadata = parseSessionMetadataJson(row.metadata_json);
      return metadata['teamWorkspaceId'] === input.teamWorkspaceId;
    });

    return mergeRuntimeTaskGroups(
      await Promise.all(
        scopedSessionRows.map(async (row) => {
          const workspacePath = getWorkspacePathFromMetadataJson({
            metadataJson: row.metadata_json,
            sessionId: row.id,
            userId: input.userId,
          });
          const includedSessionIds = new Set(scopedSessionRows.map((sessionRow) => sessionRow.id));

          const { tasks, updatedAt } = await buildMergedSessionTaskProjection({
            includedSessionIds,
            sessions: input.sessionRows,
            sessionId: row.id,
          });

          return {
            sessionIds: [row.id],
            tasks: tasks.filter((task) => task.status !== 'cancelled'),
            updatedAt,
            workspacePath,
          };
        }),
      ),
    );
  };

  app.get(
    '/team/workspaces',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.workspace.list');
      const user = request.user as JwtPayload;

      const rowsStep = child('query');
      const rows = sqliteAll<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ?
         ORDER BY updated_at DESC, created_at DESC`,
        [user.sub],
      );
      rowsStep.succeed(undefined, { count: rows.length });
      step.succeed(undefined, { count: rows.length });

      return reply.send(rows.map(mapWorkspaceRow));
    },
  );

  app.get(
    '/team/workspaces/:teamWorkspaceId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(request, 'team.workspace.get', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const queryStep = child('query');
      const row = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!row) {
        queryStep.fail('workspace not found');
        step.fail('workspace not found');
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      queryStep.succeed();
      step.succeed(undefined, { teamWorkspaceId });

      return reply.send(mapWorkspaceRow(row));
    },
  );

  app.post(
    '/team/workspaces',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.workspace.create');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = createWorkspaceSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const teamWorkspaceId = randomUUID();
      sqliteRun(
        `INSERT INTO team_workspaces (
          id,
          user_id,
          name,
          description,
          visibility,
          default_working_root
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          teamWorkspaceId,
          user.sub,
          body.data.name,
          body.data.description ?? null,
          body.data.visibility,
          body.data.defaultWorkingRoot ?? null,
        ],
      );

      const created = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      step.succeed(undefined, { teamWorkspaceId });

      return reply.status(201).send(
        created
          ? mapWorkspaceRow(created)
          : {
              id: teamWorkspaceId,
              name: body.data.name,
              description: body.data.description ?? null,
              visibility: body.data.visibility,
              defaultWorkingRoot: body.data.defaultWorkingRoot ?? null,
              createdByUserId: user.sub,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
      );
    },
  );

  app.patch(
    '/team/workspaces/:teamWorkspaceId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(request, 'team.workspace.update', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = updateWorkspaceSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const existing = sqliteGet<{ id: string }>(
        `SELECT id FROM team_workspaces WHERE user_id = ? AND id = ? LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!existing) {
        step.fail('workspace not found');
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const updates: string[] = [];
      const params: Array<string | null> = [];
      if (body.data.name !== undefined) {
        updates.push('name = ?');
        params.push(body.data.name);
      }
      if (body.data.description !== undefined) {
        updates.push('description = ?');
        params.push(body.data.description ?? null);
      }
      if (body.data.visibility !== undefined) {
        updates.push('visibility = ?');
        params.push(body.data.visibility);
      }
      if (body.data.defaultWorkingRoot !== undefined) {
        updates.push('default_working_root = ?');
        params.push(body.data.defaultWorkingRoot ?? null);
      }
      updates.push("updated_at = datetime('now')");

      sqliteRun(`UPDATE team_workspaces SET ${updates.join(', ')} WHERE user_id = ? AND id = ?`, [
        ...params,
        user.sub,
        teamWorkspaceId,
      ]);

      const updated = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      step.succeed(undefined, { teamWorkspaceId });

      return reply.send(updated ? mapWorkspaceRow(updated) : { error: 'Workspace not found' });
    },
  );

  app.post(
    '/team/workspaces/:teamWorkspaceId/threads',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(request, 'team.thread.create', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = createThreadSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const workspaceStep = child('resolve-workspace');
      const workspace = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!workspace) {
        workspaceStep.fail('workspace not found');
        step.fail('workspace not found');
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      workspaceStep.succeed();

      const metadataPatch = validateSessionMetadataPatch({
        ...body.data.metadata,
        teamWorkspaceId,
        workingDirectory: workspace.default_working_root ?? undefined,
      });
      if (!metadataPatch.success) {
        step.fail('invalid metadata');
        return reply
          .status(400)
          .send({ error: 'Invalid metadata', issues: metadataPatch.error.issues });
      }

      const normalizedMetadata = normalizeIncomingSessionMetadata(metadataPatch.data);
      if (normalizedMetadata.workingDirectory === null) {
        step.fail('forbidden path');
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const requestedParentSessionId = extractParentSessionIdFromMetadata(
        normalizedMetadata.metadata,
      );
      const parentValidation = validateParentSessionBinding({
        parentSessionId: requestedParentSessionId,
        userId: user.sub,
      });
      if (!parentValidation.ok) {
        step.fail(parentValidation.reason);
        return reply.status(parentValidation.statusCode).send({ error: parentValidation.error });
      }

      const sessionId = randomUUID();
      sqliteRun(
        'INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, title) VALUES (?, ?, ?, ?, ?, ?)',
        [
          sessionId,
          user.sub,
          '[]',
          'idle',
          JSON.stringify(normalizedMetadata.metadata),
          body.data.title ?? workspace.name,
        ],
      );
      step.succeed(undefined, { sessionId, teamWorkspaceId });

      return reply.status(201).send({
        id: sessionId,
        metadata_json: JSON.stringify(normalizedMetadata.metadata),
        state_status: 'idle',
        title: body.data.title ?? workspace.name,
      });
    },
  );

  app.post(
    '/team/workspaces/:teamWorkspaceId/imports',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(request, 'team.workspace.import', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const workspaceStep = child('workspace');
      const workspace = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!workspace) {
        workspaceStep.fail('workspace not found');
        step.fail('workspace not found');
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      workspaceStep.succeed();

      const parseStep = child('parse-body');
      const body = importWorkspaceSessionSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid import data');
        step.fail('invalid import data');
        return reply.status(400).send({ error: 'Invalid import data', issues: body.error.issues });
      }
      parseStep.succeed();

      const normalizedMessages = normalizeImportedMessages(body.data.messages);
      const validation = validateImportedMessagesPayload(normalizedMessages);
      if (!validation.ok) {
        step.fail('import too large');
        return reply.status(413).send({ error: validation.error });
      }

      const sessionId = randomUUID();
      sqliteRun(
        'INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, title) VALUES (?, ?, ?, ?, ?, ?)',
        [
          sessionId,
          user.sub,
          validation.serializedMessages,
          'idle',
          JSON.stringify({
            teamWorkspaceId,
            workingDirectory: workspace.default_working_root ?? undefined,
          }),
          workspace.name,
        ],
      );
      step.succeed(undefined, { sessionId, teamWorkspaceId, messages: normalizedMessages.length });

      return reply.status(201).send({ sessionId });
    },
  );

  app.get(
    '/team/workspaces/:teamWorkspaceId/runtime',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(
        request,
        'team.workspace-runtime.get',
        undefined,
        {
          teamWorkspaceId,
        },
      );
      const user = request.user as JwtPayload;

      const workspaceStep = child('workspace');
      const workspace = sqliteGet<TeamWorkspaceRow>(
        `SELECT id, user_id, name, description, visibility, default_working_root, created_at, updated_at
         FROM team_workspaces
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!workspace) {
        workspaceStep.fail('workspace not found');
        step.fail('workspace not found');
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      workspaceStep.succeed();

      const sessionsStep = child('sessions');
      const allSessionRows = sqliteAll<SessionRow>(
        `SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at
         FROM sessions
         WHERE user_id = ?
         ORDER BY updated_at DESC`,
        [user.sub],
      );
      const scopedSessionRows = allSessionRows.filter((row) => {
        const metadata = parseSessionMetadataJson(row.metadata_json);
        return metadata['teamWorkspaceId'] === teamWorkspaceId;
      });
      sessionsStep.succeed(undefined, { count: scopedSessionRows.length });

      const sharesStep = child('session-shares');
      const scopedSessionIds = new Set(scopedSessionRows.map((row) => row.id));
      const shareRows = sqliteAll<SessionShareRow>(
        `SELECT
           ss.id,
           ss.session_id,
           ss.member_id,
           ss.permission,
           ss.created_at,
           ss.updated_at,
           tm.name AS member_name,
           tm.email AS member_email,
           sess.title AS label,
           sess.metadata_json AS session_metadata_json
         FROM session_shares ss
         JOIN team_members tm ON tm.id = ss.member_id
         JOIN sessions sess ON sess.id = ss.session_id
         WHERE ss.user_id = ?
         ORDER BY ss.created_at DESC`,
        [user.sub],
      ).filter((row) => scopedSessionIds.has(row.session_id));
      sharesStep.succeed(undefined, { count: shareRows.length });

      const sharedSessionsStep = child('shared-with-me');
      const sharedSessionAccessRecords = listSharedSessionsForRecipient({
        email: user.email,
        limit: 24,
        offset: 0,
      }).filter((record) => record.session.workspacePath === workspace.default_working_root);
      const sharedSessions = sharedSessionAccessRecords.map((sharedSession) => ({
        sessionId: sharedSession.session.id,
        title: sharedSession.session.title,
        stateStatus: sharedSession.session.stateStatus,
        workspacePath: sharedSession.session.workspacePath,
        sharedByEmail: sharedSession.sharedByEmail,
        permission: sharedSession.permission,
        createdAt: sharedSession.session.createdAt,
        updatedAt: sharedSession.session.updatedAt,
        shareCreatedAt: sharedSession.shareCreatedAt,
        shareUpdatedAt: sharedSession.shareUpdatedAt,
      }));
      sharedSessionsStep.succeed(undefined, { count: sharedSessions.length });

      const runtimeTaskGroupsStep = child('runtime-task-groups');
      const runtimeTaskGroups = await buildWorkspaceRuntimeTaskGroups({
        sessionRows: allSessionRows,
        teamWorkspaceId,
        userId: user.sub,
      });
      runtimeTaskGroupsStep.succeed(undefined, { count: runtimeTaskGroups.length });

      step.succeed(undefined, {
        sessionCount: scopedSessionRows.length,
        sharedSessionCount: sharedSessions.length,
        teamWorkspaceId,
      });

      return reply.send({
        runtimeTaskGroups,
        sessionShares: shareRows.map((row) => mapSessionShareRow(user.sub, row)),
        sessions: scopedSessionRows.map((row) => mapRuntimeSessionRow(user.sub, row)),
        sharedSessions,
        workspace: mapWorkspaceRow(workspace),
      });
    },
  );

  app.get(
    '/team/runtime',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.runtime.get');
      const user = request.user as JwtPayload;

      const membersStep = child('members');
      const memberRows = sqliteAll<MemberRow>(
        `SELECT id, name, email, role, avatar_url, status, created_at FROM team_members WHERE user_id = ? ORDER BY created_at ASC`,
        [user.sub],
      );
      membersStep.succeed(undefined, { count: memberRows.length });

      const tasksStep = child('tasks');
      const taskRows = sqliteAll<TaskRow>(
        `SELECT id, title, assignee_id, status, priority, result, created_at, updated_at FROM team_tasks WHERE user_id = ? ORDER BY created_at DESC`,
        [user.sub],
      );
      tasksStep.succeed(undefined, { count: taskRows.length });

      const messagesStep = child('messages');
      const messageRows = sqliteAll<MessageRow>(
        `SELECT id, sender_id, content, type, created_at FROM team_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100`,
        [user.sub],
      );
      messagesStep.succeed(undefined, { count: messageRows.length });

      const sharesStep = child('session-shares');
      const shareRows = sqliteAll<SessionShareRow>(
        `SELECT
           ss.id,
           ss.session_id,
           ss.member_id,
           ss.permission,
           ss.created_at,
           ss.updated_at,
           tm.name AS member_name,
           tm.email AS member_email,
           sess.title AS label,
           sess.metadata_json AS session_metadata_json
         FROM session_shares ss
         JOIN team_members tm ON tm.id = ss.member_id
         JOIN sessions sess ON sess.id = ss.session_id
         WHERE ss.user_id = ?
         ORDER BY ss.created_at DESC`,
        [user.sub],
      );
      sharesStep.succeed(undefined, { count: shareRows.length });

      const sessionsStep = child('sessions');
      const sessionRows = sqliteAll<SessionRow>(
        `SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`,
        [user.sub],
      );
      sessionsStep.succeed(undefined, { count: sessionRows.length });

      const auditStep = child('audit-logs');
      const auditLogs = listTeamAuditLogs({ userId: user.sub, limit: 24 });
      auditStep.succeed(undefined, { count: auditLogs.length });

      const sharedSessionsStep = child('shared-with-me');
      const sharedSessionAccessRecords = listSharedSessionsForRecipient({
        email: user.email,
        limit: 24,
        offset: 0,
      });
      const sharedSessions = sharedSessionAccessRecords.map((sharedSession) => ({
        sessionId: sharedSession.session.id,
        title: sharedSession.session.title,
        stateStatus: sharedSession.session.stateStatus,
        workspacePath: sharedSession.session.workspacePath,
        sharedByEmail: sharedSession.sharedByEmail,
        permission: sharedSession.permission,
        createdAt: sharedSession.session.createdAt,
        updatedAt: sharedSession.session.updatedAt,
        shareCreatedAt: sharedSession.shareCreatedAt,
        shareUpdatedAt: sharedSession.shareUpdatedAt,
      }));
      sharedSessionsStep.succeed(undefined, { count: sharedSessions.length });

      const runtimeTaskGroupsStep = child('runtime-task-groups');
      const runtimeTaskGroups = mergeRuntimeTaskGroups(
        await Promise.all(
          sharedSessionAccessRecords.map(async (sharedSession) => {
            const workspacePath = sharedSession.session.workspacePath ?? null;
            const relatedSessionRows = sessionRows.filter(
              (row) =>
                getWorkspacePathFromMetadataJson({
                  metadataJson: row.metadata_json,
                  sessionId: row.id,
                  userId: user.sub,
                }) === workspacePath,
            );
            const includedSessionIds = new Set(
              relatedSessionRows.map((sessionRow) => sessionRow.id),
            );
            if (!includedSessionIds.has(sharedSession.session.id)) {
              includedSessionIds.add(sharedSession.session.id);
            }

            const { tasks, updatedAt } = await buildMergedSessionTaskProjection({
              includedSessionIds,
              sessions: sessionRows,
              sessionId: sharedSession.session.id,
            });

            return {
              sessionIds: [sharedSession.session.id],
              tasks: tasks.filter((task) => task.status !== 'cancelled'),
              updatedAt,
              workspacePath,
            };
          }),
        ),
      );
      runtimeTaskGroupsStep.succeed(undefined, { count: runtimeTaskGroups.length });

      const response = {
        auditLogs,
        members: memberRows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          avatarUrl: row.avatar_url,
          status: normalizeMemberStatus(row.status),
          createdAt: row.created_at,
        })),
        messages: messageRows.map((row) => ({
          id: row.id,
          memberId: row.sender_id ?? 'system',
          content: row.content,
          type:
            row.type === 'update' ||
            row.type === 'question' ||
            row.type === 'result' ||
            row.type === 'error'
              ? row.type
              : 'update',
          timestamp: Date.parse(row.created_at) || Date.now(),
        })),
        sessionShares: shareRows.map((row) => mapSessionShareRow(user.sub, row)),
        sessions: sessionRows.map((row) => mapRuntimeSessionRow(user.sub, row)),
        sharedSessions,
        runtimeTaskGroups,
        tasks: taskRows.map((row) => ({
          id: row.id,
          title: row.title,
          assigneeId: row.assignee_id,
          status: row.status === 'done' ? 'completed' : row.status,
          priority: row.priority,
          result: row.result,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      };

      step.succeed(undefined, {
        auditLogCount: auditLogs.length,
        memberCount: response.members.length,
        sessionCount: response.sessions.length,
        sharedSessionCount: response.sharedSessions.length,
        taskCount: response.tasks.length,
      });

      return reply.send(response);
    },
  );

  app.get(
    '/team/members',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.member.list');
      const user = request.user as JwtPayload;

      const queryStep = child('query');
      const rows = sqliteAll<MemberRow>(
        `SELECT id, name, email, role, avatar_url, status, created_at FROM team_members WHERE user_id = ? ORDER BY created_at ASC`,
        [user.sub],
      );
      queryStep.succeed(undefined, { count: rows.length });
      step.succeed(undefined, { count: rows.length });

      return reply.send(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          avatarUrl: row.avatar_url,
          status: normalizeMemberStatus(row.status),
          createdAt: row.created_at,
        })),
      );
    },
  );

  app.post(
    '/team/members',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.member.create');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = createMemberSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const { name, email, role, avatarUrl } = body.data;
      const existingStep = child('check-existing');
      const existing = sqliteGet<{ id: string }>(
        `SELECT id FROM team_members WHERE user_id = ? AND email = ?`,
        [user.sub, email],
      );
      if (existing) {
        existingStep.fail('member already exists');
        step.fail('member already exists');
        return reply.status(409).send({ error: 'Member with this email already exists' });
      }
      existingStep.succeed();

      const memberId = randomUUID();
      const insertStep = child('insert', undefined, { memberId, role });
      sqliteRun(
        `INSERT INTO team_members (id, user_id, name, email, role, avatar_url) VALUES (?, ?, ?, ?, ?, ?)`,
        [memberId, user.sub, name, email, role, avatarUrl ?? null],
      );
      insertStep.succeed();
      step.succeed(undefined, { memberId, role });

      return reply
        .status(201)
        .send({ id: memberId, name, email, role, avatarUrl: avatarUrl ?? null, status: 'idle' });
    },
  );

  app.get(
    '/team/tasks',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.task.list');
      const user = request.user as JwtPayload;

      const queryStep = child('query');
      const rows = sqliteAll<TaskRow>(
        `SELECT id, title, assignee_id, status, priority, result, created_at, updated_at FROM team_tasks WHERE user_id = ? ORDER BY created_at DESC`,
        [user.sub],
      );
      queryStep.succeed(undefined, { count: rows.length });
      step.succeed(undefined, { count: rows.length });

      return reply.send(
        rows.map((row) => ({
          id: row.id,
          title: row.title,
          assigneeId: row.assignee_id,
          status: row.status === 'done' ? 'completed' : row.status,
          priority: row.priority,
          result: row.result,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      );
    },
  );

  app.post(
    '/team/tasks',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.task.create');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = createTaskSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const { title, assigneeId, status, priority } = body.data;
      const taskId = randomUUID();
      const insertStep = child('insert', undefined, { taskId, priority, status });
      sqliteRun(
        `INSERT INTO team_tasks (id, user_id, title, assignee_id, status, priority, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [taskId, user.sub, title, assigneeId ?? null, status, priority, null],
      );
      insertStep.succeed();
      step.succeed(undefined, { taskId, priority, status });

      return reply.status(201).send({
        id: taskId,
        title,
        assigneeId: assigneeId ?? null,
        status,
        priority,
        result: null,
      });
    },
  );

  app.patch(
    '/team/tasks/:id',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const taskId = (request.params as { id: string }).id;
      const { step, child } = startRequestWorkflow(request, 'team.task.update', undefined, {
        taskId,
      });
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = updateTaskSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const lookupStep = child('check-existing');
      const existing = sqliteGet<{ id: string }>(
        `SELECT id FROM team_tasks WHERE user_id = ? AND id = ?`,
        [user.sub, taskId],
      );
      if (!existing) {
        lookupStep.fail('task not found');
        step.fail('task not found');
        return reply.status(404).send({ error: 'Task not found' });
      }
      lookupStep.succeed();

      const updateStep = child('update');
      sqliteRun(
        `UPDATE team_tasks SET
          assignee_id = COALESCE(?, assignee_id),
          status = COALESCE(?, status),
          result = COALESCE(?, result),
          updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
        [
          body.data.assigneeId ?? null,
          body.data.status ?? null,
          body.data.result ?? null,
          taskId,
          user.sub,
        ],
      );
      updateStep.succeed();

      step.succeed(undefined, {
        taskId,
        status: body.data.status ?? 'unchanged',
        assigneeChanged: body.data.assigneeId !== undefined,
      });
      return reply.send({ ok: true });
    },
  );

  app.get(
    '/team/messages',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.message.list');
      const user = request.user as JwtPayload;

      const queryStep = child('query');
      const rows = sqliteAll<MessageRow>(
        `SELECT id, sender_id, content, type, created_at FROM team_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100`,
        [user.sub],
      );
      queryStep.succeed(undefined, { count: rows.length });
      step.succeed(undefined, { count: rows.length });

      return reply.send(
        rows.map((row) => ({
          id: row.id,
          memberId: row.sender_id ?? 'system',
          content: row.content,
          type:
            row.type === 'update' ||
            row.type === 'question' ||
            row.type === 'result' ||
            row.type === 'error'
              ? row.type
              : 'update',
          timestamp: Date.parse(row.created_at) || Date.now(),
        })),
      );
    },
  );

  app.post(
    '/team/messages',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.message.create');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = createMessageSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const id = randomUUID();
      const insertStep = child('insert', undefined, { messageId: id, type: body.data.type });
      sqliteRun(
        `INSERT INTO team_messages (id, user_id, sender_id, content, type) VALUES (?, ?, ?, ?, ?)`,
        [id, user.sub, body.data.senderId ?? null, body.data.content, body.data.type],
      );
      insertStep.succeed();

      step.succeed(undefined, { messageId: id, type: body.data.type });
      return reply.status(201).send({
        id,
        memberId: body.data.senderId ?? 'system',
        content: body.data.content,
        type: body.data.type,
        timestamp: Date.now(),
      });
    },
  );

  app.get(
    '/team/session-shares',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.session-share.list');
      const user = request.user as JwtPayload;

      const queryStep = child('query');
      const rows = sqliteAll<SessionShareRow>(
        `SELECT
           ss.id,
           ss.session_id,
           ss.member_id,
           ss.permission,
           ss.created_at,
           ss.updated_at,
           tm.name AS member_name,
           tm.email AS member_email,
           sess.title AS label,
           sess.metadata_json AS session_metadata_json
         FROM session_shares ss
         JOIN team_members tm ON tm.id = ss.member_id
         JOIN sessions sess ON sess.id = ss.session_id
         WHERE ss.user_id = ?
         ORDER BY ss.created_at DESC`,
        [user.sub],
      );
      queryStep.succeed(undefined, { count: rows.length });
      step.succeed(undefined, { count: rows.length });

      return reply.send(rows.map((row) => mapSessionShareRow(user.sub, row)));
    },
  );

  app.post(
    '/team/session-shares',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.session-share.create');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = createSessionShareSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const sessionStep = child('check-session');
      const session = sqliteGet<{ id: string; metadata_json: string; title: string | null }>(
        `SELECT id, title, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
        [body.data.sessionId, user.sub],
      );
      if (!session) {
        sessionStep.fail('session not found');
        step.fail('session not found');
        return reply.status(404).send({ error: 'Session not found' });
      }
      sessionStep.succeed();

      const memberStep = child('check-member');
      const member = sqliteGet<{ email: string; id: string; name: string }>(
        `SELECT id, name, email FROM team_members WHERE id = ? AND user_id = ? LIMIT 1`,
        [body.data.memberId, user.sub],
      );
      if (!member) {
        memberStep.fail('member not found');
        step.fail('member not found');
        return reply.status(404).send({ error: 'Member not found' });
      }
      memberStep.succeed();

      const existingStep = child('check-existing');
      const existing = sqliteGet<{ id: string }>(
        `SELECT id FROM session_shares WHERE user_id = ? AND session_id = ? AND member_id = ? LIMIT 1`,
        [user.sub, body.data.sessionId, body.data.memberId],
      );
      if (existing) {
        existingStep.fail('share already exists');
        step.fail('share already exists');
        return reply.status(409).send({ error: 'Share already exists' });
      }
      existingStep.succeed();

      const shareId = randomUUID();
      const insertStep = child('insert', undefined, { shareId, permission: body.data.permission });
      sqliteRun(
        `INSERT INTO session_shares (id, user_id, session_id, member_id, permission, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [shareId, user.sub, body.data.sessionId, body.data.memberId, body.data.permission],
      );
      insertStep.succeed();
      step.succeed(undefined, { shareId, permission: body.data.permission });

      const sessionWorkspacePath = getWorkspacePathFromMetadataJson({
        metadataJson: session.metadata_json,
        sessionId: body.data.sessionId,
        userId: user.sub,
      });
      logTeamAudit({
        action: 'share_created' satisfies TeamAuditAction,
        actorEmail: user.email,
        actorUserId: user.sub,
        detail: `会话：${session.title ?? body.data.sessionId}；工作区：${sessionWorkspacePath ?? '未绑定工作区'}；成员：${member.name}；权限：${body.data.permission}`,
        entityId: shareId,
        entityType: 'session_share',
        summary: `已将“${session.title ?? body.data.sessionId}”共享给 ${member.name}（${body.data.permission}）`,
        userId: user.sub,
      });

      const createdShare = getSessionShareForUser(user.sub, shareId);

      return reply.status(201).send({
        ...(createdShare ? mapSessionShareRow(user.sub, createdShare) : {}),
        id: createdShare?.id ?? shareId,
        sessionId: createdShare?.session_id ?? body.data.sessionId,
        memberId: createdShare?.member_id ?? body.data.memberId,
        memberName: createdShare?.member_name ?? member.name,
        memberEmail: createdShare?.member_email ?? member.email,
        permission: createdShare?.permission ?? body.data.permission,
        sessionLabel: createdShare?.label ?? session.title ?? body.data.sessionId,
        workspacePath: createdShare
          ? getWorkspacePathFromMetadataJson({
              metadataJson: createdShare.session_metadata_json,
              sessionId: createdShare.session_id,
              userId: user.sub,
            })
          : sessionWorkspacePath,
        createdAt: createdShare?.created_at ?? new Date().toISOString(),
        updatedAt: createdShare?.updated_at ?? new Date().toISOString(),
      });
    },
  );

  app.patch(
    '/team/session-shares/:id',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const shareId = (request.params as { id: string }).id;
      const { step, child } = startRequestWorkflow(
        request,
        'team.session-share.update',
        undefined,
        {
          shareId,
        },
      );
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = updateSessionShareSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const lookupStep = child('check-existing');
      const existing = getSessionShareForUser(user.sub, shareId);
      if (!existing) {
        lookupStep.fail('share not found');
        step.fail('share not found');
        return reply.status(404).send({ error: 'Session share not found' });
      }
      lookupStep.succeed(undefined, { currentPermission: existing.permission });

      const changed = existing.permission !== body.data.permission;

      if (changed) {
        const updateStep = child('update', undefined, { nextPermission: body.data.permission });
        sqliteRun(
          `UPDATE session_shares
           SET permission = ?, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`,
          [body.data.permission, shareId, user.sub],
        );
        updateStep.succeed();

        logTeamAudit({
          action: 'share_permission_updated' satisfies TeamAuditAction,
          actorEmail: user.email,
          actorUserId: user.sub,
          detail: `会话：${existing.label ?? existing.session_id}；工作区：${getWorkspacePathFromMetadataJson({ metadataJson: existing.session_metadata_json, sessionId: existing.session_id, userId: user.sub }) ?? '未绑定工作区'}；成员：${existing.member_name}；旧权限：${existing.permission}；新权限：${body.data.permission}`,
          entityId: shareId,
          entityType: 'session_share',
          summary: `已将 ${existing.member_name} 对“${existing.label ?? existing.session_id}”的权限从 ${existing.permission} 调整为 ${body.data.permission}`,
          userId: user.sub,
        });
      }

      const responseShare = changed
        ? (getSessionShareForUser(user.sub, shareId) ?? existing)
        : existing;

      step.succeed(undefined, {
        changed,
        permission: body.data.permission,
      });
      return reply.send(
        mapSessionShareRow(user.sub, { ...responseShare, permission: body.data.permission }),
      );
    },
  );

  app.get(
    '/team/audit-logs',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.audit-log.list');
      const user = request.user as JwtPayload;

      const queryStep = child('parse-query');
      const query = auditLogsQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        queryStep.fail('invalid query');
        step.fail('invalid query');
        return reply.status(400).send({ error: 'Invalid query', issues: query.error.issues });
      }
      queryStep.succeed(undefined, { limit: query.data.limit });

      const rows = listTeamAuditLogs({ userId: user.sub, limit: query.data.limit });
      step.succeed(undefined, { count: rows.length });

      return reply.send(rows);
    },
  );

  app.delete(
    '/team/session-shares/:id',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const shareId = (request.params as { id: string }).id;
      const { step } = startRequestWorkflow(request, 'team.session-share.delete', undefined, {
        shareId,
      });
      const user = request.user as JwtPayload;

      const existing = getSessionShareForUser(user.sub, shareId);
      sqliteRun('DELETE FROM session_shares WHERE id = ? AND user_id = ?', [shareId, user.sub]);

      if (existing) {
        logTeamAudit({
          action: 'share_deleted' satisfies TeamAuditAction,
          actorEmail: user.email,
          actorUserId: user.sub,
          detail: `会话：${existing.label ?? existing.session_id}；工作区：${getWorkspacePathFromMetadataJson({ metadataJson: existing.session_metadata_json, sessionId: existing.session_id, userId: user.sub }) ?? '未绑定工作区'}；成员：${existing.member_name}；删除前权限：${existing.permission}`,
          entityId: shareId,
          entityType: 'session_share',
          summary: `已取消 ${existing.member_name} 对“${existing.label ?? existing.session_id}”的共享权限`,
          userId: user.sub,
        });
      }

      step.succeed();
      return reply.status(204).send();
    },
  );
}
