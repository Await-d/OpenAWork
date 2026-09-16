import Fastify, { type FastifyInstance } from 'fastify';
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

type AuthModule = typeof import('../../infra/auth.js');
type DbModule = typeof import('../../infra/db.js');
type PortsRoutesModule = typeof import('../../routes/ports.js');
type RequestWorkflowModule = typeof import('../../runtime/request-workflow.js');

let dbModule: DbModule;
let authPlugin: AuthModule['default'];
let portsRoutes: PortsRoutesModule['portsRoutes'];
let requestWorkflowPlugin: RequestWorkflowModule['default'];

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
      },
    ],
    strategy: 'procfs',
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

  it('携带有效 token → 返回枚举快照（不要求 sessionId）', async () => {
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
        ports: [
          {
            port: 34567,
            protocol: 'tcp',
            bindAddress: '127.0.0.1',
            pid: 4321,
            processName: 'node',
            source: 'procfs',
          },
        ],
        collectedAtMs: 1_700_000_000_000,
      });
      expect(mocks.listListeningPorts).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
