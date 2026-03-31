import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let app: FastifyInstance | null = null;
let closeDb: (() => Promise<void>) | null = null;
let sqliteGet:
  | (<T>(
      query: string,
      params?: Array<string | number | bigint | Uint8Array | null>,
    ) => T | undefined)
  | null = null;
let workspaceRoot = '';
let skillDirPath = '';

async function loginAndGetToken(): Promise<string> {
  const loginRes = await app!.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'admin@openAwork.local', password: 'admin123456' },
  });
  const body = JSON.parse(loginRes.body) as { accessToken: string };
  return body.accessToken;
}

describe.skipIf(process.version.startsWith('v22.') || process.version.startsWith('v24.'))(
  'local skills routes',
  () => {
    beforeEach(async () => {
      vi.resetModules();
      workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-local-skills-'));
      skillDirPath = join(workspaceRoot, 'skills', 'local-skill');
      await mkdir(skillDirPath, { recursive: true });
      await writeFile(
        join(skillDirPath, 'skill.yaml'),
        `apiVersion: 'agent-skill/v1'\nid: 'com.example.local-skill'\nname: 'local-skill'\ndisplayName: 'Local Skill'\nversion: '1.0.0'\ndescription: '本地工作区技能'\ndescriptionForModel: '当用户需要本地技能时使用。'\ncapabilities:\n  - local-workspace\npermissions: []\n`,
        'utf8',
      );

      process.env['DATABASE_URL'] = ':memory:';
      process.env['WORKSPACE_ROOT'] = workspaceRoot;
      process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';

      const [{ default: Fastify }, { default: authPlugin }, { localSkillsRoutes }, dbModule] =
        await Promise.all([
          import('fastify'),
          import('../auth.js'),
          import('../routes/local-skills.js'),
          import('../db.js'),
        ]);

      closeDb = dbModule.closeDb;
      sqliteGet = dbModule.sqliteGet;
      await dbModule.connectDb();
      await dbModule.migrate();

      dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        randomUUID(),
        'admin@openAwork.local',
        createHash('sha256').update('admin123456').digest('hex'),
      ]);

      app = Fastify();
      await app.register(authPlugin);
      await app.register(localSkillsRoutes);
      await app.ready();
    });

    afterEach(async () => {
      if (app) {
        await app.close();
        app = null;
      }
      if (closeDb) {
        await closeDb();
        closeDb = null;
      }
      sqliteGet = null;
      delete process.env['DATABASE_URL'];
      delete process.env['WORKSPACE_ROOT'];
      delete process.env['WORKSPACE_ACCESS_MODE'];
      if (workspaceRoot) {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    });

    it('discovers workspace local skills and installs them into installed_skills', async () => {
      const accessToken = await loginAndGetToken();

      const discoverRes = await app!.inject({
        method: 'GET',
        url: '/skills/local/discover',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(discoverRes.statusCode).toBe(200);

      const discoverBody = JSON.parse(discoverRes.body) as {
        skills: Array<{ id: string; workspaceRelativePath: string; installed: boolean }>;
      };
      expect(discoverBody.skills).toHaveLength(1);
      expect(discoverBody.skills[0]).toMatchObject({
        id: 'com.example.local-skill',
        workspaceRelativePath: 'skills/local-skill',
        installed: false,
      });

      const installRes = await app!.inject({
        method: 'POST',
        url: '/skills/local/install',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { dirPath: skillDirPath },
      });
      expect(installRes.statusCode).toBe(201);

      const installBody = JSON.parse(installRes.body) as {
        skillId: string;
        sourceId: string;
        manifest: { displayName: string; descriptionForModel?: string };
      };
      expect(installBody.skillId).toBe('com.example.local-skill');
      expect(installBody.sourceId).toBe('local-workspace');
      expect(installBody.manifest.displayName).toBe('Local Skill');
      expect(installBody.manifest.descriptionForModel).toContain('本地技能');

      const installedRow = sqliteGet?.<{ source_id: string }>(
        'SELECT source_id FROM installed_skills WHERE skill_id = ?',
        ['com.example.local-skill'],
      );
      expect(installedRow?.source_id).toBe('local-workspace');

      const rediscoverRes = await app!.inject({
        method: 'GET',
        url: '/skills/local/discover',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const rediscoverBody = JSON.parse(rediscoverRes.body) as {
        skills: Array<{ id: string; installed: boolean }>;
      };
      expect(rediscoverBody.skills[0]).toMatchObject({
        id: 'com.example.local-skill',
        installed: true,
      });
    });

    it('rejects installing local skills outside the configured workspace roots', async () => {
      const outsideRoot = await mkdtemp(join(tmpdir(), 'openawork-local-skills-outside-'));
      const outsideSkillDir = join(outsideRoot, 'external-skill');
      await mkdir(outsideSkillDir, { recursive: true });
      await writeFile(
        join(outsideSkillDir, 'skill.yaml'),
        `apiVersion: 'agent-skill/v1'\nid: 'com.example.external-skill'\nname: 'external-skill'\ndisplayName: 'External Skill'\nversion: '1.0.0'\ndescription: '外部技能'\ncapabilities: []\npermissions: []\n`,
        'utf8',
      );

      try {
        const accessToken = await loginAndGetToken();
        const res = await app!.inject({
          method: 'POST',
          url: '/skills/local/install',
          headers: { authorization: `Bearer ${accessToken}` },
          payload: { dirPath: outsideSkillDir },
        });
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('workspace roots');
      } finally {
        await rm(outsideRoot, { recursive: true, force: true });
      }
    });
  },
);
