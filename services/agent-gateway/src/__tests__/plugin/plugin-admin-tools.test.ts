/**
 * `plugin_manage` 管理模块单测（真实 DB + 隔离数据目录 + mock 网络）。
 *
 * 覆盖：
 *   1. 输入 schema 的 superRefine（各 action 的前置参数 fail-closed）；
 *   2. 会话守卫纯函数（team / cron / channel 拒绝，普通会话放行）；
 *   3. run 函数：list（空态 hint）/ source 往返 / search（mock 清单）/
 *      install（mock zipball → 激活）/ 失败路径（路径不存在、未加载插件）。
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AdminToolsModule from '../../plugin/plugin-admin-tools.js';
import type * as DbModule from '../../infra/db.js';
import type * as MarketplaceModule from '../../plugin/marketplace.js';
import type * as PluginHostModule from '../../runtime/plugin-host.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const ORIGINAL_DATA_DIR = process.env['OPENAWORK_DATA_DIR'];
process.env['OPENAWORK_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'openawork-plugin-manage-'));

let db: typeof DbModule;
let admin: typeof AdminToolsModule;
let marketplace: typeof MarketplaceModule;
let pluginHost: typeof PluginHostModule;

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  admin = await import('../../plugin/plugin-admin-tools.js');
  marketplace = await import('../../plugin/marketplace.js');
  pluginHost = await import('../../runtime/plugin-host.js');
}, 60_000);

afterAll(() => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env['OPENAWORK_DATA_DIR'];
  else process.env['OPENAWORK_DATA_DIR'] = ORIGINAL_DATA_DIR;
});

beforeEach(() => {
  pluginHost._resetPluginsForTest();
  marketplace.clearPluginMarketCache();
  db.sqliteRun('DELETE FROM plugin_sources', []);
  db.sqliteRun('DELETE FROM plugin_state', []);
  db.sqliteRun('DELETE FROM sessions', []);
  db.sqliteRun('DELETE FROM users', []);
  db.sqliteRun(
    "INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'x')",
    [],
  );
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES ('s-normal', 'u1', 't', '{"workingDirectory":"/tmp"}', 'idle')`,
    [],
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(handler: (url: string) => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => handler(String(input))),
  );
}

describe('plugin_manage schema', () => {
  it('变更动作缺前置参数时 fail-closed', () => {
    expect(admin.pluginManageInputSchema.safeParse({ action: 'uninstall' }).success).toBe(false);
    expect(admin.pluginManageInputSchema.safeParse({ action: 'reload' }).success).toBe(false);
    expect(admin.pluginManageInputSchema.safeParse({ action: 'enable' }).success).toBe(false);
    expect(admin.pluginManageInputSchema.safeParse({ action: 'disable' }).success).toBe(false);
    expect(admin.pluginManageInputSchema.safeParse({ action: 'source_add' }).success).toBe(false);
    expect(admin.pluginManageInputSchema.safeParse({ action: 'source_remove' }).success).toBe(
      false,
    );
    expect(admin.pluginManageInputSchema.safeParse({ action: 'install' }).success).toBe(false);
  });

  it('install 接受市场条目或 GitHub 直装两种形态', () => {
    expect(
      admin.pluginManageInputSchema.safeParse({
        action: 'install',
        sourceId: 'acme/plugins',
        name: 'echo',
      }).success,
    ).toBe(true);
    expect(
      admin.pluginManageInputSchema.safeParse({ action: 'install', repo: 'acme/plugins' }).success,
    ).toBe(true);
    expect(admin.pluginManageInputSchema.safeParse({ action: 'list' }).success).toBe(true);
  });
});

describe('plugin_manage session guard', () => {
  const baseRow = {
    metadata_json: '{}',
    role_layer: null,
    team_parent_session_id: null,
    handoff_state: null,
  };

  it('普通会话放行；缺失行 / team / cron / channel 拒绝', () => {
    expect(admin.resolvePluginManageSessionDenial(null)).toContain('拒绝');
    expect(admin.resolvePluginManageSessionDenial(baseRow)).toBeNull();
    expect(
      admin.resolvePluginManageSessionDenial({ ...baseRow, role_layer: 'executor' }),
    ).toContain('团队会话');
    expect(
      admin.resolvePluginManageSessionDenial({
        ...baseRow,
        metadata_json: JSON.stringify({ source: 'cron' }),
      }),
    ).toContain('定时任务');
    expect(
      admin.resolvePluginManageSessionDenial({
        ...baseRow,
        metadata_json: JSON.stringify({ source: 'channel' }),
      }),
    ).toContain('消息渠道');
  });
});

describe('plugin_manage run', () => {
  it('list：空态返回 JSON 与 hint', async () => {
    const output = await admin.runPluginManageTool({
      userId: 'u1',
      sessionId: 's-normal',
      input: { action: 'list' },
    });
    const payload = JSON.parse(output) as { ok: boolean; count: number; hint?: string };
    expect(payload.ok).toBe(true);
    expect(payload.count).toBe(0);
    expect(payload.hint).toBeTruthy();
  });

  it('source_add → source_list → source_remove 往返', async () => {
    const addOutput = await admin.runPluginManageTool({
      userId: 'u1',
      sessionId: 's-normal',
      input: { action: 'source_add', repo: 'acme/plugins' },
    });
    expect(JSON.parse(addOutput)).toMatchObject({
      ok: true,
      action: 'source_add',
      source: { sourceId: 'acme/plugins', repo: 'acme/plugins' },
    });

    const listOutput = await admin.runPluginManageTool({
      userId: 'u1',
      sessionId: 's-normal',
      input: { action: 'source_list' },
    });
    expect(JSON.parse(listOutput)).toMatchObject({ ok: true, count: 1 });

    const removeOutput = await admin.runPluginManageTool({
      userId: 'u1',
      sessionId: 's-normal',
      input: { action: 'source_remove', sourceId: 'acme/plugins' },
    });
    expect(JSON.parse(removeOutput)).toMatchObject({ ok: true, removed: true });

    await expect(
      admin.runPluginManageTool({
        userId: 'u1',
        sessionId: 's-normal',
        input: { action: 'source_remove', sourceId: 'acme/plugins' },
      }),
    ).rejects.toThrow(/不存在/);
  });

  it('search：mock 清单返回条目', async () => {
    await admin.runPluginManageTool({
      userId: 'u1',
      sessionId: 's-normal',
      input: { action: 'source_add', repo: 'acme/plugins' },
    });
    stubFetch((url) =>
      url.endsWith('/openawork-plugins.json')
        ? jsonResponse({
            plugins: [
              { name: 'echo', path: 'plugins/echo', description: '回声', version: '1.0.0' },
            ],
          })
        : new Response('nf', { status: 404 }),
    );

    const output = await admin.runPluginManageTool({
      userId: 'u1',
      sessionId: 's-normal',
      input: { action: 'search' },
    });
    const payload = JSON.parse(output) as { ok: boolean; count: number; entries: unknown[] };
    expect(payload.ok).toBe(true);
    expect(payload.count).toBe(1);
    expect(payload.entries[0]).toMatchObject({ name: 'echo', repo: 'acme/plugins' });
  });

  it('install：mock zipball 安装 → 激活 → list 可见 → uninstall 清理', async () => {
    const archive = zipSync({
      'acme-plugins-sha/plugins/tool-demo/index.mjs': strToU8(
        "export default { id: 'demo.plugin', setup() {} };\n",
      ),
    });
    stubFetch((url) =>
      url.includes('api.github.com')
        ? new Response(archive, { status: 200 })
        : new Response('nf', { status: 404 }),
    );

    const installOutput = await admin.runPluginManageTool({
      userId: 'u1',
      sessionId: 's-normal',
      input: { action: 'install', repo: 'acme/plugins', path: 'plugins/tool-demo' },
    });
    const installed = JSON.parse(installOutput) as {
      ok: boolean;
      install: { installId: string };
      source: { repo: string; path: string };
      plugin: { id: string; state: { status: string } } | null;
      notice: string;
    };
    expect(installed.ok).toBe(true);
    expect(installed.install.installId).toBe('tool-demo');
    expect(installed.source).toEqual({ repo: 'acme/plugins', path: 'plugins/tool-demo' });
    expect(installed.plugin?.id).toBe('demo.plugin');
    expect(installed.plugin?.state.status).toBe('active');
    expect(installed.notice).toContain('没有沙箱');

    const listOutput = await admin.runPluginManageTool({
      userId: 'u1',
      sessionId: 's-normal',
      input: { action: 'list' },
    });
    const listed = JSON.parse(listOutput) as {
      count: number;
      plugins: Array<{ id: string; installId?: string; state: string }>;
    };
    // 3 个内置插件组（guarded）+ 刚安装的 demo.plugin。
    expect(listed.count).toBe(4);
    expect(listed.plugins.find((entry) => entry.id === 'demo.plugin')).toMatchObject({
      id: 'demo.plugin',
      installId: 'tool-demo',
      state: 'active',
    });
    expect(listed.plugins.find((entry) => entry.id === 'builtin.image-generation')).toMatchObject({
      id: 'builtin.image-generation',
      state: 'active',
    });

    const uninstallOutput = await admin.runPluginManageTool({
      userId: 'u1',
      sessionId: 's-normal',
      input: { action: 'uninstall', installId: 'tool-demo' },
    });
    expect(JSON.parse(uninstallOutput)).toMatchObject({ ok: true, action: 'uninstall' });

    const afterOutput = await admin.runPluginManageTool({
      userId: 'u1',
      sessionId: 's-normal',
      input: { action: 'list' },
    });
    const after = JSON.parse(afterOutput) as {
      count: number;
      plugins: Array<{ id: string }>;
    };
    expect(after.count).toBe(3);
    expect(after.plugins.some((entry) => entry.id === 'demo.plugin')).toBe(false);
  });

  it('install：仓库路径不存在时抛错', async () => {
    stubFetch(() => new Response(zipSync({ 'acme-x/README.md': strToU8('# x') }), { status: 200 }));

    await expect(
      admin.runPluginManageTool({
        userId: 'u1',
        sessionId: 's-normal',
        input: { action: 'install', repo: 'acme/plugins', path: 'plugins/missing' },
      }),
    ).rejects.toThrow(/安装失败/);
  });

  it('disable：未加载插件抛错', async () => {
    await expect(
      admin.runPluginManageTool({
        userId: 'u1',
        sessionId: 's-normal',
        input: { action: 'disable', pluginId: 'missing.plugin' },
      }),
    ).rejects.toThrow(/is not loaded/);
  });
});
