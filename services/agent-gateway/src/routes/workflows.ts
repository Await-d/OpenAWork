import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
  FIXED_TEAM_CORE_ROLE_ORDER,
  TEAM_RUNTIME_LAYER_ORDER,
} from '@openAwork/shared';
import type { TeamMemberSpecialty } from '@openAwork/shared';
import type { JwtPayload } from '../infra/auth.js';
import { parseBody } from '../infra/parse-request.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { buildFixedTeamTemplateDefaultBindings } from '../team/team-template-metadata.js';
import * as agentCore from '@openAwork/agent-core';
import { resolveAuxiliaryLlmConfig } from '../provider/auxiliary-llm-config.js';
import type { ResolvedAuxiliaryLlmConfig } from '../provider/auxiliary-llm-config.js';
import { requestWorkflowLlmCompletion } from './workflow-llm.js';
import { assignTeamModels, pickAnalysisModels } from '../team/team-model-assignment.js';

type AgentCoreWithExtras = typeof agentCore & {
  PromptOptimizerImpl?: typeof agentCore.PromptOptimizerImpl;
  TranslationWorkflowImpl?: typeof agentCore.TranslationWorkflowImpl;
};
const { PromptOptimizerImpl, TranslationWorkflowImpl } = agentCore as AgentCoreWithExtras;

const TEAM_MEMBER_SPECIALTY_VALUES = Array.from(
  new Set<TeamMemberSpecialty>([
    ...DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => slot.specialty),
    'custom',
  ]),
) as [TeamMemberSpecialty, ...TeamMemberSpecialty[]];

const teamTemplateMemberSlotSchema = z.object({
  id: z.string().min(1).max(120),
  layer: z.enum(TEAM_RUNTIME_LAYER_ORDER),
  specialty: z.enum(TEAM_MEMBER_SPECIALTY_VALUES),
  displayName: z.string().min(1).max(200),
  personaKey: z.string().min(1).max(160),
  toolsets: z.array(z.string().min(1).max(80)).max(20),
  required: z.boolean(),
  // 可选 per-member 模型绑定（智能分配模型功能；老数据无此字段，向后兼容）。
  providerId: z.string().min(1).max(200).optional(),
  modelId: z.string().min(1).max(200).optional(),
  variant: z.string().min(1).max(80).optional(),
  thinkingEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  // 自定义角色字段（specialty === 'custom'）。
  custom: z.boolean().optional(),
  systemPrompt: z.string().max(8000).optional(),
  // 模板初始能力绑定（skills / mcp）。
  skillIds: z.array(z.string().min(1).max(160)).max(50).optional(),
  mcpServerIds: z.array(z.string().min(1).max(160)).max(50).optional(),
  // 路由关键词（上游派发动态识别成员擅长领域；自定义角色尤其需要）。
  routingKeywords: z.array(z.string().min(1).max(160)).max(50).optional(),
  // 派发优先级（同分排序权重）。
  dispatchPriority: z.enum(['high', 'normal', 'low']).optional(),
});

const teamTemplateModelRefSchema = z.object({
  providerId: z.string().min(1).max(200),
  modelId: z.string().min(1).max(200),
});

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

/** 「一键智能分配模型」请求体：候选池 + 各层画像 + 策略。 */
const assignTeamModelsSchema = z.object({
  strategy: z.enum(['quality', 'cost', 'balanced', 'single']),
  pool: z
    .array(
      z.object({
        providerId: z.string().min(1).max(200),
        providerName: z.string().max(200).optional(),
        modelId: z.string().min(1).max(200),
        label: z.string().max(200).optional(),
        contextWindow: z.number().int().nonnegative().optional(),
        supportsTools: z.boolean().optional(),
        supportsThinking: z.boolean().optional(),
        supportsVision: z.boolean().optional(),
        inputPricePerMillion: z.number().nonnegative().optional(),
        outputPricePerMillion: z.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(80),
  layers: z
    .array(
      z.object({
        layer: z.enum(TEAM_RUNTIME_LAYER_ORDER),
        memberLabels: z.array(z.string().min(1).max(200)).max(20).default([]),
      }),
    )
    .min(1)
    .max(TEAM_RUNTIME_LAYER_ORDER.length),
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
          memberSlots: z.array(teamTemplateMemberSlotSchema).max(40).optional(),
          modelPool: z.array(teamTemplateModelRefSchema).max(60).optional(),
          modelAssignStrategy: z.enum(['quality', 'cost', 'balanced', 'single']).optional(),
          optionalAgentIds: z.array(z.string().min(1)).optional(),
          requiredRoles: z
            .array(z.enum(['leader', 'planner', 'researcher', 'executor', 'reviewer']))
            .optional(),
          templateScale: z.enum(['small', 'medium', 'large', 'full']).nullable().optional(),
          templateFocus: z.string().max(200).nullable().optional(),
          recommendedFor: z.string().max(200).nullable().optional(),
          recommendedDefault: z.boolean().nullable().optional(),
          templatePriority: z.number().nullable().optional(),
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

const WORKFLOW_ROUTE_ERROR_MESSAGES = {
  templateNotFound: '目标工作流模板不存在。',
} as const;

interface WorkflowTemplateView {
  id: string;
  name: string;
  description: string | null;
  category: string;
  metadata: Record<string, unknown>;
  nodes: unknown[];
  edges: unknown[];
  createdAt: string;
  updatedAt: string;
}

// Corrupt-row tolerance (§0.89-§0.91 class): `metadata_json` / `nodes_json` /
// `edges_json` are persisted via `JSON.stringify`, but a crash mid-write, a
// disk error, or a hand-edited DB can leave a column that is not valid JSON.
// The list route does `rows.map(...)`, so a SINGLE corrupt template row used
// to throw and 500 the WHOLE `/workflows/templates` list — i.e. every template
// became unreadable. This variant returns `null` + warn so the list path can
// skip the bad row and the rest still loads.
function tryTemplateRowToView(row: TemplateRow): WorkflowTemplateView | null {
  try {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      metadata: JSON.parse(row.metadata_json || '{}') as Record<string, unknown>,
      nodes: JSON.parse(row.nodes_json) as unknown[],
      edges: JSON.parse(row.edges_json) as unknown[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    console.warn(
      `[workflows] 模板 ${row.id} JSON 解析失败，已跳过：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
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
      // Skip any corrupt row instead of failing the whole list: one bad
      // template must not make every template unreadable (§0.89-§0.91 class).
      const templates = rows.flatMap((row) => {
        const view = tryTemplateRowToView(row);
        return view ? [view] : [];
      });
      const skipped = rows.length - templates.length;
      parseStep.succeed(undefined, { templates: templates.length, skipped });
      step.succeed(undefined, { templates: templates.length, skipped });
      return reply.send(templates);
    },
  );

  app.post(
    '/workflows/templates',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workflow.template.create');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(createTemplateSchema, request.body);
      parseStep.succeed();

      const { name, description, category, metadata, nodes, edges } = body;
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
      const body = parseBody(optimizePromptSchema, request.body);

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
        const result = await optimizer.optimize(body);
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
      const body = parseBody(translateSchema, request.body);

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

      const results = await workflow.batchTranslate(body.tasks);
      step.succeed(undefined, { tasks: results.length });
      return reply.send({ results });
    },
  );

  app.post(
    '/workflows/assign-team-models',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'workflow.team.assign-models');
      const body = parseBody(assignTeamModelsSchema, request.body);

      const user = request.user as JwtPayload;
      // 多 provider 容错：候选池里每个 provider 取最强模型作为「分析候选」，
      // 按能力从高到低逐个尝试其凭证调上游；若某 provider 报错（如 Invalid JSON
      // response / 鉴权 / 模型不存在），自动换下一个。全部失败再回退 fast/active。
      const analysisModels = pickAnalysisModels(body.pool);
      const candidateConfigs: ResolvedAuxiliaryLlmConfig[] = [];
      for (const m of analysisModels) {
        const cfg = await resolveAuxiliaryLlmConfig(user.sub, m);
        if (
          cfg &&
          !candidateConfigs.some((c) => c.apiBaseUrl === cfg.apiBaseUrl && c.model === cfg.model)
        ) {
          candidateConfigs.push(cfg);
        }
      }
      // 兜底：池里没解析出任何可用凭证时，退回纯 fast/active 选择。
      if (candidateConfigs.length === 0) {
        const fallbackCfg = await resolveAuxiliaryLlmConfig(user.sub);
        if (fallbackCfg) candidateConfigs.push(fallbackCfg);
      }
      if (candidateConfigs.length === 0) {
        step.fail('no llm config');
        return reply.status(503).send({
          error:
            '智能分配模型未找到可用模型：请在 设置 → 提供商 中启用一个「快速 / 内联」或「会话」模型并填写 API Key，或在网关环境变量中设置 AI_API_BASE_URL 与 AI_API_KEY 后重启网关。',
        });
      }

      try {
        const callers = candidateConfigs.map(
          (cfg) => (prompt: string) =>
            requestWorkflowLlmCompletion({
              apiBaseUrl: cfg.apiBaseUrl,
              apiKey: cfg.apiKey,
              model: cfg.model,
              ...(cfg.providerType ? { providerType: cfg.providerType } : {}),
              ...(cfg.upstreamProtocol ? { upstreamProtocol: cfg.upstreamProtocol } : {}),
              prompt,
              // 低温度让结构化 JSON 输出更稳定。
              temperature: 0.2,
              // 池大 / 层多 + 推理模型会额外产出思考 token，给足输出预算避免 JSON 被截断。
              maxOutputTokens: 4096,
            }),
        );
        const result = await assignTeamModels(
          {
            strategy: body.strategy,
            pool: body.pool,
            layers: body.layers,
          },
          callers,
        );
        step.succeed(undefined, {
          assignments: result.assignments.length,
          source: result.source,
          candidates: candidateConfigs.length,
          ...(result.fallbackReasonCode ? { fallbackReason: result.fallbackReasonCode } : {}),
          ...(result.fallbackMessage ? { fallbackMessage: result.fallbackMessage } : {}),
          ...(result.llmRawSnippet ? { llmRawSnippet: result.llmRawSnippet } : {}),
        });
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        step.fail(message);
        return reply.status(500).send({ error: `智能分配模型失败：${message}` });
      }
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
        return reply.status(404).send({ error: WORKFLOW_ROUTE_ERROR_MESSAGES.templateNotFound });
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
                memberSlots: z.array(teamTemplateMemberSlotSchema).max(40).optional(),
                modelPool: z.array(teamTemplateModelRefSchema).max(60).optional(),
                modelAssignStrategy: z.enum(['quality', 'cost', 'balanced', 'single']).optional(),
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
      const body = parseBody(patchSchema, request.body);
      parseStep.succeed();

      const existingMetadata = JSON.parse(existing.metadata_json || '{}') as Record<
        string,
        unknown
      >;
      const mergedMetadata = body.metadata
        ? { ...existingMetadata, ...body.metadata }
        : existingMetadata;

      if (body.metadata?.teamTemplate && existing.category === 'team-playbook') {
        const existingTeamTemplate = (
          existingMetadata as { teamTemplate?: Record<string, unknown> }
        )?.teamTemplate;
        mergedMetadata.teamTemplate = {
          ...(existingTeamTemplate ?? {}),
          ...body.metadata.teamTemplate,
          ...(body.metadata.teamTemplate.defaultBindings
            ? {
                defaultBindings: {
                  ...((existingTeamTemplate as { defaultBindings?: Record<string, unknown> })
                    ?.defaultBindings ?? {}),
                  ...body.metadata.teamTemplate.defaultBindings,
                },
              }
            : {}),
        };
      }

      const newName = body.name ?? existing.name;
      const newDescription =
        body.description !== undefined ? body.description : existing.description;
      const newNodes = body.nodes ?? (JSON.parse(existing.nodes_json) as unknown[]);
      const newEdges = body.edges ?? (JSON.parse(existing.edges_json) as unknown[]);

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
        return reply.status(404).send({ error: WORKFLOW_ROUTE_ERROR_MESSAGES.templateNotFound });
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
