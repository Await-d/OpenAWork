import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '../auth.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { buildGatewayToolDefinitions } from '../tool-definitions.js';

export async function toolsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/tools/definitions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'tools.definitions.list');
      const tools = buildGatewayToolDefinitions().map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
      }));
      step.succeed(undefined, { count: tools.length });
      return reply.send({ tools });
    },
  );
}
