import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { FIXED_TEAM_CORE_ROLE_BINDINGS, FIXED_TEAM_CORE_ROLE_ORDER } from '@openAwork/shared';
import { listManagedAgentsForUser } from '../agent-catalog.js';
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

const createTeamSessionSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    source: z
      .object({
        kind: z.enum(['blank', 'builtin-template', 'saved-template']),
        templateId: z.string().min(1).optional(),
      })
      .optional(),
    optionalAgentIds: z.array(z.string().min(1)).default([]),
    defaultProvider: z.string().nullable().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.source && input.source.kind !== 'blank' && !input.source.templateId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'templateId is required when source kind is not blank',
        path: ['source', 'templateId'],
      });
    }
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

const teamRuntimeQuerySchema = z.object({
  teamWorkspaceId: z.string().min(1).optional(),
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

interface WorkflowTemplateLookupRow {
  id: string;
  metadata_json: string;
  name: string;
}

const workflowTeamTemplateSchema = z.object({
  defaultBindings: z
    .object({
      leader: z.string().min(1).optional(),
      planner: z.string().min(1).optional(),
      researcher: z.string().min(1).optional(),
      executor: z.string().min(1).optional(),
      reviewer: z.string().min(1).optional(),
    })
    .optional(),
  defaultProvider: z.string().nullable().optional(),
  optionalAgentIds: z.array(z.string().min(1)).optional(),
  requiredRoles: z
    .array(z.enum(['leader', 'planner', 'researcher', 'executor', 'reviewer']))
    .optional(),
});

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  const SESSION_TEAM_WORKSPACE_ID_SQL =
    "json_extract(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, '$.teamWorkspaceId')";
  const JOINED_SESSION_TEAM_WORKSPACE_ID_SQL =
    "json_extract(CASE WHEN json_valid(sess.metadata_json) THEN sess.metadata_json ELSE '{}' END, '$.teamWorkspaceId')";

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

  const getTeamWorkspaceForUser = (
    userId: string,
    teamWorkspaceId: string,
  ): TeamWorkspaceRow | null =>
    sqliteGet<TeamWorkspaceRow>(
      `SELECT id, user_id, name, description, visibility, default_working_root, created_at, updated_at
       FROM team_workspaces
       WHERE user_id = ? AND id = ?
       LIMIT 1`,
      [userId, teamWorkspaceId],
    ) ?? null;

  const listTeamRuntimeSessionRows = (input: {
    teamWorkspaceId?: string;
    userId: string;
  }): SessionRow[] => {
    const query =
      typeof input.teamWorkspaceId === 'string' && input.teamWorkspaceId.length > 0
        ? `SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at
           FROM sessions
           WHERE user_id = ? AND ${SESSION_TEAM_WORKSPACE_ID_SQL} = ?
           ORDER BY updated_at DESC`
        : `SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at
           FROM sessions
           WHERE user_id = ? AND ${SESSION_TEAM_WORKSPACE_ID_SQL} IS NOT NULL
           ORDER BY updated_at DESC`;

    const params =
      typeof input.teamWorkspaceId === 'string' && input.teamWorkspaceId.length > 0
        ? [input.userId, input.teamWorkspaceId]
        : [input.userId];

    return sqliteAll<SessionRow>(query, params).filter((row) => {
      const metadata = parseSessionMetadataJson(row.metadata_json);
      return typeof input.teamWorkspaceId === 'string' && input.teamWorkspaceId.length > 0
        ? metadata['teamWorkspaceId'] === input.teamWorkspaceId
        : metadata['teamWorkspaceId'] != null;
    });
  };

  const listTeamSessionShareRows = (input: {
    teamWorkspaceId?: string;
    userId: string;
  }): SessionShareRow[] => {
    const query =
      typeof input.teamWorkspaceId === 'string' && input.teamWorkspaceId.length > 0
        ? `SELECT
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
           WHERE ss.user_id = ? AND ${JOINED_SESSION_TEAM_WORKSPACE_ID_SQL} = ?
           ORDER BY ss.created_at DESC`
        : `SELECT
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
           WHERE ss.user_id = ? AND ${JOINED_SESSION_TEAM_WORKSPACE_ID_SQL} IS NOT NULL
           ORDER BY ss.created_at DESC`;

    const params =
      typeof input.teamWorkspaceId === 'string' && input.teamWorkspaceId.length > 0
        ? [input.userId, input.teamWorkspaceId]
        : [input.userId];

    return sqliteAll<SessionShareRow>(query, params).filter((row) => {
      const metadata = parseSessionMetadataJson(row.session_metadata_json);
      return typeof input.teamWorkspaceId === 'string' && input.teamWorkspaceId.length > 0
        ? metadata['teamWorkspaceId'] === input.teamWorkspaceId
        : metadata['teamWorkspaceId'] != null;
    });
  };

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
    stateStatus: row.state_status ?? 'idle',
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
    userId: string;
  }): Promise<TeamRuntimeTaskGroupRecord[]> => {
    return mergeRuntimeTaskGroups(
      await Promise.all(
        input.sessionRows.map(async (row) => {
          const workspacePath = getWorkspacePathFromMetadataJson({
            metadataJson: row.metadata_json,
            sessionId: row.id,
            userId: input.userId,
          });
          const includedSessionIds = new Set(input.sessionRows.map((sessionRow) => sessionRow.id));

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
    '/team/workspaces/:teamWorkspaceId/sessions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(request, 'team.session.create', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = createTeamSessionSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const workspaceStep = child('resolve-workspace');
      const workspace = getTeamWorkspaceForUser(user.sub, teamWorkspaceId);
      if (!workspace) {
        workspaceStep.fail('workspace not found');
        step.fail('workspace not found');
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      workspaceStep.succeed();

      let templateLookup: {
        id: string;
        name: string;
        teamTemplate: z.infer<typeof workflowTeamTemplateSchema>;
      } | null = null;
      if (body.data.source?.kind === 'saved-template' && body.data.source.templateId) {
        const templateStep = child('resolve-template');
        const templateRow = sqliteGet<WorkflowTemplateLookupRow>(
          `SELECT id, name, metadata_json
           FROM workflow_templates
           WHERE user_id = ? AND id = ?
           LIMIT 1`,
          [user.sub, body.data.source.templateId],
        );
        if (!templateRow) {
          templateStep.fail('template not found');
          step.fail('template not found');
          return reply.status(404).send({ error: 'Template not found' });
        }

        let parsedMetadata: unknown;
        try {
          parsedMetadata = JSON.parse(templateRow.metadata_json || '{}');
        } catch {
          templateStep.fail('template metadata invalid');
          step.fail('template metadata invalid');
          return reply.status(400).send({ error: 'Template metadata is invalid JSON' });
        }

        const teamTemplate = workflowTeamTemplateSchema.safeParse(
          (parsedMetadata as { teamTemplate?: unknown })?.teamTemplate,
        );
        if (!teamTemplate.success) {
          templateStep.fail('template metadata missing');
          step.fail('template metadata missing');
          return reply
            .status(400)
            .send({ error: 'Template does not contain a valid teamTemplate metadata payload' });
        }

        templateLookup = {
          id: templateRow.id,
          name: templateRow.name,
          teamTemplate: teamTemplate.data,
        };
        templateStep.succeed(undefined, { templateId: templateRow.id });
      }

      const agentsStep = child('resolve-agents');
      const managedAgents = listManagedAgentsForUser(user.sub).filter((agent) => agent.enabled);
      const agentMap = new Map(managedAgents.map((agent) => [agent.id, agent]));
      const requiredRoleBindings = FIXED_TEAM_CORE_ROLE_ORDER.map((role) => ({
        role,
        agentId: FIXED_TEAM_CORE_ROLE_BINDINGS[role],
      }));
      const invalidRequiredAgent = requiredRoleBindings.find(
        (binding) => !agentMap.has(binding.agentId),
      );
      if (invalidRequiredAgent) {
        agentsStep.fail('invalid required agent');
        step.fail('invalid required agent');
        return reply.status(400).send({ error: `Unknown agent: ${invalidRequiredAgent.agentId}` });
      }

      const requiredAgentIds = new Set(requiredRoleBindings.map((binding) => binding.agentId));
      const optionalAgentIds = Array.from(
        new Set(
          body.data.optionalAgentIds.length > 0
            ? body.data.optionalAgentIds
            : (templateLookup?.teamTemplate.optionalAgentIds ?? []),
        ),
      );
      const invalidOptionalAgent = optionalAgentIds.find((agentId) => !agentMap.has(agentId));
      if (invalidOptionalAgent) {
        agentsStep.fail('invalid optional agent');
        step.fail('invalid optional agent');
        return reply.status(400).send({ error: `Unknown optional agent: ${invalidOptionalAgent}` });
      }
      const overlappingOptionalAgent = optionalAgentIds.find((agentId) =>
        requiredAgentIds.has(agentId),
      );
      if (overlappingOptionalAgent) {
        agentsStep.fail('duplicate optional agent');
        step.fail('duplicate optional agent');
        return reply.status(400).send({
          error: `Optional agent duplicates required binding: ${overlappingOptionalAgent}`,
        });
      }
      agentsStep.succeed(undefined, {
        optional: optionalAgentIds.length,
        required: requiredRoleBindings.length,
      });

      const teamDefinition = {
        createdAt: new Date().toISOString(),
        defaultProvider:
          body.data.defaultProvider ?? templateLookup?.teamTemplate.defaultProvider ?? null,
        optionalMembers: optionalAgentIds.map((agentId) => {
          const agent = agentMap.get(agentId)!;
          return {
            agentId: agent.id,
            agentLabel: agent.label,
            canonicalRole: agent.canonicalRole?.coreRole ?? null,
          };
        }),
        requiredRoleBindings: requiredRoleBindings.map((binding) => {
          const agent = agentMap.get(binding.agentId)!;
          return {
            agentId: agent.id,
            agentLabel: agent.label,
            role: binding.role,
          };
        }),
        source: {
          kind: body.data.source?.kind ?? 'blank',
          ...(body.data.source?.templateId ? { templateId: body.data.source.templateId } : {}),
          ...(templateLookup ? { templateName: templateLookup.name } : {}),
        },
      };

      const metadataPatch = validateSessionMetadataPatch({
        teamDefinition,
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
      const scopedSessionRows = listTeamRuntimeSessionRows({ userId: user.sub, teamWorkspaceId });
      const scopedSessionIds = new Set(scopedSessionRows.map((row) => row.id));
      sessionsStep.succeed(undefined, { count: scopedSessionRows.length });

      const sharesStep = child('session-shares');
      const shareRows = listTeamSessionShareRows({ userId: user.sub, teamWorkspaceId }).filter(
        (row) => scopedSessionIds.has(row.session_id),
      );
      sharesStep.succeed(undefined, { count: shareRows.length });

      const sharedSessionsStep = child('shared-with-me');
      const sharedSessionAccessRecords = listSharedSessionsForRecipient({
        email: user.email,
        limit: 24,
        offset: 0,
        teamWorkspaceId,
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
      const runtimeTaskGroups = await buildWorkspaceRuntimeTaskGroups({
        sessionRows: scopedSessionRows,
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

      const queryStep = child('parse-query');
      const query = teamRuntimeQuerySchema.safeParse(request.query);
      if (!query.success) {
        queryStep.fail('invalid query');
        step.fail('invalid query');
        return reply.status(400).send({ error: 'Invalid query', issues: query.error.issues });
      }
      queryStep.succeed(undefined, query.data.teamWorkspaceId ? query.data : undefined);

      if (query.data.teamWorkspaceId) {
        const workspaceStep = child('workspace');
        const workspace = getTeamWorkspaceForUser(user.sub, query.data.teamWorkspaceId);
        if (!workspace) {
          workspaceStep.fail('workspace not found');
          step.fail('workspace not found');
          return reply.status(404).send({ error: 'Workspace not found' });
        }
        workspaceStep.succeed(undefined, { teamWorkspaceId: workspace.id });
      }

      // Run independent sync queries together, then overlap async task projection
      // with remaining sync work that doesn't depend on its result.
      const membersStep = child('members');
      const tasksStep = child('tasks');
      const messagesStep = child('messages');
      const sessionsStep = child('sessions');

      const [memberRows, taskRows, messageRows, sessionRows] = [
        sqliteAll<MemberRow>(
          `SELECT id, name, email, role, avatar_url, status, created_at FROM team_members WHERE user_id = ? ORDER BY created_at ASC`,
          [user.sub],
        ),
        sqliteAll<TaskRow>(
          `SELECT id, title, assignee_id, status, priority, result, created_at, updated_at FROM team_tasks WHERE user_id = ? ORDER BY created_at DESC`,
          [user.sub],
        ),
        sqliteAll<MessageRow>(
          `SELECT id, sender_id, content, type, created_at FROM team_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100`,
          [user.sub],
        ),
        listTeamRuntimeSessionRows({
          userId: user.sub,
          teamWorkspaceId: query.data.teamWorkspaceId,
        }),
      ];

      membersStep.succeed(undefined, { count: memberRows.length });
      tasksStep.succeed(undefined, { count: taskRows.length });
      messagesStep.succeed(undefined, { count: messageRows.length });

      const teamSessionIds = new Set(sessionRows.map((row) => row.id));
      sessionsStep.succeed(undefined, { count: sessionRows.length });

      const sharesStep = child('session-shares');
      const shareRows = listTeamSessionShareRows({
        userId: user.sub,
        teamWorkspaceId: query.data.teamWorkspaceId,
      }).filter((row) => teamSessionIds.has(row.session_id));
      sharesStep.succeed(undefined, { count: shareRows.length });

      // Kick off async runtime task groups immediately — they are the slowest part.
      // Run remaining sync queries (audit, shared sessions) in parallel with the async work.
      const sharedSessionAccessRecords = listSharedSessionsForRecipient({
        email: user.email,
        limit: 24,
        offset: 0,
        ...(query.data.teamWorkspaceId
          ? { teamWorkspaceId: query.data.teamWorkspaceId }
          : { onlyTeamSessions: true }),
      });

      const runtimeTaskGroupsPromise = Promise.all(
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
          const includedSessionIds = new Set(relatedSessionRows.map((sessionRow) => sessionRow.id));
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
      );

      // While async task projection runs, do the remaining sync work.
      const auditStep = child('audit-logs');
      const auditLogs = listTeamAuditLogs({ userId: user.sub, limit: 24 });
      auditStep.succeed(undefined, { count: auditLogs.length });

      const sharedSessionsStep = child('shared-with-me');
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

      // Await the async task projection — by now sync work is done, so this
      // only blocks for the remaining async duration.
      const runtimeTaskGroupsStep = child('runtime-task-groups');
      const runtimeTaskGroups = mergeRuntimeTaskGroups(await runtimeTaskGroupsPromise);
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

  const interactionRewriteSchema = z.object({
    intent: z.string().min(1).max(2000),
    context: z.string().max(4000).optional(),
  });

  app.post(
    '/team/interaction-agent/rewrite',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.interaction-agent.rewrite');

      const parseStep = child('parse-body');
      const body = interactionRewriteSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const AI_API_BASE_URL = process.env['AI_API_BASE_URL'] ?? '';
      const AI_API_KEY = process.env['AI_API_KEY'] ?? '';
      const AI_DEFAULT_MODEL = process.env['AI_DEFAULT_MODEL'] ?? 'gpt-4o';

      if (!AI_API_BASE_URL || !AI_API_KEY) {
        step.fail('no llm config');
        return reply.status(503).send({ error: 'Interaction agent LLM is not configured' });
      }

      const rewriteStep = child('llm-rewrite');
      const contextBlock = body.data.context
        ? `\n\n当前工作区上下文摘要：\n${body.data.context}`
        : '';
      const prompt = `你是一个团队协作交互代理（interaction-agent）。你的任务是将用户的自然语言意图改写为结构化的团队任务指令。

改写要求：
1. 保留用户原始意图的核心语义
2. 将模糊需求拆解为可执行的子任务
3. 为每个子任务推荐合适的执行角色（planner/researcher/executor/reviewer）
4. 给出推荐的下一步动作
5. 用中文输出

用户意图：${body.data.intent}${contextBlock}

请按以下格式输出：
【改写结果】<改写后的结构化意图>
【推荐角色】<planner/researcher/executor/reviewer>
【下一步】<推荐的下一步动作>`;

      try {
        const { requestWorkflowLlmCompletion } = await import('./workflow-llm.js');
        const rewritten = await requestWorkflowLlmCompletion({
          apiBaseUrl: AI_API_BASE_URL,
          apiKey: AI_API_KEY,
          model: AI_DEFAULT_MODEL,
          prompt,
          temperature: 0.3,
        });
        rewriteStep.succeed(undefined, { outputLength: rewritten.length });

        const rewrittenIntent = extractField(rewritten, '改写结果') || rewritten;
        const recommendedRole = extractField(rewritten, '推荐角色') || 'planner';
        const recommendedNextStep =
          extractField(rewritten, '下一步') ||
          '可将这条改写结果继续落到 Team 任务、共享运行跟进项或执行角色分工。';

        step.succeed();

        return reply.send({
          createdAt: Date.now(),
          recommendedNextStep,
          rewrittenIntent,
          sourceIntent: body.data.intent,
          status: 'completed',
          recommendedRole,
        });
      } catch (_error: unknown) {
        rewriteStep.fail('llm error');
        step.fail('llm error');
        return reply.status(500).send({ error: 'Interaction agent rewrite failed' });
      }
    },
  );

  // ─── Team Leader Dispatch ───

  const leaderDispatchSchema = z.object({
    rewrittenIntent: z.string().min(1),
    recommendedRole: z.string().optional(),
    sourceIntent: z.string().optional(),
    context: z.string().max(4000).optional(),
    teamRoster: z
      .array(
        z.object({
          role: z.string().min(1),
          agentId: z.string().min(1),
          agentLabel: z.string().min(1),
          capability: z.string().optional(),
        }),
      )
      .min(1)
      .default([]),
  });

  interface LeaderDispatchedTask {
    assigneeRole: string;
    assigneeAgentId: string;
    priority: 'low' | 'medium' | 'high';
    taskId: string;
    title: string;
  }

  interface LeaderDispatchResult {
    dispatchedTasks: LeaderDispatchedTask[];
    leaderAnalysis: string;
    status: 'completed';
  }

  // Build a roster entry description for the prompt
  function buildRosterTablePrompt(
    roster: Array<{ role: string; agentId: string; agentLabel: string; capability?: string }>,
  ): string {
    const header = '| Role | Agent | Core Capability | When to Assign |';
    const sep = '|------|-------|----------------|----------------|';
    const rows = roster.map((member) => {
      const cap = member.capability ?? inferCapabilityFromRole(member.role);
      return `| ${member.role} | ${member.agentLabel} | ${cap} | 需要${cap}时 |`;
    });
    return `${header}\n${sep}\n${rows.join('\n')}`;
  }

  function buildDecisionMatrixPrompt(
    roster: Array<{ role: string; agentId: string; agentLabel: string; capability?: string }>,
  ): string {
    const header = '| Task Domain | Assign To |';
    const sep = '|-------------|-----------|';
    const rows = roster.map((member) => {
      const cap = member.capability ?? inferCapabilityFromRole(member.role);
      return `| ${cap} | \`${member.role}\` |`;
    });
    return `${header}\n${sep}\n${rows.join('\n')}`;
  }

  function inferCapabilityFromRole(role: string): string {
    const known: Record<string, string> = {
      leader: '任务拆解、角色分派、协作编排',
      planner: '架构设计、方案评审、战略规划',
      researcher: '信息检索、文档查找、模式探索',
      executor: '代码实现、工程落地、深度修改',
      reviewer: '质量审查、风险挑刺、方案挑战',
      general: '通用任务处理与执行',
    };
    return known[role] ?? `${role}相关任务`;
  }

  app.post(
    '/team/leader/dispatch',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.leader.dispatch');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = leaderDispatchSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const AI_API_BASE_URL = process.env['AI_API_BASE_URL'] ?? '';
      const AI_API_KEY = process.env['AI_API_KEY'] ?? '';
      const AI_DEFAULT_MODEL = process.env['AI_DEFAULT_MODEL'] ?? 'gpt-4o';

      if (!AI_API_BASE_URL || !AI_API_KEY) {
        step.fail('no llm config');
        return reply.status(503).send({ error: 'Team leader LLM is not configured' });
      }

      // Merge fixed bindings with dynamic roster; roster takes precedence
      const rosterMap = new Map<
        string,
        { agentId: string; agentLabel: string; capability?: string }
      >();
      for (const [role, agentId] of Object.entries(FIXED_TEAM_CORE_ROLE_BINDINGS)) {
        rosterMap.set(role, {
          agentId,
          agentLabel: agentId,
          capability: inferCapabilityFromRole(role),
        });
      }
      for (const member of body.data.teamRoster) {
        rosterMap.set(member.role, {
          agentId: member.agentId,
          agentLabel: member.agentLabel,
          capability: member.capability,
        });
      }
      const fullRoster = Array.from(rosterMap.entries()).map(([role, info]) => ({ role, ...info }));
      const validRoles = fullRoster.map((m) => m.role);

      const analyzeStep = child('llm-analyze');
      const contextBlock = body.data.context ? `\n\n当前工作区上下文：\n${body.data.context}` : '';
      const recommendedRoleHint = body.data.recommendedRole
        ? `\ninteraction-agent 推荐首选角色：${body.data.recommendedRole}（请在拆解时优先考虑该角色的职责范围）`
        : '';
      const rosterTable = buildRosterTablePrompt(fullRoster);
      const decisionMatrix = buildDecisionMatrixPrompt(fullRoster);
      const validRolesList = validRoles.join(', ');
      const prompt = `<identity>
You are Zeus — the Team Leader of a multi-agent collaboration team.

In Greek mythology, Zeus is the king of the gods who delegates dominion to his siblings and children. You do the same: you receive structured intent, decompose it into concrete tasks, and assign each task to the most suitable team member.

You are a commander, not a soldier. A conductor, not a musician. You DECOMPOSE, ASSIGN, and COORDINATE.
You never execute tasks yourself. You orchestrate specialists who do.
</identity>

<mission>
Receive the interaction-agent's rewritten intent, decompose it into concrete executable tasks, and assign each task to the most suitable team role. One task per assignment. Parallel when independent. Cover all work streams.
</mission>

<team_roster>
## Available Team Members

${rosterTable}

## Decision Matrix

${decisionMatrix}

**Each task MUST be assigned to exactly one role from the roster above. NO EXCEPTIONS.**
</team_roster>

<decomposition_rules>
## 6 Decomposition Principles

1. **MECE decomposition**: Tasks must be Mutually Exclusive and Collectively Exhaustive — no overlap, no gaps. Every piece of work belongs to exactly one task.

2. **Single-responsibility**: Each task is owned by exactly one role. If a task spans multiple roles, split it into separate tasks with explicit dependencies.

3. **Dependency ordering**: Tasks with dependencies MUST be ordered so prerequisites come first. Mark dependent tasks with \`medium\` or \`low\` priority; mark unblocked critical-path tasks as \`high\`.

4. **Actionable titles**: Task titles MUST be imperative, specific, and verifiable.
   - ❌ BAD: "处理问题" / "优化代码" / "研究一下"
   - ✅ GOOD: "定位 /api/auth 502 错误的根因并输出诊断报告" / "将 UserService.extractProfile 拆分为 validateInput + transformOutput 两个纯函数"

5. **Right-sizing**: Each task should be completable in one agent session. If too broad, split further. If trivially small, merge with related work.

6. **Review gate**: Any task that modifies production code MUST have a corresponding reviewer task (if a reviewer role exists in the roster). No production change goes unreviewed.
</decomposition_rules>

<workflow>
## Step 1: Intent Analysis

Read the rewritten intent and answer:
- What are the key work streams?
- What are the dependencies between work streams?
- What is the critical path?
- What assumptions or risks exist?

## Step 2: Task Decomposition

For each work stream, decompose into tasks following the 6 principles above.

**Before finalizing each task, verify:**
\`\`\`
TASK QUALITY CHECKLIST:
□ Assigned to exactly one role from the roster?
□ Title is imperative, specific, and verifiable?
□ Scope is right-sized for one agent session?
□ Dependencies on earlier tasks are noted?
□ Priority reflects critical-path and dependency status?
\`\`\`

**If any answer is NO → rework the task before outputting.**

## Step 3: Dependency & Priority Assignment

| Priority | When to Use |
|----------|-------------|
| \`high\` | Critical-path tasks with no unmet dependencies; must-complete-first |
| \`medium\` | Important but has dependency on a high-priority task; or non-critical-path |
| \`low\` | Nice-to-have, optional, or depends on multiple prior tasks |

## Step 4: Review Gate Check

Before outputting, verify:
\`\`\`
REVIEW GATE CHECKLIST:
□ Every production-code-changing task has a reviewer task? (if reviewer exists)
□ No task is assigned to a role not in the roster?
□ No two tasks overlap in scope?
□ All dependencies are respected in priority ordering?
\`\`\`
</workflow>

<boundaries>
## What You DO vs What You DO NOT

| You DO | You DO NOT |
|--------|------------|
| Decompose intent into tasks | Execute tasks yourself |
| Assign tasks to roles | Write code, fix bugs, create files |
| Determine priority & dependencies | Make implementation decisions |
| Ensure coverage & no gaps | Skip the review gate |
| Coordinate across roles | Assign tasks to roles not in the roster |
</boundaries>

<input>
【改写后的意图】${body.data.rewrittenIntent}${recommendedRoleHint}${contextBlock}
</input>

<output_format>
**Output exactly ONE 【分析】 block followed by one or more 【任务】 lines. NOTHING ELSE.**

【分析】
<Your decomposition strategy: What are the key work streams? What are the dependencies? Why did you assign each role? What risks or assumptions exist? Be specific — not "I assigned researcher because research is needed" but "librarian is assigned to locate the OAuth2 token refresh logic in src/auth/ because the executor will need the exact file path before modifying the flow.">

【任务】<role>|<priority>|<title>
【任务】<role>|<priority>|<title>
...
</output_format>

<critical_overrides>
## Critical Rules

**NEVER**:
- Assign a task to a role not in the roster
- Output vague or non-actionable task titles
- Skip the review gate for production code changes
- Merge unrelated work into one task
- Output anything outside the 【分析】/【任务】 format
- Use English in your output (all content in Chinese)

**ALWAYS**:
- Assign each task to exactly one role from: ${validRolesList}
- Use priority values: high, medium, low
- Include exactly one 【分析】 block
- Include one or more 【任务】 lines
- Make task titles imperative and verifiable
- Consider the recommended role hint when provided
</critical_overrides>`;

      try {
        const { requestWorkflowLlmCompletion } = await import('./workflow-llm.js');
        const analysis = await requestWorkflowLlmCompletion({
          apiBaseUrl: AI_API_BASE_URL,
          apiKey: AI_API_KEY,
          model: AI_DEFAULT_MODEL,
          prompt,
          temperature: 0.3,
        });
        analyzeStep.succeed(undefined, { outputLength: analysis.length });

        // Parse tasks from LLM output
        const leaderAnalysis = extractField(analysis, '分析') || analysis;
        const taskPattern = /【任务】(.+?)\|(.+?)\|(.+?)(?:【|$)/gs;
        const parsedTasks: Array<{ role: string; priority: string; title: string }> = [];
        let match: RegExpExecArray | null;
        while ((match = taskPattern.exec(analysis)) !== null) {
          parsedTasks.push({
            role: match[1]!.trim(),
            priority: match[2]!.trim(),
            title: match[3]!.trim(),
          });
        }

        // If LLM failed to produce structured tasks, create a single fallback task
        if (parsedTasks.length === 0) {
          const fallbackRole = validRoles.includes(body.data.recommendedRole ?? '')
            ? body.data.recommendedRole!
            : (validRoles[0] ?? 'planner');
          parsedTasks.push({
            priority: 'medium',
            role: fallbackRole,
            title: body.data.rewrittenIntent,
          });
        }

        // Create team_task records
        const insertStep = child('insert-tasks');
        const dispatchedTasks: LeaderDispatchedTask[] = [];

        for (const task of parsedTasks) {
          // Resolve agent ID from roster: try exact match, then partial match
          const rosterMapEntry = rosterMap.get(task.role);
          const rosterFullEntry = fullRoster.find(
            (m) => m.role === task.role || task.role.includes(m.role) || m.role.includes(task.role),
          );
          const assigneeAgentId = rosterMapEntry?.agentId ?? rosterFullEntry?.agentId ?? task.role;
          const assigneeRole = rosterFullEntry?.role ?? task.role;
          const validPriority = ['low', 'medium', 'high'].includes(task.priority)
            ? (task.priority as 'low' | 'medium' | 'high')
            : 'medium';

          const taskId = randomUUID();
          sqliteRun(
            `INSERT INTO team_tasks (id, user_id, title, assignee_id, status, priority, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [taskId, user.sub, task.title, assigneeAgentId, 'pending', validPriority, null],
          );

          dispatchedTasks.push({
            assigneeRole,
            assigneeAgentId,
            priority: validPriority,
            taskId,
            title: task.title,
          });
        }
        insertStep.succeed(undefined, { taskCount: dispatchedTasks.length });

        logTeamAudit({
          action: 'task_created',
          actorEmail: user.email,
          actorUserId: user.sub,
          detail: `team-leader 自动分派 ${dispatchedTasks.length} 个任务：${dispatchedTasks.map((t) => `${t.title}→${t.assigneeRole}`).join('；')}`,
          entityId: dispatchedTasks[0]?.taskId ?? 'batch',
          entityType: 'team_task',
          summary: `team-leader 从 interaction-agent 改写结果自动创建 ${dispatchedTasks.length} 个任务`,
          userId: user.sub,
        });

        step.succeed(undefined, { taskCount: dispatchedTasks.length });

        return reply.send({
          dispatchedTasks,
          leaderAnalysis,
          status: 'completed',
        } satisfies LeaderDispatchResult);
      } catch (_error: unknown) {
        analyzeStep.fail('llm error');
        step.fail('llm error');
        return reply.status(500).send({ error: 'Team leader dispatch failed' });
      }
    },
  );
}

function extractField(text: string, label: string): string | null {
  const pattern = new RegExp(`【${label}】(.+?)(?:【|$)`, 's');
  const match = pattern.exec(text);
  return match?.[1]?.trim() ?? null;
}
