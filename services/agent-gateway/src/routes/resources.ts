import type { FastifyInstance } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseParams } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  createUserResource,
  createUserResourceSchema,
  deleteUserResource,
  mergeUserResources,
  resourceParamsSchema,
} from './resources-user-resources.js';

export async function resourcesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/resources', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'resources.list');
    const user = request.user as JwtPayload;
    const catalog = mergeUserResources(user.sub);
    step.succeed(undefined, {
      skills: catalog.skills.length,
      agents: catalog.agents.length,
      agentTemplates: catalog.agentTemplates.length,
      commands: catalog.commands.length,
      souls: catalog.souls.length,
      prompts: catalog.prompts.length,
      extensions: catalog.extensions.length,
      mcps: catalog.mcps.length,
    });
    return reply.send({ resources: catalog });
  });

  app.post('/resources/uploads', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'resources.upload');
    const user = request.user as JwtPayload;
    const input = parseBody(createUserResourceSchema, request.body ?? {});

    createUserResource(user.sub, input);
    const catalog = mergeUserResources(user.sub);
    step.succeed(undefined, { area: input.area, name: input.name });
    return reply.status(201).send({ resources: catalog });
  });

  app.delete(
    '/resources/uploads/:resourceId',
    { onRequest: [requireAuth] },
    async (request, reply) => {
      const { step } = startRequestWorkflow(request, 'resources.delete-upload');
      const user = request.user as JwtPayload;
      const params = parseParams(resourceParamsSchema, request.params ?? {});
      const deleted = deleteUserResource(user.sub, params.resourceId);
      if (!deleted) {
        step.fail('user resource not found');
        return reply.status(404).send({ error: '用户上传资源不存在或无权删除。' });
      }

      const catalog = mergeUserResources(user.sub);
      step.succeed(undefined, { resourceId: params.resourceId });
      return reply.send({ resources: catalog });
    },
  );
}
