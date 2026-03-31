import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteRun } from '../db.js';
import { discoverLocalSkills, installLocalSkillFromDir } from '../local-skills.js';
import { startRequestWorkflow } from '../request-workflow.js';

interface InstalledSkillIdRow {
  skill_id: string;
}

interface LocalInstallBody {
  dirPath?: string;
}

export function extractLocalInstallDirPath(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const maybeDirPath = (body as LocalInstallBody).dirPath;
  if (typeof maybeDirPath !== 'string') {
    return null;
  }

  const dirPath = maybeDirPath.trim();
  return dirPath.length > 0 ? dirPath : null;
}

function toInstalledSkillResponse(record: {
  skillId: string;
  sourceId: string;
  manifest: unknown;
  grantedPermissions: unknown[];
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
}) {
  return record;
}

export async function localSkillsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/skills/local/discover',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.local.discover');
      const user = request.user as JwtPayload;
      const installedRows = sqliteAll<InstalledSkillIdRow>(
        'SELECT skill_id FROM installed_skills WHERE user_id = ? AND enabled = 1',
        [user.sub],
      );

      try {
        const skills = await discoverLocalSkills(new Set(installedRows.map((row) => row.skill_id)));
        step.succeed(undefined, { count: skills.length });
        return reply.send({ skills });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        step.fail(message);
        return reply.status(500).send({ error: message });
      }
    },
  );

  app.post(
    '/skills/local/install',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.local.install');
      const user = request.user as JwtPayload;
      const dirPath = extractLocalInstallDirPath(request.body);

      if (!dirPath) {
        step.fail('missing dirPath');
        return reply.status(400).send({ error: 'dirPath is required' });
      }

      try {
        const record = await installLocalSkillFromDir(dirPath);
        const now = Date.now();
        sqliteRun(
          `INSERT INTO installed_skills (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(skill_id, user_id) DO UPDATE SET
             source_id = excluded.source_id,
             manifest_json = excluded.manifest_json,
             granted_permissions_json = excluded.granted_permissions_json,
             enabled = excluded.enabled,
             updated_at = excluded.updated_at`,
          [
            record.skillId,
            user.sub,
            record.sourceId,
            JSON.stringify(record.manifest),
            JSON.stringify(record.grantedPermissions),
            now,
            now,
          ],
        );
        step.succeed(undefined, { skillId: record.skillId });
        return reply.status(201).send(
          toInstalledSkillResponse({
            skillId: record.skillId,
            sourceId: record.sourceId,
            manifest: record.manifest,
            grantedPermissions: record.grantedPermissions,
            enabled: true,
            installedAt: now,
            updatedAt: now,
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        step.fail(message);
        const statusCode =
          message.includes('required') ||
          message.includes('not found') ||
          message.includes('workspace roots')
            ? 400
            : 422;
        return reply.status(statusCode).send({ error: message });
      }
    },
  );
}
