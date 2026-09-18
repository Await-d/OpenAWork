import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MessageStoreV2 from '../../message/message-store-v2.js';

const { TEST_WORKSPACE } = vi.hoisted(() => {
  return {
    TEST_WORKSPACE: `/tmp/openawork-tool-sandbox-${process.pid}`,
  };
});

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(() => []),
  roleLayer: 'executor' as string | null,
  teamParentSessionId: null as string | null,
  handoffState: null as string | null,
  requireBoundWorkspace: false,
  metadataJson: '{}' as string,
  sqliteGetMock: vi.fn((query: string) => {
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
  transitionToolToRunningMock: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: TEST_WORKSPACE,
  WORKSPACE_ROOTS: [TEST_WORKSPACE],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteRunWithRowId: vi.fn(() => 1),
}));

vi.mock('../../message/message-store-v2.js', async () => {
  const actual = await vi.importActual<typeof MessageStoreV2>('../../message/message-store-v2.js');
  return {
    ...actual,
    transitionToolToRunning: mocks.transitionToolToRunningMock,
  };
});

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

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

function executionContext(clientRequestId: string) {
  return {
    clientRequestId,
    nextRound: 1,
    requestData: { clientRequestId },
  };
}

function permissionInsertParams(): readonly unknown[] | undefined {
  const insertCall = mocks.sqliteRunMock.mock.calls.find(
    ([query]) => typeof query === 'string' && query.includes('INSERT INTO permission_requests'),
  );
  return insertCall?.[1] as readonly unknown[] | undefined;
}

describe('tool-sandbox 会话权限阶梯（permissionMode / yoloMode）', () => {
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

  it('auto-edit 档位下 write 自动执行且不创建 pending 权限请求', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    const targetPath = join(TEST_WORKSPACE, 'auto-edit-write.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-write',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-auto-edit-write',
      executionContext('req-auto-edit-write'),
    );

    expect(result.isError).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(existsSync(targetPath)).toBe(true);
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('auto-edit 档位下 edit 自动执行且不创建 pending 权限请求', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    const targetPath = join(TEST_WORKSPACE, 'auto-edit-edit.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-edit',
        toolName: 'edit',
        rawInput: { filePath: targetPath, oldString: '', newString: 'created by edit' },
      },
      new AbortController().signal,
      'session-auto-edit-edit',
      executionContext('req-auto-edit-edit'),
    );

    expect(result.isError).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(readFileSync(targetPath, 'utf8')).toBe('created by edit');
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('auto-edit 档位下 multi_edit 自动执行且不创建 pending 权限请求', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    const targetPath = join(TEST_WORKSPACE, 'auto-edit-multi.txt');
    writeFileSync(targetPath, 'alpha beta\n', 'utf8');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-multi',
        toolName: 'multi_edit',
        rawInput: {
          filePath: targetPath,
          edits: [{ oldString: 'alpha', newString: 'gamma' }],
        },
      },
      new AbortController().signal,
      'session-auto-edit-multi',
      executionContext('req-auto-edit-multi'),
    );

    expect(result.isError).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(readFileSync(targetPath, 'utf8')).toBe('gamma beta\n');
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('auto-edit 档位下 apply_patch 自动执行且不创建 pending 权限请求', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    const targetPath = join(TEST_WORKSPACE, 'auto-edit-patch.txt');
    const patchText = [
      '*** Begin Patch',
      `*** Add File: ${targetPath}`,
      '+patched content',
      '*** End Patch',
    ].join('\n');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-patch',
        toolName: 'apply_patch',
        rawInput: { patchText },
      },
      new AbortController().signal,
      'session-auto-edit-patch',
      executionContext('req-auto-edit-patch'),
    );

    expect(result.isError).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(readFileSync(targetPath, 'utf8')).toContain('patched content');
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('auto-edit 档位下 workspace_review_revert 仍需要审批（豁免工具）', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-revert',
        toolName: 'workspace_review_revert',
        rawInput: { path: TEST_WORKSPACE, filePath: 'revert.txt' },
      },
      new AbortController().signal,
      'session-auto-edit-revert',
      executionContext('req-auto-edit-revert'),
    );

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(String(result.output)).toContain('requires approval');
    expect(permissionInsertParams()?.[2]).toBe('edit');
  });

  it('auto-edit 档位下 bash 仍需要审批（类别不在自动放行集合）', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-bash',
        toolName: 'bash',
        rawInput: { command: 'printf auto-edit-bash', description: '权限阶梯回归' },
      },
      new AbortController().signal,
      'session-auto-edit-bash',
      executionContext('req-auto-edit-bash'),
    );

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(String(result.output)).toContain('requires approval');
    expect(permissionInsertParams()?.[2]).toBe('bash');
  });

  it('yolo 档位下 bash 自动执行且不创建 pending 权限请求', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });
    const markerPath = join(TEST_WORKSPACE, 'yolo-bash-marker.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-yolo-bash',
        toolName: 'bash',
        rawInput: { command: `touch ${markerPath}`, description: '权限阶梯回归' },
      },
      new AbortController().signal,
      'session-yolo-bash',
      executionContext('req-yolo-bash'),
    );

    expect(result.isError).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(existsSync(markerPath)).toBe(true);
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('历史布尔 yoloMode:true 会话的 bash 仍自动执行（向后兼容）', async () => {
    mocks.metadataJson = JSON.stringify({
      yoloMode: true,
      workingDirectory: TEST_WORKSPACE,
    });
    const markerPath = join(TEST_WORKSPACE, 'legacy-yolo-bash-marker.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-legacy-yolo-bash',
        toolName: 'bash',
        rawInput: { command: `touch ${markerPath}`, description: '权限阶梯回归' },
      },
      new AbortController().signal,
      'session-legacy-yolo-bash',
      executionContext('req-legacy-yolo-bash'),
    );

    expect(result.isError).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(existsSync(markerPath)).toBe(true);
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('yoloMode:false 不会触发 auto-edit，write 仍需审批', async () => {
    mocks.metadataJson = JSON.stringify({
      yoloMode: false,
      workingDirectory: TEST_WORKSPACE,
    });
    const targetPath = join(TEST_WORKSPACE, 'yolo-false-write.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-yolo-false-write',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-yolo-false-write',
      executionContext('req-yolo-false-write'),
    );

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(existsSync(targetPath)).toBe(false);
    expect(permissionInsertParams()?.[2]).toBe('write');
  });

  it('未声明档位的默认会话写入仍需审批（auto-edit 不泄漏到默认）', async () => {
    mocks.metadataJson = '{}';
    const targetPath = join(TEST_WORKSPACE, 'default-write.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-default-write',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-default-write',
      executionContext('req-default-write'),
    );

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(existsSync(targetPath)).toBe(false);
    expect(permissionInsertParams()?.[2]).toBe('write');
  });

  it('yolo 档位无法绕过显式 deny：write 被拒绝且未执行', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });
    writeFileSync(
      join(TEST_WORKSPACE, '.openawork.permissions.json'),
      JSON.stringify({
        rules: [{ permission: 'write', pattern: 'blocked-yolo/**', action: 'deny' }],
      }),
      'utf8',
    );
    const targetPath = join(TEST_WORKSPACE, 'blocked-yolo', 'file.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-yolo-denied-write',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-yolo-denied-write',
      executionContext('req-yolo-denied-write'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('被权限规则禁止');
    expect(existsSync(targetPath)).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('auto-edit 档位无法绕过显式 deny：write 被拒绝且未执行', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    writeFileSync(
      join(TEST_WORKSPACE, '.openawork.permissions.json'),
      JSON.stringify({
        rules: [{ permission: 'write', pattern: 'blocked-auto-edit/**', action: 'deny' }],
      }),
      'utf8',
    );
    const targetPath = join(TEST_WORKSPACE, 'blocked-auto-edit', 'file.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-denied-write',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-auto-edit-denied-write',
      executionContext('req-auto-edit-denied-write'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('被权限规则禁止');
    expect(existsSync(targetPath)).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(permissionInsertParams()).toBeUndefined();
  });

  // 继承守卫：父会话未表达档位时，task 子会话不得凭空写入 permissionMode:'ask'
  // （否则会污染「从未表达过档位」的会话，并违背 metadata 模块「不凭空写 ask」的约定）。
  it('task 子会话在父会话未表达档位时保持权限键缺席', async () => {
    mocks.metadataJson = '{}';

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-task-inherit-absent',
        toolName: 'task',
        rawInput: {
          description: '继承档位回归',
          prompt: '输出最终结论',
          subagent_type: 'explore',
          load_skills: [],
        },
      },
      new AbortController().signal,
      'session-task-inherit-absent',
      executionContext('req-task-inherit-absent'),
    );

    expect(result.pendingPermissionRequestId).toBeUndefined();
    const insertedMetadata = readInsertedChildSessionMetadata();
    expect(insertedMetadata).toBeDefined();
    expect('permissionMode' in (insertedMetadata ?? {})).toBe(false);
    expect('yoloMode' in (insertedMetadata ?? {})).toBe(false);
  });

  it('task 子会话继承父会话显式 permissionMode（不被降级为 ask）', async () => {
    mocks.metadataJson = JSON.stringify({ permissionMode: 'auto-edit' });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-task-inherit-auto-edit',
        toolName: 'task',
        rawInput: {
          description: '继承档位回归',
          prompt: '输出最终结论',
          subagent_type: 'explore',
          load_skills: [],
        },
      },
      new AbortController().signal,
      'session-task-inherit-auto-edit',
      executionContext('req-task-inherit-auto-edit'),
    );

    expect(result.pendingPermissionRequestId).toBeUndefined();
    const insertedMetadata = readInsertedChildSessionMetadata();
    expect(insertedMetadata?.['permissionMode']).toBe('auto-edit');
    expect(insertedMetadata?.['yoloMode']).toBeUndefined();
  });

  it('task 子会话继承父会话历史布尔 yoloMode:true', async () => {
    mocks.metadataJson = JSON.stringify({ yoloMode: true });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-task-inherit-yolo',
        toolName: 'task',
        rawInput: {
          description: '继承档位回归',
          prompt: '输出最终结论',
          subagent_type: 'explore',
          load_skills: [],
        },
      },
      new AbortController().signal,
      'session-task-inherit-yolo',
      executionContext('req-task-inherit-yolo'),
    );

    expect(result.pendingPermissionRequestId).toBeUndefined();
    const insertedMetadata = readInsertedChildSessionMetadata();
    expect(insertedMetadata?.['permissionMode']).toBe('yolo');
    expect(insertedMetadata?.['yoloMode']).toBe(true);
  });
});

describe('tool-sandbox reception 后台会话只读工具免审批', () => {
  beforeEach(() => {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteAllMock.mockImplementation(() => []);
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockReset();
    mocks.transitionToolToRunningMock.mockReset();
    mocks.requireBoundWorkspace = true;
    mocks.roleLayer = 'reception';
    mocks.teamParentSessionId = 'team-root-session';
    mocks.handoffState = '{"status":"running"}';
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  });

  function writeReadPermissionRule(action: 'allow' | 'ask' | 'deny'): void {
    writeFileSync(
      join(TEST_WORKSPACE, '.openawork.permissions.json'),
      JSON.stringify({ rules: [{ permission: 'read', pattern: '*', action }] }),
      'utf8',
    );
  }

  async function executeTeamTool(toolName: string, rawInput: Record<string, unknown>) {
    return createDefaultSandbox().execute(
      {
        toolCallId: `call-team-${toolName}`,
        toolName,
        rawInput,
      },
      new AbortController().signal,
      'team-reception-session',
      executionContext(`req-team-${toolName}`),
    );
  }

  it('reception 后台会话调 read 不创建权限请求', async () => {
    const targetPath = join(TEST_WORKSPACE, 'reception-read.txt');
    writeFileSync(targetPath, 'reception read content', 'utf8');

    const result = await executeTeamTool('read', { filePath: targetPath });

    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(JSON.stringify(result.output)).toContain('reception read content');
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('reception 后台会话调 grep 不创建权限请求', async () => {
    writeFileSync(join(TEST_WORKSPACE, 'reception-grep.txt'), 'needle-in-reception', 'utf8');

    const result = await executeTeamTool('grep', {
      pattern: 'needle-in-reception',
      path: TEST_WORKSPACE,
    });

    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(String(result.output)).toContain('reception-grep.txt');
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('reception 后台会话调 webfetch 不创建权限请求', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('fetched-by-reception', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeTeamTool('webfetch', { url: 'https://example.com/reception' });

    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('reception 后台会话在工作区规则 ask 只读工具时仍自动放行', async () => {
    writeReadPermissionRule('ask');
    const targetPath = join(TEST_WORKSPACE, 'reception-ask-rule.txt');
    writeFileSync(targetPath, 'ask rule read', 'utf8');

    const result = await executeTeamTool('read', { filePath: targetPath });

    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(JSON.stringify(result.output)).toContain('ask rule read');
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('reception 会话缺少 team_parent_session_id 时只读工具仍需审批', async () => {
    mocks.teamParentSessionId = null;
    writeReadPermissionRule('ask');
    const targetPath = join(TEST_WORKSPACE, 'reception-no-parent.txt');
    writeFileSync(targetPath, 'no parent', 'utf8');

    const result = await executeTeamTool('read', { filePath: targetPath });

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(permissionInsertParams()?.[2]).toBe('read');
  });

  it('reception 后台会话命中显式 deny 的只读工具时仍被拒绝', async () => {
    writeReadPermissionRule('deny');
    const targetPath = join(TEST_WORKSPACE, 'reception-denied.txt');
    writeFileSync(targetPath, 'denied', 'utf8');

    const result = await executeTeamTool('read', { filePath: targetPath });

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('被权限规则禁止');
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('reception 后台会话调 write 仍需审批', async () => {
    const targetPath = join(TEST_WORKSPACE, 'reception-write.txt');

    const result = await executeTeamTool('write', { path: targetPath, content: 'demo' });

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(String(result.output)).toContain('requires approval');
    expect(existsSync(targetPath)).toBe(false);
    expect(permissionInsertParams()?.[2]).toBe('write');
  });

  it('reception 后台会话调 edit 仍需审批', async () => {
    const targetPath = join(TEST_WORKSPACE, 'reception-edit.txt');
    writeFileSync(targetPath, 'before', 'utf8');

    const result = await executeTeamTool('edit', {
      filePath: targetPath,
      oldString: 'before',
      newString: 'after',
    });

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(readFileSync(targetPath, 'utf8')).toBe('before');
    expect(permissionInsertParams()?.[2]).toBe('edit');
  });

  it('reception 后台会话调 bash 仍需审批', async () => {
    const result = await executeTeamTool('bash', {
      command: 'printf reception-bash',
      description: '权限阶梯回归',
    });

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(String(result.output)).toContain('requires approval');
    expect(permissionInsertParams()?.[2]).toBe('bash');
  });

  it('reception 后台会话调 lsp_rename 仍需审批（lsp 不在只读白名单）', async () => {
    const targetPath = join(TEST_WORKSPACE, 'reception-rename.ts');
    writeFileSync(targetPath, 'const alpha = 1;\n', 'utf8');

    const result = await executeTeamTool('lsp_rename', {
      filePath: targetPath,
      line: 1,
      character: 6,
      newName: 'beta',
    });

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(String(result.output)).toContain('requires approval');
    expect(permissionInsertParams()?.[2]).toBe('lsp');
  });

  it.each(['pm1', 'pm2', 'executor', 'reviewer'])(
    '%s 后台会话调 write 仍保持全量免审批',
    async (roleLayer) => {
      mocks.roleLayer = roleLayer;
      const targetPath = join(TEST_WORKSPACE, `team-${roleLayer}-write.txt`);

      const result = await executeTeamTool('write', { path: targetPath, content: 'demo' });

      expect(result.isError).toBe(false);
      expect(result.pendingPermissionRequestId).toBeUndefined();
      expect(existsSync(targetPath)).toBe(true);
      expect(permissionInsertParams()).toBeUndefined();
    },
  );
});

function readInsertedChildSessionMetadata(): Record<string, unknown> | undefined {
  const insertCall = mocks.sqliteRunMock.mock.calls.find(
    ([query]) => typeof query === 'string' && query.includes('INSERT INTO sessions'),
  );
  const params = insertCall?.[1] as readonly unknown[] | undefined;
  const metadataJson = params?.[2];
  return typeof metadataJson === 'string'
    ? (JSON.parse(metadataJson) as Record<string, unknown>)
    : undefined;
}
