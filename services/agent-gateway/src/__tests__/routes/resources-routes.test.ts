import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as ResourcesRoutesModule from '../../routes/resources.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'resources-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

interface ResourceCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly integration: string;
  readonly visibility?: string;
  readonly feature?: string;
  readonly usageKind?: string;
  readonly systemPrompt?: string;
  readonly files?: readonly string[];
}

interface ResourcesCatalogResponse {
  readonly resources: {
    readonly skills: readonly ResourceCatalogEntry[];
    readonly agents: readonly ResourceCatalogEntry[];
    readonly agentTemplates: readonly ResourceCatalogEntry[];
    readonly commands: readonly ResourceCatalogEntry[];
    readonly souls: readonly ResourceCatalogEntry[];
    readonly prompts: readonly ResourceCatalogEntry[];
    readonly extensions: readonly ResourceCatalogEntry[];
    readonly mcps: readonly ResourceCatalogEntry[];
  };
}

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let resourcesRoutes: typeof ResourcesRoutesModule.resourcesRoutes;

const USER_ID = 'u-resources-routes';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(resourcesRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'resources@example.com' })}`;
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
  resourcesRoutes = (await import('../../routes/resources.js')).resourcesRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('resources routes', () => {
  it('POST /resources/uploads 需要登录', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/resources/uploads',
        payload: {
          area: 'prompts',
          name: 'daily-summary',
          title: '每日总结',
          content: '请总结今天的工作。',
        },
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('GET /resources 需要登录', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/resources',
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('GET /resources 返回中性资源目录和集成模式', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/resources',
        headers: {
          authorization: bearer(app),
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ResourcesCatalogResponse>();
      expect(body.resources.skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'com.openAwork.resource.pdf',
            name: 'pdf',
            integration: 'builtin',
          }),
          expect.objectContaining({
            id: 'resource-reference-skill-create-extension',
            name: 'create-extension',
            integration: 'reference',
          }),
        ]),
      );
      expect(body.resources.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'resource-code-reviewer',
            name: 'code-reviewer',
            integration: 'builtin',
          }),
          expect.objectContaining({
            id: 'resource-reference-cron-agent',
            name: 'cron-agent',
            integration: 'reference',
          }),
        ]),
      );
      expect(
        body.resources.agents.find((agent) => agent.id === 'resource-code-reviewer')?.systemPrompt,
      ).toContain('Code Review Checklist');
      expect(body.resources.agentTemplates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'resource-agent-template-agents',
            name: 'AGENTS',
            integration: 'reference',
            visibility: 'feature',
            feature: 'team',
            usageKind: 'agent-template',
          }),
          expect.objectContaining({
            id: 'resource-agent-template-user',
            name: 'USER',
            integration: 'reference',
          }),
        ]),
      );
      expect(body.resources.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'resource-command-commit',
            name: 'commit',
            integration: 'reference',
            visibility: 'feature',
            feature: 'commands',
            usageKind: 'command-definition',
          }),
        ]),
      );
      expect(body.resources.souls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'resource-soul-balanced-collaborator',
            visibility: 'feature',
            feature: 'channels',
            usageKind: 'channel-persona',
          }),
        ]),
      );
      expect(body.resources.prompts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'resource-prompt-codex-instructions',
            name: 'codex-instructions',
          }),
        ]),
      );
      expect(body.resources.extensions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'resource-extension-my-coffee',
            name: 'my-coffee',
            files: expect.arrayContaining(['index.js', 'components/luckin-list.html']),
          }),
        ]),
      );
      expect(body.resources.mcps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'open_websearch',
            name: 'open_websearch',
            integration: 'builtin',
          }),
          expect.objectContaining({
            id: 'websearch',
            name: 'websearch',
            integration: 'builtin',
          }),
          expect.objectContaining({
            id: 'codegraph',
            name: 'codegraph',
            integration: 'builtin',
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('POST /resources/uploads 新增用户资源后 GET 可实时识别', async () => {
    const app = await buildApp();
    try {
      const auth = bearer(app);
      const createResponse = await app.inject({
        method: 'POST',
        url: '/resources/uploads',
        headers: { authorization: auth },
        payload: {
          area: 'prompts',
          name: 'daily-summary',
          title: '每日总结',
          description: '用户上传的总结 prompt',
          content: '请总结今天的工作。',
        },
      });

      expect(createResponse.statusCode).toBe(201);
      const createBody = createResponse.json<ResourcesCatalogResponse>();
      const uploaded = createBody.resources.prompts.find((entry) => entry.name === 'daily-summary');
      expect(uploaded).toMatchObject({
        name: 'daily-summary',
        integration: 'user',
        visibility: 'feature',
        feature: 'prompts',
        usageKind: 'runtime-instruction',
      });

      const listResponse = await app.inject({
        method: 'GET',
        url: '/resources',
        headers: { authorization: auth },
      });

      expect(listResponse.statusCode).toBe(200);
      const listBody = listResponse.json<ResourcesCatalogResponse>();
      expect(listBody.resources.prompts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: uploaded?.id,
            name: 'daily-summary',
            integration: 'user',
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('DELETE /resources/uploads/:resourceId 删除当前用户上传资源并返回刷新目录', async () => {
    const app = await buildApp();
    try {
      const auth = bearer(app);
      const createResponse = await app.inject({
        method: 'POST',
        url: '/resources/uploads',
        headers: { authorization: auth },
        payload: {
          area: 'agents',
          name: 'qa-helper',
          title: 'QA Helper',
          content: '只作为参考资源保存。',
        },
      });
      const created = createResponse
        .json<ResourcesCatalogResponse>()
        .resources.agents.find((entry) => entry.name === 'qa-helper');

      expect(created?.id).toMatch(/^user-resource-/);

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/resources/uploads/${created?.id ?? ''}`,
        headers: { authorization: auth },
      });

      expect(deleteResponse.statusCode).toBe(200);
      const deleteBody = deleteResponse.json<ResourcesCatalogResponse>();
      expect(deleteBody.resources.agents.some((entry) => entry.id === created?.id)).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('DELETE /resources/uploads/:resourceId 不允许删除内置或他人资源', async () => {
    const app = await buildApp();
    try {
      seedUser('u-other-resources');
      const auth = bearer(app);
      const otherAuth = `Bearer ${app.jwt.sign({
        sub: 'u-other-resources',
        email: 'other@example.com',
      })}`;
      const createResponse = await app.inject({
        method: 'POST',
        url: '/resources/uploads',
        headers: { authorization: otherAuth },
        payload: {
          area: 'prompts',
          name: 'private-resource',
          title: '私有资源',
          content: '仅另一个用户可删。',
        },
      });
      const otherResource = createResponse
        .json<ResourcesCatalogResponse>()
        .resources.prompts.find((entry) => entry.name === 'private-resource');

      const builtinResponse = await app.inject({
        method: 'DELETE',
        url: '/resources/uploads/com.openAwork.resource.pdf',
        headers: { authorization: auth },
      });
      const otherResponse = await app.inject({
        method: 'DELETE',
        url: `/resources/uploads/${otherResource?.id ?? ''}`,
        headers: { authorization: auth },
      });

      expect(builtinResponse.statusCode).toBe(404);
      expect(otherResponse.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('POST /resources/uploads 拒绝无效请求体', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/resources/uploads',
        headers: { authorization: bearer(app) },
        payload: {
          area: 'agents',
          name: '../bad',
          title: '',
          content: '',
        },
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
