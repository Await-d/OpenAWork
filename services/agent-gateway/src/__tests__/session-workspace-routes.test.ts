import { createHash, randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';

let app: FastifyInstance | null = null;
let closeDb: (() => Promise<void>) | null = null;
let workspaceRoot = '';

describe.skipIf(process.version.startsWith('v22.') || process.version.startsWith('v24.'))(
  'session workspace routes integration',
  () => {
    beforeEach(async () => {
      vi.resetModules();
      workspaceRoot = path.join('/tmp', `openawork-session-root-${randomUUID()}`);
      process.env['DATABASE_URL'] = ':memory:';
      process.env['WORKSPACE_ROOT'] = workspaceRoot;

      const [{ default: Fastify }, { default: authPlugin }, { sessionsRoutes }, dbModule] =
        await Promise.all([
          import('fastify'),
          import('../auth.js'),
          import('../routes/sessions.js'),
          import('../db.js'),
        ]);

      closeDb = dbModule.closeDb;
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

      app = Fastify();
      await app.register(authPlugin);
      await app.register(sessionsRoutes);
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
      if (workspaceRoot) {
        rmSync(workspaceRoot, { recursive: true, force: true });
        workspaceRoot = '';
      }
      delete process.env['DATABASE_URL'];
      delete process.env['WORKSPACE_ROOT'];
    });

    it('rejects invalid workspace metadata without partially updating title', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const patchRes = await app!.inject({
        method: 'PATCH',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          title: '不应该写入',
          metadata: { workingDirectory: '/tmp/openawork-session-root-sibling/project' },
        },
      });

      expect(patchRes.statusCode).toBe(403);
      expect(JSON.parse(patchRes.body)).toEqual({ error: 'Forbidden' });

      const getRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const getPayload = JSON.parse(getRes.body) as {
        session: { title: string | null; metadata_json: string };
      };
      expect(getPayload.session.title).toBeNull();
      expect(JSON.parse(getPayload.session.metadata_json)).toEqual({});
    });

    it('rejects unsupported metadata keys when creating a session', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const createRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          metadata: {
            activeLoopKind: 'ralph',
          },
        },
      });

      expect(createRes.statusCode).toBe(400);
      expect(JSON.parse(createRes.body).error).toBe('Invalid metadata');
    });

    it('sanitizes invalid workspace metadata in get, list, and children responses', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const parentRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId: parentSessionId } = JSON.parse(parentRes.body) as { sessionId: string };

      const childRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { parentSessionId } },
      });
      const { sessionId: childSessionId } = JSON.parse(childRes.body) as { sessionId: string };

      const { sqliteRun } = await import('../db.js');
      sqliteRun(
        "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?",
        [
          JSON.stringify({
            workingDirectory: '/tmp/openawork-session-root-sibling/project',
            tag: 'kept',
          }),
          parentSessionId,
        ],
      );
      sqliteRun(
        "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?",
        [
          JSON.stringify({
            parentSessionId,
            workingDirectory: '/tmp/openawork-session-root-sibling/project',
            childTag: 'kept',
          }),
          childSessionId,
        ],
      );

      const getRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${parentSessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const getPayload = JSON.parse(getRes.body) as {
        session: { metadata_json: string; messages_json?: string; user_id?: string };
      };
      expect(getPayload.session.metadata_json).toBe(JSON.stringify({ tag: 'kept' }));
      expect(getPayload.session.messages_json).toBeUndefined();
      expect(getPayload.session.user_id).toBeUndefined();

      const listRes = await app!.inject({
        method: 'GET',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const listPayload = JSON.parse(listRes.body) as {
        sessions: Array<{ id: string; metadata_json: string }>;
      };
      expect(
        listPayload.sessions.find((session) => session.id === parentSessionId)?.metadata_json,
      ).toBe(JSON.stringify({ tag: 'kept' }));

      const childrenRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${parentSessionId}/children`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const childrenPayload = JSON.parse(childrenRes.body) as {
        sessions: Array<{
          id: string;
          metadata_json: string;
          messages_json?: string;
          user_id?: string;
        }>;
      };
      expect(
        childrenPayload.sessions.find((session) => session.id === childSessionId)?.metadata_json,
      ).toBe(JSON.stringify({ parentSessionId, childTag: 'kept' }));
      expect(
        childrenPayload.sessions.find((session) => session.id === childSessionId)?.messages_json,
      ).toBeUndefined();
      expect(
        childrenPayload.sessions.find((session) => session.id === childSessionId)?.user_id,
      ).toBeUndefined();
    });

    it('includes unified file change summary in get and list responses', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const { persistSessionFileDiffs } = await import('../session-file-diff-store.js');
      const { createRequestSnapshotRef, persistSessionSnapshot } =
        await import('../session-snapshot-store.js');
      const { sqliteGet } = await import('../db.js');
      const admin = sqliteGet<{ id: string }>('SELECT id FROM users WHERE email = ? LIMIT 1', [
        'admin@openAwork.local',
      ]);
      const userId = admin?.id;
      expect(userId).toBeTruthy();

      await persistSessionFileDiffs({
        sessionId,
        userId: userId!,
        clientRequestId: 'req-route-1',
        requestId: 'req-route-1:tool:bash-1',
        toolName: 'bash',
        toolCallId: 'bash-1',
        diffs: [
          {
            file: 'copied.txt',
            before: '',
            after: 'hello\n',
            additions: 1,
            deletions: 0,
            status: 'added',
            sourceKind: 'workspace_reconcile',
            guaranteeLevel: 'weak',
          },
        ],
      });
      persistSessionSnapshot({
        sessionId,
        userId: userId!,
        snapshotRef: createRequestSnapshotRef('req-route-1'),
        fileDiffs: [
          {
            file: 'copied.txt',
            before: '',
            after: 'hello\n',
            additions: 1,
            deletions: 0,
            status: 'added',
            sourceKind: 'workspace_reconcile',
            guaranteeLevel: 'weak',
          },
        ],
      });

      const getRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const getPayload = JSON.parse(getRes.body) as {
        session: {
          fileChangesSummary: {
            latestSnapshotRef: string;
            snapshotCount: number;
            sourceKinds: string[];
            totalFileDiffs: number;
            weakestGuaranteeLevel: string;
          };
        };
      };
      expect(getPayload.session.fileChangesSummary).toMatchObject({
        totalFileDiffs: 1,
        snapshotCount: 1,
        weakestGuaranteeLevel: 'weak',
        latestSnapshotRef: 'req:req-route-1',
        sourceKinds: ['workspace_reconcile'],
      });

      const listRes = await app!.inject({
        method: 'GET',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const listPayload = JSON.parse(listRes.body) as {
        sessions: Array<{
          fileChangesSummary?: {
            totalFileDiffs: number;
            weakestGuaranteeLevel: string;
          };
          id: string;
        }>;
      };
      expect(
        listPayload.sessions.find((session) => session.id === sessionId)?.fileChangesSummary,
      ).toMatchObject({
        totalFileDiffs: 1,
        weakestGuaranteeLevel: 'weak',
      });
    });

    it('rejects rebinding a session workspace through the dedicated workspace route', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { workingDirectory: workspaceRoot } },
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const patchRes = await app!.inject({
        method: 'PATCH',
        url: `/sessions/${sessionId}/workspace`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          workingDirectory: path.join(workspaceRoot, 'another-project'),
        },
      });

      expect(patchRes.statusCode).toBe(409);
      expect(JSON.parse(patchRes.body)).toEqual({
        error: 'Session workspace cannot be moved after binding',
      });
    });

    it('rejects rebinding a session workspace through generic metadata patching', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { workingDirectory: workspaceRoot } },
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const patchRes = await app!.inject({
        method: 'PATCH',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          metadata: {
            workingDirectory: path.join(workspaceRoot, 'another-project'),
          },
        },
      });

      expect(patchRes.statusCode).toBe(409);
      expect(JSON.parse(patchRes.body)).toEqual({
        error: 'Session workspace cannot be moved after binding',
      });
    });

    it('allows patching a session with a workspace path that normalizes to the same location', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionWorkspace = path.join(workspaceRoot, 'apps', 'web');
      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { workingDirectory: sessionWorkspace } },
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const patchRes = await app!.inject({
        method: 'PATCH',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          metadata: {
            workingDirectory: path.join(workspaceRoot, 'apps', 'web', '..', 'web'),
            dialogueMode: 'coding',
          },
        },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(JSON.parse(patchRes.body)).toEqual({ ok: true });
    });

    it('rejects child session creation when the parent session does not exist', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const createRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { parentSessionId: 'missing-parent' } },
      });

      expect(createRes.statusCode).toBe(404);
      expect(JSON.parse(createRes.body)).toEqual({ error: 'Parent session not found' });
    });

    it('rejects changing a session parent after it has been bound', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const parentRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId: firstParentId } = JSON.parse(parentRes.body) as { sessionId: string };

      const secondParentRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId: secondParentId } = JSON.parse(secondParentRes.body) as {
        sessionId: string;
      };

      const childRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { parentSessionId: firstParentId } },
      });
      const { sessionId: childSessionId } = JSON.parse(childRes.body) as { sessionId: string };

      const patchRes = await app!.inject({
        method: 'PATCH',
        url: `/sessions/${childSessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          metadata: {
            parentSessionId: secondParentId,
          },
        },
      });

      expect(patchRes.statusCode).toBe(409);
      expect(JSON.parse(patchRes.body)).toEqual({
        error: 'Session parent cannot be changed after binding',
      });
    });

    it('deletes the persisted task graph when a session is removed', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const taskManager = new AgentTaskManagerImpl();
      const graph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
      taskManager.addTask(graph, {
        title: '待删除任务',
        status: 'pending',
        blockedBy: [],
        sessionId,
        priority: 'high',
        tags: ['security'],
      });
      await taskManager.save(graph);

      const graphPath = path.join(workspaceRoot, '.agentdocs', 'tasks', `${sessionId}.json`);
      expect(existsSync(graphPath)).toBe(true);

      const deleteRes = await app!.inject({
        method: 'DELETE',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(existsSync(graphPath)).toBe(false);
      expect(existsSync(workspaceRoot)).toBe(true);
    });

    it('deletes descendant child session graphs together with the parent session', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const parentRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { workingDirectory: workspaceRoot } },
      });
      const { sessionId: parentSessionId } = JSON.parse(parentRes.body) as { sessionId: string };

      const childRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { parentSessionId } },
      });
      const { sessionId: childSessionId } = JSON.parse(childRes.body) as { sessionId: string };

      const grandchildRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { parentSessionId: childSessionId } },
      });
      const { sessionId: grandchildSessionId } = JSON.parse(grandchildRes.body) as {
        sessionId: string;
      };

      const taskManager = new AgentTaskManagerImpl();
      for (const id of [parentSessionId, childSessionId, grandchildSessionId]) {
        const graph = await taskManager.loadOrCreate(workspaceRoot, id);
        taskManager.addTask(graph, {
          title: `待删除任务-${id}`,
          status: 'pending',
          blockedBy: [],
          sessionId: id,
          priority: 'high',
          tags: ['cascade-delete'],
        });
        await taskManager.save(graph);
      }

      const graphPaths = [parentSessionId, childSessionId, grandchildSessionId].map((id) =>
        path.join(workspaceRoot, '.agentdocs', 'tasks', `${id}.json`),
      );
      expect(graphPaths.every((graphPath) => existsSync(graphPath))).toBe(true);

      const deleteRes = await app!.inject({
        method: 'DELETE',
        url: `/sessions/${parentSessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(JSON.parse(deleteRes.body)).toMatchObject({
        deletedSessionIds: expect.arrayContaining([
          parentSessionId,
          childSessionId,
          grandchildSessionId,
        ]),
        ok: true,
      });
      expect(graphPaths.every((graphPath) => !existsSync(graphPath))).toBe(true);
      expect(
        (await import('../db.js')).sqliteGet('SELECT id FROM sessions WHERE id = ? LIMIT 1', [
          parentSessionId,
        ]),
      ).toBeUndefined();
      expect(
        (await import('../db.js')).sqliteGet('SELECT id FROM sessions WHERE id = ? LIMIT 1', [
          childSessionId,
        ]),
      ).toBeUndefined();
      expect(
        (await import('../db.js')).sqliteGet('SELECT id FROM sessions WHERE id = ? LIMIT 1', [
          grandchildSessionId,
        ]),
      ).toBeUndefined();
      expect(existsSync(workspaceRoot)).toBe(true);
    });

    it('stops in-flight stream requests before deleting the session tree', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const { sqliteGet } = await import('../db.js');
      const userRow = sqliteGet<{ id: string }>('SELECT id FROM users WHERE email = ? LIMIT 1', [
        'admin@openAwork.local',
      ]);
      expect(userRow).toBeDefined();
      const userId = userRow?.id;
      if (!userId) {
        throw new Error('admin user should exist');
      }

      const {
        clearInFlightStreamRequest,
        getAnyInFlightStreamRequestForSession,
        registerInFlightStreamRequest,
      } = await import('../routes/stream-cancellation.js');
      const abortController = new AbortController();
      let abortCount = 0;
      let execution!: Promise<{ statusCode: number }>;
      execution = new Promise((resolve) => {
        abortController.signal.addEventListener(
          'abort',
          () => {
            abortCount += 1;
            clearInFlightStreamRequest({
              clientRequestId: 'delete-test-request',
              execution,
              sessionId,
            });
            resolve({ statusCode: 499 });
          },
          { once: true },
        );
      });
      registerInFlightStreamRequest({
        abortController,
        clientRequestId: 'delete-test-request',
        execution,
        sessionId,
        userId,
      });

      const deleteRes = await app!.inject({
        method: 'DELETE',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(abortCount).toBe(1);
      expect(getAnyInFlightStreamRequestForSession({ sessionId, userId })).toBeUndefined();
      expect(
        sqliteGet('SELECT id FROM sessions WHERE id = ? LIMIT 1', [sessionId]),
      ).toBeUndefined();
    });

    it('rejects deleting a session tree when any related session has pending interaction', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const parentRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId: parentSessionId } = JSON.parse(parentRes.body) as { sessionId: string };

      const childRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { parentSessionId } },
      });
      const { sessionId: childSessionId } = JSON.parse(childRes.body) as { sessionId: string };

      const { sqliteGet, sqliteRun } = await import('../db.js');
      const userRow = sqliteGet<{ id: string }>('SELECT id FROM users WHERE email = ? LIMIT 1', [
        'admin@openAwork.local',
      ]);
      expect(userRow).toBeDefined();
      const userId = userRow?.id;
      if (!userId) {
        throw new Error('admin user should exist');
      }
      sqliteRun(
        `INSERT INTO question_requests
         (id, session_id, user_id, tool_name, title, questions_json, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [
          randomUUID(),
          childSessionId,
          userId,
          'ExitPlanMode',
          'Exit plan mode',
          JSON.stringify([
            {
              question: 'Do you approve this plan and want implementation to start now?',
              header: 'Plan approval',
              multiple: false,
              options: [
                { label: 'Start implementation', description: 'Approve the plan' },
                { label: 'Continue planning', description: 'Keep planning' },
              ],
            },
          ]),
        ],
      );

      const deleteRes = await app!.inject({
        method: 'DELETE',
        url: `/sessions/${parentSessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(deleteRes.statusCode).toBe(409);
      expect(JSON.parse(deleteRes.body)).toEqual({
        blockReason: 'pendingInteraction',
        error: 'Session can only be deleted when every related session is idle',
        sessionId: childSessionId,
        state_status: 'paused',
      });
      expect(sqliteGet('SELECT id FROM sessions WHERE id = ? LIMIT 1', [parentSessionId])).toEqual({
        id: parentSessionId,
      });
      expect(sqliteGet('SELECT id FROM sessions WHERE id = ? LIMIT 1', [childSessionId])).toEqual({
        id: childSessionId,
      });
    });

    it('does not delete a task graph when the session does not belong to the caller', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const rogueGraphPath = path.join(
        workspaceRoot,
        '.agentdocs',
        'tasks',
        'missing-session.json',
      );
      rmSync(path.dirname(rogueGraphPath), { recursive: true, force: true });
      const taskManager = new AgentTaskManagerImpl();
      const rogueGraph = await taskManager.loadOrCreate(workspaceRoot, 'missing-session');
      taskManager.addTask(rogueGraph, {
        title: '不应被删除的任务图',
        status: 'pending',
        blockedBy: [],
        sessionId: 'missing-session',
        priority: 'high',
        tags: ['security'],
      });
      await taskManager.save(rogueGraph);
      expect(existsSync(rogueGraphPath)).toBe(true);

      const deleteRes = await app!.inject({
        method: 'DELETE',
        url: '/sessions/missing-session',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(deleteRes.statusCode).toBe(404);
      expect(existsSync(rogueGraphPath)).toBe(true);
    });

    it('falls back to empty metadata when patching a session with corrupted metadata_json', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const sessionRes = await app!.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      const { sessionId } = JSON.parse(sessionRes.body) as { sessionId: string };

      const { sqliteRun } = await import('../db.js');
      sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
        '{not valid json',
        sessionId,
      ]);

      const patchRes = await app!.inject({
        method: 'PATCH',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadata: { dialogueMode: 'coding', yoloMode: true } },
      });

      expect(patchRes.statusCode).toBe(200);

      const getRes = await app!.inject({
        method: 'GET',
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const getPayload = JSON.parse(getRes.body) as { session: { metadata_json: string } };
      expect(JSON.parse(getPayload.session.metadata_json)).toMatchObject({
        dialogueMode: 'coding',
        yoloMode: true,
      });
    });

    it('rejects oversized session imports', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const importRes = await app!.inject({
        method: 'POST',
        url: '/sessions/import',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          messages: Array.from({ length: 501 }, (_, index) => ({
            role: 'user',
            content: `m-${index}`,
          })),
        },
      });

      expect(importRes.statusCode).toBe(413);
      expect(JSON.parse(importRes.body)).toEqual({ error: 'Import exceeds 500 messages' });
    });
  },
);
