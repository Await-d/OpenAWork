import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as PromptSnippetsRoutesModule from '../../routes/prompt-snippets.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let promptSnippetsRoutes: typeof PromptSnippetsRoutesModule.promptSnippetsRoutes;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;

const USER_ID = 'u-prompt-snippets-route';
const OTHER_USER_ID = 'u-prompt-snippets-route-other';
const OWN_GROUP_ID = 'g-prompt-own';
const OTHER_GROUP_ID = 'g-prompt-other';
const SNIPPET_ID = 'snippet-own';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(promptSnippetsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  return `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedGroup(groupId: string, userId: string, name = '默认分组'): void {
  dbModule.sqliteRun(
    `INSERT INTO prompt_snippet_groups (id, user_id, name, sort_order)
     VALUES (?, ?, ?, 0)`,
    [groupId, userId, name],
  );
}

function seedSnippet(snippetId: string, userId: string, groupId: string, title = '示例标题'): void {
  dbModule.sqliteRun(
    `INSERT INTO prompt_snippets (id, user_id, group_id, title, content, sort_order)
     VALUES (?, ?, ?, ?, '示例内容', 0)`,
    [snippetId, userId, groupId, title],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  promptSnippetsRoutes = (await import('../../routes/prompt-snippets.js')).promptSnippetsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM prompt_snippets', []);
  dbModule.sqliteRun('DELETE FROM prompt_snippet_groups', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedUser(OTHER_USER_ID);
  seedGroup(OWN_GROUP_ID, USER_ID, '我的分组');
  seedGroup(OTHER_GROUP_ID, OTHER_USER_ID, '别人的分组');
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('prompt snippets routes', () => {
  it('POST /prompt-snippets 拒绝写入其他用户的分组', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/prompt-snippets',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          groupId: OTHER_GROUP_ID,
          title: '跨用户写入',
          content: '不应该成功',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'prompt_snippet_group_not_found',
        error: '目标分组不存在。',
      });
      const count = dbModule.sqliteGet<{ c: number }>(
        'SELECT COUNT(*) AS c FROM prompt_snippets WHERE user_id = ?',
        [USER_ID],
      );
      expect(count?.c).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('PUT /prompt-snippets/:id 拒绝迁移到其他用户的分组', async () => {
    seedSnippet(SNIPPET_ID, USER_ID, OWN_GROUP_ID);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: `/prompt-snippets/${SNIPPET_ID}`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          groupId: OTHER_GROUP_ID,
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'prompt_snippet_group_not_found',
        error: '目标分组不存在。',
      });
      const row = dbModule.sqliteGet<{ group_id: string }>(
        'SELECT group_id FROM prompt_snippets WHERE id = ?',
        [SNIPPET_ID],
      );
      expect(row?.group_id).toBe(OWN_GROUP_ID);
    } finally {
      await app.close();
    }
  });

  it('PUT /prompt-snippets/groups/:groupId 对空分组名返回结构化错误', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: `/prompt-snippets/groups/${OWN_GROUP_ID}`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          name: '   ',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'prompt_snippet_group_name_required',
        error: '分组名称不能为空。',
      });
    } finally {
      await app.close();
    }
  });
});
