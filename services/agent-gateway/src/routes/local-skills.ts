import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteAll, sqliteRun } from '../infra/db.js';
import { discoverLocalSkills, installLocalSkillFromDir } from '../skill/local-skills.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';

interface InstalledSkillIdRow {
  skill_id: string;
}

interface LocalInstallBody {
  dirPath?: string;
}

const LOCAL_SKILLS_ERROR_MESSAGES = {
  discoverFailed: '发现本地技能失败。',
  installBodyInvalid: '本地技能目录参数无效。',
  installFailed: '安装本地技能失败。',
  manifestMissing: '指定目录下未找到 skill.yaml。',
  pathOutsideWorkspaceRoots: '本地技能目录必须位于已配置的工作区范围内。',
} as const;

const localInstallSchema = z.object({
  dirPath: z.string().trim().min(1),
});

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
        return reply.status(500).send({ error: LOCAL_SKILLS_ERROR_MESSAGES.discoverFailed });
      }
    },
  );

  app.post(
    '/skills/local/install',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.local.install');
      const user = request.user as JwtPayload;
      const bodyResult = localInstallSchema.safeParse(request.body);
      if (!bodyResult.success) {
        step.fail('invalid install body');
        return reply.status(400).send({
          error: LOCAL_SKILLS_ERROR_MESSAGES.installBodyInvalid,
          issues: bodyResult.error.issues,
        });
      }
      const dirPath = bodyResult.data.dirPath;

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
        const rawMessage = error instanceof Error ? error.message : String(error);
        step.fail(rawMessage);
        if (rawMessage.includes('configured workspace roots')) {
          return reply
            .status(400)
            .send({ error: LOCAL_SKILLS_ERROR_MESSAGES.pathOutsideWorkspaceRoots });
        }
        if (rawMessage.includes('skill.yaml not found')) {
          return reply.status(400).send({ error: LOCAL_SKILLS_ERROR_MESSAGES.manifestMissing });
        }
        const message =
          rawMessage.trim().length > 0 ? rawMessage : LOCAL_SKILLS_ERROR_MESSAGES.installFailed;
        return reply.status(422).send({ error: message });
      }
    },
  );
}
