import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamRoutesModule from '../../routes/team.js';
import { parseSessionMetadataJson } from '../../session/session-workspace-metadata.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamRoutes: typeof TeamRoutesModule.teamRoutes;

const USER_ID = 'u-team-roster-route';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamRoutes);
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

const CUSTOM_ROSTER = [
  {
    id: 'custom-executor-devops-route',
    layer: 'executor' as const,
    specialty: 'devops' as const,
    displayName: '部署工程师 Route',
    personaKey: 'executor:devops:route',
    toolsets: ['read', 'write', 'shell'],
    required: false,
  },
];

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  const auth = await import('../../infra/auth.js');
  authPlugin = auth.default;
  const requestWorkflow = await import('../../runtime/request-workflow.js');
  requestWorkflowPlugin = requestWorkflow.default;
  const team = await import('../../routes/team.js');
  teamRoutes = team.teamRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('team workspace default roster routes', () => {
  it('create/list/get 会持久化并返回 workspace 默认固定团队', async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/team/workspaces',
        headers: { authorization: bearer(app) },
        payload: {
          name: 'Roster 工作区',
          defaultTeamRoster: CUSTOM_ROSTER,
        },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { id: string; defaultTeamRoster: typeof CUSTOM_ROSTER };
      expect(createdBody.defaultTeamRoster).toEqual(CUSTOM_ROSTER);

      const listed = await app.inject({
        method: 'GET',
        url: '/team/workspaces',
        headers: { authorization: bearer(app) },
      });
      expect(listed.statusCode).toBe(200);
      const listBody = listed.json() as Array<{
        id: string;
        defaultTeamRoster: typeof CUSTOM_ROSTER;
      }>;
      expect(
        listBody.find((workspace) => workspace.id === createdBody.id)?.defaultTeamRoster,
      ).toEqual(CUSTOM_ROSTER);

      const reread = await app.inject({
        method: 'GET',
        url: `/team/workspaces/${createdBody.id}`,
        headers: { authorization: bearer(app) },
      });
      expect(reread.statusCode).toBe(200);
      expect(
        (reread.json() as { defaultTeamRoster: typeof CUSTOM_ROSTER }).defaultTeamRoster,
      ).toEqual(CUSTOM_ROSTER);
    } finally {
      await app.close();
    }
  });

  it('PATCH 会更新 workspace 默认固定团队并拒绝非法 specialty', async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/team/workspaces',
        headers: { authorization: bearer(app) },
        payload: { name: 'Patch Roster 工作区' },
      });
      const workspaceId = (created.json() as { id: string }).id;

      const patched = await app.inject({
        method: 'PATCH',
        url: `/team/workspaces/${workspaceId}`,
        headers: { authorization: bearer(app) },
        payload: { defaultTeamRoster: CUSTOM_ROSTER },
      });
      expect(patched.statusCode).toBe(200);
      expect(
        (patched.json() as { defaultTeamRoster: typeof CUSTOM_ROSTER }).defaultTeamRoster,
      ).toEqual(CUSTOM_ROSTER);

      const invalid = await app.inject({
        method: 'PATCH',
        url: `/team/workspaces/${workspaceId}`,
        headers: { authorization: bearer(app) },
        payload: {
          defaultTeamRoster: [
            {
              ...CUSTOM_ROSTER[0],
              specialty: 'unsupported-specialty',
            },
          ],
        },
      });
      expect(invalid.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('废弃 /threads 入口也会固化 teamDefinition.memberSlots 快照', async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/team/workspaces',
        headers: { authorization: bearer(app) },
        payload: {
          name: 'Legacy Thread 工作区',
          defaultTeamRoster: CUSTOM_ROSTER,
        },
      });
      const workspaceId = (created.json() as { id: string }).id;

      const thread = await app.inject({
        method: 'POST',
        url: `/team/workspaces/${workspaceId}/threads`,
        headers: { authorization: bearer(app) },
        payload: { title: '旧入口线程' },
      });
      expect(thread.statusCode).toBe(201);

      const threadBody = thread.json() as { id: string; metadata_json: string };
      const metadata = parseSessionMetadataJson(threadBody.metadata_json);
      const teamDefinition = metadata['teamDefinition'] as
        | { memberSlots?: Array<{ id: string }> }
        | undefined;

      expect(Array.isArray(teamDefinition?.memberSlots)).toBe(true);
      expect(teamDefinition?.memberSlots?.[0]?.id).toBe('custom-executor-devops-route');
    } finally {
      await app.close();
    }
  });
});
