import Fastify, { type FastifyInstance } from 'fastify';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as PortsRoutesModule from '../../routes/ports.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'ports-route-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const mocks = vi.hoisted(() => ({
  listListeningPorts: vi.fn(),
}));

vi.mock('../../ports/listening-ports.js', () => ({
  listListeningPorts: mocks.listListeningPorts,
}));

let dbModule: typeof DbModule;
let authPlugin: (typeof AuthModule)['default'];
let portsRoutes: (typeof PortsRoutesModule)['portsRoutes'];
let requestWorkflowPlugin: (typeof RequestWorkflowModule)['default'];

const USER_ID = 'u-ports-route';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(portsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'ports@example.com' })}`;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  portsRoutes = (await import('../../routes/ports.js')).portsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  mocks.listListeningPorts.mockReset();
  mocks.listListeningPorts.mockResolvedValue({
    ports: [
      {
        port: 34567,
        protocol: 'tcp',
        bindAddress: '127.0.0.1',
        pid: 4321,
        processName: 'node',
        source: 'procfs',
        establishedConnections: 2,
        processAlive: true,
        terminal: { sessionId: 'session-1', terminalId: 'term-1' },
      },
    ],
    strategy: 'procfs',
    attributionSupported: true,
    collectedAtMs: 1_700_000_000_000,
  });
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('GET /sessions/ports/listening', () => {
  it('未携带 token → 401，且不触发枚举', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/sessions/ports/listening' });
      expect(response.statusCode).toBe(401);
      expect(mocks.listListeningPorts).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('携带有效 token → 返回枚举快照（不要求 sessionId，归属字段原样透传）', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/ports/listening',
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        strategy: 'procfs',
        attributionSupported: true,
        ports: [
          {
            port: 34567,
            protocol: 'tcp',
            bindAddress: '127.0.0.1',
            pid: 4321,
            processName: 'node',
            source: 'procfs',
            establishedConnections: 2,
            processAlive: true,
            terminal: { sessionId: 'session-1', terminalId: 'term-1' },
          },
        ],
        collectedAtMs: 1_700_000_000_000,
      });
      expect(mocks.listListeningPorts).toHaveBeenCalledTimes(1);
      // 归属按请求用户计算：路由必须把 user.sub 与只读的终端 pid 查询一起传下去。
      expect(mocks.listListeningPorts).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          listOwnedTerminalPids: expect.any(Function),
        }),
      );
    } finally {
      await app.close();
    }
  });
});
