/**
 * GUI Agent 视觉决策主循环（T-11）。
 *
 * 参考 `temp/UI-TARS-desktop/packages/ui-tars/sdk/src/GUIAgent.ts`（Apache-2.0），
 * 但做了关键重构：
 *
 * 1. **去除上游的 `globalThis` 单例上下文**。上游 `GUIAgent` 通过 `setContext()` 把
 *    operator / model / factors 等写进全局单例，并发跑多个任务时会互相覆盖。
 *    本实现把全部运行期状态（截图窗口、历史、步号、最近截图）放在 `run()` 的**局部变量**里，
 *    配置只以 `readonly` 实例字段保存，因此多个 runner 实例（乃至同实例重入）天然隔离。
 * 2. **用事件发射器替代 `onData` / `onError` 回调**：调用方通过 `onEvent` 订阅结构化事件，
 *    不再需要解析上游那种反复整体复制的 `GUIAgentData`。
 * 3. **模型调用通过接口注入**（{@link GuiRunnerModel}），agent-core 不依赖任何 provider 实现。
 * 4. 上游「截图失败计数器 / 暂停恢复 / 重试 / token 统计」等未在本期范围内，直接省略；
 *    异常统一走「发 error 事件 + 重新抛出」，不吞错。
 */

import { parseActionVlm } from './action-parser.js';
import type { GuiModelVersion, GuiPredictionParsed } from './action-parser.js';
import { normalizeActionName } from './action-types.js';
import type { GuiParsedAction } from './action-types.js';
import type { GuiSize } from './coordinates.js';
import { GUI_INTERNAL_ACTIONS, GUI_MAX_IMAGE_LENGTH, GUI_MAX_LOOP_COUNT } from './constants.js';
import type { GuiOperator, GuiOperatorScreenshot } from './operator.js';

/** 主循环事件（替代上游 onData / onError 回调）。 */
export type GuiRunnerEvent =
  | { readonly type: 'start'; readonly instruction: string }
  | {
      readonly type: 'screenshot';
      readonly step: number;
      readonly screenshot: GuiOperatorScreenshot;
    }
  | { readonly type: 'thought'; readonly step: number; readonly thought: string }
  | {
      readonly type: 'action';
      readonly step: number;
      readonly action: GuiParsedAction;
      readonly normalizedName: string;
    }
  | {
      readonly type: 'action-result';
      readonly step: number;
      readonly success: boolean;
      readonly detail?: string;
    }
  | { readonly type: 'finished'; readonly steps: number; readonly summary: string }
  | { readonly type: 'error'; readonly step: number; readonly message: string };

/**
 * 单次「截图 → 模型 → 动作」的模型调用契约，由调用方注入。
 *
 * `screenshots` 为最近的截图滑动窗口（最多 {@link GUI_MAX_IMAGE_LENGTH} 张，按时间正序，
 * 最后一张为当前步）。`history` 为已完成动作的历史（不含当前步）。
 */
export interface GuiRunnerModel {
  predict(input: {
    readonly instruction: string;
    readonly screenshots: readonly GuiOperatorScreenshot[];
    readonly step: number;
    readonly history: readonly GuiHistoryEntry[];
  }): Promise<string>;
}

/** 一条已执行动作的历史记录。 */
export interface GuiHistoryEntry {
  readonly step: number;
  readonly thought: string;
  readonly action: string;
  readonly success: boolean;
}

/** 构造 {@link GuiAgentRunner} 的选项。 */
export interface GuiRunnerOptions {
  readonly operator: GuiOperator;
  readonly model: GuiRunnerModel;
  /** 最大循环步数，默认 {@link GUI_MAX_LOOP_COUNT}。 */
  readonly maxSteps?: number;
  /** 取消信号；在每轮开始时检查，已取消则抛中文错误。 */
  readonly signal?: AbortSignal;
  /** 事件订阅回调。 */
  readonly onEvent?: (event: GuiRunnerEvent) => void;
  /** 屏幕（截图逻辑）尺寸；提供后解析动作时会附带像素坐标。 */
  readonly screenSize?: GuiSize;
  /** 模型版本，透传给动作解析器（影响 v1.5 智能缩放）。 */
  readonly modelVer?: GuiModelVersion;
}

/** 主循环结束后的结果。 */
export interface GuiRunnerResult {
  readonly success: boolean;
  readonly steps: number;
  readonly summary: string;
  readonly lastScreenshot?: GuiOperatorScreenshot;
  readonly history: readonly GuiHistoryEntry[];
}

/** 从模型原始输出解析出的动作信息。 */
export interface GuiModelOutput {
  readonly thought: string;
  readonly action: GuiParsedAction | null;
  readonly normalizedName: string;
}

function formatParam(value: unknown): string {
  if (typeof value === 'string') return value;
  // 数组统一渲染成 `(a,b,c)` 的坐标字符串形态：`parseSingleAction` 按
  // 「不在引号内的逗号」切分参数，若渲染成 JSON 数组（`[a,b,c]`）会被
  // 误切成多个伪参数键，导致 operator 侧解析失败。
  if (Array.isArray(value)) {
    return `(${value.map((item) => String(item)).join(',')})`;
  }
  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}

/**
 * 把解析结果重建为**可被 `parseSingleAction` 反向解析**的动作文本，
 * 例如 `click(start_box=(0.1,0.1,0.1,0.1))`。
 *
 * ⚠️ 坐标语义：`action_inputs.start_box` 是 `parseActionVlm` 归一化后的
 * **0–1 比例**（不是模型原始的 0–1000），同表中的 `start_coords` 才是绝对像素。
 * 消费方（operator）必须按此语义解读，详见 `desktop-control-operator.ts`。
 */
function buildRawAction(name: string, inputs: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(inputs);
  if (entries.length === 0) {
    return `${name}()`;
  }
  const args = entries.map(([key, value]) => `${key}='${formatParam(value)}'`).join(', ');
  return `${name}(${args})`;
}

/**
 * 从模型原始输出解析出动作（导出以便单测）。
 *
 * 模型可能一次输出多条动作（用空行分隔）；本函数**只取最后一条**含非空
 * `action_type` 的解析结果——与「最终决定下一步动作」的语义一致。
 * 动作名经 {@link normalizeActionName} 归一；无有效动作时 `action` 为 `null`、`normalizedName` 为空串。
 */
export function parseModelOutput(
  raw: string,
  options: {
    readonly screenSize?: GuiSize;
    readonly modelVer?: GuiModelVersion;
  } = {},
): GuiModelOutput {
  const result = parseActionVlm(raw, {
    screenContext: options.screenSize,
    modelVer: options.modelVer,
  });

  let last: GuiPredictionParsed | null = null;
  for (let index = result.parsed.length - 1; index >= 0; index -= 1) {
    const entry = result.parsed[index];
    if (entry !== undefined && entry.action_type.trim().length > 0) {
      last = entry;
      break;
    }
  }

  if (last === null) {
    return { thought: result.thought, action: null, normalizedName: '' };
  }

  const rawName = last.action_type.trim();
  const normalizedName = normalizeActionName(rawName);
  return {
    thought: result.thought,
    action: {
      // `name` 用归一化规范名（便于 operator 按规范名分发），`raw` 保留模型原始写法。
      name: normalizedName,
      raw: buildRawAction(rawName, last.action_inputs),
      params: Object.values(last.action_inputs),
    },
    normalizedName,
  };
}

/**
 * GUI 视觉决策主循环。
 *
 * 所有运行期可变状态均在 {@link GuiAgentRunner.run} 内部，实例字段全部 `readonly`，
 * 因此不存在跨实例的状态串扰（这是替代上游 `globalThis` 单例的核心设计）。
 */
export class GuiAgentRunner {
  private readonly operator: GuiOperator;
  private readonly model: GuiRunnerModel;
  private readonly maxSteps: number;
  private readonly signal: AbortSignal | undefined;
  private readonly onEvent: ((event: GuiRunnerEvent) => void) | undefined;
  private readonly screenSize: GuiSize | undefined;
  private readonly modelVer: GuiModelVersion | undefined;

  constructor(options: GuiRunnerOptions) {
    this.operator = options.operator;
    this.model = options.model;
    this.maxSteps = options.maxSteps ?? GUI_MAX_LOOP_COUNT;
    this.signal = options.signal;
    this.onEvent = options.onEvent;
    this.screenSize = options.screenSize;
    this.modelVer = options.modelVer;
  }

  /** 执行指令，直到 `finished` / `call_user` / 达到步数上限 / 抛错。 */
  async run(instruction: string): Promise<GuiRunnerResult> {
    this.emit({ type: 'start', instruction });

    // 运行期状态全部为局部变量——这是「去 globalThis 单例」的关键。
    const history: GuiHistoryEntry[] = [];
    const screenshots: GuiOperatorScreenshot[] = [];
    let lastScreenshot: GuiOperatorScreenshot | undefined;
    let step = 0;

    try {
      for (step = 1; step <= this.maxSteps; step += 1) {
        if (this.signal?.aborted) {
          throw new Error('GUI 任务已取消');
        }

        const screenshot = await this.operator.screenshot();
        lastScreenshot = screenshot;
        screenshots.push(screenshot);
        // 滑动窗口：只保留最近 N 张，且保持时间正序（末尾为最新）。
        if (screenshots.length > GUI_MAX_IMAGE_LENGTH) {
          screenshots.splice(0, screenshots.length - GUI_MAX_IMAGE_LENGTH);
        }
        this.emit({ type: 'screenshot', step, screenshot });

        const raw = await this.model.predict({
          instruction,
          screenshots: [...screenshots],
          step,
          history: [...history],
        });

        const { thought, action, normalizedName } = parseModelOutput(raw, {
          screenSize: this.screenSize,
          modelVer: this.modelVer,
        });
        this.emit({ type: 'thought', step, thought });

        if (normalizedName === 'finished') {
          const summary = '任务完成';
          this.emit({ type: 'finished', steps: step, summary });
          return { success: true, steps: step, summary, lastScreenshot, history };
        }

        if (normalizedName === 'call_user') {
          const summary = '模型请求用户介入，任务已暂停';
          this.emit({ type: 'finished', steps: step, summary });
          return { success: false, steps: step, summary, lastScreenshot, history };
        }

        if (GUI_INTERNAL_ACTIONS.includes(normalizedName)) {
          // 其余内部动作不交给 operator：max_loop 视作达到上限；error_env 走异常通道。
          if (normalizedName === 'max_loop') {
            const summary = `模型判定达到循环上限（第 ${step} 步）`;
            this.emit({ type: 'finished', steps: step, summary });
            return { success: false, steps: step, summary, lastScreenshot, history };
          }
          throw new Error('GUI 运行环境出现错误（error_env）');
        }

        if (action === null) {
          // 没有解析出动作：记为失败一步，继续循环（不调用 operator）。
          history.push({ step, thought, action: '', success: false });
          continue;
        }

        this.emit({ type: 'action', step, action, normalizedName });
        const result = await this.operator.execute(action);
        this.emit({
          type: 'action-result',
          step,
          success: result.success,
          ...(result.detail !== undefined ? { detail: result.detail } : {}),
        });
        history.push({ step, thought, action: normalizedName, success: result.success });
      }

      // 循环正常跑满 maxSteps 仍未结束 → 以失败收尾。
      const steps = this.maxSteps > 0 ? this.maxSteps : 0;
      const summary = `已达到最大循环步数 ${this.maxSteps}，任务未完成`;
      this.emit({ type: 'finished', steps, summary });
      return { success: false, steps, summary, lastScreenshot, history };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'error', step, message });
      throw error;
    }
  }

  private emit(event: GuiRunnerEvent): void {
    this.onEvent?.(event);
  }
}
