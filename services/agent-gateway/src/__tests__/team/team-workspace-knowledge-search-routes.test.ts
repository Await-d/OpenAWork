import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamPhaseARoutesModule from '../../routes/team-phase-a.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamPhaseARoutes: typeof TeamPhaseARoutesModule.teamPhaseARoutes;

const USER_ID = 'u-team-knowledge-search';
const TEAM_WORKSPACE_ID = 'tw-knowledge-search';

interface KnowledgeListBody {
  knowledge: Array<{ key: string; type: string }>;
}

interface KnowledgeUpsertBody {
  created: boolean;
  knowledge: {
    id: string;
    key: string;
    roleLayers: string[] | null;
    teamWorkspaceId: string | null;
    value: string;
    workspaceRoot: string | null;
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamPhaseARoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  const token = app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
  return `Bearer ${token}`;
}

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedTeamWorkspace(workspaceId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO team_workspaces (id, user_id, name) VALUES (?, ?, '知识搜索工作区')`,
    [workspaceId, userId],
  );
}

async function createKnowledge(
  app: FastifyInstance,
  payload: {
    key: string;
    roleLayers?: Array<'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer'> | null;
    type: 'preference' | 'fact' | 'instruction' | 'project_context' | 'learned_pattern';
    value: string;
  },
): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: `/team/workspaces/${TEAM_WORKSPACE_ID}/knowledge`,
    headers: { authorization: bearer(app) },
    payload,
  });
  expect(res.statusCode).toBe(201);
}

async function listKnowledgeKeys(
  app: FastifyInstance,
  search: string,
  options: { roleLayer?: 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer' } = {},
): Promise<string[]> {
  const params = new URLSearchParams();
  params.set('search', search);
  if (options.roleLayer) {
    params.set('roleLayer', options.roleLayer);
  }
  const res = await app.inject({
    method: 'GET',
    url: `/team/workspaces/${TEAM_WORKSPACE_ID}/knowledge?${params.toString()}`,
    headers: { authorization: bearer(app) },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as KnowledgeListBody;
  return body.knowledge.map((item) => item.key);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  const auth = await import('../../infra/auth.js');
  authPlugin = auth.default;
  const requestWorkflow = await import('../../runtime/request-workflow.js');
  requestWorkflowPlugin = requestWorkflow.default;
  const team = await import('../../routes/team-phase-a.js');
  teamPhaseARoutes = team.teamPhaseARoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'team-knowledge-search@example.com');
  seedTeamWorkspace(TEAM_WORKSPACE_ID, USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('GET /team/workspaces/:id/knowledge search aliases', () => {
  it('支持图谱界面里的记忆、宪法和工作区知识语义词', async () => {
    const app = await buildApp();
    try {
      await createKnowledge(app, {
        key: 'manual:project-root',
        type: 'project_context',
        value: '模块边界说明。',
      });
      await createKnowledge(app, {
        key: 'manual:user-language',
        type: 'preference',
        value: '默认使用中文回复。',
      });
      await createKnowledge(app, {
        key: 'manual:constitution-rule',
        type: 'instruction',
        value: '所有变更需要复查。',
      });
      await createKnowledge(app, {
        key: 'manual:release-fact',
        type: 'fact',
        value: '仓库采用 pnpm。',
      });
      await createKnowledge(app, {
        key: 'manual:review-pattern',
        type: 'learned_pattern',
        value: '复查时从页面、用户和实现多角度检查。',
      });

      await expect(listKnowledgeKeys(app, '个人记忆')).resolves.toEqual(['manual:user-language']);
      await expect(listKnowledgeKeys(app, '项目记忆')).resolves.toEqual(['manual:project-root']);
      await expect(listKnowledgeKeys(app, '团队宪法')).resolves.toEqual([
        'manual:constitution-rule',
      ]);

      const memoryKeys = await listKnowledgeKeys(app, '记忆');
      expect(memoryKeys).toEqual(
        expect.arrayContaining([
          'manual:project-root',
          'manual:user-language',
          'manual:release-fact',
          'manual:review-pattern',
        ]),
      );
      expect(memoryKeys).not.toContain('manual:constitution-rule');

      const englishMemoryKeys = await listKnowledgeKeys(app, 'memory');
      expect(englishMemoryKeys).toEqual(
        expect.arrayContaining([
          'manual:project-root',
          'manual:user-language',
          'manual:release-fact',
          'manual:review-pattern',
        ]),
      );
      expect(englishMemoryKeys).not.toContain('manual:constitution-rule');

      await expect(listKnowledgeKeys(app, '知识')).resolves.toHaveLength(5);
      await expect(listKnowledgeKeys(app, '工作区知识')).resolves.toHaveLength(5);
      await expect(listKnowledgeKeys(app, '知识库')).resolves.toHaveLength(5);
      await expect(listKnowledgeKeys(app, '知识资产')).resolves.toHaveLength(5);
      await expect(listKnowledgeKeys(app, '知识图谱')).resolves.toHaveLength(5);
      await expect(listKnowledgeKeys(app, '全量知识')).resolves.toHaveLength(5);
      await expect(listKnowledgeKeys(app, '完整图谱')).resolves.toHaveLength(5);
    } finally {
      await app.close();
    }
  });

  it('架构和产物搜索不会泛化返回全部项目上下文知识', async () => {
    const app = await buildApp();
    try {
      await createKnowledge(app, {
        key: 'manual:product-boundary',
        type: 'project_context',
        value: '普通项目上下文。',
      });
      await createKnowledge(app, {
        key: 'manual:archive-policy',
        type: 'project_context',
        value: '归档策略。',
      });
      await createKnowledge(app, {
        key: 'manual:arch-boundary',
        type: 'project_context',
        value: '模块边界。',
      });
      await createKnowledge(app, {
        key: 'manual:architecture-boundary',
        type: 'project_context',
        value: '网关统一出入口。',
      });
      await createKnowledge(app, {
        key: 'manual:artifact-plan',
        type: 'project_context',
        value: '实施计划。',
      });
      await createKnowledge(app, {
        key: 'artifact:spec-1',
        type: 'project_context',
        value: '需求规格。',
      });
      await createKnowledge(app, {
        key: 'manual:release-fact',
        type: 'fact',
        value: '发布事实。',
      });

      const projectContextKeys = await listKnowledgeKeys(app, '项目上下文');
      expect(projectContextKeys).toEqual(
        expect.arrayContaining([
          'artifact:spec-1',
          'manual:arch-boundary',
          'manual:architecture-boundary',
          'manual:archive-policy',
          'manual:artifact-plan',
          'manual:product-boundary',
        ]),
      );
      await expect(listKnowledgeKeys(app, '架构')).resolves.toEqual([
        'manual:arch-boundary',
        'manual:architecture-boundary',
      ]);
      await expect(listKnowledgeKeys(app, 'arch')).resolves.toEqual([
        'manual:arch-boundary',
        'manual:architecture-boundary',
      ]);
      await expect(listKnowledgeKeys(app, '产物')).resolves.toEqual([
        'artifact:spec-1',
        'manual:artifact-plan',
      ]);
      await expect(listKnowledgeKeys(app, 'fact')).resolves.toEqual(['manual:release-fact']);
    } finally {
      await app.close();
    }
  });

  it('记忆搜索不会把产物和架构 key 的项目上下文当作记忆', async () => {
    const app = await buildApp();
    try {
      await createKnowledge(app, {
        key: 'manual:project-root',
        type: 'project_context',
        value: '模块边界说明。',
      });
      await createKnowledge(app, {
        key: 'artifact:spec-1',
        type: 'project_context',
        value: '需求规格。',
      });
      await createKnowledge(app, {
        key: 'manual:artifact-plan',
        type: 'project_context',
        value: '实施计划。',
      });
      await createKnowledge(app, {
        key: 'manual:architecture-boundary',
        type: 'project_context',
        value: '网关统一出入口。',
      });

      await expect(listKnowledgeKeys(app, 'memory')).resolves.toEqual(['manual:project-root']);
      await expect(listKnowledgeKeys(app, '记忆')).resolves.toEqual(['manual:project-root']);
      await expect(listKnowledgeKeys(app, '项目记忆')).resolves.toEqual(['manual:project-root']);
    } finally {
      await app.close();
    }
  });

  it('层级词只按指定层级范围过滤，不被正文同词误触发', async () => {
    const app = await buildApp();
    try {
      await createKnowledge(app, {
        key: 'manual:global-context',
        type: 'project_context',
        value: '所有层级都可读取的工作区知识。',
      });
      await createKnowledge(app, {
        key: 'manual:pm1-context',
        roleLayers: ['pm1'],
        type: 'project_context',
        value: 'PM1 层专用规划约束。',
      });
      await createKnowledge(app, {
        key: 'manual:executor-context',
        roleLayers: ['executor'],
        type: 'project_context',
        value: '执行层专用实现约束。',
      });
      await createKnowledge(app, {
        key: 'manual:reviewer-note',
        roleLayers: ['reviewer'],
        type: 'project_context',
        value: '正文提到 PM1，但这条知识只给评审层读取。',
      });

      await expect(listKnowledgeKeys(app, 'pm1')).resolves.toEqual(['manual:pm1-context']);
      await expect(listKnowledgeKeys(app, '执行层')).resolves.toEqual(['manual:executor-context']);
      await expect(listKnowledgeKeys(app, '全部层级')).resolves.toEqual(['manual:global-context']);
      await expect(listKnowledgeKeys(app, '执行层', { roleLayer: 'executor' })).resolves.toEqual([
        'manual:executor-context',
      ]);
      await expect(listKnowledgeKeys(app, '知识', { roleLayer: 'executor' })).resolves.toEqual([
        'manual:executor-context',
        'manual:global-context',
      ]);
    } finally {
      await app.close();
    }
  });
});

describe('POST /team/workspaces/:id/knowledge scoped upsert', () => {
  it('同工作区根目录的旧版知识入库时会更新并绑定到团队工作区', async () => {
    const app = await buildApp();
    try {
      dbModule.sqliteRun('UPDATE team_workspaces SET default_working_root = ? WHERE id = ?', [
        '/workspace/openawork',
        TEAM_WORKSPACE_ID,
      ]);
      dbModule.sqliteRun(
        `INSERT INTO memories
          (id, user_id, type, key, value, source, confidence, priority, workspace_root, team_workspace_id, role_layers_json, enabled, created_at, updated_at)
         VALUES (?, ?, 'project_context', ?, ?, 'auto_extracted', 0.8, 40, ?, NULL, NULL, 1, datetime('now'), datetime('now'))`,
        [
          'legacy-root-knowledge',
          USER_ID,
          'artifact:legacy-spec',
          '旧版同根目录知识。',
          '/workspace/openawork',
        ],
      );

      const res = await app.inject({
        method: 'POST',
        url: `/team/workspaces/${TEAM_WORKSPACE_ID}/knowledge`,
        headers: { authorization: bearer(app) },
        payload: {
          key: 'artifact:legacy-spec',
          roleLayers: ['executor'],
          type: 'project_context',
          value: '更新后的团队工作区知识。',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as KnowledgeUpsertBody;
      expect(body.created).toBe(false);
      expect(body.knowledge).toMatchObject({
        id: 'legacy-root-knowledge',
        key: 'artifact:legacy-spec',
        roleLayers: ['executor'],
        teamWorkspaceId: TEAM_WORKSPACE_ID,
        value: '更新后的团队工作区知识。',
        workspaceRoot: '/workspace/openawork',
      });
    } finally {
      await app.close();
    }
  });
});
