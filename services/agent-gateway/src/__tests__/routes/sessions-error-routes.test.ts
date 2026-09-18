import Fastify, { type FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  promises as fsp,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';
import type * as SessionFileDiffStoreModule from '../../session/session-file-diff-store.js';
import type * as SessionFileReviewDecisionStoreModule from '../../session/session-file-review-decision-store.js';
import type * as SessionSnapshotStoreModule from '../../session/session-snapshot-store.js';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-sessions-routes-'));
const outsideRoot = mkdtempSync(join(tmpdir(), 'openawork-sessions-outside-'));
const dataDir = mkdtempSync(join(tmpdir(), 'openawork-sessions-routes-data-'));
const SESSION_ID = 'sess-error-routes';
const USER_ID = 'u-session-error-routes';

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'session-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['OPENAWORK_DATA_DIR'] = dataDir;
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let fileDiffStore: typeof SessionFileDiffStoreModule;
let reviewDecisionStore: typeof SessionFileReviewDecisionStoreModule;
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
  fileDiffStore = await import('../../session/session-file-diff-store.js');
  reviewDecisionStore = await import('../../session/session-file-review-decision-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM session_file_review_decisions', []);
  dbModule.sqliteRun('DELETE FROM session_file_diffs', []);
  dbModule.sqliteRun('DELETE FROM session_file_backups', []);
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
  rmSync(dataDir, { recursive: true, force: true });
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

function initGitRepo(root: string): void {
  execFileSync('git', ['init'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'review@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Review Test'], { cwd: root });
}

function reviewPayload(requestId: string, filePath: string, decision: 'accepted' | 'rejected') {
  return { requestId, filePath, decision };
}

function postReview(
  app: FastifyInstance,
  requestId: string,
  filePath: string,
  decision: 'accepted' | 'rejected',
  extra: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: `/sessions/${SESSION_ID}/file-changes/review`,
    headers: { authorization: bearer(app), 'content-type': 'application/json' },
    payload: { ...reviewPayload(requestId, filePath, decision), ...extra },
  });
}

describe('POST /sessions/:sessionId/file-changes/review', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('接受变更时只写决策行，不修改文件也不追加 diff', async () => {
    const projectRoot = join(workspaceRoot, 'review-accept');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'a.txt'), 'after content\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-accept',
      requestId: 'req-accept:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'a.txt',
          before: 'before content\n',
          after: 'after content\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-accept:tool:write', 'a.txt', 'accepted');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        decision: {
          requestId: 'req-accept:tool:write',
          filePath: 'a.txt',
          decision: 'accepted',
          createdAt: expect.any(String),
        },
        revertClientRequestId: null,
      });

      expect(readFileSync(join(projectRoot, 'a.txt'), 'utf8')).toBe('after content\n');
      const diffCount = dbModule.sqliteGet<{ count: number }>(
        'SELECT COUNT(*) as count FROM session_file_diffs WHERE session_id = ?',
        [SESSION_ID],
      )?.count;
      expect(diffCount).toBe(1);
      const decisions = reviewDecisionStore.listReviewDecisions({
        sessionId: SESSION_ID,
        userId: USER_ID,
      });
      expect(decisions).toHaveLength(1);
      expect(decisions[0]?.decision).toBe('accepted');
      expect(decisions[0]?.revertRequestId).toBeNull();

      const changesResponse = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/file-changes`,
        headers: { authorization: bearer(app) },
      });
      const changes = changesResponse.json().fileChanges as {
        fileDiffs: Array<{ file: string; reviewStatus?: string; revertRequestId?: string | null }>;
        summary: { acceptedCount?: number; rejectedCount?: number };
      };
      const reviewed = changes.fileDiffs.find((diff) => diff.file === 'a.txt');
      expect(reviewed?.reviewStatus).toBe('accepted');
      expect(reviewed?.revertRequestId).toBeNull();
      expect(changes.summary.acceptedCount).toBe(1);
      expect(changes.summary.rejectedCount).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('拒绝修改文件时把文件写回 before，并记录 manual_revert diff', async () => {
    const projectRoot = join(workspaceRoot, 'review-reject-modified');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'b.txt'), 'agent version\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-reject-mod',
      requestId: 'req-reject-mod:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'b.txt',
          before: 'original version\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-reject-mod:tool:write', 'b.txt', 'rejected');
      expect(response.statusCode).toBe(200);
      const body = response.json() as { revertClientRequestId: string | null };
      expect(body.revertClientRequestId).toMatch(/^file-revert-/);
      expect(readFileSync(join(projectRoot, 'b.txt'), 'utf8')).toBe('original version\n');

      const revertRows = dbModule.sqliteAll<{
        client_request_id: string;
        guarantee_level: string;
        source_kind: string;
      }>(
        `SELECT client_request_id, source_kind, guarantee_level FROM session_file_diffs
         WHERE session_id = ? AND source_kind = 'manual_revert'`,
        [SESSION_ID],
      );
      expect(revertRows).toHaveLength(1);
      expect(revertRows[0]?.client_request_id).toBe(body.revertClientRequestId);
      expect(revertRows[0]?.guarantee_level).toBe('strong');

      const decisionRows = dbModule.sqliteAll<{
        decision: string;
        revert_request_id: string | null;
      }>(
        `SELECT decision, revert_request_id FROM session_file_review_decisions
         WHERE session_id = ? AND request_id = ? AND file_path = ?`,
        [SESSION_ID, 'req-reject-mod:tool:write', 'b.txt'],
      );
      expect(decisionRows).toHaveLength(1);
      expect(decisionRows[0]?.decision).toBe('rejected');
      expect(decisionRows[0]?.revert_request_id).toBe(body.revertClientRequestId);

      const changesResponse = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/file-changes`,
        headers: { authorization: bearer(app) },
      });
      const changes = changesResponse.json().fileChanges as {
        fileDiffs: Array<{
          file: string;
          requestId?: string;
          reviewStatus?: string;
          revertRequestId?: string | null;
        }>;
        summary: { acceptedCount?: number; rejectedCount?: number };
      };
      const reviewed = changes.fileDiffs.find(
        (diff) => diff.requestId === 'req-reject-mod:tool:write',
      );
      expect(reviewed?.reviewStatus).toBe('rejected');
      expect(reviewed?.revertRequestId).toBe(body.revertClientRequestId);
      expect(changes.summary.rejectedCount).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('拒绝新增文件时删除该文件', async () => {
    const projectRoot = join(workspaceRoot, 'review-reject-added');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'c.txt'), 'brand new\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-reject-added',
      requestId: 'req-reject-added:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'c.txt',
          before: '',
          after: 'brand new\n',
          additions: 1,
          deletions: 0,
          status: 'added',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-reject-added:tool:write', 'c.txt', 'rejected');
      expect(response.statusCode).toBe(200);
      expect(existsSync(join(projectRoot, 'c.txt'))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('拒绝删除文件时用 before 内容重建文件', async () => {
    const projectRoot = join(workspaceRoot, 'review-reject-deleted');
    mkdirSync(projectRoot, { recursive: true });
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-reject-deleted',
      requestId: 'req-reject-deleted:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'd.txt',
          before: 'gone content\n',
          after: '',
          additions: 0,
          deletions: 1,
          status: 'deleted',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-reject-deleted:tool:write', 'd.txt', 'rejected');
      expect(response.statusCode).toBe(200);
      expect(readFileSync(join(projectRoot, 'd.txt'), 'utf8')).toBe('gone content\n');
    } finally {
      await app.close();
    }
  });

  it('内容与 after 一致时即使 git 工作区脏也允许撤销（内容优先）', async () => {
    const projectRoot = join(workspaceRoot, 'review-conflict');
    mkdirSync(projectRoot, { recursive: true });
    initGitRepo(projectRoot);
    writeFileSync(join(projectRoot, 'e.txt'), 'baseline\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: projectRoot });
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: projectRoot });
    writeFileSync(join(projectRoot, 'e.txt'), 'dirty leftover\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-conflict',
      requestId: 'req-conflict:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'e.txt',
          before: 'original\n',
          after: 'dirty leftover\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-conflict:tool:write', 'e.txt', 'rejected');
      expect(response.statusCode).toBe(200);
      expect(readFileSync(join(projectRoot, 'e.txt'), 'utf8')).toBe('original\n');
      const decisions = reviewDecisionStore.listReviewDecisions({
        sessionId: SESSION_ID,
        userId: USER_ID,
      });
      expect(decisions).toHaveLength(1);
      expect(decisions[0]?.decision).toBe('rejected');
    } finally {
      await app.close();
    }
  });

  it('forceConflicts 为 true 时内容冲突也能完成撤销', async () => {
    const projectRoot = join(workspaceRoot, 'review-force');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'f.txt'), 'human edit\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-force',
      requestId: 'req-force:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'f.txt',
          before: 'original\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const blocked = await postReview(app, 'req-force:tool:write', 'f.txt', 'rejected');
      expect(blocked.statusCode).toBe(409);

      const response = await postReview(app, 'req-force:tool:write', 'f.txt', 'rejected', {
        forceConflicts: true,
      });
      expect(response.statusCode).toBe(200);
      expect(readFileSync(join(projectRoot, 'f.txt'), 'utf8')).toBe('original\n');
    } finally {
      await app.close();
    }
  });

  it('弱可信度变更拒绝撤销时返回中文 400 且不改文件', async () => {
    const projectRoot = join(workspaceRoot, 'review-weak');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'g.txt'), 'agent version\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-weak',
      requestId: 'req-weak:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'g.txt',
          before: 'original\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'workspace_reconcile',
          guaranteeLevel: 'weak',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-weak:tool:write', 'g.txt', 'rejected');
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: { message: '该文件变更可信度不足，无法安全撤销。' },
      });
      expect(readFileSync(join(projectRoot, 'g.txt'), 'utf8')).toBe('agent version\n');
    } finally {
      await app.close();
    }
  });

  it('缺少 before 内容时返回中文 400 而不是用空串覆盖', async () => {
    const projectRoot = join(workspaceRoot, 'review-no-before');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'h.txt'), 'agent version\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    dbModule.sqliteRun(
      `INSERT INTO session_file_diffs
        (session_id, user_id, client_request_id, request_id, tool_name, file_path, before_backup_id, after_backup_id, additions, deletions, status, source_kind, guarantee_level, created_at)
       VALUES (?, ?, NULL, ?, 'write', 'h.txt', NULL, NULL, 1, 1, 'modified', 'structured_tool_diff', 'strong', datetime('now'))`,
      [SESSION_ID, USER_ID, 'req-no-before:tool:write'],
    );

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-no-before:tool:write', 'h.txt', 'rejected');
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: { message: '该文件变更缺少可恢复的原始内容，无法安全撤销。' },
      });
      expect(readFileSync(join(projectRoot, 'h.txt'), 'utf8')).toBe('agent version\n');
    } finally {
      await app.close();
    }
  });

  it('目标 diff 行不存在时返回中文 400', async () => {
    seedSession();
    const app = await buildApp();
    try {
      const response = await postReview(app, 'missing:tool:write', 'nope.txt', 'accepted');
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: { message: '目标文件变更记录不存在。' },
      });
    } finally {
      await app.close();
    }
  });

  it('非会话所有者返回中文 404', async () => {
    seedUser('u-other-review');
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES ('sess-other-review', 'u-other-review', 'other', '{}', 'idle')`,
      [],
    );
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/sess-other-review/file-changes/review',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { requestId: 'req-other:tool:write', filePath: 'x.txt', decision: 'accepted' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        name: 'NotFound',
        data: { message: '目标会话不存在。' },
      });
    } finally {
      await app.close();
    }
  });

  it('非 git 工作区中内容与 after 不一致时返回 409 且不写决策、不改文件', async () => {
    const projectRoot = join(workspaceRoot, 'review-nongit-conflict');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'stale.txt'), 'newer human work\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-nongit',
      requestId: 'req-nongit:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'stale.txt',
          before: 'original\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-nongit:tool:write', 'stale.txt', 'rejected');
      expect(response.statusCode).toBe(409);
      const body = response.json() as {
        contentConflict: { expectedAfterAvailable: boolean; filePath: string };
        validateOnly: boolean;
        workspaceReview: { conflicts: Array<{ filePath: string }> };
      };
      expect(body.validateOnly).toBe(true);
      expect(body.contentConflict).toMatchObject({
        filePath: 'stale.txt',
        expectedAfterAvailable: true,
      });
      expect(body.workspaceReview.conflicts.map((conflict) => conflict.filePath)).toContain(
        'stale.txt',
      );
      expect(readFileSync(join(projectRoot, 'stale.txt'), 'utf8')).toBe('newer human work\n');
      expect(
        reviewDecisionStore.listReviewDecisions({ sessionId: SESSION_ID, userId: USER_ID }),
      ).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('工作区 warp 后拒绝旧工作区的变更行返回中文 400 且不改文件', async () => {
    const oldRoot = join(workspaceRoot, 'review-root-old');
    const newRoot = join(workspaceRoot, 'review-root-new');
    mkdirSync(oldRoot, { recursive: true });
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(join(oldRoot, 'warp.txt'), 'agent version\n', 'utf8');
    seedSession({ workingDirectory: newRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-warp',
      requestId: 'req-warp:tool:write',
      toolName: 'write',
      workspaceRoot: oldRoot,
      diffs: [
        {
          file: 'warp.txt',
          before: 'original\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-warp:tool:write', 'warp.txt', 'rejected');
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: { message: '该文件变更属于其他工作区，无法在当前会话工作区中撤销。' },
      });
      expect(readFileSync(join(oldRoot, 'warp.txt'), 'utf8')).toBe('agent version\n');
      expect(
        reviewDecisionStore.listReviewDecisions({ sessionId: SESSION_ID, userId: USER_ID }),
      ).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('会话运行中拒绝撤销时返回 409 且不改文件', async () => {
    const projectRoot = join(workspaceRoot, 'review-busy');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'busy.txt'), 'agent version\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    dbModule.sqliteRun("UPDATE sessions SET state_status = 'running' WHERE id = ?", [SESSION_ID]);
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-busy',
      requestId: 'req-busy:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'busy.txt',
          before: 'original\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-busy:tool:write', 'busy.txt', 'rejected');
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        name: 'Conflict',
        data: { message: '会话正在运行中，无法撤销文件变更，请等待当前回合结束后重试。' },
      });
      expect(readFileSync(join(projectRoot, 'busy.txt'), 'utf8')).toBe('agent version\n');
    } finally {
      await app.close();
    }
  });

  it('重复提交同一撤销请求只产生一条 manual_revert 行', async () => {
    const projectRoot = join(workspaceRoot, 'review-idempotent');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'idem.txt'), 'agent version\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-idem',
      requestId: 'req-idem:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'idem.txt',
          before: 'original\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const first = await postReview(app, 'req-idem:tool:write', 'idem.txt', 'rejected');
      const second = await postReview(app, 'req-idem:tool:write', 'idem.txt', 'rejected');
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const firstBody = first.json() as { revertClientRequestId: string | null };
      const secondBody = second.json() as { revertClientRequestId: string | null };
      expect(firstBody.revertClientRequestId).toMatch(/^file-revert-/);
      expect(secondBody.revertClientRequestId).toBe(firstBody.revertClientRequestId);

      const revertRows = dbModule.sqliteAll<{ count: number }>(
        `SELECT COUNT(*) as count FROM session_file_diffs
         WHERE session_id = ? AND source_kind = 'manual_revert'`,
        [SESSION_ID],
      );
      expect(revertRows[0]?.count).toBe(1);
      const decisionRows = dbModule.sqliteAll<{ count: number }>(
        `SELECT COUNT(*) as count FROM session_file_review_decisions
         WHERE session_id = ? AND request_id = ?`,
        [SESSION_ID, 'req-idem:tool:write'],
      );
      expect(decisionRows[0]?.count).toBe(1);
      expect(readFileSync(join(projectRoot, 'idem.txt'), 'utf8')).toBe('original\n');
    } finally {
      await app.close();
    }
  });

  it('符号链接指向工作区外时拒绝撤销', async () => {
    const projectRoot = join(workspaceRoot, 'review-symlink');
    const escapeTarget = join(outsideRoot, 'symlink-secret.txt');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(escapeTarget, 'agent version\n', 'utf8');
    symlinkSync(escapeTarget, join(projectRoot, 'link.txt'));
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-symlink',
      requestId: 'req-symlink:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'link.txt',
          before: 'original\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-symlink:tool:write', 'link.txt', 'rejected');
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: { message: '目标文件路径不在允许范围内。' },
      });
      expect(readFileSync(escapeTarget, 'utf8')).toBe('agent version\n');
    } finally {
      await app.close();
    }
  });

  it('绝对路径位于工作区外时拒绝撤销', async () => {
    const projectRoot = join(workspaceRoot, 'review-abs');
    const outsideFile = join(outsideRoot, 'absolute-escape.txt');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(outsideFile, 'agent version\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-abs',
      requestId: 'req-abs:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: outsideFile,
          before: 'original\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-abs:tool:write', outsideFile, 'rejected');
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: { message: '目标文件路径不在允许范围内。' },
      });
      expect(readFileSync(outsideFile, 'utf8')).toBe('agent version\n');
    } finally {
      await app.close();
    }
  });

  it('after 内容不可用时按冲突处理并要求强制覆盖', async () => {
    const projectRoot = join(workspaceRoot, 'review-after-missing');
    mkdirSync(projectRoot, { recursive: true });
    // On-disk content AND the fallback after are both '', so only the
    // `!expectedAfterAvailable` branch can produce the 409 here.
    writeFileSync(join(projectRoot, 'after-missing.txt'), '', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-after-missing',
      requestId: 'req-after-missing:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'after-missing.txt',
          before: 'original\n',
          after: '',
          additions: 0,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });
    dbModule.sqliteRun(
      `UPDATE session_file_diffs SET after_backup_id = NULL, backup_after_ref_json = NULL
       WHERE session_id = ? AND request_id = ? AND file_path = ?`,
      [SESSION_ID, 'req-after-missing:tool:write', 'after-missing.txt'],
    );

    const app = await buildApp();
    try {
      const blocked = await postReview(
        app,
        'req-after-missing:tool:write',
        'after-missing.txt',
        'rejected',
      );
      expect(blocked.statusCode).toBe(409);
      const blockedBody = blocked.json() as {
        contentConflict: { expectedAfterAvailable: boolean };
      };
      expect(blockedBody.contentConflict.expectedAfterAvailable).toBe(false);
      expect(readFileSync(join(projectRoot, 'after-missing.txt'), 'utf8')).toBe('');

      const forced = await postReview(
        app,
        'req-after-missing:tool:write',
        'after-missing.txt',
        'rejected',
        { forceConflicts: true },
      );
      expect(forced.statusCode).toBe(200);
      expect(readFileSync(join(projectRoot, 'after-missing.txt'), 'utf8')).toBe('original\n');
    } finally {
      await app.close();
    }
  });

  it('撤销后的 manual_revert 行 before 等于撤销前内容、after 等于目标内容', async () => {
    const projectRoot = join(workspaceRoot, 'review-chain');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'chain.txt'), 'agent version\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-chain',
      requestId: 'req-chain:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'chain.txt',
          before: 'original\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-chain:tool:write', 'chain.txt', 'rejected');
      expect(response.statusCode).toBe(200);
      const body = response.json() as { revertClientRequestId: string };
      const details = await fileDiffStore.getSessionFileDiffDetails({
        sessionId: SESSION_ID,
        userId: USER_ID,
        requestId: body.revertClientRequestId,
        filePath: 'chain.txt',
      });
      expect(details).not.toBeNull();
      expect(details?.diff.before).toBe('agent version\n');
      expect(details?.diff.after).toBe('original\n');
      expect(details?.beforeBackupContent).toBe('agent version\n');
      expect(details?.diff.sourceKind).toBe('manual_revert');
      expect(details?.diff.guaranteeLevel).toBe('strong');
    } finally {
      await app.close();
    }
  });

  it('决策已写入但回读失败时不得回滚文件（避免重放误报已撤销）', async () => {
    const projectRoot = join(workspaceRoot, 'review-decision-readback');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'readback.txt'), 'agent version\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-readback',
      requestId: 'req-readback:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'readback.txt',
          before: 'original\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    // Decision committed but read-back yields nothing: rolling the file back
    // here is what lets a replay falsely report "reverted".
    const readSpy = vi.spyOn(reviewDecisionStore, 'getReviewDecision').mockReturnValue(null);

    const app = await buildApp();
    try {
      const response = await postReview(app, 'req-readback:tool:write', 'readback.txt', 'rejected');
      expect(response.statusCode).toBe(200);
      expect(readFileSync(join(projectRoot, 'readback.txt'), 'utf8')).toBe('original\n');
      const revertRows = dbModule.sqliteAll<{ count: number }>(
        `SELECT COUNT(*) as count FROM session_file_diffs
         WHERE session_id = ? AND source_kind = 'manual_revert'`,
        [SESSION_ID],
      );
      expect(revertRows[0]?.count).toBe(1);
      expect(readSpy).toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('决策写入失败时回滚已写入的文件并删除孤儿 manual_revert 行', async () => {
    const projectRoot = join(workspaceRoot, 'review-m1-rollback');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'rollback.txt'), 'agent version\n', 'utf8');
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-m1-rollback',
      requestId: 'req-m1-rollback:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'rollback.txt',
          before: 'original\n',
          after: 'agent version\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const upsertSpy = vi
      .spyOn(reviewDecisionStore, 'upsertReviewDecision')
      .mockImplementation(() => {
        throw new Error('decision persist boom');
      });

    const app = await buildApp();
    try {
      const response = await postReview(
        app,
        'req-m1-rollback:tool:write',
        'rollback.txt',
        'rejected',
      );
      expect(response.statusCode).toBe(500);
      expect(readFileSync(join(projectRoot, 'rollback.txt'), 'utf8')).toBe('agent version\n');
      const revertRows = dbModule.sqliteAll<{ count: number }>(
        `SELECT COUNT(*) as count FROM session_file_diffs
         WHERE session_id = ? AND source_kind = 'manual_revert'`,
        [SESSION_ID],
      );
      expect(revertRows[0]?.count).toBe(0);
      expect(upsertSpy).toHaveBeenCalled();
      expect(
        reviewDecisionStore.listReviewDecisions({ sessionId: SESSION_ID, userId: USER_ID }),
      ).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('realpath 检查与写入之间被换成越界符号链接时拒绝撤销', async () => {
    const projectRoot = join(workspaceRoot, 'review-toctou');
    const outsideDir = join(outsideRoot, 'toctou-outside');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    seedSession({ workingDirectory: projectRoot });
    await fileDiffStore.persistSessionFileDiffs({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-toctou',
      requestId: 'req-toctou:tool:write',
      toolName: 'write',
      diffs: [
        {
          file: 'sub/newfile.txt',
          before: 'original\n',
          after: '',
          additions: 0,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });

    const targetSafePath = join(projectRoot, 'sub', 'newfile.txt');
    const originalReadFile = fsp.readFile;
    const callOriginalReadFile = originalReadFile as (
      target: string,
      options?: unknown,
    ) => Promise<unknown>;
    let targetReads = 0;
    const readFileReplacement = (async (target: unknown, options?: unknown) => {
      if (typeof target === 'string' && target === targetSafePath) {
        targetReads += 1;
        if (targetReads === 2) {
          // Swap the not-yet-existing parent for an out-of-root symlink in the
          // window between the realpath guard and the pre-write recheck; the
          // recheck still passes because the target content is absent ('' === '').
          rmSync(join(projectRoot, 'sub'), { recursive: true, force: true });
          symlinkSync(outsideDir, join(projectRoot, 'sub'));
        }
      }
      return callOriginalReadFile(target as string, options);
    }) as unknown as typeof fsp.readFile;
    fsp.readFile = readFileReplacement;

    const app = await buildApp();
    try {
      const response = await postReview(
        app,
        'req-toctou:tool:write',
        'sub/newfile.txt',
        'rejected',
      );
      expect(response.statusCode).toBe(400);
      expect(existsSync(join(outsideDir, 'newfile.txt'))).toBe(false);
      expect(existsSync(targetSafePath)).toBe(false);
    } finally {
      fsp.readFile = originalReadFile;
      await app.close();
    }
  });
});

describe('file-changes read model latestSnapshotRef', () => {
  it('revert 的 scope 快照不会顶替 request 快照成为 latestSnapshotRef', async () => {
    seedSession({ workingDirectory: workspaceRoot });
    snapshotStore.persistSessionSnapshot({
      sessionId: SESSION_ID,
      userId: USER_ID,
      snapshotRef: 'req:req-latest-turn',
      fileDiffs: [
        {
          file: 'turn.txt',
          before: 'a\n',
          after: 'b\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'structured_tool_diff',
          guaranteeLevel: 'strong',
        },
      ],
    });
    snapshotStore.persistSessionSnapshot({
      sessionId: SESSION_ID,
      userId: USER_ID,
      snapshotRef: 'scope:req-revert-latest',
      fileDiffs: [
        {
          file: 'turn.txt',
          before: 'b\n',
          after: 'a\n',
          additions: 1,
          deletions: 1,
          status: 'modified',
          sourceKind: 'manual_revert',
          guaranteeLevel: 'strong',
        },
      ],
    });
    // Make the scope snapshot strictly newest so the raw `snapshots[0]` (pre-fix)
    // would deterministically pick it.
    dbModule.sqliteRun(
      `UPDATE session_snapshots SET created_at = '2099-01-01 00:00:00'
       WHERE session_id = ? AND client_request_id = 'scope:req-revert-latest'`,
      [SESSION_ID],
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}`,
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
      const summary = (
        response.json().session as {
          fileChangesSummary: {
            latestSnapshotRef?: string;
            latestSnapshotScopeKind?: string;
            snapshotCount: number;
          };
        }
      ).fileChangesSummary;
      expect(summary.latestSnapshotRef).toBe('req:req-latest-turn');
      expect(summary.latestSnapshotScopeKind).toBe('request');
      expect(summary.snapshotCount).toBe(2);
    } finally {
      await app.close();
    }
  });
});
