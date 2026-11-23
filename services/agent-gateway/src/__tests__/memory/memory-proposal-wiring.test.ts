/**
 * 261101-记忆确认写入与周期整理：记忆写入接线回归。
 *
 * 验证「所有正式写入入口一律只产生提议、唯一写入门是确认路由」这条主线：
 *   1. 自动 / 手动抽取 → 只建提议，memories 表无新增；
 *   2. 含临时 / 一次性语义的候选 → 连提议都不建；
 *   3. 渠道会话按作用域白名单注入，不注入 owner 个人记忆；个人会话可注入；
 *   4. 确认路由 approve → 记忆真正落库（confirmationKind='proposal'）；
 *   5. 同一条提议二次 approve → 失败且不产生第二条记忆；
 *   6. memory_manage 工具 add → 返回 pending_confirmation 且记忆表无变化；
 *   7. 团队 knowledge 路由写入 → 记忆表无变化、有提议；
 *   8. PUT /memories/:id 人工保存直接生效且 revision 递增；
 *   9. 非本人 approve → 403。
 *
 * 真实内存 SQLite（DATABASE_URL=:memory: + migrate）+ Fastify inject。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as MemoriesRoutesModule from '../../routes/memories.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as MemoryRuntimeModule from '../../memory/memory-runtime.js';
import type * as AdminModule from '../../memory/memory-admin-tools.js';
import type * as TeamPhaseARoutesModule from '../../routes/team-phase-a.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let memoriesRoutes: typeof MemoriesRoutesModule.memoriesRoutes;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let memoryRuntime: typeof MemoryRuntimeModule;
let admin: typeof AdminModule;
let teamPhaseARoutes: typeof TeamPhaseARoutesModule.teamPhaseARoutes;

const USER_ID = 'u-wiring';
const OTHER_USER_ID = 'u-wiring-other';
const TEAM_WORKSPACE_ID = 'tw-wiring';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(memoriesRoutes);
  await app.register(teamPhaseARoutes);
  await app.ready();
  return app;
}

function bearerFor(app: FastifyInstance, userId: string): string {
  return `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`;
}

function countMemories(userId = USER_ID): number {
  return (
    dbModule.sqliteGet<{ n: number }>('SELECT COUNT(*) AS n FROM memories WHERE user_id = ?', [
      userId,
    ])?.n ?? 0
  );
}

function countPendingProposals(userId = USER_ID): number {
  return (
    dbModule.sqliteGet<{ n: number }>(
      "SELECT COUNT(*) AS n FROM memory_proposals WHERE user_id = ? AND status = 'pending'",
      [userId],
    )?.n ?? 0
  );
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  memoriesRoutes = (await import('../../routes/memories.js')).memoriesRoutes;
  memoryRuntime = await import('../../memory/memory-runtime.js');
  admin = await import('../../memory/memory-admin-tools.js');
  teamPhaseARoutes = (await import('../../routes/team-phase-a.js')).teamPhaseARoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM memory_revisions', []);
  dbModule.sqliteRun('DELETE FROM memory_proposals', []);
  dbModule.sqliteRun('DELETE FROM memory_extraction_logs', []);
  dbModule.sqliteRun('DELETE FROM memories', []);
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM team_workspaces', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedUser(OTHER_USER_ID);
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO team_workspaces (id, user_id, name) VALUES (?, ?, '接线工作区')`,
    [TEAM_WORKSPACE_ID, USER_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('记忆写入接线 · 抽取只提议', () => {
  it('POST /memories/extract 只建提议：memories 无新增、memory_proposals 有 pending', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/memories/extract',
        headers: { authorization: bearerFor(app, USER_ID), 'content-type': 'application/json' },
        payload: { text: '请记住：以后默认使用 TypeScript 的严格模式。' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { proposed: number; candidates: number };
      expect(body.proposed).toBeGreaterThan(0);
      expect(countMemories()).toBe(0);
      expect(countPendingProposals()).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('自动抽取中含「这次/临时」的候选不产生提议（连提议都没有）', async () => {
    // 自动抽取路径（origin: auto_extract）才走「值不值得问」过滤；用户显式点「立即
    // 抽取」属 manual_extract，刻意不过滤。这里直接驱动抽取存储验证自动语义。
    const extractionStore = await import('../../memory/memory-extraction-store.js');
    const settings = {
      enabled: true,
      autoExtract: true,
      maxTokenBudget: 2000,
      minConfidence: 0.3,
      autoWriteMinConfidence: 0.65,
      reviewLowConfidence: true,
    };

    const result = extractionStore.upsertExtractedMemories(
      USER_ID,
      [
        {
          type: 'fact',
          key: 'debug.port',
          value: '这次先临时把端口改成 4000，等下就改回来。',
          confidence: 0.9,
        },
      ],
      null,
      settings,
      { origin: 'auto_extract' },
    );

    expect(result.proposed).toBe(0);
    expect(result.transient).toBe(1);
    expect(countMemories()).toBe(0);
    expect(countPendingProposals()).toBe(0);
  });
});

describe('记忆注入 · 作用域白名单', () => {
  function seedUserScopedMemory(userId: string, key: string, value: string): void {
    dbModule.sqliteRun(
      `INSERT INTO memories (id, user_id, type, key, value, source, confidence, priority, enabled,
                             created_at, updated_at, scope_type, scope_id, lifecycle, revision, change_seq)
       VALUES (?, ?, 'preference', ?, ?, 'manual', 1.0, 50, 1, datetime('now'), datetime('now'),
               'user', ?, 'active', 1, 1)`,
      [`mem-${userId}-${key}`, userId, key, value, userId],
    );
  }

  it('渠道会话不注入 owner 个人记忆；个人会话可注入', () => {
    seedUserScopedMemory(USER_ID, 'editor', '用户偏好 Vim 键位');

    const personalBlock = memoryRuntime.buildMemoryBlockForSession(USER_ID, JSON.stringify({}));
    expect(personalBlock).not.toBeNull();
    expect(personalBlock).toContain('Vim');

    const channelMetadata = JSON.stringify({ source: 'channel', channelMessageId: 'm-1' });
    const channelBlock = memoryRuntime.buildMemoryBlockForSession(USER_ID, channelMetadata);
    expect(channelBlock).toBeNull();
  });
});

describe('记忆确认路由', () => {
  it('approve 后记忆真正落库（confirmationKind=proposal），第二次 approve 失败', async () => {
    const app = await buildApp();
    try {
      const auth = bearerFor(app, USER_ID);
      const extract = await app.inject({
        method: 'POST',
        url: '/memories/extract',
        headers: { authorization: auth, 'content-type': 'application/json' },
        payload: { text: '请记住：以后默认使用 TypeScript 的严格模式。' },
      });
      expect(extract.statusCode).toBe(200);

      const list = await app.inject({
        method: 'GET',
        url: '/memories/proposals?status=pending',
        headers: { authorization: auth },
      });
      const proposals = (list.json() as { proposals: Array<{ id: string }> }).proposals;
      expect(proposals.length).toBeGreaterThan(0);
      const proposalId = proposals[0]!.id;

      const approve = await app.inject({
        method: 'POST',
        url: `/memories/proposals/${proposalId}/decision`,
        headers: { authorization: auth, 'content-type': 'application/json' },
        payload: { decision: 'approve' },
      });
      expect(approve.statusCode).toBe(200);
      expect(approve.json()).toMatchObject({ ok: true });
      expect(countMemories()).toBe(1);

      const row = dbModule.sqliteGet<{ confirmation_kind: string }>(
        'SELECT confirmation_kind FROM memories WHERE user_id = ?',
        [USER_ID],
      );
      expect(row?.confirmation_kind).toBe('proposal');

      // 二次 approve：提议已非 pending ⇒ 失败，且不产生第二条记忆。
      const second = await app.inject({
        method: 'POST',
        url: `/memories/proposals/${proposalId}/decision`,
        headers: { authorization: auth, 'content-type': 'application/json' },
        payload: { decision: 'approve' },
      });
      expect(second.statusCode).toBeGreaterThanOrEqual(400);
      expect(countMemories()).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('非本人 approve → 403 memory_proposal_forbidden', async () => {
    const app = await buildApp();
    try {
      const ownerAuth = bearerFor(app, USER_ID);
      await app.inject({
        method: 'POST',
        url: '/memories/extract',
        headers: { authorization: ownerAuth, 'content-type': 'application/json' },
        payload: { text: '请记住：以后默认使用 TypeScript 的严格模式。' },
      });
      const list = await app.inject({
        method: 'GET',
        url: '/memories/proposals?status=pending',
        headers: { authorization: ownerAuth },
      });
      const proposalId = (list.json() as { proposals: Array<{ id: string }> }).proposals[0]!.id;

      const response = await app.inject({
        method: 'POST',
        url: `/memories/proposals/${proposalId}/decision`,
        headers: {
          authorization: bearerFor(app, OTHER_USER_ID),
          'content-type': 'application/json',
        },
        payload: { decision: 'approve' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'memory_proposal_forbidden' });
      expect(countMemories()).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe('memory_manage 工具 · 只提议', () => {
  it('add → 返回 pending_confirmation 且记忆表无变化', async () => {
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES ('s-tool', ?, 'demo', '{}', 'idle')`,
      [USER_ID],
    );
    const output = await admin.runMemoryManageTool({
      userId: USER_ID,
      sessionId: 's-tool',
      input: admin.memoryManageInputSchema.parse({
        action: 'add',
        memory: { type: 'preference', key: 'editor', value: '用户偏好 Vim 键位' },
      }),
    });
    const parsed = JSON.parse(output) as { status: string; proposalId?: string };
    expect(parsed.status).toBe('pending_confirmation');
    expect(typeof parsed.proposalId).toBe('string');
    expect(countMemories()).toBe(0);
    expect(countPendingProposals()).toBe(1);
  });
});

describe('团队知识写入 · 人工直接保存', () => {
  it('POST /team/workspaces/:id/knowledge 是人工路径：直接落库、不产生提议', async () => {
    dbModule.sqliteRun(
      `INSERT OR IGNORE INTO team_workspaces (id, user_id, name, default_working_root)
       VALUES (?, ?, '接线工作区', '/workspace/wiring')`,
      [TEAM_WORKSPACE_ID, USER_ID],
    );
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/team/workspaces/${TEAM_WORKSPACE_ID}/knowledge`,
        headers: { authorization: bearerFor(app, USER_ID), 'content-type': 'application/json' },
        payload: { type: 'project_context', key: 'arch:layers', value: '分层架构说明' },
      });

      // 人工表单完整展示内容与范围后点击保存 = 该次明确提交，不二次追问。
      expect(response.statusCode).toBe(201);
      const body = response.json() as { created: boolean; knowledge: { id: string } };
      expect(body.created).toBe(true);
      expect(countMemories()).toBe(1);
      expect(countPendingProposals()).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe('人工保存路径 · 直接生效', () => {
  it('PUT /memories/:id 直接生效且 revision 递增', async () => {
    const app = await buildApp();
    try {
      const auth = bearerFor(app, USER_ID);
      const created = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: auth, 'content-type': 'application/json' },
        payload: { type: 'fact', key: 'lang', value: 'TypeScript' },
      });
      expect(created.statusCode).toBe(201);
      const memoryId = (created.json() as { memory: { id: string; revision: number } }).memory.id;

      const before = dbModule.sqliteGet<{ revision: number }>(
        'SELECT revision FROM memories WHERE id = ?',
        [memoryId],
      );

      const updated = await app.inject({
        method: 'PUT',
        url: `/memories/${memoryId}`,
        headers: { authorization: auth, 'content-type': 'application/json' },
        payload: { value: 'TypeScript strict' },
      });
      expect(updated.statusCode).toBe(200);
      // 人工保存不弹二次确认：立即生效。
      const after = dbModule.sqliteGet<{ value: string; revision: number }>(
        'SELECT value, revision FROM memories WHERE id = ?',
        [memoryId],
      );
      expect(after?.value).toBe('TypeScript strict');
      expect((after?.revision ?? 0) > (before?.revision ?? 0)).toBe(true);
      expect(countPendingProposals()).toBe(0);

      const history = await app.inject({
        method: 'GET',
        url: `/memories/revisions?memoryId=${memoryId}`,
        headers: { authorization: auth },
      });
      expect(history.statusCode).toBe(200);
      const { revisions } = history.json<{
        revisions: Array<{ id: string; after: { changeSeq?: number }; changeSeq?: number }>;
      }>();
      expect(revisions).toHaveLength(2);
      expect(revisions[0]).toMatchObject({
        origin: 'manual',
        before: { value: 'TypeScript' },
        after: { value: 'TypeScript strict' },
        payload: { value: 'TypeScript' },
      });
      expect(revisions[0]?.changeSeq).toBe(revisions[0]?.after.changeSeq);
      expect(revisions[1]).toMatchObject({ before: null, payload: null });

      const forbidden = await app.inject({
        method: 'GET',
        url: `/memories/revisions?memoryId=${memoryId}`,
        headers: { authorization: bearerFor(app, OTHER_USER_ID) },
      });
      expect(forbidden.json()).toEqual({ revisions: [] });
      const staleRollback = await app.inject({
        method: 'POST',
        url: `/memories/revisions/${revisions[1]!.id}/rollback`,
        headers: { authorization: auth },
      });
      expect(staleRollback.statusCode).toBeGreaterThanOrEqual(400);
      const rollback = await app.inject({
        method: 'POST',
        url: `/memories/revisions/${revisions[0]!.id}/rollback`,
        headers: { authorization: auth },
      });
      expect(rollback.statusCode).toBe(200);
      expect(rollback.json()).toMatchObject({ ok: true, memory: { value: 'TypeScript' } });

      for (const snapshot of [
        '{invalid-json',
        JSON.stringify({
          id: memoryId,
          userId: OTHER_USER_ID,
          key: 'secret',
          value: '不应泄露',
          enabled: true,
        }),
        JSON.stringify({
          id: 'another-memory',
          userId: USER_ID,
          key: 'secret',
          value: '不应泄露',
          enabled: true,
        }),
        JSON.stringify({ id: memoryId, userId: USER_ID, key: 'broken', enabled: true }),
      ]) {
        dbModule.sqliteRun('UPDATE memory_revisions SET before_json = ? WHERE memory_id = ?', [
          snapshot,
          memoryId,
        ]);
        const invalidHistory = await app.inject({
          method: 'GET',
          url: `/memories/revisions?memoryId=${memoryId}`,
          headers: { authorization: auth },
        });
        expect(invalidHistory.statusCode).toBe(200);
        expect(invalidHistory.json()).toEqual({ revisions: [] });
      }
    } finally {
      await app.close();
    }
  });
});
