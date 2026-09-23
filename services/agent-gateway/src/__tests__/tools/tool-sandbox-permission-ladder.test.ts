import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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

function permissionInsertCalls(): ReadonlyArray<readonly unknown[]> {
  return mocks.sqliteRunMock.mock.calls.filter(
    ([query]) => typeof query === 'string' && query.includes('INSERT INTO permission_requests'),
  );
}

const AST_GREP_CONTRACT_STUB = `#!/usr/bin/env node
'use strict';
// 测试用 ast-grep 0.44 真实契约桩：仅覆盖本用例固定的 pattern/rewrite 组合。
// 生产代码以 run 子命令调用（scan 不接受 --pattern），写盘模式（--update-all）不得带 --json
// （实测 --json 会让 ast-grep 只打印 JSON 而不落盘）；
// 本桩严格复刻该契约：args[0] 必须是 run，且 --update-all 与 --json 同现时只输出 JSON、不改写文件，
// 从而让权限层之后的真实执行链路和“带 --json 就静默丢写”的约束都能被验证。
const fs = require('node:fs');

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('ast-grep 0.0.0-test-stub\\n');
  process.exit(0);
}

const readOption = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const pattern = readOption('--pattern');
const rewrite = readOption('--rewrite');
if (args[0] !== 'run' || pattern !== 'const $A = 1' || rewrite !== 'const $A = 42') {
  process.stderr.write('unexpected ast-grep stub invocation: ' + args.join(' ') + '\\n');
  process.exit(2);
}

const valueOptions = new Set(['--pattern', '--lang', '--globs', '--rewrite', '--context']);
const paths = args.filter(
  (arg, index) => index > 0 && !arg.startsWith('--') && !valueOptions.has(args[index - 1] || ''),
);
const updateAll = args.includes('--update-all');
const jsonMode = args.some((arg) => arg.startsWith('--json'));

let changed = 0;
for (const filePath of paths) {
  const source = fs.readFileSync(filePath, 'utf8');
  const rewritten = source.replace(/const ([A-Za-z_$][A-Za-z0-9_$]*) = 1/g, 'const $1 = 42');
  if (rewritten === source) continue;
  changed += 1;
  if (updateAll && !jsonMode) {
    fs.writeFileSync(filePath, rewritten);
    continue;
  }
  process.stdout.write(
    JSON.stringify({
      file: filePath,
      range: { start: { line: 0, column: 0 } },
      lines: source.trim(),
      replacement: rewrite,
    }) + '\\n',
  );
}

if (changed === 0) process.exit(1);
if (updateAll && !jsonMode) process.stdout.write('Applied ' + changed + ' changes\\n');
`;

describe('tool-sandbox 会话权限阶梯（permissionMode / yoloMode）', () => {
  beforeEach(() => {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteAllMock.mockImplementation(() => []);
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockReset();
    mocks.transitionToolToRunningMock.mockReset();
    mocks.callMcpToolForSessionMock.mockReset();
    mocks.callMcpToolForSessionMock.mockResolvedValue({
      serverId: 'demo-server',
      toolName: 'echo',
      content: [{ type: 'text', text: 'mcp-echo-ok' }],
      isError: false,
    });
    mocks.dispatchRunBashInBackgroundMock.mockReset();
    mocks.dispatchRunBashInBackgroundMock.mockResolvedValue({
      ok: true,
      output: {
        terminalId: 'term-background-bash-test',
        status: 'running',
        startedAtMs: Date.now(),
        command: 'printf background-bash',
        cwd: TEST_WORKSPACE,
      },
    });
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

  it('auto-edit 档位下 patch 自动执行且不创建 pending 权限请求', async () => {
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
        toolName: 'patch',
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

  it('同一文件的多个 Update 块按顺序累积，后块不会覆盖前块', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    const targetPath = join(TEST_WORKSPACE, 'auto-edit-patch-sequential.txt');
    writeFileSync(targetPath, 'A\nB\n', 'utf8');
    const patchText = [
      '*** Begin Patch',
      `*** Update File: ${targetPath}`,
      '@@',
      '-A',
      '+B',
      '@@',
      '-B',
      '+C',
      '*** End Patch',
    ].join('\n');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-patch-sequential',
        toolName: 'patch',
        rawInput: { patchText },
      },
      new AbortController().signal,
      'session-auto-edit-patch-sequential',
      executionContext('req-auto-edit-patch-sequential'),
    );

    expect(result.isError).toBe(false);
    expect(readFileSync(targetPath, 'utf8')).toBe('B\nC\n');
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('一次补丁内完成新增 / 修改 / 移动 / 删除', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    const addPath = join(TEST_WORKSPACE, 'patch-multi-add.txt');
    const updatePath = join(TEST_WORKSPACE, 'patch-multi-update.txt');
    const moveSourcePath = join(TEST_WORKSPACE, 'patch-multi-move.txt');
    const moveTargetPath = join(TEST_WORKSPACE, 'patch-multi-moved.txt');
    const deletePath = join(TEST_WORKSPACE, 'patch-multi-delete.txt');
    writeFileSync(updatePath, 'alpha\nbeta\n', 'utf8');
    writeFileSync(moveSourcePath, 'gamma\n', 'utf8');
    writeFileSync(deletePath, 'obsolete\n', 'utf8');

    const patchText = [
      '*** Begin Patch',
      `*** Add File: ${addPath}`,
      '+added line',
      `*** Update File: ${updatePath}`,
      '@@',
      '-beta',
      '+BETA',
      `*** Update File: ${moveSourcePath}`,
      `*** Move to: ${moveTargetPath}`,
      '-gamma',
      '+GAMMA',
      `*** Delete File: ${deletePath}`,
      '*** End Patch',
    ].join('\n');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-patch-multi',
        toolName: 'patch',
        rawInput: { patchText },
      },
      new AbortController().signal,
      'session-patch-multi',
      executionContext('req-patch-multi'),
    );

    expect(result.isError).toBe(false);
    expect(readFileSync(addPath, 'utf8')).toBe('added line\n');
    expect(readFileSync(updatePath, 'utf8')).toBe('alpha\nBETA\n');
    expect(existsSync(moveSourcePath)).toBe(false);
    expect(readFileSync(moveTargetPath, 'utf8')).toBe('GAMMA\n');
    expect(existsSync(deletePath)).toBe(false);
  });

  it('补丁匹配失败时返回可自愈的工具错误，而不是抛异常中断回合', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    const targetPath = join(TEST_WORKSPACE, 'auto-edit-patch-miss.txt');
    writeFileSync(targetPath, 'a\n', 'utf8');
    const patchText = [
      '*** Begin Patch',
      `*** Update File: ${targetPath}`,
      '@@',
      '-not-here',
      '+x',
      '*** End Patch',
    ].join('\n');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-patch-miss',
        toolName: 'patch',
        rawInput: { patchText },
      },
      new AbortController().signal,
      'session-auto-edit-patch-miss',
      executionContext('req-auto-edit-patch-miss'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('Failed to find expected lines in');
    expect(readFileSync(targetPath, 'utf8')).toBe('a\n');
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
    // 父会话只表达工作区（不表达档位）；权限文件需要 workingDirectory 才能被加载。
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    // 委派动作默认需要审批（`task_run` 默认 ask）；本用例只关注子会话档位继承，
    // 用工作区规则显式允许委派，隔离权限门控。
    writeFileSync(
      join(TEST_WORKSPACE, '.openawork.permissions.json'),
      JSON.stringify({ rules: [{ permission: 'task_run', pattern: '*', action: 'allow' }] }),
      'utf8',
    );

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
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    // auto-edit 档位只覆盖 edit/write，不覆盖委派动作（task_run）；这里显式允许委派，
    // 让用例聚焦「子会话档位继承」本身。
    writeFileSync(
      join(TEST_WORKSPACE, '.openawork.permissions.json'),
      JSON.stringify({ rules: [{ permission: 'task_run', pattern: '*', action: 'allow' }] }),
      'utf8',
    );

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
    // yolo 档位免审批（免审批分支在 ask 之前），委派动作无需额外放行规则。
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

  it('auto-edit 档位不放过 desktop_automation：仍需审批（先放行浏览器自动化插件 gate）', async () => {
    // desktop_automation 默认动作是 ask，且不在 AUTO_EDIT_PERMISSION_CATEGORIES（仅 edit/write）内。
    // 该工具在权限检查之前还有一道「浏览器自动化插件未启用」gate，
    // 这里通过 sqliteGet 的 user_settings 查询返回已启用配置放行该 gate，使断言落在权限层本身。
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    const originalSqliteGetImplementation = mocks.sqliteGetMock.getMockImplementation();
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('user_settings')) {
        return { value: JSON.stringify({ desktopAutomation: { enabled: true } }) };
      }
      return originalSqliteGetImplementation?.(query);
    });

    try {
      const result = await createDefaultSandbox().execute(
        {
          toolCallId: 'call-auto-edit-desktop-automation',
          toolName: 'desktop_automation',
          rawInput: { action: 'status' },
        },
        new AbortController().signal,
        'session-auto-edit-desktop-automation',
        executionContext('req-auto-edit-desktop-automation'),
      );

      expect(result.pendingPermissionRequestId).toBeDefined();
      expect(String(result.output)).toContain('requires approval');
      expect(permissionInsertParams()?.[2]).toBe('desktop_automation');
    } finally {
      if (originalSqliteGetImplementation) {
        mocks.sqliteGetMock.mockImplementation(originalSqliteGetImplementation);
      }
    }
  });

  it('auto-edit 档位不放过 desktop_control：仍需审批（先放行桌面控制插件 gate）', async () => {
    // desktop_control 在权限检查之前还有一道「桌面控制插件未启用」gate（tool-sandbox.ts:6501）。
    // 这里通过 sqliteGet 的 user_settings 查询返回已启用配置放行该 gate，使断言落在权限层本身。
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    const originalSqliteGetImplementation = mocks.sqliteGetMock.getMockImplementation();
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('user_settings')) {
        return { value: JSON.stringify({ desktopControl: { enabled: true } }) };
      }
      return originalSqliteGetImplementation?.(query);
    });

    try {
      const result = await createDefaultSandbox().execute(
        {
          toolCallId: 'call-auto-edit-desktop-control',
          toolName: 'desktop_control',
          rawInput: { action: 'status' },
        },
        new AbortController().signal,
        'session-auto-edit-desktop-control',
        executionContext('req-auto-edit-desktop-control'),
      );

      expect(result.pendingPermissionRequestId).toBeDefined();
      expect(String(result.output)).toContain('requires approval');
      expect(permissionInsertParams()?.[2]).toBe('desktop_control');
    } finally {
      if (originalSqliteGetImplementation) {
        mocks.sqliteGetMock.mockImplementation(originalSqliteGetImplementation);
      }
    }
  });

  it('auto-edit 档位不放过 mcp_call：仍需审批（mcp_call 类别不在自动放行集合）', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-mcp-call',
        toolName: 'mcp_call',
        rawInput: { serverId: 'demo-server', toolName: 'echo', arguments: {} },
      },
      new AbortController().signal,
      'session-auto-edit-mcp-call',
      executionContext('req-auto-edit-mcp-call'),
    );

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(String(result.output)).toContain('requires approval');
    expect(permissionInsertParams()?.[2]).toBe('mcp_call');
    expect(mocks.callMcpToolForSessionMock).not.toHaveBeenCalled();
  });

  it('auto-edit 档位不放过 skill_mcp：仍需审批（skill 类别不在自动放行集合）', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-skill-mcp',
        toolName: 'skill_mcp',
        rawInput: { mcp_name: 'demo-mcp', tool_name: 'echo' },
      },
      new AbortController().signal,
      'session-auto-edit-skill-mcp',
      executionContext('req-auto-edit-skill-mcp'),
    );

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(String(result.output)).toContain('requires approval');
    expect(permissionInsertParams()?.[2]).toBe('skill');
  });

  it('auto-edit 档位下 ast_grep_replace 自动执行并真实改写文件（AST_GREP_BIN 契约桩）', async () => {
    // ast_grep_replace 映射到 edit 类别（tool-category-map.ts），属于 auto-edit 的自动放行范围。
    // 本用例通过生产支持的 AST_GREP_BIN 注入复刻 ast-grep 0.44 真实契约的桩（run 子命令、
    // 写盘模式不带 --json），权限判断仍完全走真实沙箱逻辑。
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    const targetPath = join(TEST_WORKSPACE, 'auto-edit-ast-grep.ts');
    const stubPath = join(TEST_WORKSPACE, 'ast-grep-contract-stub.cjs');
    writeFileSync(targetPath, 'const alpha = 1;\n', 'utf8');
    writeFileSync(stubPath, AST_GREP_CONTRACT_STUB, { mode: 0o755 });
    const previousAstGrepBin = process.env['AST_GREP_BIN'];
    process.env['AST_GREP_BIN'] = stubPath;

    try {
      const result = await createDefaultSandbox().execute(
        {
          toolCallId: 'call-auto-edit-ast-grep',
          toolName: 'ast_grep_replace',
          rawInput: {
            pattern: 'const $A = 1',
            rewrite: 'const $A = 42',
            lang: 'typescript',
            paths: [targetPath],
            dryRun: false,
          },
        },
        new AbortController().signal,
        'session-auto-edit-ast-grep',
        executionContext('req-auto-edit-ast-grep'),
      );

      expect(result.isError).toBe(false);
      expect(result.pendingPermissionRequestId).toBeUndefined();
      expect(readFileSync(targetPath, 'utf8')).toContain('const alpha = 42');
      expect(String(result.output)).toContain('已应用替换');
      expect(permissionInsertParams()).toBeUndefined();
    } finally {
      if (previousAstGrepBin === undefined) {
        delete process.env['AST_GREP_BIN'];
      } else {
        process.env['AST_GREP_BIN'] = previousAstGrepBin;
      }
    }
  });

  it('yolo 档位无法绕过通配符级 deny：write 被工具级拒绝且未执行', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });
    writeFileSync(
      join(TEST_WORKSPACE, '.openawork.permissions.json'),
      JSON.stringify({
        rules: [{ permission: 'write', pattern: '*', action: 'deny' }],
      }),
      'utf8',
    );
    const targetPath = join(TEST_WORKSPACE, 'wildcard-denied-yolo.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-yolo-wildcard-denied-write',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-yolo-wildcard-denied-write',
      executionContext('req-yolo-wildcard-denied-write'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('被权限规则禁止');
    // 通配符级（工具级）拒绝在 tool-sandbox.ts:6200 分支提前返回，不带作用域前缀。
    expect(String(result.output)).not.toContain('在作用域');
    expect(existsSync(targetPath)).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('auto-edit 档位无法绕过通配符级 deny：write 被工具级拒绝且未执行', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    writeFileSync(
      join(TEST_WORKSPACE, '.openawork.permissions.json'),
      JSON.stringify({
        rules: [{ permission: 'write', pattern: '*', action: 'deny' }],
      }),
      'utf8',
    );
    const targetPath = join(TEST_WORKSPACE, 'wildcard-denied-auto-edit.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-wildcard-denied-write',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-auto-edit-wildcard-denied-write',
      executionContext('req-auto-edit-wildcard-denied-write'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('被权限规则禁止');
    expect(String(result.output)).not.toContain('在作用域');
    expect(existsSync(targetPath)).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('请求级 permissionMode:yolo 不参与强制执行：会话为 ask 时 write 仍需审批', async () => {
    // 请求级档位只用于系统提示词投影（routes/stream.ts 的 StreamRequest.permissionMode 注释）；
    // 强制执行只读会话 metadata。这里按生产 stream 路径把 permissionMode 放进 requestData。
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'ask',
      workingDirectory: TEST_WORKSPACE,
    });
    const targetPath = join(TEST_WORKSPACE, 'request-level-yolo-write.txt');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-request-level-yolo-write',
        toolName: 'write',
        rawInput: { path: targetPath, content: 'demo' },
      },
      new AbortController().signal,
      'session-request-level-yolo-write',
      {
        clientRequestId: 'req-request-level-yolo-write',
        nextRound: 1,
        requestData: { clientRequestId: 'req-request-level-yolo-write', permissionMode: 'yolo' },
      },
    );

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(String(result.output)).toContain('requires approval');
    expect(existsSync(targetPath)).toBe(false);
    expect(permissionInsertParams()?.[2]).toBe('write');
  });

  it('yolo 档位下 mcp_call 自动执行（顶层档位覆盖非文件类 ask 类别）', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-yolo-mcp-call',
        toolName: 'mcp_call',
        rawInput: { serverId: 'demo-server', toolName: 'echo', arguments: { text: 'ping' } },
      },
      new AbortController().signal,
      'session-yolo-mcp-call',
      executionContext('req-yolo-mcp-call'),
    );

    expect(result.isError).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(mocks.callMcpToolForSessionMock).toHaveBeenCalledTimes(1);
    expect(mocks.callMcpToolForSessionMock.mock.calls[0]?.[1]).toEqual({
      serverId: 'demo-server',
      toolName: 'echo',
      arguments: { text: 'ping' },
    });
    expect(JSON.stringify(result.output)).toContain('mcp-echo-ok');
    expect(permissionInsertParams()).toBeUndefined();
  });

  it('ask 档位下 run_bash_in_background 仍需要审批（后台 bash 不得静默放行）', async () => {
    // 回归背景：run_bash_in_background 此前未登记权限类别，未映射工具名会命中
    // DEFAULT_PERMISSION_RULES 的通配符 allow，在 ask 档位下也能无审批执行任意 shell。
    // fail-closed 后它映射到 bash 类别，ask 档位必须停在 pending 审批。
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-ask-run-bash-background',
        toolName: 'run_bash_in_background',
        rawInput: { command: 'printf background-ask', description: '权限阶梯回归' },
      },
      new AbortController().signal,
      'session-ask-run-bash-background',
      executionContext('req-ask-run-bash-background'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('requires approval');
    expect(result.pendingPermissionRequestId).toBeDefined();
    const inserts = permissionInsertCalls();
    expect(inserts).toHaveLength(1);
    expect(permissionInsertParams()?.[2]).toBe('bash');
    // 唯一一条权限写入是 status='pending' 的待审批行：没有任何审批落库。
    expect(String(inserts[0]?.[0])).toContain("'pending'");
    expect(mocks.dispatchRunBashInBackgroundMock).not.toHaveBeenCalled();
  });

  it('auto-edit 档位下 run_bash_in_background 仍需要审批（后台 bash 不属于自动放行类别）', async () => {
    // 这是已确认绕过的回归锁定点：auto-edit 只自动放行 edit/write 类别，
    // 后台 bash 与前台 bash 等价，必须继续走 ask 审批。
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-auto-edit-run-bash-background',
        toolName: 'run_bash_in_background',
        rawInput: { command: 'printf background-auto-edit', description: '权限阶梯回归' },
      },
      new AbortController().signal,
      'session-auto-edit-run-bash-background',
      executionContext('req-auto-edit-run-bash-background'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('requires approval');
    expect(result.pendingPermissionRequestId).toBeDefined();
    const inserts = permissionInsertCalls();
    expect(inserts).toHaveLength(1);
    expect(permissionInsertParams()?.[2]).toBe('bash');
    expect(String(inserts[0]?.[0])).toContain("'pending'");
    expect(mocks.dispatchRunBashInBackgroundMock).not.toHaveBeenCalled();
  });

  it('yolo 档位下 run_bash_in_background 自动放行（顶层档位覆盖后台 bash）', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-yolo-run-bash-background',
        toolName: 'run_bash_in_background',
        rawInput: { command: 'printf background-yolo', description: '权限阶梯回归' },
      },
      new AbortController().signal,
      'session-yolo-run-bash-background',
      executionContext('req-yolo-run-bash-background'),
    );

    expect(result.isError).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(permissionInsertParams()).toBeUndefined();
    expect(mocks.dispatchRunBashInBackgroundMock).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchRunBashInBackgroundMock.mock.calls[0]?.[0]).toMatchObject({
      rawInput: expect.objectContaining({ command: 'printf background-yolo' }),
    });
  });

  it('未注册的任意工具名 some_future_tool 不会被静默执行：白名单 gate 直接拒绝', async () => {
    // some_future_tool 既不在 TOOL_WHITELIST 也不在 ALLOW_BY_DEFAULT_TOOL_NAMES：
    // 沙箱在权限检查之前的白名单 gate 就返回 is not allowed，即使 yolo 档位也无法
    // 让它静默执行，也不会创建权限请求。
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-unregistered-future-tool',
        toolName: 'some_future_tool',
        rawInput: { value: 'demo' },
      },
      new AbortController().signal,
      'session-unregistered-future-tool',
      executionContext('req-unregistered-future-tool'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('is not allowed');
    expect(result.pendingPermissionRequestId).toBeUndefined();
    expect(permissionInsertCalls()).toHaveLength(0);
  });

  it('已注册但未映射类别的工具不会被静默放行：必须进入审批且类别回退为 custom', async () => {
    // fail-closed 的核心语义：已注册（白名单放行）但未登记权限类别的工具必须进入
    // 审批链路，类别回退为 custom，绝不允许静默执行。
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    const futureToolExecute = vi.fn(async () => ({ output: 'must-not-run', isError: false }));

    const sandbox = createDefaultSandbox();
    sandbox.register({
      name: 'some_future_tool',
      description: '未来新增但尚未登记权限类别的工具',
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ output: z.string() }),
      execute: futureToolExecute,
    });

    const result = await sandbox.execute(
      {
        toolCallId: 'call-registered-unmapped-future-tool',
        toolName: 'some_future_tool',
        rawInput: { value: 'demo' },
      },
      new AbortController().signal,
      'session-registered-unmapped-future-tool',
      executionContext('req-registered-unmapped-future-tool'),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('requires approval');
    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(permissionInsertParams()?.[2]).toBe('custom');
    expect(futureToolExecute).not.toHaveBeenCalled();
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
