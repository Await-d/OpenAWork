import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';

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
}
