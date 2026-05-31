/**
 * Regression (§0.117, settings file-patterns corrupt-row tolerance):
 * GET /settings/file-patterns read the `file_patterns` user_settings row and
 * parsed it with an unguarded JSON.parse — the lone unguarded reader in
 * settings.ts (every sibling already wraps its parse). A corrupt row (crash
 * mid-write, disk error, hand-edited DB) threw straight out and 500'd the
 * route. The read now degrades a corrupt value to an empty list. We seed a
 * corrupt row and assert the route returns 200 with `patterns: []`.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SettingsRoutesModule from '../../routes/settings.js';

vi.mock('../../mcp/mcp-runtime.js', () => ({
  isMcpServerConnectedForUser: vi.fn(() => false),
  loadConfiguredMcpServersForUser: vi.fn(() => []),
  retryMcpConnectionForUser: vi.fn(),
}));

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: vi.fn(async () => null),
}));

vi.mock('../../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: vi.fn(),
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'settings-file-patterns-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let settingsRoutes: typeof SettingsRoutesModule.settingsRoutes;

const USER_ID = 'u-file-patterns';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(settingsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` })}`;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  settingsRoutes = (await import('../../routes/settings.js')).settingsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('GET /settings/file-patterns corrupt-row resilience', () => {
  it('file_patterns 行为损坏 JSON 时返回 200 空列表而非 500', async () => {
    // Seed a corrupt file_patterns row directly.
    dbModule.sqliteRun(
      `INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'file_patterns', ?)`,
      [USER_ID, '{not valid json'],
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/file-patterns',
        headers: { authorization: bearer(app) },
      });

      // Before the fix the unguarded JSON.parse threw → 500.
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ patterns: [] });
    } finally {
      await app.close();
    }
  });

  it('file_patterns 行为合法 JSON 数组时只返回字符串项', async () => {
    dbModule.sqliteRun(
      `INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'file_patterns', ?)`,
      [USER_ID, JSON.stringify(['*.ts', 42, '*.md', null])],
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/file-patterns',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      // Non-string entries are filtered out by the tolerant read.
      expect(response.json()).toEqual({ patterns: ['*.ts', '*.md'] });
    } finally {
      await app.close();
    }
  });
});
