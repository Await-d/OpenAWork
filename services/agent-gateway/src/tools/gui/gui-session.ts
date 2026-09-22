/**
 * T-17 / T-18：`computer_use` 的 GUI 子会话与逐步进度投影。
 *
 * 背景：内层 GUI 循环（`@openAwork/agent-core` 的 `GuiAgentRunner`）每一步都会产出
 * 「思考 → 动作 → 执行结果」，但整个循环可能要跑几分钟。若这些步骤只留在工具返回值里，
 * 用户在任务结束前看不到任何进度。本模块负责把每一步：
 *
 * 1. **落库到独立子会话**（title `computer_use`，`metadata.parentSessionId` 指向父会话）：
 *    任务可单独回看；同时父会话取消链路（`session/cancel-descendant-streams.ts` 按
 *    `metadata_json.parentSessionId` BFS 收集后代）能识别到这层血缘（T-20）。
 * 2. **以 `tool_progress` 事件投影回父会话**：前端 `applyToolProgressEvent`
 *    （`apps/web/src/pages/chat-page/state/chat-stream-state.ts`）按 `toolCallId` 归并、
 *    对任意 `toolName` 生效，因此无需新增事件类型即可渲染逐步进度（T-18）。
 *
 * 语义与 `batch` 工具的进度保持一致的几点：
 *  - `subTools` 是**累积快照**（每一步发全量，而不是增量 diff）；
 *  - 每项 `status` 取自 `BatchSubToolStatus`（`running | completed | error | skipped`），
 *    本模块只产出终结态（`completed` / `error`）——GUI 步骤在「动作执行完毕」时一次性落定；
 *  - `completedCount` = 快照中已终结的项数，`totalCount` = 本次 GUI 任务的步数预算
 *    （`maxSteps`，即 `computer_use` 入参上限），因此前端能显示「已走 N / 预算 M 步」。
 *
 * 失败安全（T-17 验收要求）：进度属于**观测性**数据，任何一步的写库 / 发事件失败都
 * 不得让 GUI 任务失败。所有副作用都在 try/catch 中降级：写子会话失败后停止继续写
 * （避免每步刷日志），但仍继续向父会话发进度；发事件失败只告警。
 */
import { randomUUID } from 'node:crypto';
import type { BatchSubToolProgress } from '@openAwork/shared';
import { sqliteRun } from '../../infra/db.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import { publishSessionRunEvent } from '../../session/session-run-events.js';

/** 子会话标题（与 `look_at` 的 `createLookAtChildSession` 同范式）。 */
export const GUI_SESSION_TITLE = 'computer_use';

/** 写进子会话 metadata 的溯源标记：由哪个工具创建。 */
export const GUI_SESSION_CREATED_BY_TOOL = 'computer_use';

/** 写进子会话 metadata 的子代理类型（GUI Agent）。 */
export const GUI_SESSION_SUBAGENT_TYPE = 'gui-agent';

/** 进度事件的 `toolName`，与 `computerUseToolDefinition.name` 对齐。 */
export const GUI_PROGRESS_TOOL_NAME = 'computer_use';

/**
 * 单步文本在进度事件里的最大长度（UTF-16 码元）。
 *
 * 进度事件会被持久化到 `session_run_events` 并广播给所有订阅者；GUI 的思考文本
 * 可能很长，逐步累积会显著放大事件体积。子会话消息里保留全文，进度事件只留摘要。
 */
const GUI_STEP_OUTPUT_MAX_CHARS = 500;

/** `GuiSessionHandle.recordStep` 的入参：一步的终结状态。 */
export interface GuiSessionStep {
  /** 步号（由主循环从 1 开始递增，与 `GuiHistoryEntry.step` 同源）。 */
  readonly index: number;
  /** 该步模型的思考文本。 */
  readonly thought: string;
  /** 归一化后的动作名（如 `click`）；未解析出动作时为空串。 */
  readonly action: string;
  /** 该步是否执行成功。 */
  readonly success: boolean;
  /** 可选的执行细节（operator 回传的 detail）。 */
  readonly detail?: string;
}

/** GUI 子会话句柄：调用方只关心「记录一步」与「收尾」两个动作。 */
export interface GuiSessionHandle {
  readonly sessionId: string;
  /** 记录一步（写子会话消息 + 发父会话 tool_progress）。 */
  recordStep(step: GuiSessionStep): void;
  /** 收尾：写最终摘要 + 发最后一次 tool_progress（幂等）。 */
  finalize(summary: string, success: boolean): void;
}

/** `createGuiSession` 入参。 */
export interface CreateGuiSessionInput {
  /** 会话所属用户（子会话 owner 与消息写入都需要）。 */
  readonly userId: string;
  /** 父会话 id；写入子会话 metadata，也是取消链路（T-20）与进度事件的落点。 */
  readonly parentSessionId: string;
  /**
   * 父会话中本次 `computer_use` 调用的 toolCallId。
   *
   * 前端按它把进度归并到对应的工具卡片；为空串时**不发**进度事件
   * （否则会在父会话里造出一条没有对应工具调用的幽灵记录）。
   */
  readonly toolCallId: string;
  /** 要执行的指令：作为子会话的第一条 user 消息落库。 */
  readonly instruction: string;
  /** 步数预算，作为进度事件的 `totalCount`。 */
  readonly maxSteps: number;
  /** 门控解析出的 provider id（溯源用，可选）。 */
  readonly providerId?: string;
  /** 门控解析出的 model id（溯源用，可选）。 */
  readonly modelId?: string;
  /** 模型变体（溯源用，可选）。 */
  readonly variant?: string;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

/** 把一步渲染成与子会话消息同构的文本（`Thought / Action / Result`）。 */
function buildStepText(step: GuiSessionStep): string {
  const action = step.action.trim().length > 0 ? step.action.trim() : '（未解析出动作）';
  const detail = step.detail?.trim() ?? '';
  const resultLine =
    detail.length > 0
      ? `${step.success ? '成功' : '失败'}：${detail}`
      : step.success
        ? '成功'
        : '失败';
  return `Thought: ${step.thought}\nAction: ${action}\nResult: ${resultLine}`;
}

/** 截断进度事件里的单步文本；子会话消息仍保留全文。 */
function truncateForProgress(text: string): string {
  if (text.length <= GUI_STEP_OUTPUT_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, GUI_STEP_OUTPUT_MAX_CHARS)}…（已截断，完整内容见子会话）`;
}

/** 构造一条子会话的记录：`sessions` 表与 `look_at` 子会话同范式。 */
function insertChildSession(input: CreateGuiSessionInput, sessionId: string): boolean {
  const metadata: Record<string, unknown> = {
    parentSessionId: input.parentSessionId,
    createdByTool: GUI_SESSION_CREATED_BY_TOOL,
    subagentType: GUI_SESSION_SUBAGENT_TYPE,
    toolCallId: input.toolCallId,
    maxSteps: input.maxSteps,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.variant ? { variant: input.variant } : {}),
  };
  try {
    sqliteRun(
      'INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, title) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, input.userId, '[]', 'idle', JSON.stringify(metadata), GUI_SESSION_TITLE],
    );
    return true;
  } catch (error) {
    // 子会话创建失败不阻断 GUI 任务：后续跳过子会话写库，父会话进度照发。
    console.warn(`[gui-session] 创建 GUI 子会话失败，降级为仅上报进度：${describeError(error)}`);
    return false;
  }
}

/**
 * 创建 GUI 子会话句柄。
 *
 * 子会话先写入指令（user 消息），随后每一步由 {@link GuiSessionHandle.recordStep}
 * 追加一条 assistant 消息；{@link GuiSessionHandle.finalize} 写入最终摘要。
 */
export function createGuiSession(input: CreateGuiSessionInput): GuiSessionHandle {
  const sessionId = randomUUID();
  // 子会话写库一旦失败就整体关闭（避免每步都抛错刷日志），进度上报独立存活。
  let childWritesEnabled = insertChildSession(input, sessionId);
  const subTools: BatchSubToolProgress[] = [];
  let finalized = false;

  const appendChildMessage = (role: 'user' | 'assistant', text: string): void => {
    if (!childWritesEnabled) {
      return;
    }
    try {
      appendSessionMessageV2({
        sessionId,
        userId: input.userId,
        role,
        content: [{ type: 'text', text }],
      });
    } catch (error) {
      childWritesEnabled = false;
      console.warn(
        `[gui-session] 写入子会话消息失败，后续步骤不再落库（进度照发）：${describeError(error)}`,
      );
    }
  };

  const publishProgress = (): void => {
    // 无 toolCallId 时不发：前端会为不存在的工具调用建卡片（幽灵条目）。
    if (input.toolCallId.length === 0) {
      return;
    }
    try {
      publishSessionRunEvent(input.parentSessionId, {
        type: 'tool_progress',
        toolCallId: input.toolCallId,
        toolName: GUI_PROGRESS_TOOL_NAME,
        // 快照语义：发全量副本，避免订阅方持有的数组被后续步骤改写。
        subTools: subTools.map((entry) => ({ ...entry })),
        completedCount: subTools.filter((entry) => entry.status !== 'running').length,
        totalCount: input.maxSteps,
        occurredAt: Date.now(),
      });
    } catch (error) {
      // 进度上报失败只降级为告警：GUI 任务本身的成败不依赖它。
      console.warn(
        `[gui-session] 发布 tool_progress 失败（不影响 GUI 任务）：${describeError(error)}`,
      );
    }
  };

  appendChildMessage('user', input.instruction);

  return {
    sessionId,
    recordStep(step: GuiSessionStep): void {
      const text = buildStepText(step);
      subTools.push({
        index: step.index,
        tool: step.action.trim().length > 0 ? step.action.trim() : 'thought',
        status: step.success ? 'completed' : 'error',
        output: truncateForProgress(text),
        ...(step.success ? {} : { isError: true }),
      });
      appendChildMessage('assistant', text);
      publishProgress();
    },
    finalize(summary: string, success: boolean): void {
      // 幂等：主循环既可能先发 error 事件、再由调用方兜底收尾，只允许落一次终态。
      if (finalized) {
        return;
      }
      finalized = true;
      appendChildMessage('assistant', `任务${success ? '完成' : '结束'}：${summary}`);
      // 终态快照：全部步骤都已终结（不再有 running）；失败的步骤保留 error + isError，
      // 与 batch 一致（`completedCount` 统计的是「已终结」而非「成功」）。
      publishProgress();
    },
  };
}
