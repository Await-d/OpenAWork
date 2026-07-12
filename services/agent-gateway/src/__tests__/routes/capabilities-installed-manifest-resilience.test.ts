/**
 * Regression (§0.119, capabilities installed-skill manifest per-row tolerance):
 * listCapabilitiesForUser reads enabled installed_skills via json_group_array
 * and parsed each manifest_json. The inner per-manifest JSON.parse lived inside
 * the outer try, so one corrupt manifest row (crash mid-write, disk error,
 * hand-edited DB) made the outer catch drop the user's ENTIRE installed-skill
 * capability view (shown to the model via buildCapabilityContext + the
 * /capabilities route), not just the bad skill. The inner parse now skips the
 * bad row individually. We seed one healthy + one corrupt enabled installed
 * skill and assert the healthy one still surfaces.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as CapabilitiesModule from '../../routes/capabilities.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type { CapabilityDescriptor } from '@openAwork/shared';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let capabilities: typeof CapabilitiesModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;

const USER_ID = 'u-capabilities';
const HEALTHY_SKILL_ID = 'com.example.healthy-cap';
const POISON_SKILL_ID = 'com.example.poison-cap';

function seedInstalledSkill(skillId: string, manifestJson: string): void {
  const now = Date.now();
  dbModule.sqliteRun(
    `INSERT INTO installed_skills
       (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, 'src', ?, '[]', 1, ?, ?)`,
    [skillId, USER_ID, manifestJson, now, now],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  const auth = await import('../../infra/auth.js');
  authPlugin = auth.default;
  const requestWorkflow = await import('../../runtime/request-workflow.js');
  requestWorkflowPlugin = requestWorkflow.default;
  capabilities = await import('../../routes/capabilities.js');
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM installed_skills', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(capabilities.capabilitiesRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` })}`;
}

describe('listCapabilitiesForUser installed-manifest resilience', () => {
  it('包含 resource agents 和 reference-only resource commands，但参考命令不可直接调用', () => {
    const caps = capabilities.listCapabilitiesForUser(USER_ID);

    expect(caps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'resource-code-reviewer',
          kind: 'agent',
          source: 'builtin',
          callable: false,
        }),
        expect.objectContaining({
          id: 'resource-command-commit',
          kind: 'command',
          source: 'reference',
          callable: false,
          tags: ['reference-resource', 'commit'],
        }),
      ]),
    );
    expect(
      caps.some(
        (capability) =>
          capability.id === 'resource-command-commit' &&
          capability.kind === 'command' &&
          capability.callable === true,
      ),
    ).toBe(false);
  });

  it('单行 manifest_json 损坏时不丢掉整份已安装技能能力，健康技能仍出现', () => {
    seedInstalledSkill(
      HEALTHY_SKILL_ID,
      JSON.stringify({
        id: HEALTHY_SKILL_ID,
        name: 'healthy-cap',
        displayName: 'Healthy Cap',
        description: 'a healthy installed skill',
        capabilities: ['cap.test'],
      }),
    );
    seedInstalledSkill(POISON_SKILL_ID, '{not valid json');

    let caps: CapabilityDescriptor[] | undefined;
    expect(() => {
      caps = capabilities.listCapabilitiesForUser(USER_ID);
    }).not.toThrow();

    const installedSkillIds = (caps ?? [])
      .filter((c) => c.kind === 'skill' && c.source === 'installed')
      .map((c) => c.id);
    // The healthy installed skill survived despite the poison row.
    expect(installedSkillIds).toContain(HEALTHY_SKILL_ID);
    // The corrupt manifest produced no descriptor.
    expect(installedSkillIds).not.toContain(POISON_SKILL_ID);
    expect(console.warn).toHaveBeenCalled();
  });

  it('会按 session metadata 中的 capabilityContext 开关裁剪注入段落', () => {
    const sessionId = 'session-capability-context-some-disabled';
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json)
       VALUES (?, ?, 'cap test', '[]', 'idle', ?)`,
      [
        sessionId,
        USER_ID,
        JSON.stringify({
          channel: {
            promptInjections: {
              capabilityContext: {
                agents: false,
                skills: true,
                mcps: false,
                tools: true,
                commands: false,
              },
            },
          },
        }),
      ],
    );

    const context = capabilities.buildCapabilityContext(USER_ID, sessionId);

    expect(context).not.toContain('## 系统 Agents');
    expect(context).toContain('## 系统 Skills');
    expect(context).not.toContain('## 系统 MCP Servers');
    expect(context).toContain('## 聊天可调用工具');
    expect(context).not.toContain('## 系统 Commands');
  });

  it('会按 tools 的细分组开关注入工具目录条目', () => {
    const sessionId = 'session-capability-context-tool-groups';
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json)
       VALUES (?, ?, 'cap tool groups', '[]', 'idle', ?)`,
      [
        sessionId,
        USER_ID,
        JSON.stringify({
          source: 'channel',
          channelLlmToolsEnabled: true,
          webSearchEnabled: true,
          channel: {
            type: 'telegram',
            tools: {
              web_search: true,
              read: true,
            },
            promptInjections: {
              capabilityContext: {
                agents: false,
                skills: false,
                mcps: false,
                tools: true,
                toolGroups: {
                  web: true,
                  lsp: false,
                  files: false,
                  shell: false,
                  orchestration: false,
                  session: false,
                  mcp: false,
                  desktop: false,
                  repo: false,
                  channel: false,
                  other: false,
                },
                commands: false,
              },
            },
          },
        }),
      ],
    );

    const context = capabilities.buildCapabilityContext(USER_ID, sessionId);

    expect(context).toContain('- websearch:');
    expect(context).not.toContain('- lsp_goto_definition:');
    expect(context).not.toContain('- list:');
    expect(context).not.toContain('- PluginSendMessage:');
  });

  it('会在 capabilityContext 五段都关闭时返回空字符串', () => {
    const sessionId = 'session-capability-context-all-disabled';
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json)
       VALUES (?, ?, 'cap test none', '[]', 'idle', ?)`,
      [
        sessionId,
        USER_ID,
        JSON.stringify({
          channel: {
            promptInjections: {
              capabilityContext: {
                agents: false,
                skills: false,
                mcps: false,
                tools: false,
                commands: false,
              },
            },
          },
        }),
      ],
    );

    expect(capabilities.buildCapabilityContext(USER_ID, sessionId)).toBe('');
  });

  it('channel preview 路由会按真实运行时工具可见性返回分组计数', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/capabilities/channel-preview',
        headers: { authorization: bearer(app) },
        payload: {
          type: 'telegram',
          channelLlmToolsEnabled: true,
          tools: {
            read: true,
            bash: true,
            task: true,
            mcp: true,
            PluginSendMessage: false,
          },
          permissions: {
            allowReadHome: false,
            readablePathPrefixes: [],
            allowWriteOutside: false,
            allowShell: false,
            allowSubAgents: false,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        readonly counts: {
          readonly toolGroups: {
            readonly files: number;
            readonly lsp: number;
            readonly shell: number;
            readonly orchestration: number;
            readonly mcp: number;
            readonly repo: number;
            readonly channel: number;
            readonly web: number;
          };
        };
      };

      expect(body.counts.toolGroups.files).toBeGreaterThan(0);
      expect(body.counts.toolGroups.lsp).toBeGreaterThan(0);
      expect(body.counts.toolGroups.repo).toBeGreaterThan(0);
      expect(body.counts.toolGroups.mcp).toBeGreaterThan(0);
      expect(body.counts.toolGroups.orchestration).toBe(0);
      expect(body.counts.toolGroups.web).toBe(0);
    } finally {
      await app.close();
    }
  });
});
