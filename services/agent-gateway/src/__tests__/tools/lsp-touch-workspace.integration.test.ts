import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type { ToolSandbox } from '../../tools/tool-sandbox.js';

const mocks = vi.hoisted(() => ({ touchFile: vi.fn(async () => undefined) }));

// 保留真实沙箱、权限派生、SQLite、工作区与 agentignore 校验，只替换 LSP 边界。
vi.mock('../../lsp/router.js', () => ({ lspManager: { touchFile: mocks.touchFile } }));

let db: typeof DbModule;
let sandbox: ToolSandbox;
let root: string;
let workspace: string;
const USER_ID = 'lsp-touch-user';
const SESSION_ID = 'lsp-touch-session';

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'openawork-lsp-touch-')));
  workspace = join(root, 'workspace');
  await mkdir(join(workspace, 'src'), { recursive: true });
  await writeFile(join(workspace, 'src', 'file.ts'), 'export const value = 1;');
  await writeFile(join(root, 'outside.ts'), 'export const secret = 1;');
  await writeFile(join(workspace, '.env'), 'SECRET=protected');
  await symlink(join(root, 'outside.ts'), join(workspace, 'escape.ts'));

  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  const { ToolSandbox } = await import('../../tools/tool-sandbox.js');
  const { gatewayLspTouchTool } = await import('../../tools/sandbox/context.js');
  sandbox = new ToolSandbox({ allowedTools: ['lsp_touch'] });
  sandbox.register(gatewayLspTouchTool);
  db.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'LSP boundary', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

beforeEach(() => {
  mocks.touchFile.mockClear();
  // 不配置 yolo 或 allow 规则：成功用例必须走真实 default-allowed 路径。
  db.sqliteRun('UPDATE sessions SET metadata_json = ?, role_layer = NULL WHERE id = ?', [
    JSON.stringify({ workingDirectory: workspace }),
    SESSION_ID,
  ]);
});

afterAll(async () => {
  await db?.closeDb();
  if (root) await rm(root, { recursive: true, force: true });
});

function touch(path: string, waitForDiagnostics = true) {
  return sandbox.execute(
    {
      toolCallId: `touch-${path}`,
      toolName: 'lsp_touch',
      rawInput: { path, waitForDiagnostics },
    },
    new AbortController().signal,
    SESSION_ID,
  );
}

describe('原生 lsp_touch 工作区边界', () => {
  it.each([true, false])('工作区内相对路径归一化后交给 LSP（等待诊断：%s）', async (wait) => {
    const result = await touch('src/../src/file.ts', wait);
    expect(result.isError, String(result.output)).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(mocks.touchFile).toHaveBeenCalledExactlyOnceWith(
      join(workspace, 'src', 'file.ts'),
      wait,
    );
  });

  it.each(['absolute', 'traversal', 'symlink'] as const)(
    '拒绝工作区外路径（%s），不调用 LSP',
    async (kind) => {
      const path = {
        absolute: join(root, 'outside.ts'),
        traversal: '../outside.ts',
        symlink: 'escape.ts',
      }[kind];
      const result = await touch(path);
      expect(result.isError).toBe(true);
      expect(String(result.output)).toMatch(/超出当前工作区范围|Forbidden workspace path/);
      expect(mocks.touchFile).not.toHaveBeenCalled();
    },
  );

  it('拒绝 agentignore 保护的文件，不调用 LSP', async () => {
    const result = await touch('.env');
    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('protected by agentignore rules');
    expect(mocks.touchFile).not.toHaveBeenCalled();
  });

  it('拒绝未绑定工作区的团队会话，不调用 LSP', async () => {
    db.sqliteRun("UPDATE sessions SET metadata_json = '{}', role_layer = 'executor' WHERE id = ?", [
      SESSION_ID,
    ]);
    const result = await touch(join(workspace, 'src', 'file.ts'));
    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('未绑定工作区');
    expect(mocks.touchFile).not.toHaveBeenCalled();
  });
});
