import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertWorkspacePathSupportedByCurrentHost: vi.fn(),
  existsSync: vi.fn<(path: string) => boolean>(() => false),
  getSessionWorkingDirectory: vi.fn<(sessionId: string) => string | null>(() => null),
  isPathWithinRoot: vi.fn<(path: string, rootPath: string) => boolean>(
    (path: string, rootPath: string) => path === rootPath || path.startsWith(`${rootPath}/`),
  ),
  resolveGatewayDataDir: vi.fn(() => '/gateway/data'),
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
}));

vi.mock('../../workspace/workspace-paths.js', () => ({
  assertWorkspacePathSupportedByCurrentHost: mocks.assertWorkspacePathSupportedByCurrentHost,
  isPathWithinRoot: mocks.isPathWithinRoot,
}));

vi.mock('../../workspace/workspace-safety.js', () => ({
  getSessionWorkingDirectory: mocks.getSessionWorkingDirectory,
}));

vi.mock('../../infra/storage-paths.js', () => ({
  resolveGatewayDataDir: mocks.resolveGatewayDataDir,
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: '/gateway/system32',
  WORKSPACE_ROOTS: ['/workspace', '/workspace/nested'],
}));

describe('resolveTaskGraphProjectRoot', () => {
  beforeEach(() => {
    mocks.assertWorkspacePathSupportedByCurrentHost.mockReset();
    mocks.existsSync.mockReset();
    mocks.existsSync.mockReturnValue(false);
    mocks.getSessionWorkingDirectory.mockReset();
    mocks.getSessionWorkingDirectory.mockReturnValue(null);
    mocks.isPathWithinRoot.mockReset();
    mocks.isPathWithinRoot.mockImplementation(
      (path: string, rootPath: string) => path === rootPath || path.startsWith(`${rootPath}/`),
    );
    mocks.resolveGatewayDataDir.mockClear();
  });

  it('优先使用会话 workingDirectory，避免回落到错误的全局 cwd', async () => {
    mocks.getSessionWorkingDirectory.mockReturnValue('/workspace/nested/project');

    const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');

    expect(resolveTaskGraphProjectRoot('session-1')).toBe('/workspace/nested');
  });

  it('已绑定 workingDirectory 对当前主机不可访问时直接抛错，不允许回退', async () => {
    mocks.getSessionWorkingDirectory.mockReturnValue('E:\\01Project\\appearance-automation');
    mocks.assertWorkspacePathSupportedByCurrentHost.mockImplementation(() => {
      throw new Error('当前网关运行在 Linux，无法访问 Windows 路径');
    });

    const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');

    expect(() => resolveTaskGraphProjectRoot('session-1')).toThrow(
      /当前网关运行在 Linux，无法访问 Windows 路径/,
    );
    expect(mocks.resolveGatewayDataDir).not.toHaveBeenCalled();
  });

  it('未绑定 workingDirectory 且全局根不是仓库时回落到桌面端默认目录', async () => {
    const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');

    expect(resolveTaskGraphProjectRoot('session-1')).toBe('/gateway/data');
  });

  it('未绑定 workingDirectory 但全局根看起来是仓库时保留 WORKSPACE_ROOT', async () => {
    mocks.existsSync.mockImplementation(
      (targetPath: string) =>
        targetPath === '/gateway/system32/.git' ||
        targetPath === '/gateway/system32/pnpm-workspace.yaml',
    );

    const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');

    expect(resolveTaskGraphProjectRoot('session-1')).toBe('/gateway/system32');
  });
});
