/**
 * workspace ctx 会话级冻结回归：
 *   - 首次构建后落快照；同会话后续请求不再重建（stable system 前缀字节稳定）；
 *   - 工作区路径变化视为失效并重建；
 *   - build 返回 null（未绑定工作区）不落快照；
 *   - OPENAWORK_DISABLE_WORKSPACE_CTX_FREEZE=1 回退每请求重建。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SnapshotModule from '../../session/workspace-context-snapshot.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let snapshotModule: typeof SnapshotModule;

const USER_ID = 'u-workspace-ctx-freeze';
const SESSION_ID = 'sess-workspace-ctx-freeze';

function readMetadata(): Record<string, unknown> {
  const row = dbModule.sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [SESSION_ID, USER_ID],
  );
  return JSON.parse(row?.metadata_json ?? '{}') as Record<string, unknown>;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  snapshotModule = await import('../../session/workspace-context-snapshot.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, messages_json, metadata_json, state_status)
     VALUES (?, ?, 'ctx freeze', '[]', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await dbModule.closeDb();
});

describe('resolveFrozenWorkspaceContext', () => {
  it('首次构建并落快照，后续请求直接命中快照（不重建）', async () => {
    const build = vi.fn(async () => '<workspace path="/repo">v1</workspace>');
    const first = await snapshotModule.resolveFrozenWorkspaceContext({
      sessionId: SESSION_ID,
      userId: USER_ID,
      workspacePath: '/repo',
      build,
    });
    expect(first).toContain('v1');
    expect(build).toHaveBeenCalledTimes(1);

    // 即使工作区内容已变化（build 会返回 v2），同路径仍返回冻结的 v1。
    const changedBuild = vi.fn(async () => '<workspace path="/repo">v2</workspace>');
    const second = await snapshotModule.resolveFrozenWorkspaceContext({
      sessionId: SESSION_ID,
      userId: USER_ID,
      workspacePath: '/repo',
      build: changedBuild,
    });
    expect(second).toContain('v1');
    expect(changedBuild).not.toHaveBeenCalled();
    expect(readMetadata()['workspaceCtxSnapshot']).toMatchObject({ workspacePath: '/repo' });
  });

  it('工作区路径变化时视为失效并重建快照', async () => {
    await snapshotModule.resolveFrozenWorkspaceContext({
      sessionId: SESSION_ID,
      userId: USER_ID,
      workspacePath: '/repo-a',
      build: async () => '<workspace path="/repo-a">A</workspace>',
    });
    const rebuilt = await snapshotModule.resolveFrozenWorkspaceContext({
      sessionId: SESSION_ID,
      userId: USER_ID,
      workspacePath: '/repo-b',
      build: async () => '<workspace path="/repo-b">B</workspace>',
    });
    expect(rebuilt).toContain('/repo-b');
    expect(readMetadata()['workspaceCtxSnapshot']).toMatchObject({ workspacePath: '/repo-b' });
  });

  it('build 返回 null（未绑定工作区）时不落快照', async () => {
    const result = await snapshotModule.resolveFrozenWorkspaceContext({
      sessionId: SESSION_ID,
      userId: USER_ID,
      workspacePath: null,
      build: async () => null,
    });
    expect(result).toBeNull();
    expect(readMetadata()['workspaceCtxSnapshot']).toBeUndefined();
  });

  it('OPENAWORK_DISABLE_WORKSPACE_CTX_FREEZE=1 时每请求重建且不落快照', async () => {
    vi.stubEnv('OPENAWORK_DISABLE_WORKSPACE_CTX_FREEZE', '1');
    const build = vi.fn(async () => '<workspace path="/repo">live</workspace>');
    await snapshotModule.resolveFrozenWorkspaceContext({
      sessionId: SESSION_ID,
      userId: USER_ID,
      workspacePath: '/repo',
      build,
    });
    await snapshotModule.resolveFrozenWorkspaceContext({
      sessionId: SESSION_ID,
      userId: USER_ID,
      workspacePath: '/repo',
      build,
    });
    expect(build).toHaveBeenCalledTimes(2);
    expect(readMetadata()['workspaceCtxSnapshot']).toBeUndefined();
  });
});
