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

function seedSession(sessionId: string, userId = USER_ID): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'artifact session', '{}', 'idle')`,
    [sessionId, userId],
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

  it('DELETE /artifacts/:artifactId 会删除当前用户产物并刷新列表为空', async () => {
    const artifact = createArtifact(USER_ID, {
      sessionId: SESSION_ID,
      title: 'demo artifact',
      content: 'hello world',
      type: 'markdown',
    });

    const app = await buildApp();
    try {
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/artifacts/${artifact.id}`,
        headers: { authorization: bearer(app) },
      });
      expect(deleteResponse.statusCode).toBe(204);

      const listResponse = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/artifacts`,
        headers: { authorization: bearer(app) },
      });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json()).toMatchObject({ contentArtifacts: [] });

      const versionCount = dbModule.sqliteGet<{ count: number }>(
        'SELECT COUNT(*) AS count FROM artifact_versions WHERE artifact_id = ?',
        [artifact.id],
      );
      expect(versionCount?.count).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('DELETE /artifacts/:artifactId 不允许删除其它用户产物', async () => {
    const otherUserId = 'u-artifacts-routes-other';
    const otherSessionId = 'sess-artifacts-routes-other';
    seedUser(otherUserId);
    seedSession(otherSessionId, otherUserId);
    const artifact = createArtifact(otherUserId, {
      sessionId: otherSessionId,
      title: 'other artifact',
      content: 'secret',
      type: 'markdown',
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/artifacts/${artifact.id}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: '目标产物不存在。' });
      const stillExists = dbModule.sqliteGet<{ id: string }>(
        'SELECT id FROM artifacts WHERE id = ? AND user_id = ?',
        [artifact.id, otherUserId],
      );
      expect(stillExists?.id).toBe(artifact.id);
    } finally {
      await app.close();
    }
  });
});

/**
 * 磁盘型附件（`POST /sessions/:id/artifacts` 写入的那套）的读取 / 删除面。
 *
 * 这是「待发队列附件跨端」依赖的两条路由：另一台设备凭 artifactId 拉回二进制、
 * 孤儿副本凭同一 id 回收。
 */
describe('磁盘型附件的上传 / 下载 / 删除', () => {
  async function uploadArtifact(
    app: FastifyInstance,
    name: string,
    bytes: number[],
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/artifacts`,
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: {
        contentBase64: Buffer.from(bytes).toString('base64'),
        mimeType: 'image/png',
        name,
        sizeBytes: bytes.length,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ artifact: { id: string } }>().artifact.id;
  }

  it('上传后可下载原始字节，删除后下载 404', async () => {
    const app = await buildApp();
    try {
      const artifactId = await uploadArtifact(app, '跨端截图.png', [1, 2, 3]);

      const download = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/artifacts/${artifactId}/content`,
        headers: { authorization: bearer(app) },
      });
      expect(download.statusCode).toBe(200);
      expect(String(download.headers['content-type'])).toContain('image/png');
      expect(download.rawPayload.equals(Buffer.from([1, 2, 3]))).toBe(true);
      // 中文文件名经 RFC 5987 编码，不产生非法 header。
      expect(String(download.headers['content-disposition'])).toContain(
        `filename*=UTF-8''${encodeURIComponent('跨端截图.png')}`,
      );

      const remove = await app.inject({
        method: 'DELETE',
        url: `/sessions/${SESSION_ID}/artifacts/${artifactId}`,
        headers: { authorization: bearer(app) },
      });
      expect(remove.statusCode).toBe(200);
      expect(remove.json<{ removed: boolean }>().removed).toBe(true);

      const afterRemove = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/artifacts/${artifactId}/content`,
        headers: { authorization: bearer(app) },
      });
      expect(afterRemove.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('跨会话读取同一 artifactId 一律 404（产物存在也不能绕过归属）', async () => {
    const otherSessionId = 'sess-artifacts-routes-scope';
    seedSession(otherSessionId);
    const app = await buildApp();
    try {
      const artifactId = await uploadArtifact(app, 'private.png', [7]);
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${otherSessionId}/artifacts/${artifactId}/content`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: '目标产物不存在。' });
    } finally {
      await app.close();
    }
  });

  it('下载 / 删除不存在的产物返回中文 404', async () => {
    const app = await buildApp();
    try {
      const download = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/artifacts/missing-artifact/content`,
        headers: { authorization: bearer(app) },
      });
      expect(download.statusCode).toBe(404);
      expect(download.json()).toMatchObject({ error: '目标产物不存在。' });

      const remove = await app.inject({
        method: 'DELETE',
        url: `/sessions/${SESSION_ID}/artifacts/missing-artifact`,
        headers: { authorization: bearer(app) },
      });
      expect(remove.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
