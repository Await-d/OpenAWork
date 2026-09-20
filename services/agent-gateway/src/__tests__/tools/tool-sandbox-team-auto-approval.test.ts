import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MessageStoreV2 from '../../message/message-store-v2.js';
import type * as RunBackgroundBashToolsModule from '../../tools/run-background-bash-tools.js';

// `vi.mock` 的工厂会被提升到文件顶部执行，不能直接引用静态导入绑定；
// 这里在工厂内部通过 `await import(...)` 取共享测试桩（tool-sandbox-test-support.ts）。
vi.mock('../../infra/db.js', async () => {
  const { TEST_WORKSPACE, mocks } = await import('./tool-sandbox-test-support.js');
  return {
    WORKSPACE_ACCESS_RESTRICTED: false,
    WORKSPACE_ROOT: TEST_WORKSPACE,
    WORKSPACE_ROOTS: [TEST_WORKSPACE],
    sqliteAll: mocks.sqliteAllMock,
    sqliteGet: mocks.sqliteGetMock,
    sqliteRun: mocks.sqliteRunMock,
    sqliteRunWithRowId: vi.fn(() => 1),
  };
});

vi.mock('../../message/message-store-v2.js', async () => {
  const { mocks } = await import('./tool-sandbox-test-support.js');
  const actual = await vi.importActual<typeof MessageStoreV2>('../../message/message-store-v2.js');
  return {
    ...actual,
    transitionToolToRunning: mocks.transitionToolToRunningMock,
  };
});

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

// mcp_call 在权限上下文构建阶段会走 mcp-runtime 的服务器配置查询；
// 这里按仓库既有测试（tool-sandbox-mcp-permission-boundary.test.ts）的方式提供桩，
// 避免权限边界用例依赖真实 MCP 配置与网络。
vi.mock('../../mcp/mcp-runtime.js', async () => {
  const { mocks } = await import('./tool-sandbox-test-support.js');
  return {
    callMcpToolForSession: mocks.callMcpToolForSessionMock,
    getConfiguredMcpServerForSession: mocks.getConfiguredMcpServerForSessionMock,
    getMcpServerFingerprint: mocks.getMcpServerFingerprintMock,
    listMcpToolsForSession: mocks.listMcpToolsForSessionMock,
  };
});

// run_bash_in_background 的执行走 gateway-managed dispatch（tool-sandbox.ts:4995）。
// 这里只替换派发函数，保留真实的工具定义，用于断言「审批未通过时后台命令绝不派发」。
vi.mock('../../tools/run-background-bash-tools.js', async () => {
  const { mocks } = await import('./tool-sandbox-test-support.js');
  const actual = await vi.importActual<typeof RunBackgroundBashToolsModule>(
    '../../tools/run-background-bash-tools.js',
  );
  return {
    ...actual,
    dispatchRunBashInBackground: mocks.dispatchRunBashInBackgroundMock,
  };
});

import { TEST_WORKSPACE, mocks } from './tool-sandbox-test-support.js';
import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

describe('tool-sandbox team session auto approval', () => {
  beforeEach(() => {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteAllMock.mockImplementation(() => []);
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockReset();
    mocks.transitionToolToRunningMock.mockReset();
    mocks.roleLayer = 'executor';
    mocks.teamParentSessionId = null;
    mocks.handoffState = null;
    mocks.requireBoundWorkspace = false;
    mocks.metadataJson = '{}';
  });

  afterEach(() => {
    vi.clearAllMocks();
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  });

  it('executor team session 调 write 空参数时返回参数错误而不是 pending approval', async () => {
    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-team-write',
        toolName: 'write',
        rawInput: {},
      },
      new AbortController().signal,
      'team-executor-session',
      {
        clientRequestId: 'req-team-write',
        nextRound: 1,
        requestData: { clientRequestId: 'req-team-write' },
      },
    );

    expect(result.isError).toBe(true);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(String(result.output)).toContain('参数校验失败');
    expect(String(result.output)).not.toContain('waiting for approval');
    expect(
      mocks.sqliteRunMock.mock.calls.some(
        ([query]) => typeof query === 'string' && query.includes('INSERT INTO permission_requests'),
      ),
    ).toBe(false);
  });

  it('普通会话伪造 teamRoleInstance metadata 时仍不会获得自动免审批', async () => {
    mocks.roleLayer = null;
    mocks.metadataJson = JSON.stringify({
      teamRoleInstance: { roleLayer: 'executor', rootSessionId: 'fake-root' },
      workingDirectory: TEST_WORKSPACE,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-fake-team-write',
        toolName: 'write',
        rawInput: { path: join(TEST_WORKSPACE, 'fake.txt'), content: 'demo' },
      },
      new AbortController().signal,
      'plain-session',
      {
        clientRequestId: 'req-fake-team-write',
        nextRound: 1,
        requestData: { clientRequestId: 'req-fake-team-write' },
      },
    );

    expect(result.isError).toBe(true);
    expect(typeof result.pendingPermissionRequestId).toBe('string');
  });

  it('普通旧会话未绑定 workingDirectory 时仍保留原有写入兼容路径', async () => {
    mocks.roleLayer = null;
    mocks.metadataJson = '{}';

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-legacy-no-workspace',
        toolName: 'write',
        rawInput: { path: join(TEST_WORKSPACE, 'legacy.txt'), content: 'demo' },
      },
      new AbortController().signal,
      'plain-session',
      {
        clientRequestId: 'req-legacy-no-workspace',
        nextRound: 1,
        requestData: { clientRequestId: 'req-legacy-no-workspace' },
      },
    );

    expect(result.isError).toBe(true);
    expect(typeof result.pendingPermissionRequestId).toBe('string');
    expect(String(result.output)).not.toContain('当前会话未绑定工作区');
  });

  it('前台 team 根会话即使带 role_layer 也不会自动免审批', async () => {
    mocks.requireBoundWorkspace = true;
    mocks.roleLayer = 'executor';
    mocks.teamParentSessionId = null;
    mocks.handoffState = null;
    mocks.metadataJson = JSON.stringify({
      workingDirectory: TEST_WORKSPACE,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-foreground-team-write',
        toolName: 'write',
        rawInput: { path: join(TEST_WORKSPACE, 'foreground.txt'), content: 'demo' },
      },
      new AbortController().signal,
      'team-foreground-session',
      {
        clientRequestId: 'req-foreground-team-write',
        nextRound: 1,
        requestData: { clientRequestId: 'req-foreground-team-write' },
      },
    );

    expect(result.isError).toBe(true);
    expect(typeof result.pendingPermissionRequestId).toBe('string');
    expect(String(result.output)).toContain('requires approval');
  });

  it('后台 handoff 子会话会继承自动免审批', async () => {
    mocks.requireBoundWorkspace = true;
    mocks.roleLayer = 'executor';
    mocks.teamParentSessionId = 'team-root-session';
    mocks.handoffState = '{"status":"running"}';
    mocks.metadataJson = JSON.stringify({
      workingDirectory: TEST_WORKSPACE,
    });

    const { existsSync } = await import('node:fs');
    const targetPath = join(TEST_WORKSPACE, 'background-child-write.txt');
    rmSync(targetPath, { force: true });

    try {
      const sandbox = createDefaultSandbox();
      const result = await sandbox.execute(
        {
          toolCallId: 'call-background-team-write',
          toolName: 'write',
          rawInput: { path: targetPath, content: 'demo' },
        },
        new AbortController().signal,
        'team-background-session',
        {
          clientRequestId: 'req-background-team-write',
          nextRound: 1,
          requestData: { clientRequestId: 'req-background-team-write' },
        },
      );

      expect(result.isError).toBe(false);
      expect(result.pendingPermissionRequestId).toBeUndefined();
      expect(existsSync(targetPath)).toBe(true);
      expect(
        mocks.sqliteRunMock.mock.calls.some(
          ([query]) =>
            typeof query === 'string' && query.includes('INSERT INTO permission_requests'),
        ),
      ).toBe(false);
    } finally {
      rmSync(targetPath, { force: true });
    }
  });

  it('executor team session 命中 scoped deny 时仍会被拒绝', async () => {
    const blockedDir = join(TEST_WORKSPACE, 'blocked');
    const permissionFile = join(TEST_WORKSPACE, '.openawork.permissions.json');
    const targetPath = join(blockedDir, 'file.txt');
    mocks.metadataJson = JSON.stringify({
      workingDirectory: TEST_WORKSPACE,
    });

    const { mkdirSync, rmSync, writeFileSync } = await import('node:fs');
    mkdirSync(blockedDir, { recursive: true });
    writeFileSync(
      permissionFile,
      JSON.stringify({
        rules: [{ permission: 'write', pattern: 'blocked/**', action: 'deny' }],
      }),
      'utf8',
    );

    try {
      const sandbox = createDefaultSandbox();
      const result = await sandbox.execute(
        {
          toolCallId: 'call-denied-write',
          toolName: 'write',
          rawInput: {
            path: targetPath,
            content: 'demo',
          },
        },
        new AbortController().signal,
        'team-executor-session',
        {
          clientRequestId: 'req-denied-write',
          nextRound: 1,
          requestData: { clientRequestId: 'req-denied-write' },
        },
      );

      expect(result.isError).toBe(true);
      expect(String(result.output)).toContain('被权限规则禁止');
      expect(result.pendingPermissionRequestId).toBeUndefined();
    } finally {
      rmSync(permissionFile, { force: true });
      rmSync(blockedDir, { recursive: true, force: true });
    }
  });

  it('会话工作区外的写入路径会被直接拦截', async () => {
    const currentWorkspace = join(TEST_WORKSPACE, 'current-workspace');
    const otherWorkspaceFile = join(TEST_WORKSPACE, 'other-workspace', 'file.txt');
    mocks.metadataJson = JSON.stringify({
      workingDirectory: currentWorkspace,
    });

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-outside-workspace',
        toolName: 'write',
        rawInput: {
          path: otherWorkspaceFile,
          content: 'demo',
        },
      },
      new AbortController().signal,
      'team-executor-session',
      {
        clientRequestId: 'req-outside-workspace',
        nextRound: 1,
        requestData: { clientRequestId: 'req-outside-workspace' },
      },
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('目标路径超出当前工作区范围');
    expect(result.pendingPermissionRequestId).toBeUndefined();
  });

  it('会话未绑定 workingDirectory 时写入会被直接拒绝', async () => {
    mocks.requireBoundWorkspace = true;
    mocks.metadataJson = '{}';

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-missing-workspace',
        toolName: 'write',
        rawInput: {
          path: join(TEST_WORKSPACE, 'file.txt'),
          content: 'demo',
        },
      },
      new AbortController().signal,
      'team-executor-session',
      {
        clientRequestId: 'req-missing-workspace',
        nextRound: 1,
        requestData: { clientRequestId: 'req-missing-workspace' },
      },
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('当前会话未绑定工作区');
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(
      mocks.sqliteRunMock.mock.calls.some(
        ([query]) => typeof query === 'string' && query.includes('INSERT INTO permission_requests'),
      ),
    ).toBe(false);
  });

  it('会话未绑定 workingDirectory 时 glob 也不会回退到全局根目录', async () => {
    mocks.requireBoundWorkspace = true;
    mocks.metadataJson = '{}';

    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-missing-workspace-glob',
        toolName: 'glob',
        rawInput: {
          pattern: '**/*.ts',
        },
      },
      new AbortController().signal,
      'team-executor-session',
      {
        clientRequestId: 'req-missing-workspace-glob',
        nextRound: 1,
        requestData: { clientRequestId: 'req-missing-workspace-glob' },
      },
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('当前会话未绑定工作区');
    expect(result.pendingPermissionRequestId).toBeUndefined();
  });
});
