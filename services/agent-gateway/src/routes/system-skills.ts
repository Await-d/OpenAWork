/**
 * Routes for system-installed skill management.
 *
 * Most of the heavy lifting happens at gateway boot (see
 * `system-skills.ts:syncSystemSkillsForAllUsers`), but the UI also needs
 * an on-demand "re-scan now" trigger — e.g. after the user edited a
 * SKILL.md outside the app, dropped a new one into `~/.claude/skills`,
 * or just clicked the per-row "Update" button on a system-installed
 * skill from the Installed tab.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { syncSystemSkillsForUser } from '../system-skills.js';

export async function systemSkillsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/skills/system/resync',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.system.resync');
      const user = request.user as JwtPayload;
      try {
        const summary = await syncSystemSkillsForUser(user.sub);
        step.succeed(undefined, {
          added: summary.added,
          updated: summary.updated,
          removed: summary.removed,
          total: summary.total,
        });
        return reply.send(summary);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        step.fail(message);
        return reply.status(500).send({ error: message });
      }
    },
  );
}
