import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as ArtifactsRoutesModule from '../../routes/artifacts.js';
import { createArtifact } from '../../session/artifact-content-store.js';

const dataDir = mkdtempSync(join(tmpdir(), 'openawork-artifacts-routes-'));

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'artifacts-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['OPENAWORK_DATA_DIR'] = dataDir;

let artifactsRoutes: typeof ArtifactsRoutesModule.artifactsRoutes;
let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;

const SESSION_ID = 'sess-artifacts-routes';
const USER_ID = 'u-artifacts-routes';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(artifactsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'artifacts@example.com' })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(sessionId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'artifact session', '{}', 'idle')`,
    [sessionId, USER_ID],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  artifactsRoutes = (await import('../../routes/artifacts.js')).artifactsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM artifact_versions', []);
  dbModule.sqliteRun('DELETE FROM artifacts', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedSession(SESSION_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('artifacts routes error contracts', () => {
  it('GET /artifacts/:artifactId 对不存在产物返回中文 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/artifacts/missing-artifact',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: '目标产物不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /artifacts/:artifactId/revert 对不存在产物返回中文 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/artifacts/missing-artifact/revert',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          versionId: 'ver-missing',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: '目标产物或版本不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /artifacts/:artifactId/revert 对不存在版本返回中文 404', async () => {
    const artifact = createArtifact(USER_ID, {
      sessionId: SESSION_ID,
      title: 'demo artifact',
      content: 'hello world',
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/artifacts/${artifact.id}/revert`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          versionId: 'ver-missing',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: '目标产物或版本不存在。',
      });
    } finally {
      await app.close();
    }
  });
});
