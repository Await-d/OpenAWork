import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedDb = vi.hoisted(() => ({
  refreshTokens: [] as Array<{ expiresAt: string; tokenHash: string; userId: string }>,
  userSettings: new Map<string, string>(),
  usersByEmail: new Map<string, { email: string; id: string; password_hash: string }>(),
  usersById: new Map<string, { email: string; id: string; password_hash: string }>(),
}));

vi.mock('../db.js', () => ({
  connectDb: async () => undefined,
  closeDb: async () => undefined,
  migrate: async () => undefined,
  redis: {
    del: () => undefined,
    get: () => null,
    setex: () => undefined,
  },
  sqliteAll: <T>(_query: string) => [] as T[],
  sqliteGet: <T>(query: string, params: unknown[] = []) => {
    if (query.includes('FROM users WHERE email = ?')) {
      return mockedDb.usersByEmail.get(String(params[0])) as T | undefined;
    }
    if (query.includes('FROM users WHERE id = ?')) {
      return mockedDb.usersById.get(String(params[0])) as T | undefined;
    }
    if (query.includes('FROM refresh_tokens WHERE token_hash = ?')) {
      const token = mockedDb.refreshTokens.find((entry) => entry.tokenHash === String(params[0]));
      return token ? ({ user_id: token.userId, expires_at: token.expiresAt } as T) : undefined;
    }
    if (query.includes('FROM installed_skills')) {
      return { value: '[]' } as T;
    }
    if (query.includes('FROM user_settings')) {
      const keyMatch = query.match(/key = '([^']+)'/);
      const key = keyMatch?.[1];
      if (!key) {
        return undefined;
      }
      const userId = String(params[0]);
      const stored = mockedDb.userSettings.get(`${userId}:${key}`);
      return stored === undefined ? undefined : ({ value: stored } as T);
    }
    return undefined;
  },
  sqliteRun: (query: string, params: unknown[] = []) => {
    if (query.includes('INSERT INTO users')) {
      const user = {
        id: String(params[0]),
        email: String(params[1]),
        password_hash: String(params[2]),
      };
      mockedDb.usersByEmail.set(user.email, user);
      mockedDb.usersById.set(user.id, user);
      return;
    }
    if (query.includes('INSERT INTO refresh_tokens')) {
      mockedDb.refreshTokens.push({
        userId: String(params[1]),
        tokenHash: String(params[2]),
        expiresAt: String(params[3]),
      });
      return;
    }
    if (query.includes('DELETE FROM refresh_tokens WHERE token_hash = ?')) {
      const tokenHash = String(params[0]);
      mockedDb.refreshTokens = mockedDb.refreshTokens.filter(
        (entry) => entry.tokenHash !== tokenHash,
      );
      return;
    }
    if (query.includes('DELETE FROM refresh_tokens WHERE user_id = ?')) {
      const userId = String(params[0]);
      mockedDb.refreshTokens = mockedDb.refreshTokens.filter((entry) => entry.userId !== userId);
      return;
    }
    if (query.includes('INSERT INTO user_settings')) {
      const userId = String(params[0]);
      const value = String(params[1]);
      mockedDb.userSettings.set(`${userId}:agent_catalog`, value);
    }
  },
}));

let app: FastifyInstance | null = null;
let closeDb: (() => Promise<void>) | null = null;

describe.skipIf(process.version.startsWith('v22.') || process.version.startsWith('v24.'))(
  'capabilities canonical role integration',
  () => {
    beforeEach(async () => {
      vi.resetModules();
      process.env['DATABASE_URL'] = ':memory:';
      mockedDb.refreshTokens = [];
      mockedDb.userSettings.clear();
      mockedDb.usersByEmail.clear();
      mockedDb.usersById.clear();

      const [{ default: Fastify }, { default: authPlugin }, { capabilitiesRoutes }, dbModule] =
        await Promise.all([
          import('fastify'),
          import('../auth.js'),
          import('../routes/capabilities.js'),
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
      await app.register(capabilitiesRoutes);
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

    it('returns canonical role metadata from the capabilities endpoint', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const res = await app!.inject({
        method: 'GET',
        url: '/capabilities',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body) as {
        capabilities: Array<{
          kind: string;
          label: string;
          canonicalRole?: { confidence?: string; coreRole: string; preset?: string };
        }>;
      };
      const oracle = body.capabilities.find(
        (item) => item.kind === 'agent' && item.label === 'oracle',
      );

      console.log(`CAPABILITY_QA=${JSON.stringify(oracle)}`);

      expect(oracle).toMatchObject({
        canonicalRole: {
          coreRole: 'planner',
          preset: 'architect',
          confidence: 'medium',
        },
      });
    });
  },
);
