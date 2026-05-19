import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { FIXED_TEAM_CORE_ROLE_ORDER } from '@openAwork/shared';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { buildFixedTeamTemplateDefaultBindings } from '../team/team-template-metadata.js';
import * as agentCore from '@openAwork/agent-core';
import { resolveAuxiliaryLlmConfig } from '../provider/auxiliary-llm-config.js';
import { requestWorkflowLlmCompletion } from './workflow-llm.js';

type AgentCoreWithExtras = typeof agentCore & {
  PromptOptimizerImpl?: typeof agentCore.PromptOptimizerImpl;
  TranslationWorkflowImpl?: typeof agentCore.TranslationWorkflowImpl;
};
const { PromptOptimizerImpl, TranslationWorkflowImpl } = agentCore as AgentCoreWithExtras;

const translateSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string().min(1),
        content: z.string().min(1),
        fileName: z.string().min(1),
        sourceLanguage: z.string().default('auto'),
        targetLanguage: z.string().min(1),
      }),
    )
    .min(1),
});

const optimizePromptSchema = z.object({
  originalPrompt: z.string().min(1),
  context: z.string().optional(),
  targetAudience: z.string().optional(),
  candidateCount: z.number().int().min(1).max(5).optional(),
});

const roleBindingSchema = z.object({
  agentId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  variant: z.string().min(1).max(80).optional(),
});

const createTemplateSchema = z.object({
  metadata: z
    .object({
      teamTemplate: z
        .object({
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
        })
        .optional(),
    })
    .optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().default('general'),
  nodes: z.array(z.record(z.unknown())).default([]),
  edges: z.array(z.record(z.unknown())).default([]),
});

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  metadata_json: string;
  nodes_json: string;
  edges_json: string;
  created_at: string;
  updated_at: string;
}

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/workflows/templates',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workflow.template.list');
      const user = request.user as JwtPayload;

      const queryStep = child('query');
      const rows = sqliteAll<TemplateRow>(
        `SELECT id, name, description, category, metadata_json, nodes_json, edges_json, created_at, updated_at
         FROM workflow_templates
         WHERE user_id = ?
         ORDER BY updated_at DESC`,
        [user.sub],
      );
      queryStep.succeed(undefined, { templates: rows.length });

      const parseStep = child('parse-json');
      try {
        const templates = rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          category: row.category,
          metadata: JSON.parse(row.metadata_json || '{}') as Record<string, unknown>,
          nodes: JSON.parse(row.nodes_json) as unknown[],
          edges: JSON.parse(row.edges_json) as unknown[],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
        parseStep.succeed(undefined, { templates: templates.length });
        step.succeed(undefined, { templates: templates.length });
        return reply.send(templates);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'invalid template JSON';
        parseStep.fail(message);
        step.fail(message);
        throw error;
      }
    },
  );

  app.post(
    '/workflows/templates',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workflow.template.create');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = createTemplateSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const { name, description, category, metadata, nodes, edges } = body.data;
      const normalizedMetadata =
        category === 'team-playbook'
          ? {
              ...(metadata ?? {}),
              teamTemplate: {
                ...(metadata?.teamTemplate ?? {}),
                defaultBindings: {
                  ...buildFixedTeamTemplateDefaultBindings(),
                  ...(metadata?.teamTemplate?.defaultBindings ?? {}),
                },
                requiredRoles: [...FIXED_TEAM_CORE_ROLE_ORDER],
              },
            }
          : (metadata ?? {});
      const templateId = randomUUID();
      const insertStep = child('insert', undefined, { category, templateId });
      sqliteRun(
        `INSERT INTO workflow_templates (id, user_id, name, description, category, metadata_json, nodes_json, edges_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          templateId,
          user.sub,
          name,
          description ?? null,
          category,
          JSON.stringify(normalizedMetadata),
          JSON.stringify(nodes),
          JSON.stringify(edges),
        ],
      );
      insertStep.succeed();
      step.succeed(undefined, { category, templateId });

      return reply.status(201).send({
        id: templateId,
        name,
        description,
        category,
        metadata: normalizedMetadata,
        nodes,
        edges,
      });
    },
  );

  app.post(
    '/workflows/optimize-prompt',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'workflow.prompt.optimize');
      const body = optimizePromptSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      // Prefer the user's chat-configured "fast / inline" provider so
      // the prompt optimizer reuses the same credentials the user
      // already set up in 设置 → 提供商, instead of requiring a
      // separate set of `AI_API_*` env vars on the gateway.
      const user = request.user as JwtPayload;
      const llmConfig = await resolveAuxiliaryLlmConfig(user.sub);
      if (!llmConfig) {
        step.fail('no llm config');
        return reply.status(503).send({
          error:
            '提示词优化器未找到可用模型：请在 设置 → 提供商 中启用一个「快速 / 内联」或「会话」模型并填写 API Key，或在网关环境变量中设置 AI_API_BASE_URL 与 AI_API_KEY 后重启网关。',
        });
      }

      const optimizer = new PromptOptimizerImpl(async (prompt: string) => {
        return requestWorkflowLlmCompletion({
          apiBaseUrl: llmConfig.apiBaseUrl,
          apiKey: llmConfig.apiKey,
          model: llmConfig.model,
          ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
          ...(llmConfig.upstreamProtocol ? { upstreamProtocol: llmConfig.upstreamProtocol } : {}),
          prompt,
          temperature: 0.7,
        });
      });

      try {
        const result = await optimizer.optimize(body.data);
        step.succeed(undefined, {
          requestId: result.requestId,
          candidates: result.candidates.length,
        });
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        step.fail(message);
        // Bubble the upstream / parser error message into the JSON body
        // so the frontend can show e.g. "AI_APICallError: 401" instead
        // of the opaque "Failed to optimize prompt: 500".
        return reply.status(500).send({ error: `优化提示词失败：${message}` });
      }
    },
  );

  app.post(
    '/workflows/translate',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'workflow.translate');
      const body = translateSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const user = request.user as JwtPayload;
      const llmConfig = await resolveAuxiliaryLlmConfig(user.sub);
      if (!llmConfig) {
        step.fail('no llm config');
        return reply.status(503).send({
          error:
            '翻译工作流未找到可用模型：请在 设置 → 提供商 中启用一个「快速 / 内联」或「会话」模型并填写 API Key，或在网关环境变量中设置 AI_API_BASE_URL 与 AI_API_KEY 后重启网关。',
        });
      }

      const workflow = new TranslationWorkflowImpl(async (prompt: string) => {
        return requestWorkflowLlmCompletion({
          apiBaseUrl: llmConfig.apiBaseUrl,
          apiKey: llmConfig.apiKey,
          model: llmConfig.model,
          ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
          ...(llmConfig.upstreamProtocol ? { upstreamProtocol: llmConfig.upstreamProtocol } : {}),
          prompt,
          temperature: 0.3,
        });
      });

      const results = await workflow.batchTranslate(body.data.tasks);
      step.succeed(undefined, { tasks: results.length });
      return reply.send({ results });
    },
  );

  app.patch(
    '/workflows/templates/:id',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workflow.template.update');
      const user = request.user as JwtPayload;
      const { id } = request.params as { id: string };

      const lookupStep = child('lookup', undefined, { templateId: id });
      const existing = sqliteGet<TemplateRow>(
        `SELECT id, name, description, category, metadata_json, nodes_json, edges_json, created_at, updated_at
         FROM workflow_templates WHERE id = ? AND user_id = ?`,
        [id, user.sub],
      );
      if (!existing) {
        lookupStep.fail('template not found');
        step.fail('template not found');
        return reply.status(404).send({ error: 'Template not found' });
      }
      lookupStep.succeed();

      const patchSchema = z.object({
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        metadata: z
          .object({
            teamTemplate: z
              .object({
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
                templateScale: z.enum(['small', 'medium', 'large', 'full']).nullable().optional(),
                templateFocus: z.string().nullable().optional(),
                recommendedFor: z.string().nullable().optional(),
                recommendedDefault: z.boolean().nullable().optional(),
                templatePriority: z.number().nullable().optional(),
              })
              .optional(),
          })
          .optional(),
        nodes: z.array(z.record(z.unknown())).optional(),
        edges: z.array(z.record(z.unknown())).optional(),
      });

      const parseStep = child('parse-body');
      const body = patchSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const existingMetadata = JSON.parse(existing.metadata_json || '{}') as Record<
        string,
        unknown
      >;
      const mergedMetadata = body.data.metadata
        ? { ...existingMetadata, ...body.data.metadata }
        : existingMetadata;

      if (body.data.metadata?.teamTemplate && existing.category === 'team-playbook') {
        const existingTeamTemplate = (
          existingMetadata as { teamTemplate?: Record<string, unknown> }
        )?.teamTemplate;
        mergedMetadata.teamTemplate = {
          ...(existingTeamTemplate ?? {}),
          ...body.data.metadata.teamTemplate,
          ...(body.data.metadata.teamTemplate.defaultBindings
            ? {
                defaultBindings: {
                  ...((existingTeamTemplate as { defaultBindings?: Record<string, unknown> })
                    ?.defaultBindings ?? {}),
                  ...body.data.metadata.teamTemplate.defaultBindings,
                },
              }
            : {}),
        };
      }

      const newName = body.data.name ?? existing.name;
      const newDescription =
        body.data.description !== undefined ? body.data.description : existing.description;
      const newNodes = body.data.nodes ?? (JSON.parse(existing.nodes_json) as unknown[]);
      const newEdges = body.data.edges ?? (JSON.parse(existing.edges_json) as unknown[]);

      const updateStep = child('update', undefined, { templateId: id });
      sqliteRun(
        `UPDATE workflow_templates SET name = ?, description = ?, metadata_json = ?, nodes_json = ?, edges_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
        [
          newName,
          newDescription,
          JSON.stringify(mergedMetadata),
          JSON.stringify(newNodes),
          JSON.stringify(newEdges),
          id,
          user.sub,
        ],
      );
      updateStep.succeed();
      step.succeed(undefined, { templateId: id });

      return reply.send({
        id,
        name: newName,
        description: newDescription,
        category: existing.category,
        metadata: mergedMetadata,
        nodes: newNodes,
        edges: newEdges,
        createdAt: existing.created_at,
        updatedAt: new Date().toISOString(),
      });
    },
  );

  app.delete(
    '/workflows/templates/:id',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const { step, child } = startRequestWorkflow(request, 'workflow.template.delete', undefined, {
        templateId: id,
      });

      const lookupStep = child('lookup', undefined, { templateId: id });
      const row = sqliteGet<{ id: string }>(
        `SELECT id FROM workflow_templates WHERE id = ? AND user_id = ?`,
        [id, user.sub],
      );
      if (!row) {
        lookupStep.fail('template not found');
        step.fail('template not found');
        return reply.status(404).send({ error: 'Template not found' });
      }
      lookupStep.succeed();

      const removeStep = child('remove', undefined, { templateId: id });
      sqliteRun(`DELETE FROM workflow_templates WHERE id = ?`, [id]);
      removeStep.succeed();
      step.succeed(undefined, { templateId: id });

      return reply.status(204).send();
    },
  );
}
