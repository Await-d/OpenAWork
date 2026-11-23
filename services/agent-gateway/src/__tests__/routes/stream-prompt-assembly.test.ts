/**
 * `stream-prompt-assembly.ts` 回归。
 *
 * 覆盖 T-13 阶段 2 抽出的 `stream.prepare-sync` 组装区，重点锁定三件容易在重构中
 * 走形的事情：
 * 1. `dynamicToolDefsPromise` **在函数返回前就已启动**（不是惰性 thunk），且即便
 *    调用方从不 await 它也必须启动——这是原来「提前启动、后续 await」的并发语义；
 * 2. start-work 抛错时先记 worklog 失败，再把**同一个错误对象**原样抛出（调用方
 *    依赖 `failReservation(error)` 收尾，换错误类型会改变响应）；
 * 3. 各提示词槽位的开/关条件（显式 Agent、对话模式、YOLO、LSP、websearch 覆盖）。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRuntimePolicy } from '../../session/session-runtime-policy.js';
import type * as DbModule from '../../infra/db.js';

// 组装区现在经 `resolveDialogueModePromptForRequest` 读取模式提示词覆盖（store → SQLite），
// 故本测试必须初始化内存库；否则「无显式 Agent + 对话模式」用例会在读库时抛错。
process.env['DATABASE_URL'] = ':memory:';

let dbModule: typeof DbModule;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
});

const mocks = vi.hoisted(() => ({
  buildCapabilityContext: vi.fn(),
  buildCompanionPrompt: vi.fn(),
  buildDynamicOrchestratorPrompt: vi.fn(),
  detectActiveCommandContext: vi.fn(),
  detectStartWorkKeyword: vi.fn(),
  loadCompanionSettingsForUser: vi.fn(),
  loadDynamicToolsForWorkspace: vi.fn(),
  logGatewayWarn: vi.fn(),
  processStartWork: vi.fn(),
  resolveUnboundSessionWorkspaceFallback: vi.fn(),
}));

vi.mock('../../routes/capabilities.js', () => ({
  buildCapabilityContext: mocks.buildCapabilityContext,
}));
vi.mock('../../workspace/companion-settings.js', () => ({
  buildCompanionPrompt: mocks.buildCompanionPrompt,
  loadCompanionSettingsForUser: mocks.loadCompanionSettingsForUser,
}));
vi.mock('../../agent/dynamic-agent-prompt-builder.js', () => ({
  buildDynamicOrchestratorPrompt: mocks.buildDynamicOrchestratorPrompt,
}));
vi.mock('../../tools/command-templates.js', () => ({
  detectActiveCommandContext: mocks.detectActiveCommandContext,
}));
vi.mock('../../workspace/start-work.js', () => ({
  detectStartWorkKeyword: mocks.detectStartWorkKeyword,
  processStartWork: mocks.processStartWork,
}));
vi.mock('../../tools/dynamic-tool-loader.js', () => ({
  loadDynamicToolsForWorkspace: mocks.loadDynamicToolsForWorkspace,
}));
vi.mock('../../workspace/workspace-safety.js', () => ({
  resolveUnboundSessionWorkspaceFallback: mocks.resolveUnboundSessionWorkspaceFallback,
}));
vi.mock('../../infra/gateway-logger.js', () => ({
  logGatewayWarn: mocks.logGatewayWarn,
}));

import {
  assembleStreamPromptContext,
  resolveStreamPromptWebSearchEnabled,
  type AssembleStreamPromptContextInput,
} from '../../routes/stream-prompt-assembly.js';
import { isWebSearchEnabled } from '../../routes/stream.js';

const ENABLED_POLICY: SessionRuntimePolicy = {
  includeCapabilityContext: true,
  includeDynamicWorkspaceTools: true,
  includeFlatMcpToolDefinitions: true,
  includeLspGuidance: true,
  includePinnedSkillsPrompt: true,
};

const DISABLED_POLICY: SessionRuntimePolicy = {
  includeCapabilityContext: false,
  includeDynamicWorkspaceTools: false,
  includeFlatMcpToolDefinitions: false,
  includeLspGuidance: false,
  includePinnedSkillsPrompt: false,
};

function buildInput(
  overrides: Partial<AssembleStreamPromptContextInput> = {},
): AssembleStreamPromptContextInput {
  return {
    interactionModes: { yoloMode: false },
    requestData: { message: 'hello' },
    route: {},
    runtimePolicy: ENABLED_POLICY,
    sessionContext: { metadataJson: '{}' },
    sessionId: 'session-1',
    user: { email: 'user@example.com', sub: 'user-1' },
    userVisibleMessage: 'hello',
    workflow: { failPrepare: vi.fn() },
    workspacePath: '/workspace/demo',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildCapabilityContext.mockReturnValue('capability-catalog');
  mocks.buildCompanionPrompt.mockReturnValue('companion-prompt');
  mocks.buildDynamicOrchestratorPrompt.mockReturnValue('orchestrator-prompt');
  mocks.detectActiveCommandContext.mockReturnValue(null);
  mocks.detectStartWorkKeyword.mockReturnValue(false);
  mocks.loadCompanionSettingsForUser.mockReturnValue({ preferences: {}, bindings: {} });
  mocks.loadDynamicToolsForWorkspace.mockResolvedValue([]);
  mocks.processStartWork.mockResolvedValue('start-work-context');
  mocks.resolveUnboundSessionWorkspaceFallback.mockReturnValue('/fallback/workspace');
});

describe('assembleStreamPromptContext · 默认组装', () => {
  it('Given 完整策略与未绑定 workspace When 组装 Then 各槽位按原语义填充', async () => {
    const result = await assembleStreamPromptContext(
      buildInput({ requestData: { agentId: 'sisyphus', message: 'hello' } }),
    );

    expect(result.capabilityContext).toBe('capability-catalog');
    expect(result.companionPrompt).toBe('companion-prompt');
    expect(result.dynamicAgentPrompt).toBe('orchestrator-prompt');
    expect(result.effectiveAgentId).toBe('sisyphus');
    // 曾在此断言 `result.hasExplicitAgent === false`：该字段是未被任何生产代码消费的
    // 死字段（仅本测试引用），已删除。其唯一意图（显式 Agent 门控）改由下方
    // 「提示词槽位开关」中 `dialogueModePrompt` 的真实返回形状钉住，此处不再重复。
    expect(result.startWorkContext).toBeNull();
    expect(result.commandContext).toBeNull();
    // 提示词模式全程未表态（无对话模式）时 LSP 指引不注入，与抽取前一致。
    expect(result.lspGuidance).toBeNull();
    expect(result.dialogueModePrompt).toBeNull();
    expect(result.yoloModePrompt).toBeNull();
    expect(result.webSearchEnabled).toBe(false);
    expect(result.workspaceRootForStartWork).toBe('/workspace/demo');
    expect(result.dynamicToolDefsPromise).toBeInstanceOf(Promise);
  });

  it('Given companion 绑定可回退到请求 agentId When 组装 Then 透传真主到 companion 读取', async () => {
    await assembleStreamPromptContext(
      buildInput({ requestData: { agentId: 'atlas', message: 'hello' }, route: {} }),
    );

    expect(mocks.loadCompanionSettingsForUser).toHaveBeenCalledWith(
      'user-1',
      'user@example.com',
      'atlas',
    );
    expect(mocks.buildCompanionPrompt).toHaveBeenCalledWith(expect.anything(), 'hello');
  });

  it('Given 路由给出镜像 systemPrompt When 组装 Then 不参与本区（仅 effectiveAgentId）', async () => {
    const result = await assembleStreamPromptContext(
      buildInput({ route: { effectiveAgentId: 'zeus' } }),
    );

    expect(result.dynamicAgentPrompt).toBe('orchestrator-prompt');
    expect(result.effectiveAgentId).toBe('zeus');
  });

  it('Given 非编排 Agent When 组装 Then 不生成动态编排器提示词', async () => {
    const result = await assembleStreamPromptContext(
      buildInput({ route: { effectiveAgentId: 'reviewer' } }),
    );

    expect(result.dynamicAgentPrompt).toBeNull();
    expect(mocks.buildDynamicOrchestratorPrompt).not.toHaveBeenCalled();
  });
});

describe('assembleStreamPromptContext · dynamicToolDefsPromise 时机', () => {
  it('Given 动态工具启用 When 组装返回 Then Promise 已经启动（无需调用方 await）', async () => {
    mocks.loadDynamicToolsForWorkspace.mockReturnValue(new Promise(() => undefined));

    await assembleStreamPromptContext(buildInput());

    expect(mocks.loadDynamicToolsForWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.loadDynamicToolsForWorkspace).toHaveBeenCalledWith('/workspace/demo', 'session-1');
  });

  it('Given 未绑定 workspace When 组装 Then 动态工具仍指向回退目录', async () => {
    await assembleStreamPromptContext(buildInput({ workspacePath: null }));

    expect(mocks.resolveUnboundSessionWorkspaceFallback).toHaveBeenCalledTimes(1);
    expect(mocks.loadDynamicToolsForWorkspace).toHaveBeenCalledWith(
      '/fallback/workspace',
      'session-1',
    );
  });

  it('Given 动态工具加载失败 When 消费 Promise Then 降级为空数组并告警', async () => {
    mocks.loadDynamicToolsForWorkspace.mockRejectedValue(new Error('scan failed'));

    const result = await assembleStreamPromptContext(buildInput());

    await expect(result.dynamicToolDefsPromise).resolves.toEqual([]);
    expect(mocks.logGatewayWarn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load dynamic tools for /workspace/demo: scan failed'),
    );
  });

  it('Given 策略关闭动态工具 When 组装 Then 不触达加载器且返回空数组', async () => {
    const result = await assembleStreamPromptContext(
      buildInput({ runtimePolicy: DISABLED_POLICY }),
    );

    expect(mocks.loadDynamicToolsForWorkspace).not.toHaveBeenCalled();
    await expect(result.dynamicToolDefsPromise).resolves.toEqual([]);
  });
});

describe('assembleStreamPromptContext · start-work', () => {
  it('Given 命中 ulw 关键词 When 组装 Then 用工作区根跑 start-work', async () => {
    mocks.detectStartWorkKeyword.mockReturnValue(true);

    const result = await assembleStreamPromptContext(buildInput());

    expect(mocks.processStartWork).toHaveBeenCalledWith('/workspace/demo', 'session-1', 'hello');
    expect(result.startWorkContext).toBe('start-work-context');
  });

  it('Given start-work 抛错 When 组装 Then 先记 worklog 失败再原样重抛同一个错误', async () => {
    const failure = new Error('boulder write denied');
    const failPrepare = vi.fn();
    mocks.detectStartWorkKeyword.mockReturnValue(true);
    mocks.processStartWork.mockRejectedValue(failure);

    await expect(
      assembleStreamPromptContext(buildInput({ workflow: { failPrepare } })),
    ).rejects.toBe(failure);
    expect(failPrepare).toHaveBeenCalledWith('start-work 失败');
  });

  it('Given 未命中关键词 When 组装 Then 不启动 start-work 也不记失败', async () => {
    const failPrepare = vi.fn();

    const result = await assembleStreamPromptContext(buildInput({ workflow: { failPrepare } }));

    expect(mocks.processStartWork).not.toHaveBeenCalled();
    expect(failPrepare).not.toHaveBeenCalled();
    expect(result.startWorkContext).toBeNull();
  });
});

describe('assembleStreamPromptContext · 提示词槽位开关', () => {
  it('Given 显式 Agent + 对话模式 When 组装 Then 对话模式提示词不注入', async () => {
    const result = await assembleStreamPromptContext(
      buildInput({
        interactionModes: { dialogueMode: 'clarify', yoloMode: false },
        route: { effectiveAgentId: 'sisyphus' },
      }),
    );

    expect(result.dialogueModePrompt).toBeNull();
  });

  it('Given 无显式 Agent + 对话模式 When 组装 Then 注入对应模式提示词', async () => {
    const result = await assembleStreamPromptContext(
      buildInput({ interactionModes: { dialogueMode: 'clarify', yoloMode: false } }),
    );

    expect(result.dialogueModePrompt).toBeTruthy();
    expect(result.lspGuidance).toBeTruthy();
  });

  it('Given yoloMode When 组装 Then 注入 YOLO 提示词', async () => {
    const result = await assembleStreamPromptContext(
      buildInput({ interactionModes: { yoloMode: true } }),
    );

    expect(result.yoloModePrompt).toBeTruthy();
  });

  it('Given 策略关闭 LSP 指引 When 组装 Then 不注入 LSP 提示词', async () => {
    const result = await assembleStreamPromptContext(
      buildInput({
        interactionModes: { dialogueMode: 'clarify', yoloMode: false },
        runtimePolicy: DISABLED_POLICY,
      }),
    );

    expect(result.lspGuidance).toBeNull();
    expect(result.capabilityContext).toBeNull();
  });

  it('Given 请求显式开启 websearch When 组装 Then 覆盖会话 metadata', async () => {
    const result = await assembleStreamPromptContext(
      buildInput({
        requestData: { message: 'hello', webSearchEnabled: true },
        sessionContext: { metadataJson: '{}' },
      }),
    );

    expect(result.webSearchEnabled).toBe(true);
  });

  it('Given 请求未表态 When 组装 Then 回落到会话 metadata 的判定', async () => {
    const result = await assembleStreamPromptContext(
      buildInput({
        sessionContext: { metadataJson: JSON.stringify({ webSearchEnabled: true }) },
      }),
    );

    expect(result.webSearchEnabled).toBe(true);
  });

  it('Given 命令模板命中 When 组装 Then 透传 commandContext 供调用方取 instruction', async () => {
    const commandContext = { actionKind: 'start_ralph_loop', instruction: 'loop instruction' };
    mocks.detectActiveCommandContext.mockReturnValue(commandContext);

    const result = await assembleStreamPromptContext(buildInput());

    expect(result.commandContext).toBe(commandContext);
  });
});

describe('resolveStreamPromptWebSearchEnabled · 与 stream.ts 判定对拍', () => {
  const metadataSamples: string[] = [
    '{}',
    '{"webSearchEnabled":true}',
    '{"webSearchEnabled":false}',
    '{"channel":{"tools":{"web_search":true}}}',
    '{"channel":{"tools":{"web_search":false}}}',
    '{"channel":{"tools":{}}}',
    '{"channel":null}',
    '{"channel":{"tools":{"webSearch":true}}}',
    'not-json',
  ];

  it.each(metadataSamples)('Given %s When 两个实现各自判定 Then 结果一致', (metadataJson) => {
    expect(resolveStreamPromptWebSearchEnabled(metadataJson)).toBe(
      isWebSearchEnabled(metadataJson),
    );
  });
});
