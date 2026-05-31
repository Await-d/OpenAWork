import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import { parseBody, parseParams, parseQuery } from '../../infra/parse-request.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let requireAuthHook: typeof import('../../infra/auth.js').requireAuth;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);

  app.post('/test/body', async (request, reply) => {
    parseBody(
      z.object({
        name: z.string().min(1),
      }),
      request.body,
    );
    return reply.send({ ok: true });
  });

  app.get('/test/query', async (request, reply) => {
    parseQuery(
      z.object({
        limit: z.coerce.number().int().min(1),
      }),
      request.query,
    );
    return reply.send({ ok: true });
  });

  app.get('/test/params/:id', async (request, reply) => {
    parseParams(
      z.object({
        id: z.string().uuid(),
      }),
      request.params,
    );
    return reply.send({ ok: true });
  });

  app.get('/test/protected', { onRequest: [requireAuthHook] }, async (_request, reply) => {
    return reply.send({ ok: true });
  });

  app.get('/test/explode', async () => {
    throw new Error('boom');
  });

  await app.ready();
  return app;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  const authModule = await import('../../infra/auth.js');
  authPlugin = authModule.default;
  requireAuthHook = authModule.requireAuth;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('global error contracts', () => {
  it('parseBody 失败时返回中文 BadRequest', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/test/body',
        headers: { 'content-type': 'application/json' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: {
          message: '请求体参数无效。',
          kind: 'Body',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('parseQuery 失败时返回中文 Query 错误', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/test/query?limit=0',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: {
          message: '查询参数无效。',
          kind: 'Query',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('parseParams 失败时返回中文 Params 错误', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/test/params/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: {
          message: '路径参数无效。',
          kind: 'Params',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('requireAuth 失败时返回中文 401', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/test/protected',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: '未授权或登录已失效。',
      });
    } finally {
      await app.close();
    }
  });

  it('未知异常时返回中文 500', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/test/explode',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        name: 'InternalError',
        data: {
          message: '服务器内部错误。',
        },
      });
    } finally {
      await app.close();
    }
  });
});
