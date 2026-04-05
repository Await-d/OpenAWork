import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';
import {
  extractSessionWorkingDirectory,
  parseSessionMetadataJson,
} from '../session-workspace-metadata.js';

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

interface TeamAuditLogRow {
  action: 'share_created' | 'share_deleted' | 'share_permission_updated';
  created_at: string;
  detail: string | null;
  entity_id: string;
  entity_type: 'session_share';
  id: number;
  summary: string;
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

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  const normalizeMemberStatus = (status: string): 'idle' | 'working' | 'done' | 'error' => {
    if (status === 'working' || status === 'done' || status === 'error') return status;
    return 'idle';
  };

  const logTeamAudit = (input: {
    action: TeamAuditLogRow['action'];
    detail?: string;
    entityId: string;
    summary: string;
    userId: string;
  }) => {
    sqliteRun(
      `INSERT INTO team_audit_logs (user_id, action, entity_type, entity_id, summary, detail, created_at)
       VALUES (?, ?, 'session_share', ?, ?, ?, datetime('now'))`,
      [input.userId, input.action, input.entityId, input.summary, input.detail ?? null],
    );
  };

  const getWorkspacePathFromMetadataJson = (metadataJson: string): string | null =>
    extractSessionWorkingDirectory(parseSessionMetadataJson(metadataJson));

  const mapSessionShareRow = (row: SessionShareRow) => ({
    id: row.id,
    sessionId: row.session_id,
    memberId: row.member_id,
    memberName: row.member_name,
    memberEmail: row.member_email,
    permission: row.permission,
    sessionLabel: row.label ?? row.session_id,
    workspacePath: getWorkspacePathFromMetadataJson(row.session_metadata_json),
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

      return reply.send(rows.map((row) => mapSessionShareRow(row)));
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

      const sessionWorkspacePath = getWorkspacePathFromMetadataJson(session.metadata_json);
      logTeamAudit({
        action: 'share_created',
        detail: `会话：${session.title ?? body.data.sessionId}；工作区：${sessionWorkspacePath ?? '未绑定工作区'}；成员：${member.name}；权限：${body.data.permission}`,
        entityId: shareId,
        summary: `已将“${session.title ?? body.data.sessionId}”共享给 ${member.name}（${body.data.permission}）`,
        userId: user.sub,
      });

      const createdShare = getSessionShareForUser(user.sub, shareId);

      return reply.status(201).send({
        ...(createdShare ? mapSessionShareRow(createdShare) : {}),
        id: createdShare?.id ?? shareId,
        sessionId: createdShare?.session_id ?? body.data.sessionId,
        memberId: createdShare?.member_id ?? body.data.memberId,
        memberName: createdShare?.member_name ?? member.name,
        memberEmail: createdShare?.member_email ?? member.email,
        permission: createdShare?.permission ?? body.data.permission,
        sessionLabel: createdShare?.label ?? session.title ?? body.data.sessionId,
        workspacePath: createdShare
          ? getWorkspacePathFromMetadataJson(createdShare.session_metadata_json)
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
          action: 'share_permission_updated',
          detail: `会话：${existing.label ?? existing.session_id}；工作区：${getWorkspacePathFromMetadataJson(existing.session_metadata_json) ?? '未绑定工作区'}；成员：${existing.member_name}；旧权限：${existing.permission}；新权限：${body.data.permission}`,
          entityId: shareId,
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
      return reply.send(mapSessionShareRow({ ...responseShare, permission: body.data.permission }));
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

      const rows = sqliteAll<TeamAuditLogRow>(
        `SELECT id, action, entity_type, entity_id, summary, detail, created_at
         FROM team_audit_logs
         WHERE user_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        [user.sub, query.data.limit],
      );
      step.succeed(undefined, { count: rows.length });

      return reply.send(
        rows.map((row) => ({
          id: String(row.id),
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          summary: row.summary,
          detail: row.detail,
          createdAt: row.created_at,
        })),
      );
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
          action: 'share_deleted',
          detail: `会话：${existing.label ?? existing.session_id}；工作区：${getWorkspacePathFromMetadataJson(existing.session_metadata_json) ?? '未绑定工作区'}；成员：${existing.member_name}；删除前权限：${existing.permission}`,
          entityId: shareId,
          summary: `已取消 ${existing.member_name} 对“${existing.label ?? existing.session_id}”的共享权限`,
          userId: user.sub,
        });
      }

      step.succeed();
      return reply.status(204).send();
    },
  );
}
