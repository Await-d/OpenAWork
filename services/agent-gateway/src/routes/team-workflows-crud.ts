/**
 * 260516-team-phase-e · T-05
 *
 * Workflow CRUD API：GET/POST/PUT/DELETE /team/workflows
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  teamWorkflowSchema,
  validateWorkflowConsistency,
} from '../handoff/workflow/workflow-template-schema.js';
import { BUILTIN_WORKFLOWS } from '../handoff/workflow/workflow-builtin-packs.js';
import { randomUUID } from 'node:crypto';

const createWorkflowSchema = z.object({
  workflow: teamWorkflowSchema,
});

const updateWorkflowSchema = z.object({
  workflow: teamWorkflowSchema,
});

export async function teamWorkflowsCrudRoutes(app: FastifyInstance): Promise<void> {
  // 列出所有可用 workflow（内置 + 自定义）
  app.get(
    '/team/workflows',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.workflows.list');
      const user = request.user as JwtPayload;

      const customRows = sqliteAll<{ id: string; metadata_json: string; updated_at: string }>(
        `SELECT id, metadata_json, updated_at FROM workflow_templates
         WHERE user_id = ? AND json_extract(metadata_json, '$.teamWorkflow') IS NOT NULL
         ORDER BY updated_at DESC`,
        [user.sub],
      );

      const custom = customRows
        .map((row) => {
          try {
            const meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
            const parsed = teamWorkflowSchema.safeParse(meta['teamWorkflow']);
            if (parsed.success) return { ...parsed.data, _dbId: row.id };
            return null;
          } catch (_err) {
            void _err;
            return null;
          }
        })
        .filter((w): w is NonNullable<typeof w> => w !== null);

      const workflows = [...BUILTIN_WORKFLOWS.map((w) => ({ ...w, _dbId: null })), ...custom];

      step.succeed(undefined, { count: workflows.length });
      return reply.send({ workflows });
    },
  );

  // 创建自定义 workflow
  app.post(
    '/team/workflows',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.workflows.create');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = createWorkflowSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const validation = validateWorkflowConsistency(body.data.workflow);
      if (!validation.valid) {
        step.fail('invalid workflow');
        return reply.status(400).send({ error: 'Invalid workflow', issues: validation.errors });
      }

      const id = randomUUID();
      const metadataJson = JSON.stringify({ teamWorkflow: body.data.workflow });
      sqliteRun(
        `INSERT INTO workflow_templates (id, user_id, name, category, metadata_json, nodes_json, edges_json)
         VALUES (?, ?, ?, 'team-playbook', ?, '[]', '[]')`,
        [id, user.sub, body.data.workflow.name, metadataJson],
      );

      step.succeed(undefined, { workflowId: body.data.workflow.id });
      return reply.status(201).send({ id, workflow: body.data.workflow });
    },
  );

  // 更新自定义 workflow
  app.put(
    '/team/workflows/:workflowDbId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.workflows.update');
      const user = request.user as JwtPayload;
      const workflowDbId = (request.params as { workflowDbId: string }).workflowDbId;

      const existing = sqliteGet<{ id: string }>(
        `SELECT id FROM workflow_templates WHERE id = ? AND user_id = ?`,
        [workflowDbId, user.sub],
      );
      if (!existing) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Workflow not found' });
      }

      const parseStep = child('parse-body');
      const body = updateWorkflowSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const validation = validateWorkflowConsistency(body.data.workflow);
      if (!validation.valid) {
        step.fail('invalid workflow');
        return reply.status(400).send({ error: 'Invalid workflow', issues: validation.errors });
      }

      const metadataJson = JSON.stringify({ teamWorkflow: body.data.workflow });
      sqliteRun(
        `UPDATE workflow_templates SET name = ?, metadata_json = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
        [body.data.workflow.name, metadataJson, workflowDbId, user.sub],
      );

      step.succeed(undefined, { workflowId: body.data.workflow.id });
      return reply.send({ id: workflowDbId, workflow: body.data.workflow });
    },
  );

  // 删除自定义 workflow
  app.delete(
    '/team/workflows/:workflowDbId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.workflows.delete');
      const user = request.user as JwtPayload;
      const workflowDbId = (request.params as { workflowDbId: string }).workflowDbId;

      const existing = sqliteGet<{ id: string }>(
        `SELECT id FROM workflow_templates WHERE id = ? AND user_id = ?`,
        [workflowDbId, user.sub],
      );
      if (!existing) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Workflow not found' });
      }

      sqliteRun(`DELETE FROM workflow_templates WHERE id = ? AND user_id = ?`, [
        workflowDbId,
        user.sub,
      ]);

      step.succeed(undefined, { workflowDbId });
      return reply.send({ ok: true });
    },
  );
}
