import { resolvePermissionCategory } from '@openAwork/agent-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as PermissionRulesModule from '../../permission/permission-rules.js';
import type * as SandboxModule from '../../tools/tool-sandbox.js';
import type * as DefinitionsModule from '../../tools/tool-definitions.js';
import type * as VisibilityModule from '../../session/session-tool-visibility.js';
import type * as ToolsetModule from '../../handoff/capability/toolset-gate.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_DATABASE_PATH'] = ':memory:';

let db: typeof DbModule;
let sandbox: typeof SandboxModule;
let permissionRules: typeof PermissionRulesModule;
let definitions: typeof DefinitionsModule;
let visibility: typeof VisibilityModule;
let toolsets: typeof ToolsetModule;

const input = { session_id: 'permission-child', request_id: 'permission-approval' };
const rawInput = {
  command: `bun -e '${'完整参数不能截断；'.repeat(1500)}'`,
  workdir: '/workspace',
  timeout: 120000,
  nested: { values: ['保留嵌套数据', 42, false] },
};

function setMetadata(metadata: Record<string, unknown>): void {
  db.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
    JSON.stringify(metadata),
    'permission-parent',
  ]);
}

async function execute(
  folded = false,
  callingSession = 'permission-parent',
  argumentsInput: Record<string, unknown> = input,
) {
  return sandbox.createDefaultSandbox().execute(
    {
      toolCallId: `permission-get-${callingSession}-${folded}`,
      toolName: folded ? 'tool_invoke' : 'permission_get',
      rawInput: folded ? { tool: 'permission_get', arguments: argumentsInput } : argumentsInput,
    },
    new AbortController().signal,
    callingSession,
    { clientRequestId: 'permission-get-turn', nextRound: 1, requestData: {} },
  );
}

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  sandbox = await import('../../tools/tool-sandbox.js');
  permissionRules = await import('../../permission/permission-rules.js');
  definitions = await import('../../tools/tool-definitions.js');
  visibility = await import('../../session/session-tool-visibility.js');
  toolsets = await import('../../handoff/capability/toolset-gate.js');
});

beforeEach(() => {
  db.sqliteRun('DELETE FROM permission_requests');
  db.sqliteRun('DELETE FROM sessions');
  db.sqliteRun('DELETE FROM users');
  for (const user of ['permission-owner', 'permission-foreign']) {
    db.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      user,
      `${user}@test.local`,
      'x',
    ]);
  }
  for (const [id, userId, parentId] of [
    ['permission-parent', 'permission-owner', null],
    ['permission-child', 'permission-owner', 'permission-parent'],
    ['permission-foreign-session', 'permission-foreign', null],
  ] as const) {
    db.sqliteRun('INSERT INTO sessions (id, user_id, title, parent_id) VALUES (?, ?, ?, ?)', [
      id,
      userId,
      id,
      parentId,
    ]);
  }
  db.sqliteRun(
    `INSERT INTO permission_requests
       (id, session_id, tool_name, scope, reason, risk_level, status, request_payload_json)
     VALUES (?, ?, 'bash', '完整命令', '需要审批', 'high', 'deciding', ?)`,
    [
      input.request_id,
      input.session_id,
      JSON.stringify({
        toolCallId: 'blocked-call',
        clientRequestId: 'blocked-turn',
        rawInput,
        requestData: { secret: 'private-resume-data' },
        blockedToolCalls: [{ rawInput: { secret: 'private-sibling-call' } }],
      }),
    ],
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.closeDb();
});

describe('permission_get 真实沙箱与 SQLite 安全边界', () => {
  it.each([false, true])('同用户父会话读取子会话完整参数，folded=%s', async (folded) => {
    setMetadata({ toolInvokeAllowlist: ['permission_get'] });
    const before = db.sqliteGet('SELECT * FROM permission_requests WHERE id = ?', [
      input.request_id,
    ]);
    const result = await execute(folded);
    expect(result.isError).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(result.output).toMatchObject({
      request: {
        requestId: input.request_id,
        sessionId: input.session_id,
        toolName: 'bash',
        status: 'deciding',
        execution: {
          available: true,
          toolCallId: 'blocked-call',
          clientRequestId: 'blocked-turn',
          rawInput,
        },
      },
    });
    expect(JSON.stringify(result.output)).not.toContain('private-resume-data');
    expect(JSON.stringify(result.output)).not.toContain('private-sibling-call');
    expect(
      db.sqliteGet('SELECT * FROM permission_requests WHERE id = ?', [input.request_id]),
    ).toEqual(before);
    expect(db.sqliteGet('SELECT COUNT(*) AS n FROM permission_requests')).toEqual({ n: 1 });
  });

  it('外部用户的真实调用会话无法读取所有者的请求', async () => {
    const result = await execute(false, 'permission-foreign-session');
    expect(result.isError).toBe(false);
    expect(result.output).toEqual({ request: null });
  });

  it.each([false, true])('伪造 userId 额外参数被拒绝，folded=%s', async (folded) => {
    db.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
      JSON.stringify({ toolInvokeAllowlist: ['permission_get'] }),
      'permission-foreign-session',
    ]);
    const result = await execute(folded, 'permission-foreign-session', {
      ...input,
      userId: 'permission-owner',
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.output)).toContain('userId');
    expect(JSON.stringify(result.output)).not.toContain(rawInput.command);
  });

  it('调用会话不存在时关闭读取入口', async () => {
    const result = await execute(false, 'permission-missing-session');
    expect(result.isError).toBe(true);
    expect(result.output).toEqual({ request: null });
  });

  it.each([false, true])('clarify 模式保留只读查询，folded=%s', async (folded) => {
    setMetadata({ dialogueMode: 'clarify', toolInvokeAllowlist: ['permission_get'] });
    const result = await execute(folded);
    expect(result.isError).toBe(false);
    expect(result.output).toMatchObject({ request: { execution: { available: true, rawInput } } });
  });

  it('缺少折叠工具 allowlist 时拒绝调用', async () => {
    const result = await execute(true);
    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('not available in this session');
  });

  it.each([false, true])('source=channel 默认拒绝读取权限详情，folded=%s', async (folded) => {
    setMetadata({ source: 'channel', toolInvokeAllowlist: ['permission_get'] });
    const result = await execute(folded);
    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/disabled|not enabled/);
    expect(JSON.stringify(result.output)).not.toContain('blocked-call');
  });

  it.each([false, true])('显式 deny 覆盖只读默认放行，folded=%s', async (folded) => {
    setMetadata({
      workingDirectory: process.env['XDG_DOCUMENTS_DIR'],
      permissionMode: 'yolo',
      toolInvokeAllowlist: ['permission_get'],
    });
    // 当前模块将文件读取入口导出为 loadWorkspacePermissionRules；只替换规则文件 IO。
    const readRules = vi
      .spyOn(permissionRules, 'loadWorkspacePermissionRules')
      .mockReturnValue([{ permission: 'permission_get', pattern: '*', action: 'deny' }]);
    const result = await execute(folded);
    expect(readRules).toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('被权限规则禁止');
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(db.sqliteGet('SELECT COUNT(*) AS n FROM permission_requests')).toEqual({ n: 1 });
  });

  it('模型可见注册保留严格参数、独立权限分类与团队只读工具面', () => {
    const tools = definitions.buildGatewayToolDefinitions();
    const definition = tools.find((tool) => tool.function.name === 'permission_get');
    expect(definition).toBeDefined();
    expect(definition?.function.parameters).toMatchObject({
      type: 'object',
      properties: { session_id: { type: 'string' }, request_id: { type: 'string' } },
      required: ['session_id', 'request_id'],
      additionalProperties: false,
    });
    expect(resolvePermissionCategory('permission_get')).toBe('permission_get');
    expect(visibility.isGatewayToolEnabledForSessionMetadata('permission_get', {})).toBe(true);
    expect(
      toolsets
        .filterToolsByAllowedSets(tools, ['read'])
        .some((tool) => tool.function.name === 'permission_get'),
    ).toBe(true);
  });

  it('权限阶梯新建请求即保存实际工具名，不依赖同轮后续回填', async () => {
    setMetadata({ workingDirectory: process.env['XDG_DOCUMENTS_DIR'] });
    const workspaceSafety = await import('../../workspace/workspace-safety.js');
    vi.spyOn(workspaceSafety, 'hasWorkspacePermanentPermission').mockReturnValue(false);
    vi.spyOn(permissionRules, 'loadWorkspacePermissionRules').mockReturnValue([
      { permission: 'bash', pattern: '*', action: 'ask' },
    ]);
    const state = await sandbox.ensurePermissionForTool(
      'permission-parent',
      {
        toolCallId: 'new-call',
        toolName: 'run_bash_in_background',
        rawInput: { command: 'custom-command' },
      },
      undefined,
      { clientRequestId: 'new-turn', nextRound: 1, requestData: {} },
    );
    expect(state.kind).toBe('pending');
    if (state.kind !== 'pending') throw new Error('预期创建待审批请求');
    const { runPermissionGetTool } = await import('../../permission/permission-get-tool.js');
    expect(
      runPermissionGetTool('permission-owner', {
        session_id: 'permission-parent',
        request_id: state.requestId,
      }).request,
    ).toMatchObject({
      permissionCategory: 'bash',
      execution: {
        available: true,
        toolName: 'run_bash_in_background',
        rawInput: { command: 'custom-command' },
      },
    });
  });

  it('数据库查询异常被沙箱转成工具错误，不打断调用方', async () => {
    const sqliteGet = db.sqliteGet;
    vi.spyOn(db, 'sqliteGet').mockImplementation((query, params) => {
      if (query.includes('FROM permission_requests p JOIN sessions')) {
        throw new Error('simulated database read failure');
      }
      return sqliteGet(query, params);
    });
    const result = await execute();
    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('simulated database read failure');
  });
});
