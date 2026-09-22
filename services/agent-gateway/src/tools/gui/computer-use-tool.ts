/**
 * T-13：`computer_use` 工具定义与执行体。
 *
 * 架构（Gate 0 决策 1「复用现有 Provider」+ Phase 1 关键技术决策 1）：
 *   外层模型 → computer_use(instruction) → [内嵌循环：截图 → VLM → 动作 → 执行] ×N
 *
 * 三块协作：
 *  - 主循环：`@openAwork/agent-core` 的 {@link GuiAgentRunner}（WS-1，纯逻辑、无副作用）；
 *  - 操作器：`./desktop-control-operator.js` 的 {@link createDesktopControlOperator}（WS-2）；
 *  - 模型门控：`./gui-model-gate.js` 的 {@link resolveGuiModelGate}（WS-2）。
 *
 * Phase 2 接线：
 *  - T-17 / T-18：`onEvent` 把每一步投影到 GUI 子会话 + 父会话 `tool_progress`
 *    （见 `./gui-session.js`，子会话 metadata 的 `parentSessionId` 亦是 T-20 取消链路的识别键）；
 *  - T-21：内层 VLM 的聚合用量（四档 token + 步数）进入工具结果 payload，同时仍按月入账。
 *
 * 内层 VLM 调用**复用 `look_at` 的上游范式**（provider 解析 + 多模态上行 +
 * `upstreamProtocol` 转发），不新建执行通道：见 `../look-at-tools.js`。
 *
 * `execute` 与 `look_at` / `desktop_control` 同范式，仅抛指定错误——真实执行一律经
 * `tool-sandbox.ts` 的网关托管路径（那里才拿得到 session/user 上下文）。
 */
import {
  GUI_MAX_LOOP_COUNT,
  GuiAgentRunner,
  buildGuiSystemPrompt,
  buildGuiUserPrompt,
} from '@openAwork/agent-core';
import type {
  GuiHistoryEntry,
  GuiOperator,
  GuiOperatorScreenshot,
  GuiRunnerEvent,
  GuiRunnerModel,
  GuiSize,
  ToolDefinition,
} from '@openAwork/agent-core';
import { z } from 'zod';
import { desktopControlManager } from '../desktop-control.js';
import type { DesktopControlManager } from '../desktop-control.js';
import { requestLookAtText, resolveLookAtRoute } from '../look-at-tools.js';
import { createDesktopControlOperator } from './desktop-control-operator.js';
import { resolveGuiModelGate } from './gui-model-gate.js';
import type { GuiModelGateResult } from './gui-model-gate.js';
import { createGuiSession } from './gui-session.js';
import { readImageSizeFromBase64 } from './screenshot-size.js';
import { EMPTY_GUI_USAGE, accumulateGuiUsage, hasBillableGuiUsage } from './gui-usage.js';
import type { GuiAggregatedUsage, GuiStepUsage } from './gui-usage.js';
import { persistMonthlyUsageRecord } from '../../session/usage-records-store.js';

/** `computer_use` 的模型入参。 */
export const computerUseInputSchema = z.object({
  /** 自然语言任务，例如「打开系统设置」。 */
  instruction: z.string().min(1),
  /** 最大循环步数；缺省时由主循环使用 {@link GUI_MAX_LOOP_COUNT}。 */
  maxSteps: z.number().int().min(1).max(100).optional(),
});

export type ComputerUseInput = z.infer<typeof computerUseInputSchema>;

/**
 * 兜底逻辑屏幕尺寸。
 *
 * ⚠️ 已知缺口：`desktop_control` bridge 的 `ScreenshotResponse` 不返回宽高
 * （只有 data / mediaType / byteLength / driver），网关也没有其它屏幕尺寸来源。
 * 若真实屏幕不是 1920×1080，0–1000 归一化坐标会整体偏移。待 bridge 上报宽高后
 * 应改为从首张截图推导，而非使用该常量。
 */
const GUI_FALLBACK_SCREEN_SIZE: GuiSize = { width: 1920, height: 1080 };

/**
 * GUI 任务总时限（G4）。
 *
 * 与 `computerUseToolDefinition.timeout`（300000）保持一致：该声明值在沙箱托管路径
 * 不会被自动执行，因此必须在实现里显式施加，否则循环可无限跑下去。
 */
const GUI_TOTAL_TIMEOUT_MS = 300_000;

/**
 * 从一张真实截图解码逻辑屏幕尺寸。
 *
 * 桥的 `ScreenshotResponse` 不含宽高，因此这里主动抓一张截图并解析 PNG/GIF/JPEG/WebP 头。
 * 任何失败（桥异常、格式不支持、字段缺失）都回退到 {@link GUI_FALLBACK_SCREEN_SIZE}，
 * **不阻断任务**——尺寸偏差只影响坐标精度，不应让整个 GUI 任务失败。
 */
async function resolveScreenSizeFromScreenshot(manager: DesktopControlManager): Promise<GuiSize> {
  try {
    const result = await manager.screenshot({ action: 'screenshot' });
    const base64 = readScreenshotBase64Candidate(result);
    if (!base64) return GUI_FALLBACK_SCREEN_SIZE;
    return readImageSizeFromBase64(base64) ?? GUI_FALLBACK_SCREEN_SIZE;
  } catch {
    return GUI_FALLBACK_SCREEN_SIZE;
  }
}

/** 与 operator 侧同样的候选键顺序，兼容桥的不同返回形态。 */
function readScreenshotBase64Candidate(
  result: Readonly<Record<string, unknown>>,
): string | undefined {
  for (const key of ['data', 'screenshotBase64', 'imageBase64', 'base64']) {
    const value = result[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/** 执行上下文与可注入依赖（测试可覆盖门控 / 管理器 / 屏幕尺寸）。 */
export interface ComputerUseDeps {
  /** 会话所属用户 id（模型门控与上游路由都依赖它）。 */
  readonly userId: string;
  /** 父会话 id：GUI 子会话的 `parentSessionId`，也是进度事件的落点（T-17）。 */
  readonly sessionId: string;
  /**
   * 父会话中本次调用的 toolCallId（T-18）。
   *
   * 沙箱托管路径一定会传（`tool-sandbox.ts` 的 `request.toolCallId`）；缺省时
   * 仍可执行 GUI 任务，只是不发 `tool_progress`（无法归并到工具卡片）。
   */
  readonly toolCallId?: string;
  /** 取消信号，透传给主循环。 */
  readonly signal?: AbortSignal;
  /** 覆盖 `desktop_control` manager（测试替身 / 复用）。 */
  readonly manager?: DesktopControlManager;
  /** 覆盖逻辑屏幕尺寸；缺省使用 {@link GUI_FALLBACK_SCREEN_SIZE}。 */
  readonly screenSize?: GuiSize;
  /** 覆盖模型门控；缺省调用 {@link resolveGuiModelGate}。 */
  /**
   * 覆盖模型门控；缺省调用 {@link resolveGuiModelGate}。
   *
   * 第二个参数是**会话 id**：门控会优先采用该会话 metadata 里的模型选择，
   * 保证 GUI 与主对话用的是同一个模型（见 `gui-model-gate.ts` 的模型来源优先级）。
   */
  readonly resolveModelGate?: (userId: string, sessionId?: string) => Promise<GuiModelGateResult>;
  /**
   * 覆盖上游路由解析；缺省调用 {@link resolveLookAtRoute}。
   *
   * 第三个参数是**门控选出的 provider/model**（G1）：必须透传给路由解析，
   * 否则内层调用会落到 `multimodal-looker` 委派模型上，与门控判定不一致，
   * 路径 B 的自定义 GUI endpoint 也会被忽略。
   *
   * 返回值的 `providerId` / `modelId` 为可选：真实实现（`resolveLookAtRoute`）会给出
   * 实际选中的组合，用于 GUI 子会话的溯源 metadata；测试替身可只返回 `route`。
   */
  readonly resolveRoute?: (
    userId: string,
    systemPrompt: string | undefined,
    override?: { readonly providerId: string; readonly modelId: string },
  ) => Promise<{
    route: Parameters<typeof createGuiRunnerModel>[0];
    readonly providerId?: string;
    readonly modelId?: string;
  }>;
}

/** 工具返回的 JSON 结构（`outputSchema` 为字符串）。 */
export interface ComputerUseResultPayload {
  readonly success: boolean;
  readonly steps: number;
  readonly summary: string;
  readonly history: readonly GuiHistoryEntry[];
  /**
   * 内层 VLM 的聚合用量（T-21）。
   *
   * 四个 token 档位 + 模型调用步数，既供前端展示，也让外层模型知道本次 GUI
   * 任务花了多少预算（月度账目仍由 `persistMonthlyUsageRecord` 落库）。
   */
  readonly usage: GuiAggregatedUsage;
  /**
   * 最后一张截图的 base64 与媒体类型（G3）。
   *
   * 供沙箱侧生成 artifact 并作为 `attachments` 回传；**不放进模型的文本输出**，
   * 因为整张 base64 会撑爆上下文（见下方 `runComputerUseTool` 的注释）。
   */
  readonly lastScreenshot?: {
    readonly dataBase64: string;
    readonly mediaType: string;
  };
}

// `execute` 走沙箱路径，与 `look_at` / `desktop_control` 保持完全一致的范式。
const COMPUTER_USE_SANDBOX_ONLY_MESSAGE =
  'computer_use must execute through the gateway-managed sandbox path';

export const computerUseToolDefinition: ToolDefinition<typeof computerUseInputSchema, z.ZodString> =
  {
    name: 'computer_use',
    description:
      '用视觉模型驱动系统桌面完成自然语言任务：内嵌「截图 → 决策 → 动作」循环，' +
      '可点击、输入、滚动、拖拽与等待。需要系统桌面控制插件已启用，且当前模型具备 GUI grounding 能力。' +
      '参数 instruction 描述要完成的任务；maxSteps 可选，限制最大循环步数（1–100）。',
    inputSchema: computerUseInputSchema,
    outputSchema: z.string(),
    // GUI 循环通常需要数分钟，覆盖默认 30s；沙箱路径亦按此超时托管。
    timeout: 300000,
    execute: async () => {
      throw new Error(COMPUTER_USE_SANDBOX_ONLY_MESSAGE);
    },
  };

function buildFailure(summary: string): ComputerUseResultPayload {
  // 早期失败（门控 / 桥不可用 / 缺上下文）不会产生任何上游调用，
  // 用零用量占位，保证 `usage` 字段在成功与失败两条路径上始终存在。
  return { success: false, steps: 0, summary, history: [], usage: EMPTY_GUI_USAGE };
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

/** 把操作器截图统一成 data URL（`input_image` 上行要求 data:image/...;base64,...）。 */
function toImageDataUrl(screenshot: GuiOperatorScreenshot): string {
  const data = screenshot.dataBase64;
  return data.startsWith('data:') ? data : `data:${screenshot.mediaType};base64,${data}`;
}

/** 把已完成动作历史渲染成提示词可读的文本（主循环只提供结构化 history）。 */
function buildHistoryText(history: readonly GuiHistoryEntry[]): string {
  if (history.length === 0) {
    return '（暂无已执行动作）';
  }
  return history
    .map(
      (entry) =>
        `${entry.step}. ${entry.success ? '成功' : '失败'} ${entry.action.length > 0 ? entry.action : '（未解析出动作）'}`,
    )
    .join('\n');
}

type LookAtRoute = Awaited<ReturnType<typeof resolveLookAtRoute>>['route'];

/**
 * 基于 `look_at` 已解析路由构造 {@link GuiRunnerModel}：
 * system prompt 用 GUI 模板，user prompt = 指令 + 动作历史，截图以 data URL 多图上送。
 *
 * `sessionId` 传 GUI 子会话 id：内层 VLM 调用因此带上 prompt cache key 与会话亲和头，
 * 且同一轮循环的所有步骤共享同一个键。
 */
function createGuiRunnerModel(
  route: LookAtRoute,
  onUsage?: (usage: GuiStepUsage) => void,
  sessionId?: string,
): GuiRunnerModel {
  return {
    predict: async ({ instruction, screenshots, history }) => {
      const images = screenshots.map((screenshot) => ({
        data: toImageDataUrl(screenshot),
        mediaType: screenshot.mediaType,
      }));
      const prompt = `${buildGuiUserPrompt(instruction)}\n\n## 已执行动作历史\n${buildHistoryText(history)}`;

      return requestLookAtText({
        ...(onUsage ? { onUsage } : {}),
        ...(sessionId ? { sessionId } : {}),
        apiBaseUrl: route.apiBaseUrl,
        apiKey: route.apiKey,
        mimeType: images[images.length - 1]?.mediaType ?? 'image/png',
        imageDataUrls: images,
        model: route.model,
        ...(route.providerType ? { providerType: route.providerType } : {}),
        ...(route.openaiFastMode === true ? { openaiFastMode: true } : {}),
        ...(route.upstreamProtocol ? { upstreamProtocol: route.upstreamProtocol } : {}),
        prompt,
        requestOverrides: route.requestOverrides,
        ...(route.systemPrompt ? { systemPrompt: route.systemPrompt } : {}),
      });
    },
  };
}

/**
 * 执行一次 `computer_use`（由 `tool-sandbox.ts` 在拿到 session/user 上下文后调用）。
 *
 * 门控 / 能力不足时**返回** `{ success: false, summary }` 而非抛异常，让外层模型能读到
 * 中文原因并据此改配置；只有无法归因的运行时异常才向上抛，由沙箱统一标记为错误。
 *
 * @param input 工具入参（instruction / maxSteps）。
 * @param deps  执行上下文；缺省时无法定位用户，直接返回失败结果。
 */
export async function runComputerUseTool(
  input: ComputerUseInput,
  deps?: ComputerUseDeps,
): Promise<string> {
  if (!deps) {
    return JSON.stringify(
      buildFailure('缺少运行上下文（userId / sessionId），无法执行 GUI 操作。'),
    );
  }

  const gateFn = deps.resolveModelGate ?? resolveGuiModelGate;
  let gate: GuiModelGateResult;
  try {
    gate = await gateFn(deps.userId, deps.sessionId);
  } catch (error) {
    return JSON.stringify(buildFailure(`GUI 模型门控检查失败：${describeError(error)}`));
  }
  if (!gate.allowed) {
    return JSON.stringify(
      buildFailure(gate.reason ?? '当前模型不具备 GUI grounding 能力，无法执行 GUI 操作。'),
    );
  }

  const manager = deps.manager ?? desktopControlManager;
  let status: Awaited<ReturnType<DesktopControlManager['status']>>;
  try {
    status = await manager.status();
  } catch (error) {
    return JSON.stringify(buildFailure(`系统桌面控制不可用：${describeError(error)}`));
  }
  if (!status.enabled) {
    return JSON.stringify(
      buildFailure(
        `系统桌面控制不可用：${status.reason ?? '桌面端桥未启用或当前不在桌面端运行。'}`,
      ),
    );
  }

  // 屏幕尺寸：优先用调用方注入值；否则从真实截图解码宽高。
  // 硬编码兜底（1920×1080）只在截图解码失败时使用——若实际屏幕不同，
  // 0–1000 归一化坐标会整体偏移，故必须尽力取真实值。
  const screenSize = deps.screenSize ?? (await resolveScreenSizeFromScreenshot(manager));
  const operator: GuiOperator = createDesktopControlOperator({ manager, screenSize });
  // 路由：把门控选出的 provider/model 透传给 look_at 链路（G1）。
  // 不传 override 时，内层调用会落到 multimodal-looker 委派模型上，与门控判定不一致；
  // 路径 B（自定义 GUI endpoint）更是会被完全忽略。
  const routeFn = deps.resolveRoute ?? resolveLookAtRoute;
  const route = await routeFn(deps.userId, buildGuiSystemPrompt(), gate.route);
  // T-15：收集内层 VLM 的逐步用量，任务结束后入账（成功/失败都记，因为消耗已实际发生）。
  let guiUsage = EMPTY_GUI_USAGE;
  const collectUsage = (step: GuiStepUsage) => {
    guiUsage = accumulateGuiUsage(guiUsage, step);
  };
  // G4：沙箱托管路径绕过 ToolRegistry 的超时包装，`timeout: 300000` 仅为声明值。
  // 这里显式施加总时限，避免 GUI 循环（每步上游调用最长 120s）无限累积。
  const timeoutSignal = AbortSignal.timeout(GUI_TOTAL_TIMEOUT_MS);
  const effectiveSignal = deps.signal
    ? AbortSignal.any([deps.signal, timeoutSignal])
    : timeoutSignal;

  // T-17 / T-18：GUI 子会话承载「指令 + 每步 Thought/Action/Result」，
  // 并把每步进度以 `tool_progress` 投影回父会话（前端按 toolCallId 渲染）。
  // 子会话 metadata 里的 `parentSessionId` 同时是父会话取消链路（T-20）的识别依据。
  const maxSteps = input.maxSteps ?? GUI_MAX_LOOP_COUNT;
  // 溯源信息：优先用路由解析结果（`resolveLookAtRoute` 给出实际选中的 provider/model），
  // 退化时依次回落到路由配置本身与门控选择，保证子会话 metadata 尽量可归因。
  const guiProviderId = route.providerId ?? route.route.providerId ?? gate.route?.providerId;
  const guiModelId = route.modelId ?? route.route.model;
  const guiSession = createGuiSession({
    userId: deps.userId,
    parentSessionId: deps.sessionId,
    toolCallId: deps.toolCallId ?? '',
    instruction: input.instruction,
    maxSteps,
    ...(guiProviderId ? { providerId: guiProviderId } : {}),
    ...(guiModelId ? { modelId: guiModelId } : {}),
    ...(route.route.variant ? { variant: route.route.variant } : {}),
  });

  // Inner VLM calls belong to the GUI child session: passing its id gives the
  // look_at path a prompt cache key and the session affinity header (OpenCode Go
  // rejects requests without one), and all steps of this loop share the same key.
  const model = createGuiRunnerModel(route.route, collectUsage, guiSession.sessionId);
  // 主循环把一步拆成 thought → action → action-result 三个事件，这里先暂存前两者，
  // 到 action-result 时一次性落定该步（与 `GuiHistoryEntry` 的字段一一对应）。
  let pendingThought = '';
  let pendingAction = '';

  const runner = new GuiAgentRunner({
    operator,
    model,
    maxSteps,
    signal: effectiveSignal,
    screenSize,
    onEvent: (event: GuiRunnerEvent) => {
      switch (event.type) {
        case 'thought':
          pendingThought = event.thought;
          return;
        case 'action':
          pendingAction = event.normalizedName;
          return;
        case 'action-result':
          guiSession.recordStep({
            index: event.step,
            thought: pendingThought,
            action: pendingAction,
            success: event.success,
            ...(event.detail ? { detail: event.detail } : {}),
          });
          pendingThought = '';
          pendingAction = '';
          return;
        case 'error':
          // 主循环抛错前会先发 error 事件：立刻收尾，让前端看到终态而不是一直「运行中」。
          guiSession.finalize(event.message, false);
          return;
        default:
          // start / screenshot 不产生独立步骤；finished 只带摘要不带 success，
          // 终态一律由 run() 的返回值落定，避免把「步数用尽/请求用户介入」误报为成功。
          return;
      }
    },
  });

  let result;
  try {
    result = await runner.run(input.instruction);
  } catch (error) {
    // error 事件路径已收尾；这里只是兜底（finalize 幂等，不会重复发事件）。
    guiSession.finalize(describeError(error), false);
    throw error;
  } finally {
    // 用量入账放在 finally：即使主循环抛错（取消/上游异常），已产生的消耗也要记账。
    if (hasBillableGuiUsage(guiUsage)) {
      persistMonthlyUsageRecord({ userId: deps.userId, usage: guiUsage });
    }
  }
  guiSession.finalize(result.summary, result.success);

  // 文本输出只含摘要与历史（整张 base64 会撑爆上下文）；
  // 最后截图以独立字段带回，由沙箱侧转成 artifact + attachments（G3）。
  const lastScreenshot = result.lastScreenshot;
  return JSON.stringify({
    success: result.success,
    steps: result.steps,
    summary: result.summary,
    history: result.history,
    usage: guiUsage,
    ...(lastScreenshot
      ? {
          lastScreenshot: {
            dataBase64: lastScreenshot.dataBase64,
            mediaType: lastScreenshot.mediaType,
          },
        }
      : {}),
  } satisfies ComputerUseResultPayload);
}

/**
 * 执行一次 `computer_use` 并把结果拆成「模型可见文本」+「最后截图」（G3）。
 *
 * 沙箱侧用后者生成 artifact 并以 `attachments` 回传，让用户能在会话里看到
 * GUI 任务结束时的画面，而不必把整张 base64 塞进模型上下文。
 */
export async function runComputerUseToolWithScreenshot(
  input: ComputerUseInput,
  deps: ComputerUseDeps,
): Promise<{
  readonly output: string;
  readonly screenshot?: { readonly dataBase64: string; readonly mediaType: string };
}> {
  const output = await runComputerUseTool(input, deps);
  const parsed = parseComputerUsePayload(output);
  return {
    output: stripScreenshotFromPayload(output),
    ...(parsed?.lastScreenshot ? { screenshot: parsed.lastScreenshot } : {}),
  };
}

/** 解析 `runComputerUseTool` 的 JSON 输出；失败返回 undefined（不抛异常）。 */
function parseComputerUsePayload(output: string): ComputerUseResultPayload | undefined {
  try {
    const parsed: unknown = JSON.parse(output);
    if (parsed !== null && typeof parsed === 'object') {
      return parsed as ComputerUseResultPayload;
    }
  } catch {
    // 输出不是 JSON（理论上不会发生）——按无截图处理，不影响主流程。
  }
  return undefined;
}

/** 从返回文本中移除 base64 截图字段，避免它进入模型上下文。 */
function stripScreenshotFromPayload(output: string): string {
  const parsed = parseComputerUsePayload(output);
  if (!parsed || parsed.lastScreenshot === undefined) {
    return output;
  }
  const { lastScreenshot: _omitted, ...rest } = parsed;
  return JSON.stringify(rest);
}
