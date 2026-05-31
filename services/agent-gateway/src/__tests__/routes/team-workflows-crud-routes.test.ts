import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamWorkflowsCrudModule from '../../routes/team-workflows-crud.ts';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamWorkflowsCrudRoutes: typeof TeamWorkflowsCrudModule.teamWorkflowsCrudRoutes;

const USER_ID = 'u-team-workflow-route';
const OTHER_USER_ID = 'u-team-workflow-route-other';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamWorkflowsCrudRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  const token = app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
  return `Bearer ${token}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedWorkflowTemplate(workflowDbId: string, userId: string): void {
  const workflow = {
    id: 'workflow-demo',
    name: '演示工作流',
    description: 'desc',
    version: '1',
    source: 'custom',
    entryStepId: 'step-1',
    steps: [
      {
        id: 'step-1',
        roleLayer: 'reception',
        label: '接待',
        promptTemplate: 'hello',
        toolsets: [],
        handoffTargets: [],
        parallel: false,
        minInstances: 1,
        maxInstances: 1,
        gates: [],
        terminal: true,
      },
    ],
    defaultBindings: {},
    tags: [],
  };
  dbModule.sqliteRun(
    `INSERT INTO workflow_templates (id, user_id, name, category, metadata_json, nodes_json, edges_json)
     VALUES (?, ?, ?, 'team-playbook', ?, '[]', '[]')`,
    [workflowDbId, userId, workflow.name, JSON.stringify({ teamWorkflow: workflow })],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  teamWorkflowsCrudRoutes = (await import('../../routes/team-workflows-crud.js'))
    .teamWorkflowsCrudRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM workflow_templates', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedUser(OTHER_USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('team workflows crud routes', () => {
  it('POST /team/workflows 在工作流非法时返回结构化 400', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/team/workflows',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          workflow: {
            id: 'wf-invalid',
            name: '非法工作流',
            description: 'desc',
            version: '1',
            source: 'custom',
            entryStepId: 'step-1',
            steps: [
              {
                id: 'step-1',
                roleLayer: 'reception',
                label: '接待',
                promptTemplate: 'hello',
                toolsets: [],
                handoffTargets: [],
                parallel: false,
                minInstances: 1,
                maxInstances: 1,
                gates: [],
                terminal: false,
              },
            ],
            defaultBindings: {},
            tags: [],
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'team_workflow_invalid',
        error: '团队工作流配置无效。',
      });
    } finally {
      await app.close();
    }
  });

  it('PUT /team/workflows/:workflowDbId 对其他用户资源返回结构化 404', async () => {
    seedWorkflowTemplate('wf-other', OTHER_USER_ID);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/team/workflows/wf-other',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          workflow: {
            id: 'workflow-demo',
            name: '更新工作流',
            description: 'desc',
            version: '1',
            source: 'custom',
            entryStepId: 'step-1',
            steps: [
              {
                id: 'step-1',
                roleLayer: 'reception',
                label: '接待',
                promptTemplate: 'hello',
                toolsets: [],
                handoffTargets: [],
                parallel: false,
                minInstances: 1,
                maxInstances: 1,
                gates: [],
                terminal: true,
              },
            ],
            defaultBindings: {},
            tags: [],
          },
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_workflow_not_found',
        error: '目标团队工作流不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('DELETE /team/workflows/:workflowDbId 对不存在资源返回结构化 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/team/workflows/wf-missing',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_workflow_not_found',
        error: '目标团队工作流不存在。',
      });
    } finally {
      await app.close();
    }
  });
});
