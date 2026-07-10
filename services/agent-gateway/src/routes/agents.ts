import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseParams } from '../infra/parse-request.js';
import {
  createManagedAgentForUser,
  listManagedAgentsForUser,
  removeManagedAgentForUser,
  resetAllManagedAgentsForUser,
  resetManagedAgentForUser,
  updateManagedAgentForUser,
} from '../agent/agent-catalog.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';

const AGENT_ROUTE_ERROR_MESSAGES = {
  agentExists: '目标 Agent 已存在。',
  agentNotFound: '目标 Agent 不存在。',
  builtinDeleteForbidden: '内置 Agent 不允许删除。',
  builtinUpdateRestricted: '内置 Agent 仅允许修改模型配置。',
  updatePayloadRequired: '至少需要提供一个可更新字段。',
} as const;

function mapAgentCatalogError(error: unknown): { error: string; statusCode: number } {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('already exists')) {
    return { statusCode: 409, error: AGENT_ROUTE_ERROR_MESSAGES.agentExists };
  }
  if (message.includes('cannot be removed')) {
    return { statusCode: 409, error: AGENT_ROUTE_ERROR_MESSAGES.builtinDeleteForbidden };
  }
  if (message.includes('only allow model configuration updates')) {
    return { statusCode: 400, error: AGENT_ROUTE_ERROR_MESSAGES.builtinUpdateRestricted };
  }
  if (message.includes('not found')) {
    return { statusCode: 404, error: AGENT_ROUTE_ERROR_MESSAGES.agentNotFound };
  }

  return {
    statusCode: 400,
    error: message.trim().length > 0 ? message : '请求参数无效。',
  };
}

const canonicalRoleSchema = z
  .object({
    coreRole: z.enum(['general', 'researcher', 'planner', 'executor', 'reviewer']),
    preset: z
      .enum([
        'default',
        'explore',
        'analyst',
        'librarian',
        'architect',
        'debugger',
        'critic',
        'code-review',
        'test',
        'verifier',
      ])
      .optional(),
    overlays: z.array(z.enum(['writer', 'multimodal'])).optional(),
    confidence: z.enum(['low', 'medium', 'high']).optional(),
  })
  .optional();

const createManagedAgentSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).optional().default(''),
  aliases: z.array(z.string().trim().min(1).max(80)).optional().default([]),
  canonicalRole: canonicalRoleSchema,
  model: z.string().trim().min(1).max(200).optional(),
  variant: z.string().trim().min(1).max(80).optional(),
  fallbackModels: z.array(z.string().trim().min(1).max(200)).optional(),
  systemPrompt: z.string().trim().min(1).max(4000),
  note: z.string().trim().max(400).optional(),
  enabled: z.boolean().optional().default(true),
});

const updateManagedAgentSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(400).optional(),
    aliases: z.array(z.string().trim().min(1).max(80)).optional(),
    canonicalRole: canonicalRoleSchema,
    model: z.string().trim().min(1).max(200).optional(),
    variant: z.string().trim().min(1).max(80).optional(),
    fallbackModels: z.array(z.string().trim().min(1).max(200)).optional(),
    systemPrompt: z.string().trim().max(4000).optional(),
    note: z.string().trim().max(400).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: AGENT_ROUTE_ERROR_MESSAGES.updatePayloadRequired,
  });

const paramsSchema = z.object({ agentId: z.string().trim().min(1).max(120) });

export async function agentsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/agents', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agents.list');
    const user = request.user as JwtPayload;
    const agents = listManagedAgentsForUser(user.sub);
    step.succeed(undefined, { count: agents.length });
    return reply.send({ agents });
  });

  app.post('/agents', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agents.create');
    const user = request.user as JwtPayload;
    const parsed = parseBody(createManagedAgentSchema, request.body ?? {});

    try {
      const agent = createManagedAgentForUser(user.sub, parsed);
      step.succeed(undefined, { agentId: agent.id });
      return reply.status(201).send({ agent });
    } catch (error) {
      const mapped = mapAgentCatalogError(error);
      step.fail(error instanceof Error ? error.message : 'create failed');
      return reply.status(mapped.statusCode).send({ error: mapped.error });
    }
  });

  app.put('/agents/:agentId', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agents.update');
    const user = request.user as JwtPayload;
    const params = parseParams(paramsSchema, request.params ?? {});
    const parsed = parseBody(updateManagedAgentSchema, request.body ?? {});

    try {
      const agent = updateManagedAgentForUser(user.sub, params.agentId, parsed);
      step.succeed(undefined, { agentId: agent.id });
      return reply.send({ agent });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'update failed';
      const mapped = mapAgentCatalogError(error);
      step.fail(message);
      return reply.status(mapped.statusCode).send({ error: mapped.error });
    }
  });

  app.delete('/agents/:agentId', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agents.delete');
    const user = request.user as JwtPayload;
    const params = parseParams(paramsSchema, request.params ?? {});

    try {
      removeManagedAgentForUser(user.sub, params.agentId);
      step.succeed(undefined, { agentId: params.agentId });
      return reply.status(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'delete failed';
      const mapped = mapAgentCatalogError(error);
      step.fail(message);
      return reply.status(mapped.statusCode).send({ error: mapped.error });
    }
  });

  app.post('/agents/:agentId/reset', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agents.reset-one');
    const user = request.user as JwtPayload;
    const params = parseParams(paramsSchema, request.params ?? {});

    try {
      const agent = resetManagedAgentForUser(user.sub, params.agentId);
      step.succeed(undefined, { agentId: agent.id });
      return reply.send({ agent });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'reset failed';
      const mapped = mapAgentCatalogError(error);
      step.fail(message);
      return reply.status(mapped.statusCode).send({ error: mapped.error });
    }
  });

  app.post(
    '/agents/reset-all',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'agents.reset-all');
      const user = request.user as JwtPayload;
      const agents = resetAllManagedAgentsForUser(user.sub);
      step.succeed(undefined, { count: agents.length });
      return reply.send({ agents });
    },
  );
}
