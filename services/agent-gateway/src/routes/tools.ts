import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '../auth.js';
import { sqliteGet } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { buildGatewayToolDefinitions } from '../tool-definitions.js';
import { filterEnabledGatewayToolsForSession } from '../session-tool-visibility.js';
import {
  getEffectiveSkillsForSession,
  getEffectiveSkillsForUser,
} from '../skill-selection-context.js';

interface SessionMetadataRow {
  metadata_json: string;
}

export async function toolsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/tools/definitions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'tools.definitions.list');
      const user = request.user as { sub: string };
      const query = (request.query ?? {}) as { sessionId?: string };
      const sessionMetadataRow = query.sessionId
        ? sqliteGet<SessionMetadataRow>(
            'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
            [query.sessionId, user.sub],
          )
        : undefined;
      const effectiveSkills = query.sessionId
        ? (getEffectiveSkillsForSession(query.sessionId) ?? undefined)
        : getEffectiveSkillsForUser({ userId: user.sub, workspacePath: null });
      const definitions = buildGatewayToolDefinitions({ effectiveSkills });
      const visibleTools = sessionMetadataRow?.metadata_json
        ? filterEnabledGatewayToolsForSession(definitions, sessionMetadataRow.metadata_json)
        : definitions;
      const tools = visibleTools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
      }));
      step.succeed(undefined, { count: tools.length });
      return reply.send({ tools });
    },
  );
}
