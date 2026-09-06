import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveGatewayDataDir: vi.fn(() => '/gateway/data/agent-gateway'),
  sqliteGet: vi.fn(),
  resolveSessionWorkspacePath: vi.fn(
    (input: { metadataJson: string; sessionId: string; userId: string }) => {
      try {
        const meta = JSON.parse(input.metadataJson) as Record<string, unknown>;
        return typeof meta.workingDirectory === 'string' ? meta.workingDirectory : null;
      } catch {
        return null;
      }
    },
  ),
  parseSessionMetadataJson: vi.fn((raw: string) => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }),
}));

vi.mock('../../infra/storage-paths.js', () => ({
  resolveGatewayDataDir: mocks.resolveGatewayDataDir,
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/',
  WORKSPACE_ROOTS: ['/'],
  sqliteGet: mocks.sqliteGet,
}));

vi.mock('../../session/session-workspace-resolution.js', () => ({
  resolveSessionWorkspacePath: mocks.resolveSessionWorkspacePath,
}));

vi.mock('../../session/session-workspace-metadata.js', () => ({
  parseSessionMetadataJson: mocks.parseSessionMetadataJson,
}));

describe('assertSessionWorkingDirectory unbound fallback', () => {
  beforeEach(() => {
    mocks.resolveGatewayDataDir.mockClear();
    mocks.sqliteGet.mockReset();
    mocks.resolveSessionWorkspacePath.mockClear();
  });

  it('未绑定工作区时回退到桌面端默认数据目录，而不是盘符根 /', async () => {
    mocks.sqliteGet.mockReturnValue({
      metadata_json: '{}',
      user_id: 'user-1',
      role_layer: null,
      team_parent_session_id: null,
    });
    mocks.resolveSessionWorkspacePath.mockReturnValue(null);

    const { assertSessionWorkingDirectory, resolveUnboundSessionWorkspaceFallback } =
      await import('../../workspace/workspace-safety.js');

    expect(resolveUnboundSessionWorkspaceFallback()).toBe('/gateway/data/agent-gateway');
    expect(assertSessionWorkingDirectory('plain-chat-session')).toBe('/gateway/data/agent-gateway');
    expect(mocks.resolveGatewayDataDir).toHaveBeenCalled();
  });

  it('已绑定工作区时原样返回会话路径，不允许回退', async () => {
    mocks.sqliteGet.mockReturnValue({
      metadata_json: JSON.stringify({ workingDirectory: 'C:\\Users\\lenovo\\project' }),
      user_id: 'user-1',
      role_layer: null,
      team_parent_session_id: null,
    });
    mocks.resolveSessionWorkspacePath.mockReturnValue('C:\\Users\\lenovo\\project');

    const { assertSessionWorkingDirectory } = await import('../../workspace/workspace-safety.js');

    expect(assertSessionWorkingDirectory('bound-session')).toBe('C:\\Users\\lenovo\\project');
    expect(mocks.resolveGatewayDataDir).not.toHaveBeenCalled();
  });

  it('team 会话要求绑定工作区时，未绑定直接抛错而不是回退', async () => {
    mocks.sqliteGet.mockImplementation((query: string) => {
      if (query.includes('role_layer') && query.includes('team_parent_session_id')) {
        return {
          metadata_json: '{}',
          user_id: 'user-1',
          role_layer: 'executor',
          team_parent_session_id: 'parent-1',
        };
      }
      return {
        metadata_json: '{}',
        user_id: 'user-1',
      };
    });
    mocks.resolveSessionWorkspacePath.mockReturnValue(null);

    const { assertSessionWorkingDirectory } = await import('../../workspace/workspace-safety.js');

    expect(() => assertSessionWorkingDirectory('team-session')).toThrow(/当前会话未绑定工作区/);
    expect(mocks.resolveGatewayDataDir).not.toHaveBeenCalled();
  });

  it('未绑定会话显式传入 / 或占位路径时改写为桌面默认目录', async () => {
    mocks.sqliteGet.mockReturnValue({
      metadata_json: '{}',
      user_id: 'user-1',
      role_layer: null,
      team_parent_session_id: null,
    });
    mocks.resolveSessionWorkspacePath.mockReturnValue(null);

    const { isFilesystemRootOrPlaceholderPath, rewriteUnboundPlaceholderPath } =
      await import('../../workspace/workspace-safety.js');

    expect(isFilesystemRootOrPlaceholderPath('/')).toBe(true);
    expect(isFilesystemRootOrPlaceholderPath('/absolute/workspace/path')).toBe(true);
    expect(isFilesystemRootOrPlaceholderPath('C:\\')).toBe(true);
    expect(isFilesystemRootOrPlaceholderPath('/home/await/project')).toBe(false);

    expect(rewriteUnboundPlaceholderPath('plain-chat-session', '/')).toBe(
      '/gateway/data/agent-gateway',
    );
    expect(rewriteUnboundPlaceholderPath('plain-chat-session', '/absolute/workspace/path')).toBe(
      '/gateway/data/agent-gateway',
    );
    expect(rewriteUnboundPlaceholderPath('plain-chat-session', '/home/await/project')).toBe(
      '/home/await/project',
    );
  });

  it('已绑定会话即使 path 是 / 也不改写', async () => {
    mocks.sqliteGet.mockReturnValue({
      metadata_json: JSON.stringify({ workingDirectory: 'C:\\Users\\lenovo\\project' }),
      user_id: 'user-1',
      role_layer: null,
      team_parent_session_id: null,
    });
    mocks.resolveSessionWorkspacePath.mockReturnValue('C:\\Users\\lenovo\\project');

    const { rewriteUnboundPlaceholderPath } = await import('../../workspace/workspace-safety.js');

    expect(rewriteUnboundPlaceholderPath('bound-session', '/')).toBe('/');
    expect(mocks.resolveGatewayDataDir).not.toHaveBeenCalled();
  });

  it('assertSessionWorkspacePath 在未绑定时把 / 改写后再做主机校验', async () => {
    mocks.sqliteGet.mockReturnValue({
      metadata_json: '{}',
      user_id: 'user-1',
      role_layer: null,
      team_parent_session_id: null,
    });
    mocks.resolveSessionWorkspacePath.mockReturnValue(null);

    const { assertSessionWorkspacePath } = await import('../../workspace/workspace-safety.js');

    // unrestricted 模式下 fallback 路径可通过 validateWorkspacePath；
    // 关键是验证不会在改写前因 `/` 触发跨平台主机错误。
    const safePath = assertSessionWorkspacePath({
      path: '/',
      sessionId: 'plain-chat-session',
    });
    expect(safePath).toBe('/gateway/data/agent-gateway');
  });

  it('已绑定会话将相对路径解析到会话工作区', async () => {
    mocks.sqliteGet.mockReturnValue({
      metadata_json: JSON.stringify({ workingDirectory: '/workspace/project' }),
      user_id: 'user-1',
      role_layer: null,
      team_parent_session_id: null,
    });
    mocks.resolveSessionWorkspacePath.mockReturnValue('/workspace/project');

    const { assertSessionWorkspacePath } = await import('../../workspace/workspace-safety.js');

    expect(
      assertSessionWorkspacePath({
        path: 'temp/render-status-health.mjs',
        sessionId: 'bound-session',
      }),
    ).toBe('/workspace/project/temp/render-status-health.mjs');
  });
});
