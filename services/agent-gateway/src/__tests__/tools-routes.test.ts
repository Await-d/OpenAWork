import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let app: FastifyInstance | null = null;
let closeDb: (() => Promise<void>) | null = null;

describe.skipIf(process.version.startsWith('v22.') || process.version.startsWith('v24.'))(
  'tools routes',
  () => {
    beforeEach(async () => {
      vi.resetModules();
      process.env['DATABASE_URL'] = ':memory:';

      const [{ default: Fastify }, { default: authPlugin }, { toolsRoutes }, dbModule] =
        await Promise.all([
          import('fastify'),
          import('../auth.js'),
          import('../routes/tools.js'),
          import('../db.js'),
        ]);

      closeDb = dbModule.closeDb;
      await dbModule.connectDb();
      await dbModule.migrate();

      const userId = randomUUID();
      dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        userId,
        'admin@openAwork.local',
        createHash('sha256').update('admin123456').digest('hex'),
      ]);

      app = Fastify();
      await app.register(authPlugin);
      await app.register(toolsRoutes);
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
      delete process.env['DATABASE_URL'];
    });

    it('returns fusion-native canonical tool names by default', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const res = await app!.inject({
        method: 'GET',
        url: '/tools/definitions',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { tools: Array<{ name: string }> };
      expect(body.tools.some((tool) => tool.name === 'skill')).toBe(true);
      expect(body.tools.some((tool) => tool.name === 'question')).toBe(true);
      expect(body.tools.some((tool) => tool.name === 'call_omo_agent')).toBe(true);
      expect(body.tools.some((tool) => tool.name === 'Skill')).toBe(false);
      expect(body.tools.some((tool) => tool.name === 'AskUserQuestion')).toBe(false);
      expect(body.tools.some((tool) => tool.name === 'Agent')).toBe(false);
    });

    it('returns claude-profile presented tool names for a session-scoped request', async () => {
      const [{ sqliteGet, sqliteRun }] = await Promise.all([import('../db.js')]);
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };
      const userRow = sqliteGet<{ id: string }>('SELECT id FROM users WHERE email = ? LIMIT 1', [
        'admin@openAwork.local',
      ]);
      const userId = userRow?.id;
      expect(userId).toBeTruthy();
      if (!userId) {
        throw new Error('Expected seeded admin user to exist');
      }
      const sessionId = randomUUID();
      sqliteRun(
        `INSERT INTO sessions (id, user_id, messages_json, metadata_json)
         VALUES (?, ?, '[]', ?)`,
      );

      const res = await app!.inject({
        method: 'GET',
        url: `/tools/definitions?sessionId=${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { tools: Array<{ name: string }> };
      expect(body.tools.some((tool) => tool.name === 'Skill')).toBe(true);
      expect(body.tools.some((tool) => tool.name === 'AskUserQuestion')).toBe(true);
      expect(body.tools.some((tool) => tool.name === 'Agent')).toBe(true);
      expect(body.tools.some((tool) => tool.name === 'skill')).toBe(false);
      expect(body.tools.some((tool) => tool.name === 'question')).toBe(false);
      expect(body.tools.some((tool) => tool.name === 'call_omo_agent')).toBe(false);
    });
  },
);
