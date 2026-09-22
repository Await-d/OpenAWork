/**
 * GUI Operator 抽象（仅类型 / 接口，无实现）。
 *
 * Phase 1 的平台 Operator（桌面 / 浏览器 / ADB 等）需要实现该接口，
 * 由下游 GUI Agent 循环统一调用截图与动作执行。
 */
import type { GuiParsedAction } from './action-types.js';

/** 截图结果：base64 数据、MIME 类型与像素尺寸（物理像素）。 */
export interface GuiOperatorScreenshot {
  readonly dataBase64: string;
  readonly mediaType: string;
  readonly width: number;
  readonly height: number;
}

/** 动作执行结果。 */
export interface GuiOperatorExecutionResult {
  readonly success: boolean;
  readonly detail?: string;
}

/** Operator 能力声明：支持的动作名集合（用于能力路由 / 降级）。 */
export interface GuiOperatorCapabilities {
  readonly supportedActions: readonly string[];
}

/**
 * GUI 操作器接口：负责采集屏幕与执行动作。
 */
export interface GuiOperator {
  /** 采集当前屏幕截图。 */
  screenshot(): Promise<GuiOperatorScreenshot>;
  /** 执行一个已解析的动作。 */
  execute(action: GuiParsedAction): Promise<GuiOperatorExecutionResult>;
}
