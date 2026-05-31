import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { resolveSessionWorkspacePath } from '../session/session-workspace-resolution.js';
import { listTeamAuditLogs, logTeamAudit, type TeamAuditAction } from '../team/team-audit-store.js';
import { appendTeamMessage } from '../team/team-message-store.js';

const createMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
  avatarUrl: z.string().url().optional(),
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

type TeamCrudRouteErrorCode =
  | 'team_member_already_exists'
  | 'team_task_not_found'
  | 'team_session_not_found'
  | 'team_member_not_found'
  | 'team_session_share_already_exists'
  | 'team_session_share_not_found';

const TEAM_CRUD_ROUTE_ERROR_MESSAGES: Record<TeamCrudRouteErrorCode, string> = {
  team_member_already_exists: '该邮箱对应的团队成员已存在。',
  team_task_not_found: '目标团队任务不存在。',
  team_session_not_found: '目标会话不存在。',
  team_member_not_found: '目标团队成员不存在。',
  team_session_share_already_exists: '该会话共享记录已存在。',
  team_session_share_not_found: '目标会话共享记录不存在。',
};

function teamCrudRouteErrorPayload(
  code: TeamCrudRouteErrorCode,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    code,
    error: TEAM_CRUD_ROUTE_ERROR_MESSAGES[code],
    ...(extra ?? {}),
  };
}

export async function teamCrudRoutes(app: FastifyInstance): Promise<void> {
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
        return reply.status(409).send(teamCrudRouteErrorPayload('team_member_already_exists'));
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
        `SELECT id, title, assignee_id, status, priority, result, created_at, updated_at FROM team_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`,
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
        return reply.status(404).send(teamCrudRouteErrorPayload('team_task_not_found'));
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
      appendTeamMessage({
        id,
        userId: user.sub,
        senderId: body.senderId ?? null,
        content: body.content,
        type: body.type,
      });
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
        return reply.status(404).send(teamCrudRouteErrorPayload('team_session_not_found'));
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
        return reply.status(404).send(teamCrudRouteErrorPayload('team_member_not_found'));
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
        return reply
          .status(409)
          .send(teamCrudRouteErrorPayload('team_session_share_already_exists'));
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
        return reply.status(404).send(teamCrudRouteErrorPayload('team_session_share_not_found'));
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
}
