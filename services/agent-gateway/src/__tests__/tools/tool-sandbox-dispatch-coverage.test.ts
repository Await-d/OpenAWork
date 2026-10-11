/**
 * `tool-sandbox` 派发覆盖率 tripwire(261009-tool-sandbox 拆分方案的 P0 护栏)。
 *
 * 目的:在把 `executeGatewayManagedToolImpl` 的巨型 if 链按域搬进
 * `sandbox/handlers/*` 之前,先钉死「静态白名单」与「派发可达性」两条不变量,
 * 使任何「搬迁漏分支 / 搬丢白名单条目」都变成确定性红灯(而非静默通过)。
 *
 * 判据(来自 tool-sandbox.ts 的实际出口文案):
 *   - 白名单未命中 → `Tool "X" is not allowed`
 *   - 派发未命中且注册表无此工具 → `Tool "X" not found`(ToolNotFoundError)
 *
 * 若某工具名的 if 分支被搬丢,它会一路落到 `this.registry.execute(...)` 并
 * 抛 `ToolNotFoundError`,输出变成 `... not found` —— 本测试断言"不得出现"。
 *
 * 说明:渠道 / codegraph 等工具在普通 chat 会话会命中「会话未启用」门
 * (`is not enabled for this session`)——那是**门控**而非**派发缺口**,不计入失败。
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MessageStoreV2 from '../../message/message-store-v2.js';

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

import { TEST_WORKSPACE, mocks } from './tool-sandbox-test-support.js';
import { TOOL_WHITELIST, createDefaultSandbox } from '../../tools/tool-sandbox.js';

/** 静态白名单里必须始终存在的关键条目(按工具家族各取代表)。 */
const CRITICAL_WHITELIST_NAMES = [
  'patch',
  'bash',
  'read_tool_output',
  'edit',
  'multi_edit',
  'batch',
  'skill',
  'question',
  // 子代理工具:规范名 `subagent` 与历史别名 `task` 都必须在册。
  // 模型可见名是 `subagent`(见 tool-definitions 的 getVisibleToolName),
  // 历史回归:白名单只登记 `task` 时,`subagent` 会被沙箱白名单门禁拒绝。
  'subagent',
  'task',
  'task_create',
  'task_get',
  'task_list',
  'task_update',
  'mcp_list_tools',
  'mcp_call',
  'background_output',
  'background_cancel',
  'interactive_bash',
  'run_bash_in_background',
  'bash_output',
  'bash_kill',
  'ast_grep_search',
  'ast_grep_replace',
  'lsp_rename',
  'generate_image',
  'session_list',
  'session_read',
  'session_search',
  'session_info',
  'session_rename',
  'session_move',
  'memory_manage',
  'skill_manage',
  'plugin_manage',
  'schedule_manage',
  'agent_manage',
  'team_workspace_manage',
  'desktop_automation',
  'desktop_control',
  'computer_use',
  'repo_clone',
  'repo_overview',
];

/** 允许"落到注册表兜底"的白名单条目(不在 if 链、由 ToolRegistry 通用执行)。 */
const REGISTRY_BACKED_NAMES = new Set<string>(['read', 'write', 'glob', 'grep', 'list']);

const NOT_ALLOWED_MARK = 'is not allowed';
const NOT_FOUND_MARK = 'not found';

describe('tool-sandbox 派发覆盖率 tripwire', () => {
  beforeEach(() => {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteAllMock.mockImplementation(() => []);
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockReset();
    mocks.transitionToolToRunningMock.mockReset();
    mocks.roleLayer = null;
    mocks.teamParentSessionId = null;
    mocks.handoffState = null;
    mocks.requireBoundWorkspace = false;
    // yolo 档位 + 已绑定工作区:让权限层与工作区守卫都不拦截,直达派发。
    mocks.metadataJson = JSON.stringify({
      workingDirectory: TEST_WORKSPACE,
      permissionMode: 'yolo',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  });

  it('静态白名单必须包含全部关键工具名', () => {
    const missing = CRITICAL_WHITELIST_NAMES.filter((name) => !TOOL_WHITELIST.has(name));
    expect(missing).toEqual([]);
  });

  it('每个白名单工具名都能被派发链路识别(不得落到 not found 兜底)', async () => {
    const sandbox = createDefaultSandbox();
    const names = [...TOOL_WHITELIST].filter((name) => !REGISTRY_BACKED_NAMES.has(name));

    const unhandled: string[] = [];
    for (const name of names) {
      const result = await sandbox.execute(
        { toolCallId: `probe-${name}`, toolName: name, rawInput: {} },
        new AbortController().signal,
        'coverage-session',
        {
          clientRequestId: `probe-req-${name}`,
          nextRound: 1,
          requestData: { clientRequestId: `probe-req-${name}` },
        },
      );
      const output = String(result.output);
      expect(output, `工具 "${name}" 不应被静态白名单拒绝`).not.toContain(NOT_ALLOWED_MARK);
      if (output.includes(NOT_FOUND_MARK)) unhandled.push(name);
    }

    // 空数组 = 每个白名单名都有真实承接(if 链分支或注册表工具)。
    expect(unhandled).toEqual([]);
  });

  it('派发链不得出现未 await 的 handler 调用', () => {
    const source = readFileSync(new URL('../../tools/tool-sandbox.ts', import.meta.url), 'utf8');
    // `return await handleXxx(...)` 合法;写成 `return handleXxx(...)` 时,handler 的
    // 异步 reject 不经过 `executeGatewayManagedToolImpl` 的 try/catch(async 函数的
    // `return promise` 语义),会绕过兜底 catch 直接中断整轮流。
    // 只匹配「调用形态」:`return handleFoo;`(把 handler 当值返回)不算违规。
    expect(source).not.toMatch(
      /\breturn\s+(?!await\s)(?:handle[A-Z]\w*\s*\(|executePluginTool\s*\()/,
    );
  });

  /** 把会话工作区绑定到子目录,便于构造「越界 workdir」的入参错误。 */
  function bindNestedSessionWorkspace(): string {
    const nestedWorkspace = join(TEST_WORKSPACE, 'nested-session');
    mkdirSync(nestedWorkspace, { recursive: true });
    mocks.metadataJson = JSON.stringify({
      workingDirectory: nestedWorkspace,
      permissionMode: 'yolo',
    });
    return nestedWorkspace;
  }

  function runBashProbe(workdir: string, tag: string) {
    return createDefaultSandbox().execute(
      {
        toolCallId: `probe-bash-outside-${tag}`,
        toolName: 'bash',
        rawInput: { command: 'echo hi', description: 'probe outside workspace', workdir },
      },
      new AbortController().signal,
      'coverage-session',
      {
        clientRequestId: `probe-req-bash-outside-${tag}`,
        nextRound: 1,
        requestData: { clientRequestId: `probe-req-bash-outside-${tag}` },
      },
    );
  }

  it('handler 抛出的绝对路径越界错误降级为可恢复工具错误,并给出可操作的会话工作区', async () => {
    const nestedWorkspace = bindNestedSessionWorkspace();

    // 会话工作区绑定在子目录,workdir 却指向父目录:resolveBashWorkdir 会抛错,
    // 必须被收敛成 isError 工具结果(线上表现曾是可恢复错误被放大为
    // STREAM_ERROR + WS 流中断)。
    const result = await runBashProbe(TEST_WORKSPACE, 'absolute-parent');

    expect(result.isError).toBe(true);
    const output = String(result.output);
    expect(output).toContain('outside current session workspace');
    // 文案契约:必须带上正确的会话工作区,模型才能据此自我纠正重试。
    expect(output).toContain(`(session workspace: ${nestedWorkspace})`);
  });

  it('handler 抛出的相对路径越界错误同样降级为工具错误', async () => {
    bindNestedSessionWorkspace();

    const result = await runBashProbe('../..', 'relative-escape');

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('outside current session workspace');
  });
});
