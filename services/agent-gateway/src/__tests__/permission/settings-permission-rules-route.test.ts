import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// End-to-end regression for the "永久允许 → settings page → delete" flow.
//
// History: prior to this test the popup's permanent-allow path wrote
// entries into the legacy `permanentGrants` array, while the settings
// panel only listed (and edited) `config.rules`. Legacy files therefore
// surfaced grants at runtime that the user could not see — let alone
// remove — from the UI. The fix makes the GET handler return the
// merged effective view and the PUT handler clear `permanentGrants` on
// save so deletion actually sticks.

const { TEST_WORKSPACE } = vi.hoisted(() => {
  // Imports inside `vi.hoisted` are evaluated before any top-level
  // imports of the test module, so we must use `require` here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
  const nodeFs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
  const nodeOs = require('node:os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
  const nodePath = require('node:path') as typeof import('node:path');
  return {
    TEST_WORKSPACE: nodeFs.mkdtempSync(
      nodePath.join(nodeOs.tmpdir(), 'openawork-permission-rules-route-'),
    ),
  };
});

vi.mock('../../db.js', () => ({
  WORKSPACE_ROOT: TEST_WORKSPACE,
  sqliteAll: vi.fn(() => [] as unknown[]),
  sqliteGet: vi.fn(() => null),
  sqliteRun: vi.fn(),
}));

vi.mock('../../auth.js', () => ({
  requireAuth: async (request: { user?: unknown }) => {
    request.user = { sub: 'test-user', email: 'test@openAwork.local' };
  },
}));

vi.mock('../../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: { succeed: vi.fn(), fail: vi.fn() },
    child: () => ({ succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

vi.mock('../../request-workflow-log-store.js', () => ({
  listRequestWorkflowLogs: vi.fn(() => []),
}));

import { settingsRoutes } from '../../routes/settings.js';

const PERMISSION_FILE = join(TEST_WORKSPACE, '.openawork.permissions.json');

function writePermissionFile(value: unknown): void {
  if (!existsSync(TEST_WORKSPACE)) {
    mkdirSync(TEST_WORKSPACE, { recursive: true });
  }
  writeFileSync(PERMISSION_FILE, JSON.stringify(value, null, 2), 'utf8');
}

function readPermissionFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(PERMISSION_FILE, 'utf8')) as Record<string, unknown>;
}

async function buildApp() {
  const app = Fastify();
  await app.register(settingsRoutes);
  await app.ready();
  return app;
}

describe('settings permission-rules route', () => {
  beforeEach(() => {
    writePermissionFile({});
  });

  afterAll(() => {
    try {
      writeFileSync(PERMISSION_FILE, '{}', 'utf8');
    } catch {
      // ignore — tmp dir cleanup is best-effort
    }
  });

  it('GET returns the merged effective view so legacy permanentGrants entries are visible', async () => {
    writePermissionFile({
      permanentGrants: [
        {
          id: 'legacy-1',
          toolName: 'bash',
          scope: 'ls *',
          grantedAt: 1700000000000,
          decision: 'permanent',
        },
      ],
      rules: [],
    });

    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/settings/permission-rules' });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        rules: { permission: string; pattern: string; action: string }[];
      };
      expect(body.rules).toEqual([{ permission: 'bash', pattern: 'ls *', action: 'allow' }]);
    } finally {
      await app.close();
    }
  });

  it('PUT clears the legacy permanentGrants array so deletions take effect', async () => {
    writePermissionFile({
      permanentGrants: [
        {
          id: 'legacy-1',
          toolName: 'bash',
          scope: 'ls *',
          grantedAt: 1700000000000,
          decision: 'permanent',
        },
      ],
      rules: [],
    });

    const app = await buildApp();
    try {
      // Simulate the user opening the panel, removing the merged entry,
      // and saving the empty rule set.
      const response = await app.inject({
        method: 'PUT',
        url: '/settings/permission-rules',
        payload: { rules: [] },
      });

      expect(response.statusCode).toBe(200);
      const persisted = readPermissionFile();
      expect(persisted['rules']).toEqual([]);
      expect(persisted['permanentGrants']).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('round-trip: legacy entry survives an unchanged save and disappears after a wipe', async () => {
    writePermissionFile({
      permanentGrants: [
        {
          id: 'legacy-1',
          toolName: 'bash',
          scope: 'ls *',
          grantedAt: 1700000000000,
          decision: 'permanent',
        },
      ],
    });

    const app = await buildApp();
    try {
      // 1. GET returns the merged view.
      const getOne = await app.inject({ method: 'GET', url: '/settings/permission-rules' });
      const merged = (
        JSON.parse(getOne.body) as {
          rules: { permission: string; pattern: string; action: string }[];
        }
      ).rules;
      expect(merged).toEqual([{ permission: 'bash', pattern: 'ls *', action: 'allow' }]);

      // 2. User saves without modifying — POSTs the merged list back.
      //    File should now hold the migrated entry in `rules` and have
      //    cleared `permanentGrants`.
      const putOne = await app.inject({
        method: 'PUT',
        url: '/settings/permission-rules',
        payload: { rules: merged },
      });
      expect(putOne.statusCode).toBe(200);
      let persisted = readPermissionFile();
      expect(persisted['rules']).toEqual(merged);
      expect(persisted['permanentGrants']).toEqual([]);

      // 3. User now actually deletes it via the panel.
      const putTwo = await app.inject({
        method: 'PUT',
        url: '/settings/permission-rules',
        payload: { rules: [] },
      });
      expect(putTwo.statusCode).toBe(200);
      persisted = readPermissionFile();
      expect(persisted['rules']).toEqual([]);
      expect(persisted['permanentGrants']).toEqual([]);

      // 4. Re-GET confirms nothing surfaces from either array.
      const getTwo = await app.inject({ method: 'GET', url: '/settings/permission-rules' });
      expect((JSON.parse(getTwo.body) as { rules: unknown[] }).rules).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('PUT rejects malformed bodies and does not touch the config file', async () => {
    writePermissionFile({
      rules: [{ permission: 'bash', pattern: 'ls *', action: 'allow' }],
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings/permission-rules',
        // Missing required `rules` field.
        payload: { other: true },
      });

      expect(response.statusCode).toBe(400);
      // Pre-existing rules survive the failed write.
      const persisted = readPermissionFile();
      expect(persisted['rules']).toEqual([
        { permission: 'bash', pattern: 'ls *', action: 'allow' },
      ]);
    } finally {
      await app.close();
    }
  });
});
