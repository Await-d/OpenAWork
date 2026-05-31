/**
 * Coverage for the AI-recommend route surface (PR4 of the
 * skill-workspace-selection spec):
 *
 *   - LLM happy path with `dropHallucinations` filtering an out-of-candidate id.
 *   - 24h cache short-circuit returns `fromCache: true` with the same recommendationId.
 *   - LLM failure falls back to deterministic heuristic, `fellBackToHeuristic: true`.
 *   - Apply replaces selection rows with `source = 'ai-recommend'`, marks `applied = 1`.
 *   - Latest endpoint surfaces (applied, pending) with the correct ordering.
 */

import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SkillRecommendModule from '../../routes/skill-recommend.js';
import type * as UpstreamActual from '../../v2-runtime/upstream/index.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const upstreamMock = vi.hoisted(() => ({
  runUpstreamGenerate: vi.fn(),
}));

vi.mock('../../v2-runtime/upstream/index.js', async (orig) => {
  const actual = await (orig() as Promise<typeof UpstreamActual>);
  return {
    ...actual,
    runUpstreamGenerate: upstreamMock.runUpstreamGenerate,
  };
});

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let skillRecommendRoutes: typeof SkillRecommendModule.skillRecommendRoutes;

const USER_ID = 'u-rec';

function installedManifest(id: string, capabilities: string[] = []) {
  return {
    apiVersion: 'agent-skill/v1',
    id,
    name: id.split('.').pop() ?? id,
    displayName: id,
    version: '1.0.0',
    description: `Skill ${id}`,
    capabilities,
    permissions: [],
  };
}

function seedUser(id = USER_ID): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedInstalled(skillId: string, capabilities: string[] = []): void {
  const manifest = installedManifest(skillId, capabilities);
  const now = Date.now();
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO installed_skills
       (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, 'local', ?, '[]', 1, ?, ?)`,
    [skillId, USER_ID, JSON.stringify(manifest), now, now],
  );
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(skillRecommendRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` });
  return `Bearer ${token}`;
}

function resetState(): void {
  dbModule.sqliteRun('DELETE FROM chat_workspace_skill_recommendations');
  dbModule.sqliteRun('DELETE FROM chat_workspace_skill_selections');
  dbModule.sqliteRun('DELETE FROM chat_workspace_skill_configured');
  dbModule.sqliteRun('DELETE FROM installed_skills');
  dbModule.sqliteRun('DELETE FROM users');
}

let workspaceDir: string;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  skillRecommendRoutes = (await import('../../routes/skill-recommend.js')).skillRecommendRoutes;
  await dbModule.connectDb();
  await dbModule.migrate();

  // Lay out a tiny synthetic workspace so signal sampling has something to read.
  workspaceDir = await mkdtemp(join(tmpdir(), 'skill-recommend-test-'));
  await writeFile(
    join(workspaceDir, 'package.json'),
    JSON.stringify({ name: 'demo', dependencies: { react: '^18', tailwindcss: '^3' } }, null, 2),
  );
  await writeFile(join(workspaceDir, 'README.md'), '# Demo\n\nA TypeScript + React project.');
  await mkdir(join(workspaceDir, '.agentdocs'), { recursive: true });
  await writeFile(join(workspaceDir, '.agentdocs', 'index.md'), '## Index\nReact playground.');
});

afterAll(async () => {
  await dbModule.closeDb();
  if (workspaceDir) {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  resetState();
  seedUser();
  upstreamMock.runUpstreamGenerate.mockReset();
});

describe('POST /skills/recommend', () => {
  it('drops hallucinated skill_ids returned by the LLM', async () => {
    seedInstalled('com.example.frontend', ['frontend.react']);
    seedInstalled('com.example.backend', ['backend.api']);
    upstreamMock.runUpstreamGenerate.mockResolvedValue({
      text: JSON.stringify({
        recommendations: [
          {
            skill_id: 'com.example.frontend',
            pinned: true,
            reason: 'matches react usage',
            score: 92,
          },
          {
            skill_id: 'com.hallucinated.unknown',
            pinned: false,
            reason: 'pretend match',
            score: 70,
          },
        ],
        rejected: [{ skill_id: 'com.example.backend', reason: 'no backend code' }],
      }),
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/skills/recommend',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { workspacePath: workspaceDir, force: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        recommendations: Array<{ skill_id: string }>;
        fellBackToHeuristic: boolean;
        fromCache: boolean;
      };
      expect(body.fromCache).toBe(false);
      expect(body.fellBackToHeuristic).toBe(false);
      expect(body.recommendations.map((r) => r.skill_id)).toEqual(['com.example.frontend']);
    } finally {
      await app.close();
    }
  });

  it('serves a 24h cache hit on identical signals + force=false', async () => {
    seedInstalled('com.example.alpha', ['cap']);
    upstreamMock.runUpstreamGenerate.mockResolvedValue({
      text: JSON.stringify({
        recommendations: [{ skill_id: 'com.example.alpha', pinned: false, reason: 'r', score: 50 }],
        rejected: [],
      }),
    });

    const app = await buildApp();
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/skills/recommend',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { workspacePath: workspaceDir },
      });
      const firstBody = first.json() as { recommendationId: string; fromCache: boolean };
      expect(firstBody.fromCache).toBe(false);

      const second = await app.inject({
        method: 'POST',
        url: '/skills/recommend',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { workspacePath: workspaceDir },
      });
      const secondBody = second.json() as { recommendationId: string; fromCache: boolean };
      expect(secondBody.fromCache).toBe(true);
      expect(secondBody.recommendationId).toBe(firstBody.recommendationId);
      // LLM should have been called exactly once (the second call is a cache hit).
      expect(upstreamMock.runUpstreamGenerate).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("forwards the user provider's upstreamProtocol to runUpstreamGenerate", async () => {
    // Regression: prior to forwarding, the recommend route silently degraded
    // every provider into OpenAI Chat Completions, which broke users with
    // explicit `anthropic-messages` / `openai-responses` configs.
    seedInstalled('com.example.alpha', ['cap']);
    const provider = {
      id: 'anthropic-claude',
      type: 'anthropic',
      name: 'Claude',
      enabled: true,
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'test-key',
      upstreamProtocol: 'anthropic-messages',
      defaultModels: [{ id: 'claude-3-5-sonnet-latest', label: 'Sonnet', enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const activeSelection = {
      chat: { providerId: provider.id, modelId: 'claude-3-5-sonnet-latest' },
    };
    dbModule.sqliteRun(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [USER_ID, JSON.stringify([provider])],
    );
    dbModule.sqliteRun(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [USER_ID, JSON.stringify(activeSelection)],
    );
    upstreamMock.runUpstreamGenerate.mockResolvedValue({
      text: JSON.stringify({
        recommendations: [{ skill_id: 'com.example.alpha', pinned: false, reason: 'r', score: 50 }],
        rejected: [],
      }),
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/skills/recommend',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { workspacePath: workspaceDir, force: true },
      });
      expect(res.statusCode).toBe(200);
      expect(upstreamMock.runUpstreamGenerate).toHaveBeenCalledTimes(1);
      const callArgs = upstreamMock.runUpstreamGenerate.mock.calls[0]?.[0] as
        | { providerType?: string; upstreamProtocol?: string; model?: string }
        | undefined;
      expect(callArgs).toBeDefined();
      expect(callArgs?.providerType).toBe('anthropic');
      // The bug fix: protocol must be propagated so the AI SDK uses
      // anthropic_messages instead of silently degrading to chat_completions.
      expect(callArgs?.upstreamProtocol).toBe('anthropic_messages');
      expect(typeof callArgs?.model).toBe('string');
    } finally {
      await app.close();
    }
  });

  it('falls back to the heuristic when the LLM call rejects', async () => {
    seedInstalled('com.example.frontend', ['frontend.react']);
    upstreamMock.runUpstreamGenerate.mockRejectedValue(new Error('upstream blew up'));

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/skills/recommend',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { workspacePath: workspaceDir, force: true },
      });
      const body = res.json() as {
        recommendations: Array<{ skill_id: string }>;
        fellBackToHeuristic: boolean;
      };
      expect(body.fellBackToHeuristic).toBe(true);
      expect(body.recommendations.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});

describe('POST /skills/recommend/:id/apply', () => {
  it('replaces selection rows with source ai-recommend and marks applied=1', async () => {
    seedInstalled('com.example.frontend');
    upstreamMock.runUpstreamGenerate.mockResolvedValue({
      text: JSON.stringify({
        recommendations: [
          {
            skill_id: 'com.example.frontend',
            pinned: true,
            reason: 'core',
            score: 90,
          },
        ],
        rejected: [],
      }),
    });

    const app = await buildApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/skills/recommend',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { workspacePath: workspaceDir, force: true },
      });
      const createdBody = created.json() as { recommendationId: string };

      const applied = await app.inject({
        method: 'POST',
        url: `/skills/recommend/${createdBody.recommendationId}/apply`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { overrides: {} },
      });
      expect(applied.statusCode).toBe(200);
      const appliedBody = applied.json() as { applied: boolean; replacedCount: number };
      expect(appliedBody.applied).toBe(true);
      expect(appliedBody.replacedCount).toBe(1);

      const rows = dbModule.sqliteAll<{
        skill_id: string;
        pinned: number;
        source: string;
      }>('SELECT skill_id, pinned, source FROM chat_workspace_skill_selections WHERE user_id = ?', [
        USER_ID,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        skill_id: 'com.example.frontend',
        pinned: 1,
        source: 'ai-recommend',
      });

      const recRow = dbModule.sqliteGet<{ applied: number }>(
        'SELECT applied FROM chat_workspace_skill_recommendations WHERE id = ?',
        [createdBody.recommendationId],
      );
      expect(recRow?.applied).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('rejects overrides that target a BUILTIN skill id', async () => {
    seedInstalled('com.example.frontend');
    upstreamMock.runUpstreamGenerate.mockResolvedValue({
      text: JSON.stringify({
        recommendations: [
          { skill_id: 'com.example.frontend', pinned: false, reason: 'r', score: 70 },
        ],
        rejected: [],
      }),
    });

    const app = await buildApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/skills/recommend',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { workspacePath: workspaceDir, force: true },
      });
      const createdBody = created.json() as { recommendationId: string };

      const applied = await app.inject({
        method: 'POST',
        url: `/skills/recommend/${createdBody.recommendationId}/apply`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: {
          overrides: {
            'com.openAwork.builtin.git-master': { enabled: true, pinned: true },
          },
        },
      });
      expect(applied.statusCode).toBe(400);
      expect(applied.json()).toMatchObject({
        error: "内置技能 'com.openAwork.builtin.git-master' 不允许通过选择接口管理。",
      });
      // Confirm nothing was written despite the rejection.
      const rows = dbModule.sqliteAll<{ skill_id: string }>(
        'SELECT skill_id FROM chat_workspace_skill_selections WHERE user_id = ?',
        [USER_ID],
      );
      expect(rows).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('drops overrides whose skillId is not currently installed', async () => {
    seedInstalled('com.example.frontend');
    upstreamMock.runUpstreamGenerate.mockResolvedValue({
      text: JSON.stringify({
        recommendations: [
          { skill_id: 'com.example.frontend', pinned: false, reason: 'r', score: 70 },
        ],
        rejected: [],
      }),
    });

    const app = await buildApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/skills/recommend',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { workspacePath: workspaceDir, force: true },
      });
      const createdBody = created.json() as { recommendationId: string };

      // Foreign / never-installed skill id MUST be dropped silently and
      // never end up in the selection table — even though it isn't a
      // BUILTIN id we hard-reject above.
      const applied = await app.inject({
        method: 'POST',
        url: `/skills/recommend/${createdBody.recommendationId}/apply`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: {
          overrides: {
            'com.example.never-installed': { enabled: true, pinned: true },
          },
        },
      });
      expect(applied.statusCode).toBe(200);
      const rows = dbModule.sqliteAll<{ skill_id: string }>(
        'SELECT skill_id FROM chat_workspace_skill_selections WHERE user_id = ?',
        [USER_ID],
      );
      expect(rows.map((r) => r.skill_id)).toEqual(['com.example.frontend']);
    } finally {
      await app.close();
    }
  });

  it('surfaces a 404 for recommendations not owned by the caller', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/skills/recommend/does-not-exist/apply',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { overrides: {} },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('GET /skills/recommend/latest', () => {
  it('returns the most recent applied + pending pair', async () => {
    seedInstalled('com.example.alpha');
    upstreamMock.runUpstreamGenerate.mockResolvedValue({
      text: JSON.stringify({
        recommendations: [{ skill_id: 'com.example.alpha', pinned: false, reason: 'r', score: 60 }],
        rejected: [],
      }),
    });

    const app = await buildApp();
    try {
      // First recommendation, applied
      const first = await app.inject({
        method: 'POST',
        url: '/skills/recommend',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { workspacePath: workspaceDir, force: true },
      });
      const firstId = (first.json() as { recommendationId: string }).recommendationId;
      await app.inject({
        method: 'POST',
        url: `/skills/recommend/${firstId}/apply`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { overrides: {} },
      });

      // Second recommendation, left pending — change candidate set so the
      // signalDigest differs and we don't get a 24h cache hit.
      seedInstalled('com.example.beta');
      const second = await app.inject({
        method: 'POST',
        url: '/skills/recommend',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { workspacePath: workspaceDir, force: true },
      });
      const secondId = (second.json() as { recommendationId: string }).recommendationId;

      const latest = await app.inject({
        method: 'GET',
        url: `/skills/recommend/latest?workspacePath=${encodeURIComponent(workspaceDir)}`,
        headers: { authorization: bearer(app) },
      });
      const latestBody = latest.json() as {
        applied: { recommendationId: string } | null;
        pending: { recommendationId: string } | null;
      };
      expect(latestBody.applied?.recommendationId).toBe(firstId);
      expect(latestBody.pending?.recommendationId).toBe(secondId);
    } finally {
      await app.close();
    }
  });
});
