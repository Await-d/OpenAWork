/**
 * T-13 / T-14b / T-17 / T-18 / T-21：`computer_use` 工具定义、门控、沙箱范式、
 * 三处注册，以及 Phase 2 的「子会话 + 逐步进度 + 用量回传」接线回归测试。
 *
 * 覆盖：
 *  1. 输入 schema（instruction 必填、maxSteps 1–100、缺省可解析）；
 *  2. 工具定义（name / timeout）；
 *  3. 模型门控拒绝时返回失败 JSON（不抛异常，含中文原因）；
 *  4. 桌面桥不可用时返回明确中文错误；
 *  5. `execute` 必须抛「走网关沙箱路径」错误；
 *  6. 注册完整性：同时出现在可见清单与沙箱白名单（防漏注册回归）；
 *  7. 主循环事件 → 子会话步骤 / 父会话 `tool_progress`，且聚合用量进入结果 payload。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModuleActual from '../../infra/db.js';
import type * as LookAtModuleActual from '../../tools/look-at-tools.js';
import type * as MessageAdapterActual from '../../message/message-v2-adapter.js';
import type * as RunEventsActual from '../../session/session-run-events.js';

const mocks = vi.hoisted(() => {
  interface CannedLookAtResponse {
    readonly text: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
  }
  const sessionInserts: Array<{ sql: string; params: unknown[] }> = [];
  const childMessages: Array<{
    sessionId: string;
    userId: string;
    role: string;
    text: string;
  }> = [];
  const publishedEvents: Array<{ sessionId: string; event: Record<string, unknown> }> = [];
  const lookAtResponses: CannedLookAtResponse[] = [];
  const lookAtSessionIds: Array<string | undefined> = [];
  const reset = (): void => {
    sessionInserts.length = 0;
    childMessages.length = 0;
    publishedEvents.length = 0;
    lookAtResponses.length = 0;
    lookAtSessionIds.length = 0;
  };
  return {
    sessionInserts,
    childMessages,
    publishedEvents,
    lookAtResponses,
    lookAtSessionIds,
    reset,
  };
});

// 只替换副作用出口，其余导出保持真实（`importOriginal`），
// 以免影响本文件后段的工具定义 / 注册完整性断言。
vi.mock('../../infra/db.js', async (orig) => {
  const actual = await (orig() as Promise<typeof DbModuleActual>);
  return {
    ...actual,
    sqliteRun: (sql: string, params: unknown[] = []): void => {
      mocks.sessionInserts.push({ sql, params });
    },
  };
});

vi.mock('../../message/message-v2-adapter.js', async (orig) => {
  const actual = await (orig() as Promise<typeof MessageAdapterActual>);
  return {
    ...actual,
    appendSessionMessageV2: (input: {
      sessionId: string;
      userId: string;
      role: string;
      content: Array<{ type: string; text?: string }>;
    }): { id: string } => {
      mocks.childMessages.push({
        sessionId: input.sessionId,
        userId: input.userId,
        role: input.role,
        text: input.content.map((part) => part.text ?? '').join(''),
      });
      return { id: `message-${mocks.childMessages.length}` };
    },
  };
});

vi.mock('../../session/session-run-events.js', async (orig) => {
  const actual = await (orig() as Promise<typeof RunEventsActual>);
  return {
    ...actual,
    publishSessionRunEvent: (
      sessionId: string,
      event: Record<string, unknown>,
    ): { seq: null; rowId: null } => {
      mocks.publishedEvents.push({ sessionId, event });
      return { seq: null, rowId: null };
    },
  };
});

vi.mock('../../tools/look-at-tools.js', async (orig) => {
  const actual = await (orig() as Promise<typeof LookAtModuleActual>);
  return {
    ...actual,
    // 内层 VLM 的确定性替身：按队列返回模型原始输出，并**照真实契约回调 onUsage**
    // （T-15 / T-21 的用量聚合链依赖这个回调）。
    requestLookAtText: async (input: {
      sessionId?: string;
      onUsage?: (usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
      }) => void;
    }): Promise<string> => {
      mocks.lookAtSessionIds.push(input.sessionId);
      const next = mocks.lookAtResponses.shift();
      if (!next) {
        throw new Error('no canned look_at response left');
      }
      input.onUsage?.({
        inputTokens: next.inputTokens,
        outputTokens: next.outputTokens,
        cacheReadTokens: next.cacheReadTokens,
        cacheWriteTokens: next.cacheWriteTokens,
      });
      return next.text;
    },
  };
});

import type { DesktopControlManager } from '../../tools/desktop-control.js';
import {
  computerUseInputSchema,
  computerUseToolDefinition,
  runComputerUseTool,
  runComputerUseToolWithScreenshot,
} from '../../tools/gui/computer-use-tool.js';
import { buildGatewayToolDefinitions } from '../../tools/tool-definitions.js';
import { TOOL_WHITELIST } from '../../tools/tool-sandbox.js';

/** 覆盖 DesktopControlManager 全部方法的最小替身；默认 status 关闭。 */
class FakeDesktopControlManager implements DesktopControlManager {
  readonly status = vi.fn(async () => ({ enabled: false, reason: '桌面端桥未启用。' }));
  readonly screenshot = vi.fn(async () => ({ success: true, data: 'base64-image' }));
  readonly click = vi.fn(async () => ({ success: true }));
  readonly type = vi.fn(async () => ({ success: true }));
  readonly key = vi.fn(async () => ({ success: true }));
  readonly hotkey = vi.fn(async () => ({ success: true }));
  readonly scroll = vi.fn(async () => ({ success: true }));
  readonly wait = vi.fn(async () => ({ success: true }));
  readonly drag = vi.fn(async () => ({ success: true }));
  readonly mouseMove = vi.fn(async () => ({ success: true }));
  readonly longPress = vi.fn(async () => ({ success: true }));
}

describe('computerUseInputSchema', () => {
  it('instruction 必填且不能为空串', () => {
    expect(computerUseInputSchema.safeParse({}).success).toBe(false);
    expect(computerUseInputSchema.safeParse({ instruction: '' }).success).toBe(false);
    expect(computerUseInputSchema.safeParse({ instruction: '打开系统设置' }).success).toBe(true);
  });

  it('maxSteps 仅接受 1–100 的整数，且缺省时可解析', () => {
    expect(computerUseInputSchema.safeParse({ instruction: 'a', maxSteps: 0 }).success).toBe(false);
    expect(computerUseInputSchema.safeParse({ instruction: 'a', maxSteps: 101 }).success).toBe(
      false,
    );
    expect(computerUseInputSchema.safeParse({ instruction: 'a', maxSteps: 1.5 }).success).toBe(
      false,
    );

    const min = computerUseInputSchema.safeParse({ instruction: 'a', maxSteps: 1 });
    const max = computerUseInputSchema.safeParse({ instruction: 'a', maxSteps: 100 });
    expect(min.success).toBe(true);
    expect(max.success).toBe(true);

    const parsed = computerUseInputSchema.parse({ instruction: 'a' });
    expect(parsed.maxSteps).toBeUndefined();
  });
});

describe('computerUseToolDefinition', () => {
  it('名称为 computer_use，超时为 300000（覆盖默认 30s）', () => {
    expect(computerUseToolDefinition.name).toBe('computer_use');
    expect(computerUseToolDefinition.timeout).toBe(300000);
  });

  it('execute 必须走网关沙箱路径，直接调用即抛错', async () => {
    await expect(
      computerUseToolDefinition.execute(
        { instruction: '打开系统设置' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('computer_use must execute through the gateway-managed sandbox path');
  });
});

describe('runComputerUseTool', () => {
  it('模型门控拒绝时返回失败 JSON（含中文原因，不抛异常）', async () => {
    const output = await runComputerUseTool(
      { instruction: '打开系统设置' },
      {
        userId: 'user-1',
        sessionId: 'session-1',
        resolveModelGate: async () => ({
          allowed: false,
          reason: '当前模型不具备 GUI grounding 能力，无法输出可执行的屏幕坐标。',
        }),
      },
    );

    const payload = JSON.parse(output) as {
      success: boolean;
      steps: number;
      summary: string;
      history: unknown[];
    };
    expect(payload.success).toBe(false);
    expect(payload.steps).toBe(0);
    expect(payload.summary).toContain('GUI grounding');
    expect(payload.summary).toContain('无法输出可执行的屏幕坐标');
    expect(payload.history).toEqual([]);
  });

  it('缺少运行上下文时返回失败 JSON，而不是抛异常', async () => {
    const output = await runComputerUseTool({ instruction: '打开系统设置' });
    const payload = JSON.parse(output) as { success: boolean; summary: string };
    expect(payload.success).toBe(false);
    expect(payload.summary).toContain('缺少运行上下文');
  });

  it('系统桌面控制桥不可用时返回明确中文错误', async () => {
    const manager = new FakeDesktopControlManager();
    const output = await runComputerUseTool(
      { instruction: '打开系统设置' },
      {
        userId: 'user-1',
        sessionId: 'session-1',
        manager,
        resolveModelGate: async () => ({ allowed: true, route: { providerId: 'p', modelId: 'm' } }),
      },
    );

    const payload = JSON.parse(output) as { success: boolean; steps: number; summary: string };
    expect(payload.success).toBe(false);
    expect(payload.steps).toBe(0);
    expect(payload.summary).toContain('系统桌面控制不可用');
    expect(payload.summary).toContain('桌面端桥未启用');
  });
});

describe('G1：门控选出的模型必须透传到路由（路径 B 生效的关键）', () => {
  it('resolveRoute 收到门控的 providerId/modelId 作为 override', async () => {
    // 桥必须可用，否则会在路由解析前提前返回（这正是被测的调用顺序）。
    const manager = new FakeDesktopControlManager();
    (manager.status as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      enabled: true,
    });

    let receivedOverride: { providerId: string; modelId: string } | undefined;

    await runComputerUseTool(
      { instruction: '打开设置' },
      {
        userId: 'user-1',
        sessionId: 'session-1',
        manager,
        resolveModelGate: async () => ({
          allowed: true,
          route: { providerId: 'gui-endpoint', modelId: 'ui-tars-7b' },
        }),
        resolveRoute: async (_userId, _systemPrompt, override) => {
          receivedOverride = override;
          // 记下 override 后立即终止流程：后续 predict 需要真实上游，
          // 这里只需验证「门控结果已透传给路由」这一件事。
          throw new Error('ROUTE_CAPTURED');
        },
      },
    ).catch(() => undefined);

    expect(receivedOverride).toEqual({ providerId: 'gui-endpoint', modelId: 'ui-tars-7b' });
  });
});

describe('computer_use 注册完整性（T-14b 防漏注册）', () => {
  it('同时出现在网关可见工具清单与沙箱白名单中', () => {
    const visibleNames = buildGatewayToolDefinitions().map((tool) => tool.function.name);
    expect(visibleNames).toContain('computer_use');
    expect(TOOL_WHITELIST.has('computer_use')).toBe(true);
  });

  it('可见清单中的参数描述了 instruction / maxSteps', () => {
    const definition = buildGatewayToolDefinitions().find(
      (tool) => tool.function.name === 'computer_use',
    );
    expect(definition).toBeDefined();
    const parameters = definition?.function.parameters as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(parameters.required).toContain('instruction');
    expect(Object.keys(parameters.properties ?? {}).sort()).toEqual(['instruction', 'maxSteps']);
  });
});

describe('T-17 / T-18 / T-21：子会话、逐步进度与用量回传', () => {
  beforeEach(() => {
    mocks.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('主循环事件投影为子会话步骤 + 父会话 tool_progress，聚合用量进入结果 payload', async () => {
    const manager = new FakeDesktopControlManager();
    (
      manager.status as unknown as { mockResolvedValue: (value: unknown) => void }
    ).mockResolvedValue({ enabled: true });

    mocks.lookAtResponses.push(
      {
        text: "Thought: 点击开始菜单\nAction: click(start_box='(500,500)')",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheWriteTokens: 7,
      },
      {
        text: 'Thought: 界面已打开\nAction: finished()',
        inputTokens: 30,
        outputTokens: 8,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    );

    const result = await runComputerUseToolWithScreenshot(
      { instruction: '打开系统设置', maxSteps: 7 },
      {
        userId: 'user-1',
        sessionId: 'session-parent',
        toolCallId: 'call-1',
        manager,
        screenSize: { width: 1000, height: 800 },
        resolveModelGate: async () => ({
          allowed: true,
          route: { providerId: 'gui-endpoint', modelId: 'ui-tars-7b' },
        }),
        resolveRoute: async () => ({
          route: {
            model: 'ui-tars-7b',
            apiBaseUrl: 'https://gui.example/v1',
            apiKey: 'sk-test',
            maxTokens: 2048,
            temperature: 0.2,
            upstreamProtocol: 'chat_completions',
            requestOverrides: {},
            supportsThinking: false,
            providerType: 'openai',
          },
        }),
      },
    );

    // 结果 payload：历史 + 聚合用量（T-21：四档 token + 模型调用步数）。
    const payload = JSON.parse(result.output) as {
      success: boolean;
      steps: number;
      summary: string;
      history: Array<{ step: number; thought: string; action: string; success: boolean }>;
      usage: Record<string, number>;
    };
    expect(payload.success).toBe(true);
    expect(payload.steps).toBe(2);
    expect(payload.summary).toBe('任务完成');
    expect(payload.history).toHaveLength(1);
    expect(payload.history[0]?.action).toBe('click');
    expect(payload.history[0]?.success).toBe(true);
    expect(payload.history[0]?.thought).toContain('点击开始菜单');
    expect(payload.usage).toEqual({
      inputTokens: 130,
      outputTokens: 28,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      steps: 2,
    });

    // G3 契约不变：截图独立回传，模型可见文本里不含 base64 字段。
    expect(result.screenshot).toEqual({ dataBase64: 'base64-image', mediaType: 'image/png' });
    expect(result.output).not.toContain('lastScreenshot');

    // T-17：GUI 子会话落库，metadata 含 parentSessionId（T-20 取消链路的识别键）。
    const sessionInsert = mocks.sessionInserts.find((insert) =>
      insert.sql.includes('INSERT INTO sessions'),
    );
    expect(sessionInsert).toBeDefined();
    const metadata = JSON.parse(String(sessionInsert?.params[4])) as Record<string, unknown>;
    expect(metadata['parentSessionId']).toBe('session-parent');
    expect(metadata['createdByTool']).toBe('computer_use');
    expect(metadata['subagentType']).toBe('gui-agent');

    // 内层 VLM 调用归属 GUI 子会话：look_at 链路收到子会话 id（prompt cache key /
    // 会话亲和头的来源），且不等于父会话 id（父子缓存键保持隔离）。
    const guiChildSessionId = String(sessionInsert?.params[0]);
    expect(guiChildSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(guiChildSessionId).not.toBe('session-parent');
    expect(mocks.lookAtSessionIds).toHaveLength(2);
    expect(mocks.lookAtSessionIds.every((id) => id === guiChildSessionId)).toBe(true);

    // 子会话消息：指令 → 步骤 → 最终摘要。
    expect(mocks.childMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'assistant',
    ]);
    expect(mocks.childMessages[0]?.text).toBe('打开系统设置');
    expect(mocks.childMessages[1]?.text).toContain('Action: click');
    expect(mocks.childMessages[2]?.text).toContain('任务完成');

    // T-18：每步（含 finalize）向父会话发 tool_progress，totalCount = maxSteps 预算。
    expect(mocks.publishedEvents.every((entry) => entry.sessionId === 'session-parent')).toBe(true);
    const progress = mocks.publishedEvents
      .map((entry) => entry.event)
      .filter((event) => event['type'] === 'tool_progress');
    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'computer_use',
      completedCount: 1,
      totalCount: 7,
    });
    const finalSubTools = progress[1]?.['subTools'] as Array<{ status: string }>;
    expect(finalSubTools).toHaveLength(1);
    expect(finalSubTools[0]?.status).toBe('completed');
  });
});
