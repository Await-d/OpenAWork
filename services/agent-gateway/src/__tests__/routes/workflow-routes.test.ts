import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as WorkflowRoutesModule from '../../routes/workflows.js';

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'workflow-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let workflowRoutes: typeof WorkflowRoutesModule.workflowRoutes;

const USER_ID = 'u-workflow-routes';
const OTHER_USER_ID = 'u-workflow-routes-other';

const TEAM_MEMBER_SLOT = {
  id: 'executor-custom-thinking',
  layer: 'executor',
  specialty: 'custom',
  displayName: '推理执行者',
  personaKey: 'executor:custom:thinking',
  toolsets: ['read', 'write', 'shell'],
  required: false,
  custom: true,
  thinkingEnabled: true,
  reasoningEffort: 'high',
} as const;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(workflowRoutes);
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

function seedTemplate(
  templateId: string,
  userId: string,
  overrides?: { metadataJson?: string },
): void {
  dbModule.sqliteRun(
    `INSERT INTO workflow_templates
      (id, user_id, name, description, category, metadata_json, nodes_json, edges_json)
     VALUES (?, ?, '演示模板', 'desc', 'general', ?, '[]', '[]')`,
    [templateId, userId, overrides?.metadataJson ?? '{}'],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  workflowRoutes = (await import('../../routes/workflows.js')).workflowRoutes;
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

describe('workflow routes error contracts', () => {
  it('POST/GET /workflows/templates 与 PATCH 会持久化 team template 成员思考配置', async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/workflows/templates',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          name: '带思考配置的团队模板',
          category: 'team-playbook',
          metadata: {
            teamTemplate: {
              memberSlots: [TEAM_MEMBER_SLOT],
            },
          },
        },
      });

      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as {
        id: string;
        metadata?: {
          teamTemplate?: {
            memberSlots?: Array<{
              id: string;
              thinkingEnabled?: boolean;
              reasoningEffort?: string;
            }>;
          };
        };
      };
      expect(createdBody.metadata?.teamTemplate?.memberSlots?.[0]).toMatchObject({
        id: TEAM_MEMBER_SLOT.id,
        thinkingEnabled: true,
        reasoningEffort: 'high',
      });

      const stored = dbModule.sqliteGet<{ metadata_json: string }>(
        'SELECT metadata_json FROM workflow_templates WHERE id = ? AND user_id = ?',
        [createdBody.id, USER_ID],
      );
      expect(stored).toBeDefined();
      const storedMetadata = JSON.parse(stored?.metadata_json ?? '{}') as {
        teamTemplate?: {
          memberSlots?: Array<{
            id: string;
            thinkingEnabled?: boolean;
            reasoningEffort?: string;
          }>;
        };
      };
      expect(storedMetadata.teamTemplate?.memberSlots?.[0]).toMatchObject({
        id: TEAM_MEMBER_SLOT.id,
        thinkingEnabled: true,
        reasoningEffort: 'high',
      });

      const listed = await app.inject({
        method: 'GET',
        url: '/workflows/templates',
        headers: { authorization: bearer(app) },
      });
      expect(listed.statusCode).toBe(200);
      const templates = listed.json() as Array<{
        id: string;
        metadata?: {
          teamTemplate?: {
            memberSlots?: Array<{
              id: string;
              thinkingEnabled?: boolean;
              reasoningEffort?: string;
            }>;
          };
        };
      }>;
      expect(
        templates.find((template) => template.id === createdBody.id)?.metadata?.teamTemplate
          ?.memberSlots?.[0],
      ).toMatchObject({
        id: TEAM_MEMBER_SLOT.id,
        thinkingEnabled: true,
        reasoningEffort: 'high',
      });

      const patched = await app.inject({
        method: 'PATCH',
        url: `/workflows/templates/${createdBody.id}`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          metadata: {
            teamTemplate: {
              memberSlots: [
                {
                  ...TEAM_MEMBER_SLOT,
                  thinkingEnabled: false,
                  reasoningEffort: 'low',
                },
              ],
            },
          },
        },
      });
      expect(patched.statusCode).toBe(200);
      const patchedBody = patched.json() as {
        metadata?: {
          teamTemplate?: {
            memberSlots?: Array<{
              id: string;
              thinkingEnabled?: boolean;
              reasoningEffort?: string;
            }>;
          };
        };
      };
      expect(patchedBody.metadata?.teamTemplate?.memberSlots?.[0]).toMatchObject({
        id: TEAM_MEMBER_SLOT.id,
        thinkingEnabled: false,
        reasoningEffort: 'low',
      });

      const storedAfterPatch = dbModule.sqliteGet<{ metadata_json: string }>(
        'SELECT metadata_json FROM workflow_templates WHERE id = ? AND user_id = ?',
        [createdBody.id, USER_ID],
      );
      const patchedMetadata = JSON.parse(storedAfterPatch?.metadata_json ?? '{}') as {
        teamTemplate?: {
          memberSlots?: Array<{
            id: string;
            thinkingEnabled?: boolean;
            reasoningEffort?: string;
          }>;
        };
      };
      expect(patchedMetadata.teamTemplate?.memberSlots?.[0]).toMatchObject({
        id: TEAM_MEMBER_SLOT.id,
        thinkingEnabled: false,
        reasoningEffort: 'low',
      });
    } finally {
      await app.close();
    }
  });

  it('GET /workflows/templates 跳过 JSON 损坏的单条模板而不是整列 500', async () => {
    // One corrupt row must not make every template unreadable (§0.89-§0.91
    // class): the list degrades by skipping the bad row and returns the rest.
    seedTemplate('wf-good', USER_ID);
    seedTemplate('wf-broken', USER_ID, { metadataJson: '{broken-json' });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/workflows/templates',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const templates = response.json() as Array<{ id: string }>;
      const ids = templates.map((t) => t.id);
      expect(ids).toContain('wf-good');
      expect(ids).not.toContain('wf-broken');
    } finally {
      await app.close();
    }
  });

  it('PATCH /workflows/templates/:id 对不存在模板返回中文 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/workflows/templates/wf-missing',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          name: '新名字',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: '目标工作流模板不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('DELETE /workflows/templates/:id 对其他用户模板返回中文 404', async () => {
    seedTemplate('wf-other', OTHER_USER_ID);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/workflows/templates/wf-other',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: '目标工作流模板不存在。',
      });
    } finally {
      await app.close();
    }
  });
});
