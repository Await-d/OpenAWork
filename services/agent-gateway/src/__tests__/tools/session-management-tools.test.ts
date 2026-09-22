import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  unbindSession: vi.fn(),
  invalidateAllowlist: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOTS: [],
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
}));

vi.mock('../../ssh/ssh-service.js', () => ({
  getSshService: () => ({ unbindSession: mocks.unbindSession }),
}));

vi.mock('../../workspace/user-workspace-allowlist.js', () => ({
  invalidateUserWorkspaceAllowlist: mocks.invalidateAllowlist,
}));

import {
  runSessionMoveTool,
  runSessionRenameTool,
  sessionMoveToolDefinition,
  sessionRenameToolDefinition,
} from '../../tools/session-management-tools.js';

describe('runSessionRenameTool', () => {
  beforeEach(() => {
    mocks.sqliteGet.mockReset();
    mocks.sqliteRun.mockReset();
  });

  it('去除首尾空白后重命名当前会话', () => {
    mocks.sqliteGet.mockReturnValueOnce({ id: 's1' });

    const result = runSessionRenameTool('s1', 'u1', { title: '  新标题  ' });

    expect(result).toEqual({ ok: true, sessionID: 's1', title: '新标题' });
    expect(mocks.sqliteRun).toHaveBeenCalledWith(expect.stringContaining('UPDATE sessions'), [
      '新标题',
      's1',
      'u1',
    ]);
  });

  it('显式指定 sessionID 且该会话归属当前用户时重命名目标会话', () => {
    mocks.sqliteGet.mockReturnValueOnce({ id: 'other' });

    const result = runSessionRenameTool('s1', 'u1', { sessionID: 'other', title: '重命名' });

    expect(result).toEqual({ ok: true, sessionID: 'other', title: '重命名' });
  });

  it('trim 后为空时失败且不写库', () => {
    mocks.sqliteGet.mockReturnValueOnce({ id: 's1' });

    const result = runSessionRenameTool('s1', 'u1', { title: '   ' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('不能为空');
    }
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });

  it('目标会话不存在时失败', () => {
    mocks.sqliteGet.mockReturnValueOnce(undefined);

    const result = runSessionRenameTool('s1', 'u1', { sessionID: 'ghost', title: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('会话不存在');
    }
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });
});

describe('runSessionMoveTool', () => {
  beforeEach(() => {
    mocks.sqliteGet.mockReset();
    mocks.sqliteRun.mockReset();
    mocks.unbindSession.mockReset();
    mocks.invalidateAllowlist.mockReset();
  });

  it('首次绑定工作目录并刷新 allowlist', () => {
    mocks.sqliteGet.mockReturnValueOnce({ id: 's1', metadata_json: '{}' });

    const result = runSessionMoveTool('s1', 'u1', { directory: '/tmp/new-ws' });

    expect(result).toEqual({
      ok: true,
      sessionID: 's1',
      workingDirectory: '/tmp/new-ws',
      changed: true,
      forced: false,
    });
    expect(mocks.sqliteRun).toHaveBeenCalledWith(expect.stringContaining('UPDATE sessions'), [
      JSON.stringify({ workingDirectory: '/tmp/new-ws' }),
      's1',
      'u1',
    ]);
    expect(mocks.invalidateAllowlist).toHaveBeenCalledWith('u1');
  });

  it('默认拒绝重绑已绑定的工作区', () => {
    mocks.sqliteGet.mockReturnValueOnce({
      id: 's1',
      metadata_json: JSON.stringify({ workingDirectory: '/tmp/old-ws' }),
    });

    const result = runSessionMoveTool('s1', 'u1', { directory: '/tmp/new-ws' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('不能直接修改');
    }
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });

  it('force=true 时强制重绑并写入 workspaceWarpHistory', () => {
    mocks.sqliteGet.mockReturnValueOnce({
      id: 's1',
      metadata_json: JSON.stringify({ workingDirectory: '/tmp/old-ws' }),
    });

    const result = runSessionMoveTool('s1', 'u1', { directory: '/tmp/new-ws', force: true });

    expect(result).toEqual({
      ok: true,
      sessionID: 's1',
      workingDirectory: '/tmp/new-ws',
      changed: true,
      forced: true,
    });

    const updateCall = mocks.sqliteRun.mock.calls.find(
      ([query]) => typeof query === 'string' && query.includes('UPDATE sessions'),
    );
    const persisted = JSON.parse(String(updateCall?.[1]?.[0])) as {
      workspaceWarpHistory?: Array<{ from: string; to: string }>;
    };
    expect(persisted.workspaceWarpHistory?.[0]).toMatchObject({
      from: '/tmp/old-ws',
      to: '/tmp/new-ws',
    });
  });

  it('directory=null 时解绑工作区', () => {
    mocks.sqliteGet.mockReturnValueOnce({
      id: 's1',
      metadata_json: JSON.stringify({ workingDirectory: '/tmp/old-ws' }),
    });

    const result = runSessionMoveTool('s1', 'u1', { directory: null, force: true });

    expect(result).toEqual({
      ok: true,
      sessionID: 's1',
      workingDirectory: null,
      changed: true,
      forced: true,
    });
  });
});

describe('session 管理工具定义', () => {
  it('使用约定的模型可见名称', () => {
    expect(sessionRenameToolDefinition.name).toBe('session_rename');
    expect(sessionMoveToolDefinition.name).toBe('session_move');
  });

  it('session_move 描述包含目录写入生效的时序提示', () => {
    expect(sessionMoveToolDefinition.description).toContain(
      '会话工作目录在写入后生效；同一轮内不要执行依赖目标目录的工具',
    );
  });
});
