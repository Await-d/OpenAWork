/**
 * UI-TARS 动作解析器移植版（T-02）。
 *
 * 来源：`bytedance/UI-TARS-desktop` @ `packages/ui-tars/action-parser/src/actionParser.ts`
 * （Apache-2.0）。按本仓约定做了四类改造：
 * 1. 去掉 `lodash.isnumber` 依赖（改用 `Number.isFinite`）；
 * 2. 去掉 `console.error`（改为返回结构化失败信息，由调用方决定是否记录）；
 * 3. 去掉 `@ts-ignore` 与隐式 `any`（改为显式类型）；
 * 4. 内部相对导入补 `.js` 扩展名。
 *
 * 关键设计（与上游一致）：解析器**不含动作枚举**，`^(\w+)\((.*)\)$` 是通用语法解析，
 * 动作词表由 prompt / operator 决定——因此新增动作无需改动本模块。
 */

import { GUI_IMAGE_FACTOR } from './coordinates.js';

/**
 * 图像缩放的像素对齐因子（复用 `coordinates.ts` 的 {@link GUI_IMAGE_FACTOR}，避免重复导出）。
 */
export { GUI_IMAGE_FACTOR };
/** 最小像素预算（上游 `MIN_PIXELS`）。 */
export const GUI_MIN_PIXELS = 100 * GUI_IMAGE_FACTOR * GUI_IMAGE_FACTOR;
/** 长宽比上限（上游 `MAX_RATIO`）。 */
export const GUI_MAX_RATIO = 200;

/** 支持的模型版本（与上游 `UITarsModelVersion` 对齐）。 */
export type GuiModelVersion = 'v1.0' | 'doubao' | 'v1.5';

export interface GuiScreenContext {
  readonly width: number;
  readonly height: number;
}

export interface GuiParseActionOptions {
  /** 坐标归一化因子，`[widthFactor, heightFactor]` 或单一数值（默认 1000）。 */
  readonly factor?: number | readonly [number, number];
  /** 屏幕（逻辑）尺寸；提供后才会产出像素中心坐标。 */
  readonly screenContext?: GuiScreenContext;
  /** 截图缩放系数（默认 1）。 */
  readonly scaleFactor?: number;
  /** 输出模式：`bc`（Thought/Action 文本）或 `o1`（`<Thought>` 标签）。 */
  readonly mode?: 'bc' | 'o1';
  /** 模型版本；`v1.5` 会启用智能缩放因子。 */
  readonly modelVer?: GuiModelVersion;
  /** 像素上限，默认按模型版本推导。 */
  readonly maxPixels?: number;
}

export interface GuiActionParseResult {
  readonly parsed: readonly GuiPredictionParsed[];
  /** 思考内容（`Thought:` / `Action_Summary:` 段落），无则为空串。 */
  readonly thought: string;
  /** 反思内容（`Reflection:` 段落），无则为 null。 */
  readonly reflection: string | null;
}

/** 解析后的一条动作（字段名沿用上游 `PredictionParsed`，便于对照参考实现）。 */
export interface GuiPredictionParsed {
  readonly reflection: string | null;
  readonly thought: string;
  readonly action_type: string;
  readonly action_inputs: Readonly<Record<string, unknown>>;
}

/** 解析单条动作字符串的结果；解析失败时 `action` 为 null。 */
export interface GuiActionInstance {
  readonly function: string;
  readonly args: Readonly<Record<string, string>>;
}

function roundByFactor(value: number, factor: number): number {
  return Math.round(value / factor) * factor;
}

function floorByFactor(value: number, factor: number): number {
  return Math.floor(value / factor) * factor;
}

function ceilByFactor(value: number, factor: number): number {
  return Math.ceil(value / factor) * factor;
}

/**
 * V1.5 智能缩放：把屏幕尺寸收敛到 `[minPixels, maxPixels]` 区间并按 factor 对齐。
 *
 * 与上游差异：长宽比越界时返回 `null`（上游是 `console.error` 后返回 null），
 * 由调用方决定如何告知——本仓约定禁止在纯逻辑层直接打印日志。
 */
export function smartResizeForV15(
  height: number,
  width: number,
  options: {
    readonly maxRatio?: number;
    readonly factor?: number;
    readonly minPixels?: number;
    readonly maxPixels?: number;
  } = {},
): readonly [number, number] | null {
  const {
    maxRatio = GUI_MAX_RATIO,
    factor = GUI_IMAGE_FACTOR,
    minPixels = GUI_MIN_PIXELS,
    maxPixels,
  } = options;

  if (maxPixels === undefined) return null;
  if (width <= 0 || height <= 0) return null;

  const ratio = Math.max(height, width) / Math.min(height, width);
  if (ratio > maxRatio) return null;

  let wBar = Math.max(factor, roundByFactor(width, factor));
  let hBar = Math.max(factor, roundByFactor(height, factor));

  if (hBar * wBar > maxPixels) {
    const beta = Math.sqrt((height * width) / maxPixels);
    hBar = floorByFactor(height / beta, factor);
    wBar = floorByFactor(width / beta, factor);
  } else if (hBar * wBar < minPixels) {
    const beta = Math.sqrt(minPixels / (height * width));
    hBar = ceilByFactor(height * beta, factor);
    wBar = ceilByFactor(width * beta, factor);
  }

  return [wBar, hBar];
}

function resolveFactors(factor: GuiParseActionOptions['factor']): readonly [number, number] {
  if (factor === undefined) return [1000, 1000];
  if (Array.isArray(factor)) {
    const [widthFactor, heightFactor] = factor as readonly [number, number];
    return [widthFactor, heightFactor];
  }
  const scalar = factor as number;
  return [scalar, scalar];
}

/** 规整化为二元组：单值 point 展开成退化 box。 */
function normalizeBoxNumbers(numbers: readonly number[]): number[] {
  const result = [...numbers];
  if (result.length === 2) {
    const [x, y] = result;
    if (x === undefined || y === undefined) return result;
    result.push(x, y);
  }
  return result;
}

/**
 * 解析一段模型输出文本，产出动作列表。
 *
 * `Thought:` / `Reflection:` / `Action_Summary:` 段落按上游规则抽取；
 * 动作体按空行切分后逐条走 `parseSingleAction`。
 */
export function parseActionVlm(
  text: string,
  options: GuiParseActionOptions = {},
): GuiActionParseResult {
  const { screenContext, scaleFactor, mode = 'bc', modelVer = 'v1.0', maxPixels } = options;
  const factors = resolveFactors(options.factor);

  let reflection: string | null = null;
  let thought: string | null = null;
  let actionStr = '';

  let smartResizeFactors: readonly [number, number] | null = null;
  if (modelVer === 'v1.5' && screenContext && screenContext.height > 0 && screenContext.width > 0) {
    smartResizeFactors = smartResizeForV15(screenContext.height, screenContext.width, {
      ...(maxPixels !== undefined ? { maxPixels } : {}),
    });
  }

  const source = text.trim();
  if (mode === 'bc') {
    if (source.includes('Thought:')) {
      const thoughtMatch = source.match(/Thought: ([\s\S]+?)(?=\s*Action[:：]|$)/);
      if (thoughtMatch?.[1]) thought = thoughtMatch[1].trim();
    } else if (source.startsWith('Reflection:')) {
      const reflectionMatch = source.match(
        /Reflection: ([\s\S]+?)Action_Summary: ([\s\S]+?)(?=\s*Action[:：]|$)/,
      );
      if (reflectionMatch?.[2]) {
        thought = reflectionMatch[2].trim();
        reflection = reflectionMatch[1]?.trim() ?? null;
      }
    } else if (source.startsWith('Action_Summary:')) {
      const summaryMatch = source.match(/Action_Summary: (.+?)(?=\s*Action[:：]|$)/);
      if (summaryMatch?.[1]) thought = summaryMatch[1].trim();
    }

    if (!['Action:', 'Action：'].some((keyword) => source.includes(keyword))) {
      actionStr = source;
    } else {
      const actionParts = source.split(/Action[:：]/);
      actionStr = actionParts[actionParts.length - 1] ?? '';
    }
  } else {
    // o1 模式：`<Thought>` / `Action_Summary` / `Action` 标签。
    const thoughtMatch = source.match(/<Thought>\s*(.*?)\s*<\/Thought>/);
    const actionSummaryMatch = source.match(/\nAction_Summary:\s*(.*?)\s*Action:/);
    const actionMatch = source.match(/\nAction:\s*(.*?)\s*<\/Output>/);

    const thoughtContent = thoughtMatch?.[1] ?? null;
    const actionSummaryContent = actionSummaryMatch?.[1] ?? null;
    const actionContent = actionMatch?.[1] ?? null;

    thought = `${thoughtContent}\n<Action_Summary>\n${actionSummaryContent}`;
    actionStr = actionContent ?? '';
  }

  const parsed: GuiPredictionParsed[] = [];
  for (const rawStr of actionStr.split('\n\n')) {
    const actionInstance = parseSingleAction(rawStr.replace(/\n/g, String.raw`\n`).trimStart());
    let actionType = '';
    const actionInputs: Record<string, unknown> = {};

    if (actionInstance) {
      actionType = actionInstance.function;

      for (const [paramName, param] of Object.entries(actionInstance.args)) {
        if (!param) continue;
        const trimmedParam = param.trim();
        const key = paramName.trim();

        if (key.includes('start_box') || key.includes('end_box')) {
          const numbers = trimmedParam
            .replace(/[()[\]]/g, '')
            .split(',')
            .filter((item) => item !== '');

          const floatNumbers = numbers.map((num, idx) => {
            const factorIndex = idx % 2;
            if (modelVer === 'v1.5' && smartResizeFactors) {
              const divisor = smartResizeFactors[factorIndex];
              return divisor ? Number.parseFloat(num) / divisor : Number.parseFloat(num);
            }
            const divisor = factors[factorIndex];
            return divisor ? Number.parseFloat(num) / divisor : Number.parseFloat(num);
          });

          actionInputs[key] = JSON.stringify(normalizeBoxNumbers(floatNumbers));

          if (screenContext && screenContext.width > 0 && screenContext.height > 0) {
            const boxKey = key.includes('start_box') ? 'start_coords' : 'end_coords';
            const normalized = normalizeBoxNumbers(floatNumbers);
            const [nx1, ny1, nx2, ny2] = normalized;
            const [widthFactor, heightFactor] = factors;
            const finite =
              nx1 !== undefined &&
              ny1 !== undefined &&
              nx2 !== undefined &&
              ny2 !== undefined &&
              [nx1, ny1, nx2, ny2].every((value) => Number.isFinite(value));

            actionInputs[boxKey] = finite
              ? [
                  (Math.round(((nx1 + nx2) / 2) * screenContext.width * widthFactor) /
                    widthFactor) *
                    (scaleFactor ?? 1),
                  (Math.round(((ny1 + ny2) / 2) * screenContext.height * heightFactor) /
                    heightFactor) *
                    (scaleFactor ?? 1),
                ]
              : [];
          }
        } else {
          actionInputs[key] = trimmedParam;
        }
      }
    }

    parsed.push({
      reflection,
      thought: thought ?? '',
      action_type: actionType,
      action_inputs: actionInputs,
    });
  }

  return { parsed, thought: thought ?? '', reflection };
}

/**
 * 解析单条动作字符串，例如 `click(start_box='(279,81)')`。
 *
 * 解析失败返回 `null`（上游会 `console.error` 后返回 null；本仓约定纯逻辑层不打印）。
 * 支持的坐标写法：`<|box_start|>` 包裹、`<bbox>637 964 …</bbox>`、`<point>510 150</point>`、
 * `point=` / `start_point=` / `end_point=` 别名。
 */
export function parseSingleAction(actionStr: string): GuiActionInstance | null {
  const normalized = actionStr
    .replace(/<\|box_start\|>|<\|box_end\|>/g, '')
    .replace(/(?<!start_|end_)point=/g, 'start_box=')
    .replace(/start_point=/g, 'start_box=')
    .replace(/end_point=/g, 'end_box=');

  const match = normalized.trim().match(/^(\w+)\((.*)\)$/);
  if (!match) return null;

  const functionName = match[1];
  const argsStr = match[2];
  if (functionName === undefined || argsStr === undefined) return null;

  const args: Record<string, string> = {};

  if (argsStr.trim()) {
    // 按「不在引号内的逗号」切分参数对。
    const argPairs = argsStr.match(/([^,']|'[^']*')+/g) ?? [];

    for (const pair of argPairs) {
      const [key, ...valueParts] = pair.split('=');
      if (!key) continue;

      let value = valueParts
        .join('=')
        .trim()
        .replace(/^['"]|['"]$/g, '');

      if (value.includes('<bbox>')) {
        value = value.replace(/<bbox>|<\/bbox>/g, '').replace(/\s+/g, ',');
        value = `(${value})`;
      }

      if (value.includes('<point>')) {
        value = value.replace(/<point>|<\/point>/g, '').replace(/\s+/g, ',');
        value = `(${value})`;
      }

      args[key.trim()] = value;
    }
  }

  return { function: functionName, args };
}
