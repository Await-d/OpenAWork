import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertWorkspacePathSupportedByCurrentHost: vi.fn(),
  ensureUnboundSessionWorkspaceDirectory: vi.fn(() => '/gateway/data'),
  existsSync: vi.fn<(path: string) => boolean>(() => false),
  getSessionWorkspaceResolution: vi.fn<
    (sessionId: string) => { path: string; remote: boolean } | null
  >(() => null),
  isPathWithinRoot: vi.fn<(path: string, rootPath: string) => boolean>(
    (path: string, rootPath: string) => path === rootPath || path.startsWith(`${rootPath}/`),
  ),
  isFilesystemRootOrPlaceholderPath: vi.fn<(path: string) => boolean>(
    (path: string) => path === '/' || /^[A-Za-z]:[/\\]?$/.test(path),
  ),
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
}));

vi.mock('../../workspace/workspace-paths.js', () => ({
  assertWorkspacePathSupportedByCurrentHost: mocks.assertWorkspacePathSupportedByCurrentHost,
  isPathWithinRoot: mocks.isPathWithinRoot,
}));

vi.mock('../../workspace/workspace-safety.js', () => ({
  ensureUnboundSessionWorkspaceDirectory: mocks.ensureUnboundSessionWorkspaceDirectory,
  getSessionWorkspaceResolution: mocks.getSessionWorkspaceResolution,
  isFilesystemRootOrPlaceholderPath: mocks.isFilesystemRootOrPlaceholderPath,
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: '/gateway/system32',
  WORKSPACE_ROOTS: ['/workspace', '/workspace/nested'],
}));

/** 指定会话工作目录解析结果（`remote` 缺省为本地会话）。 */
function mockWorkspace(path: string | null, remote = false): void {
  mocks.getSessionWorkspaceResolution.mockReturnValue(path === null ? null : { path, remote });
}

describe('resolveTaskGraphProjectRoot', () => {
  beforeEach(() => {
    mocks.assertWorkspacePathSupportedByCurrentHost.mockReset();
    mocks.ensureUnboundSessionWorkspaceDirectory.mockClear();
    mocks.existsSync.mockReset();
    mocks.existsSync.mockReturnValue(false);
    mocks.getSessionWorkspaceResolution.mockReset();
    mocks.getSessionWorkspaceResolution.mockReturnValue(null);
    mocks.isPathWithinRoot.mockReset();
    mocks.isPathWithinRoot.mockImplementation(
      (path: string, rootPath: string) => path === rootPath || path.startsWith(`${rootPath}/`),
    );
    mocks.isFilesystemRootOrPlaceholderPath.mockReset();
    mocks.isFilesystemRootOrPlaceholderPath.mockImplementation(
      (path: string) => path === '/' || /^[A-Za-z]:[/\\]?$/.test(path),
    );
  });

  it('优先使用会话 workingDirectory，避免回落到错误的全局 cwd', async () => {
    mockWorkspace('/workspace/nested/project');

    const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');

    expect(resolveTaskGraphProjectRoot('session-1')).toBe('/workspace/nested');
  });

  it('已绑定 workingDirectory 对当前主机不可访问时直接抛错，不允许回退', async () => {
    mockWorkspace('E:\\01Project\\appearance-automation');
    mocks.assertWorkspacePathSupportedByCurrentHost.mockImplementation(() => {
      throw new Error('当前网关运行在 Linux，无法访问 Windows 路径');
    });

    const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');

    expect(() => resolveTaskGraphProjectRoot('session-1')).toThrow(
      /当前网关运行在 Linux，无法访问 Windows 路径/,
    );
    expect(mocks.ensureUnboundSessionWorkspaceDirectory).not.toHaveBeenCalled();
  });

  it('未绑定 workingDirectory 且全局根不是仓库时回落到系统文档目录', async () => {
    const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');

    expect(resolveTaskGraphProjectRoot('session-1')).toBe('/gateway/data');
    expect(mocks.ensureUnboundSessionWorkspaceDirectory).toHaveBeenCalled();
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

  // 回归（2026-10-16 排障包）：SSH 远端工作区会话的 workingDirectory 是**远端**
  // 绝对路径（远端 cwd 为 `/` 时它就是 `/`）。若被当成本地项目根，任务图会去写
  // 本机 `/.agentdocs` → EACCES，整个 `Agent` 委派调用 0ms 失败。
  describe('SSH 远端工作区会话', () => {
    it('远端 workingDirectory 不落本地盘，回退到网关本机任务图根', async () => {
      mockWorkspace('/volume1/docker/1panel', true);

      const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');

      const root = resolveTaskGraphProjectRoot('session-remote');
      expect(root).toBe('/gateway/data');
      // 远端路径绝不能被当成本地主机路径使用（不触发跨主机断言，也不返回远端路径）。
      expect(root).not.toBe('/volume1/docker/1panel');
      expect(mocks.assertWorkspacePathSupportedByCurrentHost).not.toHaveBeenCalled();
    });

    it('远端 cwd 为根目录 / 时不解析出 /.agentdocs', async () => {
      mockWorkspace('/', true);

      const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');

      const root = resolveTaskGraphProjectRoot('session-remote-root');
      expect(root).toBe('/gateway/data');
      expect(root).not.toBe('/');
    });

    it('远端会话下全局根是本机仓库目录时保留该目录', async () => {
      mockWorkspace('/volume1/docker/1panel', true);
      mocks.existsSync.mockImplementation((targetPath: string) => targetPath.endsWith('/.git'));

      const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');

      expect(resolveTaskGraphProjectRoot('session-remote')).toBe('/gateway/system32');
    });

    it('全局根是盘符根时不作为任务图根（越权写入守卫）', async () => {
      mockWorkspace('/srv/app', true);
      mocks.isFilesystemRootOrPlaceholderPath.mockImplementation((path: string) => path === '/');

      const { resolveTaskGraphProjectRoot } = await import('../../task/task-graph-root.js');

      // WORKSPACE_ROOT 被判为不可用 → 回退默认工作区目录，而不是拿根路径当项目根。
      expect(resolveTaskGraphProjectRoot('session-remote')).toBe('/gateway/data');
    });
  });
});
