import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { assert, withTempEnv } from './task-verification-helpers.js';

async function main(): Promise<void> {
  const workspaceRoot = `/tmp/openawork-session-task-root-${randomUUID()}`;

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      WORKSPACE_ROOT: workspaceRoot,
    },
    async () => {
      const [{ default: Fastify }, { default: authPlugin }, { sessionsRoutes }, dbModule] =
        await Promise.all([
          import('fastify'),
          import('../auth.js'),
          import('../routes/sessions.js'),
          import('../db.js'),
        ]);
      const { default: requestWorkflowPlugin } = await import('../request-workflow.js');

      await dbModule.connectDb();
      await dbModule.migrate();

      const userId = randomUUID();
      const email = 'admin@openAwork.local';
      dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        userId,
        email,
        'hash',
      ]);

      const app = Fastify();
      await app.register(requestWorkflowPlugin);
      await app.register(authPlugin);
      await app.register(sessionsRoutes);
      await app.ready();

      try {
        const accessToken = app.jwt.sign({ sub: userId, email });
        const sessionId = randomUUID();
        dbModule.sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json) VALUES (?, ?, '[]', 'idle', '{}')`,
          [sessionId, userId],
        );

        const taskManager = new AgentTaskManagerImpl();
        const graph = await taskManager.loadOrCreate(dbModule.WORKSPACE_ROOT, sessionId);
        const childSessionId = randomUUID();
        const grandchildSessionId = randomUUID();
        const staleTimeoutSessionId = randomUUID();
        dbModule.sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, title) VALUES (?, ?, '[]', 'idle', ?, ?)`,
          [childSessionId, userId, JSON.stringify({ parentSessionId: sessionId }), '子代理会话'],
        );
        dbModule.sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, title) VALUES (?, ?, '[]', 'idle', ?, ?)`,
          [
            grandchildSessionId,
            userId,
            JSON.stringify({ parentSessionId: childSessionId }),
            '孙子代理会话',
          ],
        );
        dbModule.sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, title) VALUES (?, ?, '[]', 'running', ?, ?)`,
          [
            staleTimeoutSessionId,
            userId,
            JSON.stringify({
              parentSessionId: sessionId,
              createdByTool: 'task',
              subagentType: 'explore',
              deadlineMs: Date.now() - 1_000,
            }),
            '过期子代理会话',
          ],
        );
        const parentTask = taskManager.addTask(graph, {
          title: '根任务',
          description: '主任务',
          status: 'pending',
          blockedBy: [],
          sessionId,
          priority: 'high',
          tags: ['root'],
        });
        const childTask = taskManager.addTask(graph, {
          title: '子任务',
          description: '细分步骤',
          status: 'pending',
          blockedBy: [],
          parentTaskId: parentTask.id,
          priority: 'medium',
          tags: ['child'],
        });
        const siblingTask = taskManager.addTask(graph, {
          title: '第二个根任务',
          description: '并列步骤',
          status: 'pending',
          blockedBy: [childTask.id],
          sessionId,
          priority: 'low',
          tags: ['sibling'],
        });
        const delegatedTask = taskManager.addTask(graph, {
          title: '委派文档检索',
          description: '抓取文档并返回摘要',
          status: 'completed',
          blockedBy: [],
          sessionId: childSessionId,
          assignedAgent: 'librarian',
          priority: 'medium',
          tags: ['task-tool', 'librarian'],
          result: '文档摘要已返回给父线程。',
        });
        const staleTimeoutTask = taskManager.addTask(graph, {
          title: '已过期的子代理任务',
          description: '等待 reconcile 收敛成 timeout',
          status: 'running',
          blockedBy: [],
          sessionId: staleTimeoutSessionId,
          assignedAgent: 'explore',
          priority: 'medium',
          tags: ['task-tool'],
        });
        await taskManager.save(graph);

        const childGraph = await taskManager.loadOrCreate(dbModule.WORKSPACE_ROOT, childSessionId);
        const childFollowupTask = taskManager.addTask(childGraph, {
          title: '整理文档结论',
          description: '汇总抓取结果并整理输出',
          status: 'running',
          blockedBy: [],
          sessionId: childSessionId,
          assignedAgent: 'librarian',
          priority: 'medium',
          tags: ['task-tool', 'follow-up'],
        });
        await taskManager.save(childGraph);

        const effectiveDeadline = Date.now() + 60_000;
        dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ? AND user_id = ?', [
          JSON.stringify({
            parentSessionId: sessionId,
            terminalReason: 'timeout',
            deadlineMs: effectiveDeadline,
          }),
          childSessionId,
          userId,
        ]);

        const grandchildGraph = await taskManager.loadOrCreate(
          dbModule.WORKSPACE_ROOT,
          grandchildSessionId,
        );
        const grandchildTask = taskManager.addTask(grandchildGraph, {
          title: '孙子代理复核结论',
          description: '整理孙子代理的复核输出',
          status: 'pending',
          blockedBy: [],
          sessionId: grandchildSessionId,
          assignedAgent: 'reviewer',
          priority: 'medium',
          tags: ['task-tool', 'reviewer'],
        });
        await taskManager.save(grandchildGraph);

        const tasksRes = await app.inject({
          method: 'GET',
          url: `/sessions/${sessionId}/tasks`,
          headers: { authorization: `Bearer ${accessToken}` },
        });

        const childrenRes = await app.inject({
          method: 'GET',
          url: `/sessions/${sessionId}/children`,
          headers: { authorization: `Bearer ${accessToken}` },
        });

        assert(
          childrenRes.statusCode === 200,
          `session children route should succeed (got ${childrenRes.statusCode}: ${childrenRes.body})`,
        );
        const childrenPayload = JSON.parse(childrenRes.body) as {
          sessions: Array<{ id: string }>;
        };
        assert(
          childrenPayload.sessions.some((session) => session.id === childSessionId),
          'session children route should include direct child sessions',
        );
        assert(
          childrenPayload.sessions.some((session) => session.id === grandchildSessionId),
          'session children route should include deeper descendant sessions',
        );

        assert(
          tasksRes.statusCode === 200,
          `session tasks route should succeed (got ${tasksRes.statusCode}: ${tasksRes.body})`,
        );
        const payload = JSON.parse(tasksRes.body) as {
          tasks: Array<{
            id: string;
            title: string;
            status: string;
            parentTaskId?: string;
            depth: number;
            subtaskCount: number;
            blockedBy: string[];
            sessionId?: string;
            terminalReason?: string;
            effectiveDeadline?: number;
          }>;
        };

        assert(payload.tasks.length === 7, 'session tasks route should return projected tasks');
        const parentProjectedTask = payload.tasks.find((task) => task.id === parentTask.id);
        const childProjectedTask = payload.tasks.find((task) => task.id === childTask.id);
        const siblingProjectedTask = payload.tasks.find((task) => task.id === siblingTask.id);
        const delegatedProjectedTask = payload.tasks.find((task) => task.id === delegatedTask.id);
        const staleTimeoutProjectedTask = payload.tasks.find(
          (task) => task.id === staleTimeoutTask.id,
        );
        const grandchildProjectedTask = payload.tasks.find((task) => task.id === grandchildTask.id);

        assert(parentProjectedTask?.depth === 0, 'root task depth should be 0');
        assert(
          parentProjectedTask?.subtaskCount === 1,
          'root task should report its direct in-session subtask',
        );
        assert(
          childProjectedTask?.parentTaskId === parentTask.id,
          'child task should keep parentTaskId',
        );
        assert(childProjectedTask?.depth === 1, 'child task depth should be 1');
        assert(
          JSON.stringify(siblingProjectedTask?.blockedBy) === JSON.stringify([childTask.id]),
          'sibling task should keep blockedBy metadata',
        );
        assert(
          delegatedProjectedTask?.depth === 0,
          'delegated child-session task should remain visible without a cross-session parent link',
        );
        assert(
          delegatedProjectedTask?.title === delegatedTask.title,
          'delegated child-session task should preserve its title',
        );
        assert(
          (delegatedProjectedTask as { terminalReason?: string } | undefined)?.terminalReason ===
            'timeout',
          'delegated child-session task should expose terminalReason from child session metadata',
        );
        assert(
          (delegatedProjectedTask as { effectiveDeadline?: number } | undefined)
            ?.effectiveDeadline === effectiveDeadline,
          'delegated child-session task should expose effectiveDeadline from child session metadata',
        );
        assert(
          staleTimeoutProjectedTask?.status === 'failed',
          'session tasks route should reconcile stale expired child sessions into failed tasks on the same response',
        );
        assert(
          (staleTimeoutProjectedTask as { terminalReason?: string } | undefined)?.terminalReason ===
            'timeout',
          'session tasks route should expose terminalReason=timeout immediately after reconcile',
        );
        assert(
          grandchildProjectedTask?.sessionId === grandchildSessionId,
          'parent session tasks route should include deeper descendant tasks',
        );

        const childTasksRes = await app.inject({
          method: 'GET',
          url: `/sessions/${childSessionId}/tasks`,
          headers: { authorization: `Bearer ${accessToken}` },
        });

        assert(
          childTasksRes.statusCode === 200,
          `child session tasks route should succeed (got ${childTasksRes.statusCode}: ${childTasksRes.body})`,
        );
        const childPayload = JSON.parse(childTasksRes.body) as {
          tasks: Array<{
            id: string;
            sessionId?: string;
            status: string;
            title: string;
          }>;
        };
        assert(
          childPayload.tasks.some((task) => task.id === delegatedTask.id),
          'child session tasks route should include the delegated task stored in the parent graph',
        );
        assert(
          childPayload.tasks.some((task) => task.id === childFollowupTask.id),
          'child session tasks route should include tasks created inside the child session graph',
        );
        assert(
          childPayload.tasks.every(
            (task) =>
              task.sessionId === sessionId ||
              task.sessionId === childSessionId ||
              task.sessionId === grandchildSessionId ||
              task.sessionId === undefined,
          ),
          'child session tasks route should include the full visible ancestor/descendant chain only',
        );

        const grandchildTasksRes = await app.inject({
          method: 'GET',
          url: `/sessions/${grandchildSessionId}/tasks`,
          headers: { authorization: `Bearer ${accessToken}` },
        });

        assert(
          grandchildTasksRes.statusCode === 200,
          `grandchild session tasks route should succeed (got ${grandchildTasksRes.statusCode}: ${grandchildTasksRes.body})`,
        );
        const grandchildPayload = JSON.parse(grandchildTasksRes.body) as {
          tasks: Array<{ id: string; sessionId?: string }>;
        };
        assert(
          grandchildPayload.tasks.some((task) => task.id === delegatedTask.id),
          'grandchild session tasks route should still include ancestor delegated tasks from the root graph',
        );
        assert(
          grandchildPayload.tasks.some((task) => task.id === grandchildTask.id),
          'grandchild session tasks route should include tasks stored in the grandchild graph',
        );
        assert(
          grandchildPayload.tasks.every(
            (task) =>
              task.sessionId === sessionId ||
              task.sessionId === childSessionId ||
              task.sessionId === grandchildSessionId ||
              task.sessionId === undefined,
          ),
          'grandchild session tasks route should remain scoped to the visible ancestor/descendant chain',
        );

        console.log('verify-session-task-routes: ok');
      } finally {
        await app.close();
        await dbModule.closeDb();
        rmSync(workspaceRoot, { recursive: true, force: true });
      }
    },
  );
}

void main().catch((error) => {
  console.error('verify-session-task-routes: failed');
  console.error(error);
  process.exitCode = 1;
});
