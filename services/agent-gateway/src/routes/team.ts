import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { FIXED_TEAM_CORE_ROLE_BINDINGS, FIXED_TEAM_CORE_ROLE_ORDER } from '@openAwork/shared';
import { listManagedAgentsForUser } from '../agent/agent-catalog.js';
import type { JwtPayload } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  normalizeIncomingSessionMetadata,
  parseSessionMetadataJson,
  validateSessionMetadataPatch,
} from '../session/session-workspace-metadata.js';
import { resolveSessionWorkspacePath } from '../session/session-workspace-resolution.js';
import { mergeRuntimeTaskGroups } from '../team/team-runtime-task-groups.js';
import { listSharedSessionsForRecipient } from '../session/session-shared-access.js';
import { listTeamAuditLogs, logTeamAudit, type TeamAuditAction } from '../team/team-audit-store.js';
import {
  buildMergedSessionTaskProjection,
  extractParentSessionIdFromMetadata,
  normalizeImportedMessages,
  type SessionRow,
  validateParentSessionBinding,
} from './sessions.js';
import { validateImportedMessagesPayload } from './session-route-helpers.js';
import { createTeamSession } from '../handoff/bus/team-session-create.js';

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

// L1.3 §1.3 反向消息通道载荷 schema（与 packages/web-client/src/team-inbound.ts 协议对齐）
const inboundSubmitSchema = z.object({
  messageType: z.enum([
    'cancel_signal',
    'pause_signal',
    'resume_signal',
    'clarification_answer',
    'user_input',
    'escalation_request',
    'progress_report',
  ]),
  // payload 由 messageType 决定形状；这里只校验是 object，具体 shape
  // 由消费方 LLM 循环解释（避免每次扩展类型都要改 schema）。
  payload: z.record(z.unknown()).optional(),
  clientIdempotencyKey: z.string().min(1).max(200).optional(),
  // 客户端可指定过期时间（毫秒 epoch），缺省由 inbound-store 按类型给默认 TTL
  expiresAt: z.number().int().positive().optional(),
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

const roleBindingSchema = z.object({
  agentId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  variant: z.string().min(1).max(80).optional(),
});

const workflowTeamTemplateSchema = z.object({
  defaultBindings: z
    .object({
      leader: z.union([z.string().min(1), roleBindingSchema]).optional(),
      planner: z.union([z.string().min(1), roleBindingSchema]).optional(),
      researcher: z.union([z.string().min(1), roleBindingSchema]).optional(),
      executor: z.union([z.string().min(1), roleBindingSchema]).optional(),
      reviewer: z.union([z.string().min(1), roleBindingSchema]).optional(),
    })
    .optional(),
  defaultProvider: z.string().nullable().optional(),
  optionalAgentIds: z.array(z.string().min(1)).optional(),
  requiredRoles: z
    .array(z.enum(['leader', 'planner', 'researcher', 'executor', 'reviewer']))
    .optional(),
  /**
   * 模板内置的快捷起始建议，前端 ReceptionStarterCard 渲染为 chip。
   * 用户点击 chip → 填入 composer（不直接发送，由用户确认后再发出）。
   * 与 D31 对齐：starter 仍要被视作"用户主动给出的意图"，不允许自动派发。
   */
  starterSuggestions: z.array(z.string().min(1).max(200)).max(8).optional(),
});

// ─── Phase B T-09/T-10 helpers ──────────────────────────────────────────────
//
// 旧路径 helper（findOrCreateReceptionSession / mapDispatchRoleToHandoffLayer）
// 已与 /team/interaction-agent/rewrite + /team/leader/dispatch 路由一并移除。
// 新路径走 reception-orchestrator → watcher 自动链。

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
        ? `SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at, team_parent_session_id
           FROM sessions
           WHERE user_id = ? AND ${SESSION_TEAM_WORKSPACE_ID_SQL} = ?
           ORDER BY updated_at DESC`
        : `SELECT id, user_id, messages_json, state_status, metadata_json, title, created_at, updated_at, team_parent_session_id
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

  const mapRuntimeSessionRow = (userId: string, row: SessionRow) => {
    // team_parent_session_id 列不在 SessionRow 接口中（接口是通用的），
    // 但 listTeamRuntimeSessionRows 的 SELECT 包含了它。用 unknown 中转读取。
    const rawRow = row as unknown as Record<string, unknown>;
    const teamParentSessionId =
      typeof rawRow['team_parent_session_id'] === 'string' && rawRow['team_parent_session_id']
        ? rawRow['team_parent_session_id']
        : null;
    const metadataParentSessionId =
      typeof parseSessionMetadataJson(row.metadata_json)['parentSessionId'] === 'string'
        ? (parseSessionMetadataJson(row.metadata_json)['parentSessionId'] as string) || null
        : null;
    return {
      id: row.id,
      metadataJson: row.metadata_json,
      parentSessionId: teamParentSessionId ?? metadataParentSessionId,
      stateStatus: row.state_status ?? 'idle',
      title: row.title ?? null,
      updatedAt: row.updated_at,
      workspacePath: getWorkspacePathFromMetadataJson({
        metadataJson: row.metadata_json,
        sessionId: row.id,
        userId,
      }),
    };
  };

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
      const body = parseBody(createWorkspaceSchema, request.body);
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
          body.name,
          body.description ?? null,
          body.visibility,
          body.defaultWorkingRoot ?? null,
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
              name: body.name,
              description: body.description ?? null,
              visibility: body.visibility,
              defaultWorkingRoot: body.defaultWorkingRoot ?? null,
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
      const body = parseBody(updateWorkspaceSchema, request.body);
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
      if (body.name !== undefined) {
        updates.push('name = ?');
        params.push(body.name);
      }
      if (body.description !== undefined) {
        updates.push('description = ?');
        params.push(body.description ?? null);
      }
      if (body.visibility !== undefined) {
        updates.push('visibility = ?');
        params.push(body.visibility);
      }
      if (body.defaultWorkingRoot !== undefined) {
        updates.push('default_working_root = ?');
        params.push(body.defaultWorkingRoot ?? null);
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

  app.delete(
    '/team/workspaces/:teamWorkspaceId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step } = startRequestWorkflow(request, 'team.workspace.delete', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const existing = sqliteGet<{ id: string }>(
        `SELECT id FROM team_workspaces WHERE user_id = ? AND id = ? LIMIT 1`,
        [user.sub, teamWorkspaceId],
      );
      if (!existing) {
        step.fail('workspace not found');
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // 仅删除 team_workspaces 行；session 数据保留（仍然按 metadata_json
      // 中的 teamWorkspaceId 孤立存在），符合\"删除工作区不破坏历史会话\"的保守策略。
      sqliteRun(`DELETE FROM team_workspaces WHERE user_id = ? AND id = ?`, [
        user.sub,
        teamWorkspaceId,
      ]);

      step.succeed(undefined, { teamWorkspaceId });
      return reply.status(204).send();
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
      const body = parseBody(createTeamSessionSchema, request.body);
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
      if (body.source?.kind === 'saved-template' && body.source.templateId) {
        const templateStep = child('resolve-template');
        const templateRow = sqliteGet<WorkflowTemplateLookupRow>(
          `SELECT id, name, metadata_json
           FROM workflow_templates
           WHERE user_id = ? AND id = ?
           LIMIT 1`,
          [user.sub, body.source.templateId],
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

        const teamTemplate = parseBody(
          workflowTeamTemplateSchema,
          (parsedMetadata as { teamTemplate?: unknown })?.teamTemplate,
        );

        templateLookup = {
          id: templateRow.id,
          name: templateRow.name,
          teamTemplate: teamTemplate,
        };
        templateStep.succeed(undefined, { templateId: templateRow.id });
      }

      const agentsStep = child('resolve-agents');
      const managedAgents = listManagedAgentsForUser(user.sub).filter((agent) => agent.enabled);
      const agentMap = new Map(managedAgents.map((agent) => [agent.id, agent]));
      const templateDefaultBindings = templateLookup?.teamTemplate.defaultBindings;
      const requiredRoleBindings = FIXED_TEAM_CORE_ROLE_ORDER.map((role) => {
        const templateBinding = templateDefaultBindings?.[role];
        const agentId =
          typeof templateBinding === 'object' && templateBinding?.agentId
            ? templateBinding.agentId
            : typeof templateBinding === 'string' && templateBinding.trim().length > 0
              ? templateBinding
              : FIXED_TEAM_CORE_ROLE_BINDINGS[role];
        return {
          role,
          agentId,
          ...(typeof templateBinding === 'object' && templateBinding?.providerId
            ? { providerId: templateBinding.providerId }
            : {}),
          ...(typeof templateBinding === 'object' && templateBinding?.modelId
            ? { modelId: templateBinding.modelId }
            : {}),
          ...(typeof templateBinding === 'object' && templateBinding?.variant
            ? { variant: templateBinding.variant }
            : {}),
        };
      });
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
          body.optionalAgentIds.length > 0
            ? body.optionalAgentIds
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
          body.defaultProvider ?? templateLookup?.teamTemplate.defaultProvider ?? null,
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
            ...(binding.providerId ? { providerId: binding.providerId } : {}),
            ...(binding.modelId ? { modelId: binding.modelId } : {}),
            ...(binding.variant ? { variant: binding.variant } : {}),
          };
        }),
        source: {
          kind: body.source?.kind ?? 'blank',
          ...(body.source?.templateId ? { templateId: body.source.templateId } : {}),
          ...(templateLookup ? { templateName: templateLookup.name } : {}),
        },
        // 模板内置的快捷起始建议（D 项 starter chips）。前端 empty state 渲染为
        // chip，点击只填 composer 不直接发送（D31：starter 仍须用户主动确认）。
        ...(templateLookup?.teamTemplate.starterSuggestions
          ? { starterSuggestions: templateLookup.teamTemplate.starterSuggestions }
          : {}),
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

      // L1.3 §1.3 + L1.8：通过 b 层创建的 session 必须打上 reception 语义
      // （role_layer='reception'），否则 Watcher 后续无法把它当作 handoff 的
      // from_session_id，整条 b → c → d → e/f/g 链路无法挂载到这条会话上。
      // 这里改用 handoff/team-session-create.ts::createTeamSession 而不是
      // 直接 INSERT，统一与 Watcher 内部创建子 session 的语义。
      const sessionTitle = body.title?.trim() || workspace.name;
      const { sessionId } = createTeamSession({
        userId: user.sub,
        roleLayer: 'reception',
        teamParentSessionId: requestedParentSessionId ?? null,
        metadataJson: JSON.stringify(normalizedMetadata.metadata),
        title: sessionTitle,
      });
      step.succeed(undefined, { sessionId, teamWorkspaceId });

      return reply.status(201).send({
        id: sessionId,
        metadata_json: JSON.stringify(normalizedMetadata.metadata),
        state_status: 'idle',
        title: sessionTitle,
      });
    },
  );

  app.post(
    '/team/workspaces/:teamWorkspaceId/threads',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // ⚠️ DEPRECATED：保留作为兼容入口（v3.10 之前的"generic team thread"语义）。
      // 新代码请改用 POST /team/workspaces/:id/sessions（接受完整 source/optionalAgentIds/
      // defaultProvider，并且产出带 role_layer='reception' 的合法 b 层会话）。
      //
      // 退出策略（与 L1.4 §1.4.4 feature flag 退出策略对齐）：
      //   - 当前阶段：与 /sessions 共用同一会话创建路径，确保产出 reception session
      //   - Phase F：response header 加 deprecation 标记（运维埋点）
      //   - Phase G+：返回 410 Gone
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;
      const { step, child } = startRequestWorkflow(request, 'team.thread.create', undefined, {
        teamWorkspaceId,
      });
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(createThreadSchema, request.body);
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
        ...body.metadata,
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

      // 与 /sessions 路径产出语义一致的 reception session
      const sessionTitle = body.title?.trim() || workspace.name;
      const { sessionId } = createTeamSession({
        userId: user.sub,
        roleLayer: 'reception',
        teamParentSessionId: requestedParentSessionId ?? null,
        metadataJson: JSON.stringify(normalizedMetadata.metadata),
        title: sessionTitle,
      });
      step.succeed(undefined, { sessionId, teamWorkspaceId });

      // Deprecation 提示：让客户端日志能看到这条警告
      reply.header('Deprecation', 'true');
      reply.header('Sunset', 'use POST /team/workspaces/:id/sessions instead');

      return reply.status(201).send({
        id: sessionId,
        metadata_json: JSON.stringify(normalizedMetadata.metadata),
        state_status: 'idle',
        title: sessionTitle,
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
      const body = parseBody(importWorkspaceSessionSchema, request.body);
      parseStep.succeed();

      const normalizedMessages = normalizeImportedMessages(body.messages);
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
      const query = parseQuery(teamRuntimeQuerySchema, request.query);
      queryStep.succeed(undefined, query.teamWorkspaceId ? query : undefined);

      if (query.teamWorkspaceId) {
        const workspaceStep = child('workspace');
        const workspace = getTeamWorkspaceForUser(user.sub, query.teamWorkspaceId);
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
          teamWorkspaceId: query.teamWorkspaceId,
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
        teamWorkspaceId: query.teamWorkspaceId,
      }).filter((row) => teamSessionIds.has(row.session_id));
      sharesStep.succeed(undefined, { count: shareRows.length });

      // Kick off async runtime task groups immediately — they are the slowest part.
      // Run remaining sync queries (audit, shared sessions) in parallel with the async work.
      const sharedSessionAccessRecords = listSharedSessionsForRecipient({
        email: user.email,
        limit: 24,
        offset: 0,
        ...(query.teamWorkspaceId
          ? { teamWorkspaceId: query.teamWorkspaceId }
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
      const body = parseBody(createMemberSchema, request.body);
      parseStep.succeed();

      const { name, email, role, avatarUrl } = body;
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
      const body = parseBody(createTaskSchema, request.body);
      parseStep.succeed();

      const { title, assigneeId, status, priority } = body;
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
      const body = parseBody(updateTaskSchema, request.body);
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
        [body.assigneeId ?? null, body.status ?? null, body.result ?? null, taskId, user.sub],
      );
      updateStep.succeed();

      step.succeed(undefined, {
        taskId,
        status: body.status ?? 'unchanged',
        assigneeChanged: body.assigneeId !== undefined,
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
      const body = parseBody(createMessageSchema, request.body);
      parseStep.succeed();

      const id = randomUUID();
      const insertStep = child('insert', undefined, { messageId: id, type: body.type });
      sqliteRun(
        `INSERT INTO team_messages (id, user_id, sender_id, content, type) VALUES (?, ?, ?, ?, ?)`,
        [id, user.sub, body.senderId ?? null, body.content, body.type],
      );
      insertStep.succeed();

      step.succeed(undefined, { messageId: id, type: body.type });
      return reply.status(201).send({
        id,
        memberId: body.senderId ?? 'system',
        content: body.content,
        type: body.type,
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
      const body = parseBody(createSessionShareSchema, request.body);
      parseStep.succeed();

      const sessionStep = child('check-session');
      const session = sqliteGet<{ id: string; metadata_json: string; title: string | null }>(
        `SELECT id, title, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
        [body.sessionId, user.sub],
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
        [body.memberId, user.sub],
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
        [user.sub, body.sessionId, body.memberId],
      );
      if (existing) {
        existingStep.fail('share already exists');
        step.fail('share already exists');
        return reply.status(409).send({ error: 'Share already exists' });
      }
      existingStep.succeed();

      const shareId = randomUUID();
      const insertStep = child('insert', undefined, { shareId, permission: body.permission });
      sqliteRun(
        `INSERT INTO session_shares (id, user_id, session_id, member_id, permission, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [shareId, user.sub, body.sessionId, body.memberId, body.permission],
      );
      insertStep.succeed();
      step.succeed(undefined, { shareId, permission: body.permission });

      const sessionWorkspacePath = getWorkspacePathFromMetadataJson({
        metadataJson: session.metadata_json,
        sessionId: body.sessionId,
        userId: user.sub,
      });
      logTeamAudit({
        action: 'share_created' satisfies TeamAuditAction,
        actorEmail: user.email,
        actorUserId: user.sub,
        detail: `会话：${session.title ?? body.sessionId}；工作区：${sessionWorkspacePath ?? '未绑定工作区'}；成员：${member.name}；权限：${body.permission}`,
        entityId: shareId,
        entityType: 'session_share',
        summary: `已将“${session.title ?? body.sessionId}”共享给 ${member.name}（${body.permission}）`,
        userId: user.sub,
      });

      const createdShare = getSessionShareForUser(user.sub, shareId);

      return reply.status(201).send({
        ...(createdShare ? mapSessionShareRow(user.sub, createdShare) : {}),
        id: createdShare?.id ?? shareId,
        sessionId: createdShare?.session_id ?? body.sessionId,
        memberId: createdShare?.member_id ?? body.memberId,
        memberName: createdShare?.member_name ?? member.name,
        memberEmail: createdShare?.member_email ?? member.email,
        permission: createdShare?.permission ?? body.permission,
        sessionLabel: createdShare?.label ?? session.title ?? body.sessionId,
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
      const body = parseBody(updateSessionShareSchema, request.body);
      parseStep.succeed();

      const lookupStep = child('check-existing');
      const existing = getSessionShareForUser(user.sub, shareId);
      if (!existing) {
        lookupStep.fail('share not found');
        step.fail('share not found');
        return reply.status(404).send({ error: 'Session share not found' });
      }
      lookupStep.succeed(undefined, { currentPermission: existing.permission });

      const changed = existing.permission !== body.permission;

      if (changed) {
        const updateStep = child('update', undefined, { nextPermission: body.permission });
        sqliteRun(
          `UPDATE session_shares
           SET permission = ?, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`,
          [body.permission, shareId, user.sub],
        );
        updateStep.succeed();

        logTeamAudit({
          action: 'share_permission_updated' satisfies TeamAuditAction,
          actorEmail: user.email,
          actorUserId: user.sub,
          detail: `会话：${existing.label ?? existing.session_id}；工作区：${getWorkspacePathFromMetadataJson({ metadataJson: existing.session_metadata_json, sessionId: existing.session_id, userId: user.sub }) ?? '未绑定工作区'}；成员：${existing.member_name}；旧权限：${existing.permission}；新权限：${body.permission}`,
          entityId: shareId,
          entityType: 'session_share',
          summary: `已将 ${existing.member_name} 对“${existing.label ?? existing.session_id}”的权限从 ${existing.permission} 调整为 ${body.permission}`,
          userId: user.sub,
        });
      }

      const responseShare = changed
        ? (getSessionShareForUser(user.sub, shareId) ?? existing)
        : existing;

      step.succeed(undefined, {
        changed,
        permission: body.permission,
      });
      return reply.send(
        mapSessionShareRow(user.sub, { ...responseShare, permission: body.permission }),
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
      const query = parseQuery(auditLogsQuerySchema, request.query);
      queryStep.succeed(undefined, { limit: query.limit });

      const rows = listTeamAuditLogs({ userId: user.sub, limit: query.limit });
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

  // ─── L1.3 §1.3 反向消息通道：POST /team/sessions/:sessionId/inbound-messages ───
  // 关联文档：docs/team-architecture-l1-3-streaming-handoff-spec.md §1.3
  // 关联实现：handoff/inbound-store.ts
  //
  // 用途：
  //   - team 用户回答 c 的 [NEEDS CLARIFICATION] → clarification_answer
  //   - team 用户中途追加输入 → user_input
  //   - 取消 / 暂停 / 恢复信号
  // 这条端点写入 session_inbound_messages 表，下游 session 在 LLM 循环中
  // 通过 consumePendingInboundMessage 拉取消费。
  app.post(
    '/team/sessions/:sessionId/inbound-messages',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const { step, child } = startRequestWorkflow(request, 'team.session.inbound', undefined, {
        sessionId,
      });
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(inboundSubmitSchema, request.body);
      parseStep.succeed();

      // 校验 session 归属
      const sessionStep = child('resolve-session');
      const session = sqliteGet<{ id: string; user_id: string; role_layer: string | null }>(
        `SELECT id, user_id, role_layer FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
        [sessionId, user.sub],
      );
      if (!session) {
        sessionStep.fail('session not found');
        step.fail('session not found');
        return reply.status(404).send({ error: 'Session not found' });
      }
      sessionStep.succeed();

      const submitStep = child('submit-inbound');
      try {
        const { submitInboundMessage } = await import('../handoff/store/inbound-store.js');
        const expiresAtIso =
          typeof body.expiresAt === 'number'
            ? new Date(body.expiresAt).toISOString().replace('T', ' ').replace('Z', '').slice(0, 19)
            : undefined;
        const result = submitInboundMessage({
          userId: user.sub,
          toSessionId: sessionId,
          // L1.4 capability：HTTP 入口的发送方语义。
          //   - 目标是 reception 会话 → 'user'（用户直接发到 b）
          //   - 目标是其他层会话 → 'reception'（b 代为转发用户的回答给 c/d/e/f/g）
          // 这与 layer-capabilities 矩阵的 canReceiveInboundFrom 对齐。
          fromRoleLayer: session.role_layer === 'reception' ? 'user' : 'reception',
          messageType: body.messageType,
          payload: body.payload ?? {},
          clientIdempotencyKey: body.clientIdempotencyKey ?? null,
          ...(expiresAtIso ? { expiresAt: expiresAtIso } : {}),
        });
        submitStep.succeed(undefined, {
          messageId: result.record.id,
          reused: result.reused,
        });

        // ─── L1.4 audit log：escape hatch 使用记录 ─────────────────────
        // cancel_signal / pause_signal / escalation_request 是 escape hatch 调用，
        // 必须写 audit log（L1.4.3 要求）。
        const isEscapeHatch =
          body.messageType === 'cancel_signal' ||
          body.messageType === 'pause_signal' ||
          body.messageType === 'resume_signal' ||
          body.messageType === 'escalation_request';
        if (isEscapeHatch && !result.reused) {
          const hatchType =
            body.messageType === 'escalation_request'
              ? '#1 escalation'
              : body.messageType === 'cancel_signal' || body.messageType === 'pause_signal'
                ? '#3 cancel/pause'
                : '#3 resume';
          try {
            logTeamAudit({
              action: 'escape_hatch_used' as TeamAuditAction,
              actorEmail: user.email,
              actorUserId: user.sub,
              detail: JSON.stringify({
                hatchType,
                messageType: body.messageType,
                targetSessionId: sessionId,
                decisionSource: 'user',
              }),
              entityId: result.record.id,
              entityType: 'session_inbound_message',
              summary: `Escape hatch ${hatchType}: ${body.messageType} → session ${sessionId.slice(0, 8)}`,
              userId: user.sub,
            });
          } catch {
            // audit log 写入失败不阻塞
          }
        }

        // ─── 同步：把用户消息写入 session 消息流（所有 session 类型） ─────
        // 无论是否触发 B1 编排，user_input 都应该在 session 的消息流中可见。
        // 这样 reload 后前端能立刻看到自己发的话。
        // 注意：只对 user_input 且非 reused 写入（避免 cancel/pause 等信号
        // 或幂等重试产生重复消息）。
        if (body.messageType === 'user_input' && !result.reused) {
          const userInputText =
            typeof body.payload?.['text'] === 'string' ? body.payload['text'] : '';
          if (userInputText.trim().length > 0) {
            try {
              const { appendSessionMessageV2 } = await import('../message/message-v2-adapter.js');
              appendSessionMessageV2({
                sessionId,
                userId: user.sub,
                role: 'user',
                content: [{ type: 'text', text: userInputText }],
                clientRequestId: body.clientIdempotencyKey ?? null,
              });
            } catch (err) {
              console.warn(
                `[team.session.inbound] persist user msg failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }

        // ─── B1 自动编排（只对 reception session 的 user_input 触发） ─────────
        const shouldOrchestrate =
          !result.reused && session.role_layer === 'reception' && body.messageType === 'user_input';
        if (shouldOrchestrate) {
          const userInputText =
            typeof body.payload?.['text'] === 'string' ? body.payload['text'] : '';
          // 从 session metadata 读 teamWorkspaceId（reception session 创建时已写入）
          const sessionMeta = sqliteGet<{ metadata_json: string | null }>(
            `SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1`,
            [sessionId],
          );
          let teamWorkspaceIdFromMeta: string | null = null;
          if (sessionMeta?.metadata_json) {
            try {
              const parsed = JSON.parse(sessionMeta.metadata_json) as Record<string, unknown>;
              if (typeof parsed['teamWorkspaceId'] === 'string') {
                teamWorkspaceIdFromMeta = parsed['teamWorkspaceId'];
              }
            } catch {
              // ignore
            }
          }

          // 异步：把 LLM 改写 + handoff 创建放到后台。assistant ack 由
          // orchestrator 在完成时落库，前端可通过 WS 或下一次 reload 看到。
          void (async () => {
            try {
              const { orchestrateReceptionInput } =
                await import('../handoff/runner/reception-orchestrator.js');
              await orchestrateReceptionInput({
                userId: user.sub,
                receptionSessionId: sessionId,
                userIntent: userInputText,
                teamWorkspaceId: teamWorkspaceIdFromMeta,
                clientIdempotencyKey: body.clientIdempotencyKey ?? null,
                // user 消息已在上面同步写过，避免重复写
                persistUserMessage: false,
              });
            } catch (err) {
              console.warn(
                `[team.session.inbound] orchestrate (async) failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          })();
        }

        step.succeed(undefined, { messageId: result.record.id });

        // L1.6 延迟监控：记录 a→b 确认延迟（从请求开始到响应）
        try {
          const { recordLatency } = await import('../handoff/bus/latency-monitor.js');
          const requestStartMs = (request as unknown as { startTime?: number }).startTime;
          if (typeof requestStartMs === 'number') {
            recordLatency('a_to_b_ack', Date.now() - requestStartMs);
          }
        } catch {
          /* latency monitor 不阻塞 */
        }

        return reply.status(result.reused ? 200 : 201).send({
          messageId: result.record.id,
          createdAt: result.record.createdAt,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'inbound submit failed';
        submitStep.fail(reason);
        step.fail(reason);
        return reply.status(500).send({ error: reason });
      }
    },
  );
}
