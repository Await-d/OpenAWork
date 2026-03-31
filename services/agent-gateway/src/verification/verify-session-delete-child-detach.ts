import { createHash, randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { assert, withTempEnv } from './task-verification-helpers.js';

async function main(): Promise<void> {
  const workspaceRoot = path.join('/tmp', `openawork-session-delete-${randomUUID()}`);

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      WORKSPACE_ROOT: workspaceRoot,
    },
    async () => {
      const [
        { default: Fastify },
        { default: authPlugin },
        { default: requestWorkflowPlugin },
        { sessionsRoutes },
        dbModule,
      ] = await Promise.all([
        import('fastify'),
        import('../auth.js'),
        import('../request-workflow.js'),
        import('../routes/sessions.js'),
        import('../db.js'),
      ]);

      await dbModule.connectDb();
      await dbModule.migrate();

      const admin = dbModule.sqliteGet<{ id: string }>(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        ['admin@openAwork.local'],
      );
      if (!admin) {
        dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          randomUUID(),
          'admin@openAwork.local',
          createHash('sha256').update('admin123456').digest('hex'),
        ]);
      }

      const app = Fastify();
      await app.register(requestWorkflowPlugin);
      await app.register(authPlugin);
      await app.register(sessionsRoutes);
      await app.ready();

      try {
        const loginRes = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'admin@openAwork.local', password: 'admin123456' },
        });
        assert(loginRes.statusCode === 200, `login should succeed: ${loginRes.body}`);
        const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

        const parentRes = await app.inject({
          method: 'POST',
          url: '/sessions',
          headers: { authorization: `Bearer ${accessToken}` },
          payload: {},
        });
        assert(parentRes.statusCode === 201, `parent create should succeed: ${parentRes.body}`);
        const { sessionId: parentSessionId } = JSON.parse(parentRes.body) as { sessionId: string };

        const childRes = await app.inject({
          method: 'POST',
          url: '/sessions',
          headers: { authorization: `Bearer ${accessToken}` },
          payload: { metadata: { parentSessionId } },
        });
        assert(childRes.statusCode === 201, `child create should succeed: ${childRes.body}`);
        const { sessionId: childSessionId } = JSON.parse(childRes.body) as { sessionId: string };

        const grandchildRes = await app.inject({
          method: 'POST',
          url: '/sessions',
          headers: { authorization: `Bearer ${accessToken}` },
          payload: { metadata: { parentSessionId: childSessionId } },
        });
        assert(
          grandchildRes.statusCode === 201,
          `grandchild create should succeed: ${grandchildRes.body}`,
        );
        const { sessionId: grandchildSessionId } = JSON.parse(grandchildRes.body) as {
          sessionId: string;
        };

        dbModule.sqliteRun(
          "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?",
          [
            JSON.stringify({
              parentSessionId,
              createdByTool: 'task',
              subagentType: 'explore',
              taskParentToolCallId: 'task-call-1',
              taskParentToolRequestId: 'task-parent-request-1',
              workingDirectory: '/tmp/openawork-session-root-child/project',
            }),
            childSessionId,
          ],
        );

        const taskManager = new AgentTaskManagerImpl();
        const parentGraph = await taskManager.loadOrCreate(workspaceRoot, parentSessionId);
        taskManager.addTask(parentGraph, {
          title: '父会话任务',
          status: 'pending',
          blockedBy: [],
          sessionId: parentSessionId,
          priority: 'high',
          tags: ['parent'],
        });
        await taskManager.save(parentGraph);

        const childGraph = await taskManager.loadOrCreate(workspaceRoot, childSessionId);
        taskManager.addTask(childGraph, {
          title: '子会话任务',
          status: 'pending',
          blockedBy: [],
          sessionId: childSessionId,
          priority: 'medium',
          tags: ['child'],
        });
        await taskManager.save(childGraph);

        const parentGraphPath = path.join(
          workspaceRoot,
          '.agentdocs',
          'tasks',
          `${parentSessionId}.json`,
        );
        const childGraphPath = path.join(
          workspaceRoot,
          '.agentdocs',
          'tasks',
          `${childSessionId}.json`,
        );
        assert(existsSync(parentGraphPath), 'parent graph should exist before delete');
        assert(existsSync(childGraphPath), 'child graph should exist before delete');

        const deleteRes = await app.inject({
          method: 'DELETE',
          url: `/sessions/${parentSessionId}`,
          headers: { authorization: `Bearer ${accessToken}` },
        });
        assert(deleteRes.statusCode === 200, `delete should succeed: ${deleteRes.body}`);

        assert(!existsSync(parentGraphPath), 'parent graph should be removed after delete');
        assert(!existsSync(childGraphPath), 'child graph should be removed after parent delete');

        const childRow = dbModule.sqliteGet<{ id: string }>(
          'SELECT id FROM sessions WHERE id = ? LIMIT 1',
          [childSessionId],
        );
        assert(!childRow, 'child session should be deleted with the parent');

        const grandchildRow = dbModule.sqliteGet<{ id: string }>(
          'SELECT id FROM sessions WHERE id = ? LIMIT 1',
          [grandchildSessionId],
        );
        assert(!grandchildRow, 'grandchild session should be deleted with the parent');

        const listRes = await app.inject({
          method: 'GET',
          url: '/sessions',
          headers: { authorization: `Bearer ${accessToken}` },
        });
        assert(listRes.statusCode === 200, `list should succeed: ${listRes.body}`);
        const listPayload = JSON.parse(listRes.body) as { sessions: Array<{ id: string }> };
        assert(
          !listPayload.sessions.some((session) => session.id === childSessionId),
          'session list should no longer contain child session',
        );
        assert(
          !listPayload.sessions.some((session) => session.id === parentSessionId),
          'session list should no longer contain parent session',
        );
        assert(
          !listPayload.sessions.some((session) => session.id === grandchildSessionId),
          'session list should no longer contain grandchild session',
        );
        assert(
          existsSync(workspaceRoot),
          'workspace root should remain after deleting the session tree',
        );

        console.log('verify-session-delete-child-detach: ok');
      } finally {
        await app.close();
        await dbModule.closeDb();
        rmSync(workspaceRoot, { recursive: true, force: true });
      }
    },
  );
}

void main().catch((error) => {
  console.error('verify-session-delete-child-detach: failed');
  console.error(error);
  process.exitCode = 1;
});
