import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let app: FastifyInstance | null = null;
let closeDb: (() => Promise<void>) | null = null;

describe.skipIf(process.version.startsWith('v22.') || process.version.startsWith('v24.'))(
  'capabilities routes',
  () => {
    beforeEach(async () => {
      vi.resetModules();
      process.env['DATABASE_URL'] = ':memory:';

      const [
        { default: Fastify },
        { default: authPlugin },
        { capabilitiesRoutes, buildCapabilityContext },
        dbModule,
      ] = await Promise.all([
        import('fastify'),
        import('../auth.js'),
        import('../routes/capabilities.js'),
        import('../db.js'),
      ]);

      closeDb = dbModule.closeDb;
      await dbModule.connectDb();
      await dbModule.migrate();

      const userId = randomUUID();
      dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        userId,
        'admin@openAwork.local',
        createHash('sha256').update('admin123456').digest('hex'),
      ]);
      dbModule.sqliteRun(
        `INSERT INTO installed_skills (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
         VALUES (?, ?, ?, ?, '[]', 1, ?, ?)`,
        [
          'github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator',
          userId,
          'github:Await-d/agentdocs-orchestrator',
          JSON.stringify({
            id: 'github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator',
            displayName: 'Agentdocs Orchestrator',
            description: '任务编排技能',
            capabilities: ['planning'],
          }),
          Date.now(),
          Date.now(),
        ],
      );
      dbModule.sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'mcp_servers', ?)`,
        [
          userId,
          JSON.stringify([{ id: 'playwright', name: 'playwright', type: 'stdio', enabled: true }]),
        ],
      );

      expect(buildCapabilityContext(userId)).toContain('系统 Agents');
      expect(buildCapabilityContext(userId)).toContain('Agentdocs Orchestrator');
      expect(buildCapabilityContext(userId)).toContain('playwright');

      app = Fastify();
      await app.register(authPlugin);
      await app.register(capabilitiesRoutes);
      await app.ready();
    });

    afterEach(async () => {
      if (app) {
        await app.close();
        app = null;
      }
      if (closeDb) {
        await closeDb();
        closeDb = null;
      }
      delete process.env['DATABASE_URL'];
    });

    it('lists agents, skills, mcps, tools, and commands in a unified catalog', async () => {
      const loginRes = await app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@openAwork.local', password: 'admin123456' },
      });
      const { accessToken } = JSON.parse(loginRes.body) as { accessToken: string };

      const res = await app!.inject({
        method: 'GET',
        url: '/capabilities',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body) as {
        capabilities: Array<{
          kind: string;
          label: string;
          callable?: boolean;
          canonicalRole?: { coreRole: string; preset?: string };
          aliases?: string[];
        }>;
      };
      expect(
        body.capabilities.some((item) => item.kind === 'agent' && item.label === 'oracle'),
      ).toBe(true);
      expect(
        body.capabilities.some(
          (item) =>
            item.kind === 'agent' &&
            item.label === 'oracle' &&
            item.canonicalRole?.coreRole === 'planner' &&
            item.canonicalRole?.preset === 'architect' &&
            item.aliases?.includes('debugger') === true,
        ),
      ).toBe(true);
      expect(
        body.capabilities.some(
          (item) => item.kind === 'skill' && item.label === 'Agentdocs Orchestrator',
        ),
      ).toBe(true);
      expect(
        body.capabilities.some((item) => item.kind === 'mcp' && item.label === 'context7'),
      ).toBe(true);
      expect(
        body.capabilities.some((item) => item.kind === 'mcp' && item.label === 'grep_app'),
      ).toBe(false);
      expect(
        body.capabilities.some((item) => item.kind === 'tool' && item.label === 'web_search'),
      ).toBe(false);
      expect(
        body.capabilities.some((item) => item.kind === 'tool' && item.label === 'websearch'),
      ).toBe(true);
      expect(
        body.capabilities.some((item) => item.kind === 'tool' && item.label === 'webfetch'),
      ).toBe(true);
      expect(body.capabilities.some((item) => item.kind === 'tool' && item.label === 'list')).toBe(
        true,
      );
      expect(body.capabilities.some((item) => item.kind === 'tool' && item.label === 'glob')).toBe(
        true,
      );
      expect(body.capabilities.some((item) => item.kind === 'tool' && item.label === 'edit')).toBe(
        true,
      );
      expect(body.capabilities.some((item) => item.kind === 'tool' && item.label === 'batch')).toBe(
        true,
      );
      expect(body.capabilities.some((item) => item.kind === 'tool' && item.label === 'Skill')).toBe(
        true,
      );
      expect(body.capabilities.some((item) => item.kind === 'tool' && item.label === 'bash')).toBe(
        true,
      );
      expect(
        body.capabilities.some((item) => item.kind === 'tool' && item.label === 'apply_patch'),
      ).toBe(true);
      expect(
        body.capabilities.some((item) => item.kind === 'tool' && item.label === 'AskUserQuestion'),
      ).toBe(true);
      expect(body.capabilities.some((item) => item.kind === 'tool' && item.label === 'task')).toBe(
        true,
      );
      expect(
        body.capabilities.some(
          (item) => item.kind === 'tool' && item.label === 'background_output',
        ),
      ).toBe(true);
      expect(
        body.capabilities.some(
          (item) => item.kind === 'tool' && item.label === 'background_cancel',
        ),
      ).toBe(true);
      expect(body.capabilities.some((item) => item.kind === 'tool' && item.label === 'read')).toBe(
        true,
      );
      expect(body.capabilities.some((item) => item.kind === 'tool' && item.label === 'grep')).toBe(
        true,
      );
      expect(body.capabilities.some((item) => item.kind === 'tool' && item.label === 'write')).toBe(
        true,
      );
      expect(
        body.capabilities.some((item) => item.kind === 'tool' && item.label === 'mcp_call'),
      ).toBe(true);
      expect(
        body.capabilities.filter((item) => item.kind === 'tool' && item.label === 'read').length,
      ).toBe(1);
      expect(
        body.capabilities.filter((item) => item.kind === 'tool' && item.label === 'lsp_diagnostics')
          .length,
      ).toBe(1);
      expect(
        body.capabilities.some(
          (item) => item.kind === 'tool' && item.label === 'lsp_goto_definition',
        ),
      ).toBe(true);
      expect(
        body.capabilities.some(
          (item) => item.kind === 'tool' && item.label === 'lsp_goto_implementation',
        ),
      ).toBe(true);
      expect(
        body.capabilities.some(
          (item) => item.kind === 'tool' && item.label === 'lsp_find_references',
        ),
      ).toBe(true);
      expect(
        body.capabilities.some((item) => item.kind === 'tool' && item.label === 'lsp_symbols'),
      ).toBe(true);
      expect(
        body.capabilities.some(
          (item) => item.kind === 'tool' && item.label === 'lsp_prepare_rename',
        ),
      ).toBe(true);
      expect(
        body.capabilities.some((item) => item.kind === 'tool' && item.label === 'lsp_rename'),
      ).toBe(true);
      expect(
        body.capabilities.some((item) => item.kind === 'tool' && item.label === 'lsp_hover'),
      ).toBe(true);
      expect(
        body.capabilities.some(
          (item) =>
            item.kind === 'mcp' &&
            item.label === 'context7' &&
            (item as { callable?: boolean }).callable === false,
        ),
      ).toBe(true);
      expect(
        body.capabilities.some((item) => item.kind === 'command' && item.label === '/compact'),
      ).toBe(true);
    });

    it('builds capability context with session-level tool visibility when sessionId is provided', async () => {
      const [{ buildCapabilityContext }, dbModule] = await Promise.all([
        import('../routes/capabilities.js'),
        import('../db.js'),
      ]);

      const userId = randomUUID();
      const sessionId = randomUUID();
      dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        userId,
        'scoped@openAwork.local',
        createHash('sha256').update('scoped123456').digest('hex'),
      ]);
      dbModule.sqliteRun(
        `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', ?)`,
        [sessionId, userId, JSON.stringify({ createdByTool: 'task', parentSessionId: 'parent-1' })],
      );

      const scopedContext = buildCapabilityContext(userId, sessionId);
      expect(scopedContext).toContain('聊天可调用工具');
      expect(scopedContext).toContain('read');
      expect(scopedContext).not.toContain('task:');
      expect(scopedContext).not.toContain('AskUserQuestion:');
    });
  },
);
