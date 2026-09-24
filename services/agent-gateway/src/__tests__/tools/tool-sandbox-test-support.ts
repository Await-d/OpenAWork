import { vi, type Mock } from 'vitest';

/** 显式标注以消除 `vi.fn()` 推断类型对 @vitest/spy 深层路径的引用（否则 TS2742 类型不可移植）。 */
interface ToolSandboxTestMocks {
  readonly sqliteAllMock: Mock;
  roleLayer: string | null;
  teamParentSessionId: string | null;
  handoffState: string | null;
  requireBoundWorkspace: boolean;
  metadataJson: string;
  readonly callMcpToolForSessionMock: Mock;
  readonly getConfiguredMcpServerForSessionMock: Mock;
  readonly getMcpServerFingerprintMock: Mock;
  readonly listMcpToolsForSessionMock: Mock;
  readonly sqliteGetMock: Mock;
  readonly sqliteRunMock: Mock;
  readonly sqliteTransactionMock: Mock;
  readonly transitionToolToRunningMock: Mock;
  readonly dispatchRunBashInBackgroundMock: Mock;
}

/**
 * tool-sandbox 系列测试共享的临时工作区根目录（与原测试文件保持一致：
 * 每个测试进程独立，文件级串行执行，不会跨文件并发争用）。
 */
export const TEST_WORKSPACE = `/tmp/openawork-tool-sandbox-${process.pid}`;

/**
 * tool-sandbox 系列测试共享的模块级桩。
 *
 * 注意：`vi.mock` 的工厂会被提升到文件顶部执行，无法直接引用本模块的静态导入绑定；
 * 因此各测试文件在工厂内部通过 `await import('./tool-sandbox-test-support.js')` 取用本对象，
 * 测试主体中则可直接静态导入（同一测试文件内是同一份实例，Vitest 默认按文件隔离模块图）。
 */
export const mocks: ToolSandboxTestMocks = {
  sqliteAllMock: vi.fn(() => []),
  roleLayer: 'executor' as string | null,
  teamParentSessionId: null as string | null,
  handoffState: null as string | null,
  requireBoundWorkspace: false,
  metadataJson: '{}' as string,
  callMcpToolForSessionMock: vi.fn(),
  getConfiguredMcpServerForSessionMock: vi.fn((_sessionId: string, serverId: string) => ({
    id: serverId,
    name: serverId,
    transport: 'stdio',
    enabled: true,
  })),
  getMcpServerFingerprintMock: vi.fn(
    (server: { readonly id?: string }) => `fp-${server.id ?? 'unknown'}`,
  ),
  listMcpToolsForSessionMock: vi.fn(async () => []),
  sqliteGetMock: vi.fn((query: string): Record<string, unknown> | undefined => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('role_layer') && query.includes('team_parent_session_id')) {
      return {
        metadata_json: mocks.metadataJson,
        user_id: 'user-1',
        role_layer: mocks.requireBoundWorkspace ? mocks.roleLayer : null,
        team_parent_session_id: mocks.requireBoundWorkspace ? mocks.teamParentSessionId : null,
        handoff_state: mocks.requireBoundWorkspace ? mocks.handoffState : null,
      };
    }
    if (query.includes('SELECT metadata_json, user_id FROM sessions')) {
      return { metadata_json: mocks.metadataJson, user_id: 'user-1' };
    }
    if (query.includes('SELECT metadata_json FROM sessions')) {
      return { metadata_json: mocks.metadataJson };
    }
    if (query.includes('SELECT role_layer FROM sessions')) {
      return { role_layer: mocks.roleLayer };
    }
    return undefined;
  }),
  sqliteRunMock: vi.fn(),
  // 直通实现：调用方只关心「事务内语句被执行」，mock 环境无真实事务语义。
  sqliteTransactionMock: vi.fn((fn: () => void) => fn()),
  transitionToolToRunningMock: vi.fn(),
  dispatchRunBashInBackgroundMock: vi.fn(),
};
