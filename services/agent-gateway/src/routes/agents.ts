import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CreateManagedAgentInput, UpdateManagedAgentInput } from '@openAwork/shared';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import {
  createManagedAgentForUser,
  listManagedAgentsForUser,
  removeManagedAgentForUser,
  resetAllManagedAgentsForUser,
  resetManagedAgentForUser,
  updateManagedAgentForUser,
} from '../agent-catalog.js';
import { startRequestWorkflow } from '../request-workflow.js';

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
  systemPrompt: z.string().trim().max(4000).optional(),
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
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

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
    const parsed = createManagedAgentSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      step.fail('invalid create payload');
      return reply
        .status(400)
        .send({ error: 'Invalid create payload', issues: parsed.error.issues });
    }

    try {
      const agent = createManagedAgentForUser(user.sub, parsed.data as CreateManagedAgentInput);
      step.succeed(undefined, { agentId: agent.id });
      return reply.status(201).send({ agent });
    } catch (error) {
      step.fail(error instanceof Error ? error.message : 'create failed');
      return reply
        .status(409)
        .send({ error: error instanceof Error ? error.message : 'Create failed' });
    }
  });

  app.put('/agents/:agentId', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agents.update');
    const user = request.user as JwtPayload;
    const params = paramsSchema.safeParse(request.params ?? {});
    if (!params.success) {
      step.fail('invalid agentId');
      return reply.status(400).send({ error: 'Invalid agentId', issues: params.error.issues });
    }
    const parsed = updateManagedAgentSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      step.fail('invalid update payload');
      return reply
        .status(400)
        .send({ error: 'Invalid update payload', issues: parsed.error.issues });
    }

    try {
      const agent = updateManagedAgentForUser(
        user.sub,
        params.data.agentId,
        parsed.data as UpdateManagedAgentInput,
      );
      step.succeed(undefined, { agentId: agent.id });
      return reply.send({ agent });
    } catch (error) {
      step.fail(error instanceof Error ? error.message : 'update failed');
      return reply
        .status(404)
        .send({ error: error instanceof Error ? error.message : 'Update failed' });
    }
  });

  app.delete('/agents/:agentId', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agents.delete');
    const user = request.user as JwtPayload;
    const params = paramsSchema.safeParse(request.params ?? {});
    if (!params.success) {
      step.fail('invalid agentId');
      return reply.status(400).send({ error: 'Invalid agentId', issues: params.error.issues });
    }

    try {
      removeManagedAgentForUser(user.sub, params.data.agentId);
      step.succeed(undefined, { agentId: params.data.agentId });
      return reply.status(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      step.fail(message);
      const statusCode = message.includes('cannot be removed') ? 409 : 404;
      return reply.status(statusCode).send({ error: message });
    }
  });

  app.post('/agents/:agentId/reset', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agents.reset-one');
    const user = request.user as JwtPayload;
    const params = paramsSchema.safeParse(request.params ?? {});
    if (!params.success) {
      step.fail('invalid agentId');
      return reply.status(400).send({ error: 'Invalid agentId', issues: params.error.issues });
    }

    try {
      const agent = resetManagedAgentForUser(user.sub, params.data.agentId);
      step.succeed(undefined, { agentId: agent.id });
      return reply.send({ agent });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reset failed';
      step.fail(message);
      return reply.status(404).send({ error: message });
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
