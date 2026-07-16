import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';
import type * as SessionSnapshotStoreModule from '../../session/session-snapshot-store.js';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-sessions-routes-'));
const outsideRoot = mkdtempSync(join(tmpdir(), 'openawork-sessions-outside-'));
const SESSION_ID = 'sess-error-routes';
const USER_ID = 'u-session-error-routes';

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'session-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionsRoutes: typeof SessionsRoutesModule.sessionsRoutes;
let snapshotStore: typeof SessionSnapshotStoreModule;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sessionsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'session-routes@example.com' })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(metadata: Record<string, unknown> = {}): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'session', ?, 'idle')`,
    [SESSION_ID, USER_ID, JSON.stringify(metadata)],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  sessionsRoutes = (await import('../../routes/sessions.js')).sessionsRoutes;
  snapshotStore = await import('../../session/session-snapshot-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM session_snapshots', []);
  dbModule.sqliteRun('DELETE FROM message_ratings', []);
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM question_requests', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(outsideRoot, { recursive: true, force: true });
});

describe('sessions route error contracts', () => {
  it('POST /sessions 对非法 metadata 返回中文 BadRequest', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          metadata: {
            unexpectedField: true,
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: {
          message: '会话元数据无效。',
          kind: 'Body',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('POST /sessions 接受 modelSelectionSource 元数据字段', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          metadata: {
            modelId: 'gpt-5.4',
            modelSelectionSource: 'defaults',
            providerId: 'openai',
          },
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        sessionId: expect.any(String),
      });
    } finally {
      await app.close();
    }
  });

  it('POST /sessions 对越界 workingDirectory 返回中文 403', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          workingDirectory: outsideRoot,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: '工作区路径不在允许范围内。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /sessions 对不存在的父会话返回中文 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          metadata: {
            parentSessionId: 'missing-parent-session',
          },
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: '目标父会话不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH /sessions/:sessionId 对非法 metadata 返回中文 400', async () => {
    seedSession();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/sessions/${SESSION_ID}`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          metadata: {
            badField: 'x',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: '会话元数据无效。',
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH /sessions/:sessionId 接受 modelSelectionSource 元数据字段', async () => {
    seedSession();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/sessions/${SESSION_ID}`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          metadata: {
            modelId: 'gpt-5.4',
            modelSelectionSource: 'manual',
            providerId: 'openai',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH /sessions/:sessionId 对将自己设为父会话的请求返回中文 400', async () => {
    seedSession();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/sessions/${SESSION_ID}`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          metadata: {
            parentSessionId: SESSION_ID,
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: '会话不能将自己设为父会话。',
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH /sessions/:sessionId 对越界 metadata.workingDirectory 返回中文 403', async () => {
    seedSession();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/sessions/${SESSION_ID}`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          metadata: {
            workingDirectory: outsideRoot,
          },
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: '工作区路径不在允许范围内。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /sessions/:sessionId/restore/preview 在缺少 backupId 与 snapshotRef 时返回中文 issue', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${SESSION_ID}/restore/preview`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: {
          message: '请求体参数无效。',
          kind: 'Body',
          issues: [
            expect.objectContaining({
              message: '必须且只能提供 backupId 或 snapshotRef 其中之一。',
            }),
          ],
        },
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH /sessions/:sessionId/workspace 对已绑定工作区的改绑请求返回中文 409', async () => {
    seedSession({ workingDirectory: join(workspaceRoot, 'project-a') });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/sessions/${SESSION_ID}/workspace`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          workingDirectory: join(workspaceRoot, 'project-b'),
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: '当前会话已绑定工作区，不能直接修改。',
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH /sessions/:sessionId/workspace 首次绑定新目录时不受旧 allowlist 预校验影响', async () => {
    seedSession();
    const nextWorkspace = join(workspaceRoot, 'project-first-bind');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/sessions/${SESSION_ID}/workspace`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          workingDirectory: nextWorkspace,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        workingDirectory: nextWorkspace,
      });
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/recovery 跳过 questions_json 损坏的单条提问而不是整列 500', async () => {
    seedSession();
    // One good pending question + one with corrupt questions_json. The recovery
    // read model must skip the bad row, not 500 the whole recovery response
    // (§0.89-§0.93 corrupt-row class).
    dbModule.sqliteRun(
      `INSERT INTO question_requests
        (id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status)
       VALUES ('q-good', ?, ?, 'AskFollowUpQuestion', '好问题', '[]', NULL, NULL, NULL, 'pending')`,
      [SESSION_ID, USER_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO question_requests
        (id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status)
       VALUES ('q-broken', ?, ?, 'AskFollowUpQuestion', '坏问题', '{broken-json', NULL, NULL, NULL, 'pending')`,
      [SESSION_ID, USER_ID],
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/recovery`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const pendingQuestions = response.json().recovery.pendingQuestions as Array<{
        requestId: string;
      }>;
      const ids = pendingQuestions.map((q) => q.requestId);
      expect(ids).toContain('q-good');
      expect(ids).not.toContain('q-broken');
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/recovery 透传 role_layer（团队接待会话空态依赖此字段）', async () => {
    // 团队 reception 会话：前端空态卡片 + 初始化清单 gate 在 role_layer==='reception'。
    // 此前 recovery SELECT 不投影 role_layer，导致前端 roleLayer 永远为 null、空态不渲染。
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer)
       VALUES (?, ?, 'team-reception', ?, 'idle', 'reception')`,
      [SESSION_ID, USER_ID, JSON.stringify({ teamWorkspaceId: 'tw-1' })],
    );
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/recovery`,
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
      const session = response.json().recovery.session as { role_layer?: string };
      expect(session.role_layer).toBe('reception');
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/recovery 沿 team_parent_session_id 返回多层团队子会话', async () => {
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer)
       VALUES ('team-recovery-root', ?, 'reception', '{}', 'idle', 'reception')`,
      [USER_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id)
       VALUES ('team-recovery-pm1', ?, 'pm1', '{}', 'idle', 'pm1', 'team-recovery-root')`,
      [USER_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id)
       VALUES ('team-recovery-executor', ?, 'executor', '{}', 'idle', 'executor', 'team-recovery-pm1')`,
      [USER_ID],
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/team-recovery-root/recovery',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const children = response.json().recovery.children as Array<{
        id: string;
        role_layer?: string | null;
      }>;
      expect(children.map((child) => child.id)).toEqual(
        expect.arrayContaining(['team-recovery-pm1', 'team-recovery-executor']),
      );
      expect(children.find((child) => child.id === 'team-recovery-pm1')?.role_layer).toBe('pm1');
      expect(children.find((child) => child.id === 'team-recovery-executor')?.role_layer).toBe(
        'executor',
      );
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/recovery 为 team 子会话显式透传 parentSessionId', async () => {
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer)
       VALUES ('team-recovery-parent', ?, 'reception', '{}', 'idle', 'reception')`,
      [USER_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id)
       VALUES ('team-recovery-child', ?, 'pm1', '{}', 'idle', 'pm1', 'team-recovery-parent')`,
      [USER_ID],
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/team-recovery-child/recovery',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const session = response.json().recovery.session as {
        parentSessionId?: string | null;
        team_parent_session_id?: string | null;
      };
      expect(session.parentSessionId).toBe('team-recovery-parent');
      expect(session.team_parent_session_id).toBe('team-recovery-parent');
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/recovery 对不同 team 子会话返回各自消息', async () => {
    const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer)
       VALUES ('team-recovery-message-root', ?, 'reception', '{}', 'idle', 'reception')`,
      [USER_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id)
       VALUES ('team-recovery-message-pm1', ?, 'pm1', '{}', 'idle', 'pm1', 'team-recovery-message-root')`,
      [USER_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id)
       VALUES ('team-recovery-message-reviewer', ?, 'reviewer', '{}', 'idle', 'reviewer', 'team-recovery-message-root')`,
      [USER_ID],
    );
    appendSessionMessageV2({
      sessionId: 'team-recovery-message-pm1',
      userId: USER_ID,
      role: 'assistant',
      content: [{ type: 'text', text: 'PM1 独立消息' }],
      messageId: 'msg-pm1-independent',
    });
    appendSessionMessageV2({
      sessionId: 'team-recovery-message-reviewer',
      userId: USER_ID,
      role: 'assistant',
      content: [{ type: 'text', text: '评审独立消息' }],
      messageId: 'msg-reviewer-independent',
    });

    const app = await buildApp();
    try {
      const pm1Response = await app.inject({
        method: 'GET',
        url: '/sessions/team-recovery-message-pm1/recovery',
        headers: { authorization: bearer(app) },
      });
      const reviewerResponse = await app.inject({
        method: 'GET',
        url: '/sessions/team-recovery-message-reviewer/recovery',
        headers: { authorization: bearer(app) },
      });

      expect(pm1Response.statusCode).toBe(200);
      expect(reviewerResponse.statusCode).toBe(200);

      const pm1Messages = pm1Response.json().recovery.session.messages as Array<{
        content: unknown;
        id: string;
      }>;
      const reviewerMessages = reviewerResponse.json().recovery.session.messages as Array<{
        content: unknown;
        id: string;
      }>;

      expect(pm1Messages.map((message) => message.id)).toContain('msg-pm1-independent');
      expect(JSON.stringify(pm1Messages.map((message) => message.content))).not.toContain(
        '评审独立消息',
      );
      expect(reviewerMessages.map((message) => message.id)).toContain('msg-reviewer-independent');
      expect(JSON.stringify(reviewerMessages.map((message) => message.content))).not.toContain(
        'PM1 独立消息',
      );
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/status 在大量团队子会话下返回完整子树且不触发 SQL 变量上限', async () => {
    const rootSessionId = 'team-status-root';
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer)
       VALUES (?, ?, 'root', '{}', 'idle', 'reception')`,
      [rootSessionId, USER_ID],
    );

    const childCount = 905;
    for (let index = 0; index < childCount; index += 1) {
      dbModule.sqliteRun(
        `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id)
         VALUES (?, ?, 'child', '{}', 'idle', 'pm1', ?)`,
        [`team-status-child-${index}`, USER_ID, rootSessionId],
      );
    }

    dbModule.sqliteRun(
      `INSERT INTO permission_requests
        (id, session_id, tool_name, scope, reason, risk_level, status)
       VALUES ('perm-bulk-status', ?, 'bash', 'workspace', 'test', 'medium', 'pending')`,
      ['team-status-child-904'],
    );
    dbModule.sqliteRun(
      `INSERT INTO question_requests
        (id, session_id, user_id, tool_name, title, questions_json, status)
       VALUES ('question-bulk-status', ?, ?, 'ask', '需要回答', '[]', 'pending')`,
      ['team-status-child-903', USER_ID],
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${rootSessionId}/status`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const status = response.json().status as {
        children: Array<{ id: string }>;
        pendingPermissions: Array<{ requestId: string; sessionId: string }>;
        pendingQuestions: Array<{ requestId: string; sessionId: string }>;
      };

      expect(status.children).toHaveLength(childCount);
      expect(status.children.some((child) => child.id === 'team-status-child-904')).toBe(true);
      expect(status.pendingPermissions).toEqual([
        expect.objectContaining({
          requestId: 'perm-bulk-status',
          sessionId: 'team-status-child-904',
        }),
      ]);
      expect(status.pendingQuestions).toEqual([
        expect.objectContaining({
          requestId: 'question-bulk-status',
          sessionId: 'team-status-child-903',
        }),
      ]);
    } finally {
      await app.close();
    }
  });

  it('PUT /sessions/:sessionId/messages/:messageId/rating 对不存在消息返回中文 404', async () => {
    seedSession();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: `/sessions/${SESSION_ID}/messages/msg-missing/rating`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          rating: 'up',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        name: 'NotFound',
        data: {
          message: '目标消息不存在。',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('POST /sessions/:sessionId/restore/preview 对不可读(EISDIR)的单个文件降级为缺失而不是整列 500', async () => {
    // The restore-preview batch reads every snapshot file via
    // Promise.all(snapshot.files.map(...)). A non-ENOENT read error (here a
    // directory sitting at the file path → EISDIR) used to reject the whole
    // batch and 500 the entire preview (§0.95 class). The validate-only preview
    // path now degrades the unreadable file to "absent" and still returns 200.
    const projectRoot = join(workspaceRoot, 'restore-preview-proj');
    mkdirSync(projectRoot, { recursive: true });
    // A real readable file (good) + a directory at a file path (EISDIR on read).
    writeFileSync(join(projectRoot, 'good.txt'), 'current good\n');
    mkdirSync(join(projectRoot, 'locked.txt'), { recursive: true });

    seedSession({ workingDirectory: projectRoot });
    snapshotStore.persistSessionSnapshot({
      sessionId: SESSION_ID,
      userId: USER_ID,
      snapshotRef: 'req:restore-preview-test',
      fileDiffs: [
        {
          file: 'good.txt',
          before: 'current good\n',
          after: 'restored good\n',
          additions: 1,
          deletions: 1,
          requestId: 'r1',
          toolName: 'write',
          status: 'modified',
        },
        {
          file: 'locked.txt',
          before: '',
          after: 'restored locked\n',
          additions: 1,
          deletions: 0,
          requestId: 'r1',
          toolName: 'write',
          status: 'modified',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${SESSION_ID}/restore/preview`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { snapshotRef: 'req:restore-preview-test', includeText: true },
      });

      // Must not 500 because one file (locked.txt) is unreadable (EISDIR).
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.validateOnly).toBe(true);
      expect(body.mode).toBe('snapshot');
      // Both files still appear in the preview; the unreadable one degrades to
      // "absent" (validPath true, currentExists false) rather than aborting.
      expect(body.validation.fileCount).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('DELETE /sessions/:id 级联删除经 team_parent_session_id 关联的团队子会话（§0.146）', async () => {
    // reception 根 + 经 team_parent_session_id 列（非 metadata.parentSessionId）关联的
    // pm1/pm2 子会话。createTeamSession 只写该列、从不写 metadata.parentSessionId；
    // 修复前 buildSessionDeletionRows 只跟 metadata.parentSessionId，会只删根、孤立子会话。
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer)
       VALUES ('s146-reception', ?, 'reception', '{}', 'idle', 'reception')`,
      [USER_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id)
       VALUES ('s146-pm1', ?, 'pm1', '{}', 'idle', 'pm1', 's146-reception')`,
      [USER_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id)
       VALUES ('s146-pm2', ?, 'pm2', '{}', 'idle', 'pm2', 's146-pm1')`,
      [USER_ID],
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/sessions/s146-reception',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const deletedIds = response.json().deletedSessionIds as string[];
      // 根 + 两层 team 子会话全部进入删除集。
      expect(deletedIds).toEqual(
        expect.arrayContaining(['s146-reception', 's146-pm1', 's146-pm2']),
      );

      // DB 中三行都不复存在——没有孤立的团队子会话残留。
      const remaining = dbModule.sqliteGet<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sessions WHERE id IN ('s146-reception','s146-pm1','s146-pm2')",
        [],
      );
      expect(remaining?.n).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/status 返回当前会话 workflowRuntime 供轻量轮询同步', async () => {
    seedSession({
      activeWorkflowPlanPath: '.agentdocs/workflow/260706-lazycodex-native-workflow.md',
      activeWorkflowPlanProgress: '2/8',
      activeWorkflowPlanTitle: 'LazyCodex/OmO 原生化接入工作流',
      workflowRuntimeEvidenceArtifactRefs: ['artifact-1'],
      workflowRuntimeEvidenceStatus: 'available',
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/status`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const status = response.json().status as {
        workflowRuntime?: {
          activePlan?: { path?: string; progress?: string; title?: string };
          evidence: { artifactRefs: string[]; status: string };
          mode: string;
        };
      };

      expect(status.workflowRuntime).toEqual({
        mode: 'execution',
        activePlan: {
          path: '.agentdocs/workflow/260706-lazycodex-native-workflow.md',
          progress: '2/8',
          title: 'LazyCodex/OmO 原生化接入工作流',
        },
        evidence: {
          artifactRefs: ['artifact-1'],
          status: 'available',
        },
      });
    } finally {
      await app.close();
    }
  });
});
