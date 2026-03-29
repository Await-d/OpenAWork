import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import authPlugin from '../auth.js';
import { closeDb, connectDb, migrate, sqliteRun } from '../db.js';
import requestWorkflowPlugin from '../request-workflow.js';
import { permissionsRoutes } from '../routes/permissions.js';
import { assert, withTempEnv } from './task-verification-helpers.js';

async function main(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
    },
    async () => {
      await connectDb();
      await migrate();

      const userId = randomUUID();
      const sessionId = randomUUID();
      const email = `permissions-${userId}@openawork.local`;

      sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        userId,
        email,
        'hash',
      ]);
      sqliteRun(
        `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', '{}')`,
        [sessionId, userId],
      );

      const app = Fastify();
      await app.register(requestWorkflowPlugin);
      await app.register(authPlugin);
      await app.register(permissionsRoutes);
      await app.ready();

      try {
        const accessToken = app.jwt.sign({ sub: userId, email });

        const createRes = await app.inject({
          method: 'POST',
          url: `/sessions/${sessionId}/permissions/requests`,
          headers: { authorization: `Bearer ${accessToken}` },
          payload: {
            toolName: 'file_write',
            scope: '/tmp/demo.txt',
            reason: '需要写入测试文件',
            riskLevel: 'medium',
            previewAction: 'write demo',
          },
        });

        assert(createRes.statusCode === 201, 'permission create route should succeed');
        const created = JSON.parse(createRes.body) as {
          request: { requestId: string; toolName: string; sessionId: string };
        };
        assert(
          created.request.toolName === 'file_write',
          'created permission should keep tool name',
        );
        assert(
          created.request.sessionId === sessionId,
          'created permission should keep session id',
        );

        const listRes = await app.inject({
          method: 'GET',
          url: `/sessions/${sessionId}/permissions/pending`,
          headers: { authorization: `Bearer ${accessToken}` },
        });
        assert(listRes.statusCode === 200, 'permission pending list should succeed');
        const listed = JSON.parse(listRes.body) as {
          requests: Array<{ requestId: string; toolName: string; status: string }>;
        };
        assert(listed.requests.length === 1, 'pending list should contain created permission');
        assert(
          listed.requests[0]?.requestId === created.request.requestId,
          'pending list should expose created request id',
        );
        assert(
          listed.requests[0]?.toolName === 'file_write',
          'pending list should expose created tool name',
        );

        const replyRes = await app.inject({
          method: 'POST',
          url: `/sessions/${sessionId}/permissions/reply`,
          headers: { authorization: `Bearer ${accessToken}` },
          payload: { requestId: created.request.requestId, decision: 'session' },
        });
        assert(replyRes.statusCode === 200, 'permission reply route should succeed');

        const afterReplyRes = await app.inject({
          method: 'GET',
          url: `/sessions/${sessionId}/permissions/pending`,
          headers: { authorization: `Bearer ${accessToken}` },
        });
        assert(afterReplyRes.statusCode === 200, 'pending list after reply should succeed');
        const afterReply = JSON.parse(afterReplyRes.body) as { requests: unknown[] };
        assert(afterReply.requests.length === 0, 'pending list should be empty after reply');

        console.log('verify-permissions-routes: ok');
      } finally {
        await app.close();
        await closeDb();
      }
    },
  );
}

void main().catch((error) => {
  console.error('verify-permissions-routes: failed');
  console.error(error);
  process.exitCode = 1;
});
