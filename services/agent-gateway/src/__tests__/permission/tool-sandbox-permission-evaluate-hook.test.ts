/**
 * `permission.evaluate`（deny-only 后置裁决）回归。
 *
 * 该 hook 必须在 `ensurePermissionForTool` 的最后运行——规则、档位快捷分支
 * （yolo / auto-edit / 后台 team / reception）、渠道策略、workspace 永久规则、
 * saved approvals（含会话批准与父会话继承）全部判定之后。本文件用真实
 * tool-sandbox 执行链路验证：
 *
 *   1. 插件 deny 能覆盖 yolo / auto-edit 档位的免审批分支；
 *   2. 插件 deny 能覆盖 saved approval（session 批准）；
 *   3. 未注册插件 / 插件不设置 effect / 插件设置非 deny 值 → 决策与既有链路一致；
 *   4. 插件抛错 → 只记录 warn，决策不变且不抛；
 *   5. 显式 deny 规则仍优先：插件无法把 deny 改成 allow，且 deny 早退不调用 hook。
 *
 * 桩组织与 `tool-sandbox-permission-ladder.test.ts` 保持一致（共享
 * `../tools/tool-sandbox-test-support.js` 的模块级桩）。
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MessageStoreV2 from '../../message/message-store-v2.js';
import type { PermissionEvaluateEvent } from '../../runtime/plugin-host.js';

vi.mock('../../infra/db.js', async () => {
  const { TEST_WORKSPACE, mocks } = await import('../tools/tool-sandbox-test-support.js');
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
  const { mocks } = await import('../tools/tool-sandbox-test-support.js');
  const actual = await vi.importActual<typeof MessageStoreV2>('../../message/message-store-v2.js');
  return {
    ...actual,
    transitionToolToRunning: mocks.transitionToolToRunningMock,
  };
});

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

vi.mock('../../mcp/mcp-runtime.js', async () => {
  const { mocks } = await import('../tools/tool-sandbox-test-support.js');
  return {
    callMcpToolForSession: mocks.callMcpToolForSessionMock,
    getConfiguredMcpServerForSession: mocks.getConfiguredMcpServerForSessionMock,
    getMcpServerFingerprint: mocks.getMcpServerFingerprintMock,
    listMcpToolsForSession: mocks.listMcpToolsForSessionMock,
  };
});

import { TEST_WORKSPACE, mocks } from '../tools/tool-sandbox-test-support.js';
import { _registerPluginForTest, _resetPluginsForTest } from '../../runtime/plugin-host.js';
import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

function executionContext(clientRequestId: string) {
  return {
    clientRequestId,
    nextRound: 1,
    requestData: { clientRequestId },
  };
}

function permissionInsertCalls(): ReadonlyArray<readonly unknown[]> {
  return mocks.sqliteRunMock.mock.calls.filter(
    ([query]) => typeof query === 'string' && query.includes('INSERT INTO permission_requests'),
  );
}

/** 第一条 `INSERT INTO permission_requests` 的参数数组（[2] 为 tool_name）。 */
function permissionInsertParams(): readonly unknown[] | undefined {
  return permissionInsertCalls()[0]?.[1] as readonly unknown[] | undefined;
}

describe('tool-sandbox permission.evaluate（deny-only 后置裁决）', () => {
  beforeEach(() => {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    _resetPluginsForTest();
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
    _resetPluginsForTest();
    vi.clearAllMocks();
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  });

  it('插件 deny 覆盖 yolo 档位：bash 被拒绝、不执行、无 pending 记录', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });
    const seen: PermissionEvaluateEvent[] = [];
    _registerPluginForTest('deny-bash', {
      'permission.evaluate': (event) => {
        seen.push(event);
        if (event.permission !== 'bash') return;
        event.effect = 'deny';
        event.message = '插件策略：禁止执行 shell 命令';
      },
    });
    const markerPath = join(TEST_WORKSPACE, 'plugin-evaluate-yolo-denied.txt');
    const command = `touch ${markerPath}`;

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-plugin-evaluate-yolo',
        toolName: 'bash',
        rawInput: { command, description: '插件后置裁决回归' },
      },
      new AbortController().signal,
      'session-plugin-evaluate-yolo',
      executionContext('req-plugin-evaluate-yolo'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('插件策略：禁止执行 shell 命令');
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(existsSync(markerPath)).toBe(false);
    expect(permissionInsertCalls()).toHaveLength(0);
    // hook 在档位快捷分支之后运行，拿到的内置结论是 allow（本应免审批执行）。
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      sessionID: 'session-plugin-evaluate-yolo',
      toolName: 'bash',
      permission: 'bash',
      scope: command,
      decision: 'allow',
    });
  });

  it('插件 deny 覆盖 auto-edit 档位：write 被拒绝且不落盘', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    const seen: PermissionEvaluateEvent[] = [];
    _registerPluginForTest('deny-write', {
      'permission.evaluate': (event) => {
        seen.push(event);
        if (event.permission !== 'write') return;
        // 不提供 message：应回落到通用中文拒绝文案。
        event.effect = 'deny';
      },
    });
    const targetPath = join(TEST_WORKSPACE, 'plugin-evaluate-auto-edit.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-plugin-evaluate-auto-edit',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-plugin-evaluate-auto-edit',
      executionContext('req-plugin-evaluate-auto-edit'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('permission.evaluate');
    expect(existsSync(targetPath)).toBe(false);
    expect(permissionInsertCalls()).toHaveLength(0);
    expect(seen[0]).toMatchObject({
      toolName: 'write',
      permission: 'write',
      scope: 'plugin-evaluate-auto-edit.txt',
      decision: 'allow',
    });
  });

  it('插件 deny 覆盖 saved approval（session 批准）：已获批的 write 仍被拒绝', async () => {
    mocks.metadataJson = '{}';
    mocks.sqliteAllMock.mockImplementation((query?: string, params?: readonly unknown[]) =>
      typeof query === 'string' &&
      query.includes('FROM permission_requests') &&
      params?.[0] === 'write'
        ? [{ id: 'approved-session', decision: 'session', scope: '*', always_json: null }]
        : [],
    );
    const seen: PermissionEvaluateEvent[] = [];
    _registerPluginForTest('deny-approved-write', {
      'permission.evaluate': (event) => {
        seen.push(event);
        event.effect = 'deny';
        event.message = '插件策略：该路径禁止写入';
      },
    });
    const targetPath = join(TEST_WORKSPACE, 'plugin-evaluate-saved-approval.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-plugin-evaluate-saved-approval',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-plugin-evaluate-saved-approval',
      executionContext('req-plugin-evaluate-saved-approval'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('插件策略：该路径禁止写入');
    expect(existsSync(targetPath)).toBe(false);
    expect(permissionInsertCalls()).toHaveLength(0);
    // saved approval 命中后仍要经过 hook（decision = allow）。
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      toolName: 'write',
      permission: 'write',
      decision: 'allow',
    });
    // 对照：同一个 saved approval 在没有插件时应正常放行（零副作用基线）。
    _resetPluginsForTest();
    const controlPath = join(TEST_WORKSPACE, 'plugin-evaluate-saved-approval-control.txt');
    const control = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-plugin-evaluate-saved-approval-control',
        toolName: 'write',
        rawInput: { path: controlPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-plugin-evaluate-saved-approval',
      executionContext('req-plugin-evaluate-saved-approval-control'),
    );

    expect(control.isError).toBe(false);
    expect(existsSync(controlPath)).toBe(true);
    expect(permissionInsertCalls()).toHaveLength(0);
  });

  it('插件 deny 覆盖 user-scoped permanent grant：已永久允许的 write 仍被拒绝', async () => {
    mocks.metadataJson = '{}';
    // findMatchingPermissionGrant 走 permission_grants 表（用户级永久授权）。
    mocks.sqliteAllMock.mockImplementation((query?: string, params?: readonly unknown[]) =>
      typeof query === 'string' &&
      query.includes('FROM permission_grants') &&
      params?.[0] === 'user-1'
        ? [{ id: 'grant-1', user_id: 'user-1', tool_name: 'write', scope: '*' }]
        : [],
    );
    const seen: PermissionEvaluateEvent[] = [];
    _registerPluginForTest('deny-permanent-grant', {
      'permission.evaluate': (event) => {
        seen.push(event);
        event.effect = 'deny';
        event.message = '插件策略：永久授权也需复核';
      },
    });
    const targetPath = join(TEST_WORKSPACE, 'plugin-evaluate-permanent-grant.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-plugin-evaluate-permanent-grant',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-plugin-evaluate-permanent-grant',
      executionContext('req-plugin-evaluate-permanent-grant'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('插件策略：永久授权也需复核');
    expect(existsSync(targetPath)).toBe(false);
    expect(permissionInsertCalls()).toHaveLength(0);
    expect(seen[0]).toMatchObject({ toolName: 'write', decision: 'allow' });

    // 对照：同一个 permanent grant 在没有插件时应正常放行。
    _resetPluginsForTest();
    const controlPath = join(TEST_WORKSPACE, 'plugin-evaluate-permanent-grant-control.txt');
    const control = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-plugin-evaluate-permanent-grant-control',
        toolName: 'write',
        rawInput: { path: controlPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-plugin-evaluate-permanent-grant',
      executionContext('req-plugin-evaluate-permanent-grant-control'),
    );

    expect(control.isError).toBe(false);
    expect(existsSync(controlPath)).toBe(true);
    expect(permissionInsertCalls()).toHaveLength(0);
  });

  it('未注册插件时保持既有链路：默认档位 write 仍进入 pending 审批', async () => {
    mocks.metadataJson = '{}';
    const targetPath = join(TEST_WORKSPACE, 'plugin-evaluate-no-plugin.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-plugin-evaluate-no-plugin',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-plugin-evaluate-no-plugin',
      executionContext('req-plugin-evaluate-no-plugin'),
    );

    expect(result.isError).toBe(true);
    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(existsSync(targetPath)).toBe(false);
    expect(permissionInsertCalls()).toHaveLength(1);
    expect(permissionInsertParams()?.[2]).toBe('write');
  });

  it('插件不设置 effect（或设置非 deny 值）时决策不变：write 仍进入 pending 审批', async () => {
    mocks.metadataJson = '{}';
    const seen: PermissionEvaluateEvent[] = [];
    _registerPluginForTest('no-veto', {
      'permission.evaluate': (event) => {
        seen.push(event);
        // 插件只能拒绝：把 effect 改成非 'deny' 的取值必须被忽略。
        (event as { effect?: string }).effect = 'allow';
      },
    });
    const targetPath = join(TEST_WORKSPACE, 'plugin-evaluate-no-veto.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-plugin-evaluate-no-veto',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-plugin-evaluate-no-veto',
      executionContext('req-plugin-evaluate-no-veto'),
    );

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(existsSync(targetPath)).toBe(false);
    expect(permissionInsertCalls()).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ toolName: 'write', decision: 'ask' });
  });

  it('插件抛错只记录 warn，决策不变且不抛（yolo 下 bash 仍执行）', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      _registerPluginForTest('crashy-permission', {
        'permission.evaluate': () => {
          throw new Error('plugin evaluate crashed');
        },
      });
      const markerPath = join(TEST_WORKSPACE, 'plugin-evaluate-crashy.txt');

      const result = await createDefaultSandbox().execute(
        {
          toolCallId: 'call-plugin-evaluate-crashy',
          toolName: 'bash',
          rawInput: { command: `touch ${markerPath}`, description: '插件异常回归' },
        },
        new AbortController().signal,
        'session-plugin-evaluate-crashy',
        executionContext('req-plugin-evaluate-crashy'),
      );

      expect(result.isError).toBe(false);
      expect(existsSync(markerPath)).toBe(true);
      expect(permissionInsertCalls()).toHaveLength(0);
      const warnText = warnSpy.mock.calls.map((call) => call.join(' ')).join(' ');
      expect(warnText).toContain('crashy-permission');
      expect(warnText).toContain('plugin evaluate crashed');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('显式 deny 规则仍优先：插件无法把 deny 改成 allow，且 deny 早退不调用 hook', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });
    writeFileSync(
      join(TEST_WORKSPACE, '.openawork.permissions.json'),
      JSON.stringify({
        rules: [{ permission: 'write', pattern: 'blocked-plugin/**', action: 'deny' }],
      }),
      'utf8',
    );
    const seen: PermissionEvaluateEvent[] = [];
    _registerPluginForTest('allow-attempt', {
      'permission.evaluate': (event) => {
        seen.push(event);
        (event as { effect?: string }).effect = 'allow';
      },
    });
    const targetPath = join(TEST_WORKSPACE, 'blocked-plugin', 'file.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-plugin-evaluate-rule-deny',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-plugin-evaluate-rule-deny',
      executionContext('req-plugin-evaluate-rule-deny'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('被权限规则禁止');
    expect(existsSync(targetPath)).toBe(false);
    expect(permissionInsertCalls()).toHaveLength(0);
    // deny 早退路径已经拒绝，无需（也不应）再调用 hook。
    expect(seen).toHaveLength(0);
  });
});
