import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import {
  createAgentProfileForUser,
  getAgentProfileForWorkspace,
  listAgentProfilesForUser,
  removeAgentProfileForUser,
  updateAgentProfileForUser,
} from '../agent-profile-store.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { TOOL_SURFACE_PROFILES } from '../session-workspace-metadata.js';

const profileBodySchema = z.object({
  agentId: z.string().trim().min(1).max(120).optional(),
  label: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(400).optional(),
  providerId: z.string().trim().min(1).max(200).optional(),
  toolSurfaceProfile: z.enum(TOOL_SURFACE_PROFILES).optional(),
  workspacePath: z.string().trim().min(1),
});

const updateProfileBodySchema = profileBodySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const profileParamsSchema = z.object({ profileId: z.string().trim().min(1).max(120) });

const profileWorkspaceQuerySchema = z.object({
  workspacePath: z.string().trim().min(1),
});

export async function agentProfilesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/agent-profiles', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agent-profiles.list');
    const user = request.user as JwtPayload;
    const profiles = listAgentProfilesForUser(user.sub);
    step.succeed(undefined, { count: profiles.length });
    return reply.send({ profiles });
  });

  app.get('/agent-profiles/current', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agent-profiles.current');
    const user = request.user as JwtPayload;
    const query = profileWorkspaceQuerySchema.safeParse(
      (request as FastifyRequest & { query: unknown }).query,
    );
    if (!query.success) {
      step.fail('invalid query params');
      return reply.status(400).send({ error: 'Invalid query params', issues: query.error.issues });
    }

    const profile = getAgentProfileForWorkspace(user.sub, query.data.workspacePath);
    step.succeed(undefined, { found: Boolean(profile) });
    return reply.send({ profile });
  });

  app.post('/agent-profiles', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agent-profiles.create');
    const user = request.user as JwtPayload;
    const parsed = profileBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      step.fail('invalid create payload');
      return reply
        .status(400)
        .send({ error: 'Invalid create payload', issues: parsed.error.issues });
    }

    try {
      const profile = createAgentProfileForUser(user.sub, parsed.data);
      step.succeed(undefined, { profileId: profile.id });
      return reply.status(201).send({ profile });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create failed';
      step.fail(message);
      const statusCode = message.includes('UNIQUE') || message.includes('workspace') ? 409 : 400;
      return reply.status(statusCode).send({ error: message });
    }
  });

  app.put('/agent-profiles/:profileId', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agent-profiles.update');
    const user = request.user as JwtPayload;
    const params = profileParamsSchema.safeParse(request.params ?? {});
    const parsed = updateProfileBodySchema.safeParse(request.body ?? {});
    if (!params.success) {
      step.fail('invalid profile id');
      return reply.status(400).send({ error: 'Invalid profile id', issues: params.error.issues });
    }
    if (!parsed.success) {
      step.fail('invalid update payload');
      return reply
        .status(400)
        .send({ error: 'Invalid update payload', issues: parsed.error.issues });
    }

    try {
      const profile = updateAgentProfileForUser(user.sub, params.data.profileId, parsed.data);
      step.succeed(undefined, { profileId: profile.id });
      return reply.send({ profile });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      step.fail(message);
      const statusCode = message.includes('not found') ? 404 : 400;
      return reply.status(statusCode).send({ error: message });
    }
  });

  app.delete('/agent-profiles/:profileId', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'agent-profiles.delete');
    const user = request.user as JwtPayload;
    const params = profileParamsSchema.safeParse(request.params ?? {});
    if (!params.success) {
      step.fail('invalid profile id');
      return reply.status(400).send({ error: 'Invalid profile id', issues: params.error.issues });
    }

    removeAgentProfileForUser(user.sub, params.data.profileId);
    step.succeed(undefined, { profileId: params.data.profileId });
    return reply.status(204).send();
  });
}
