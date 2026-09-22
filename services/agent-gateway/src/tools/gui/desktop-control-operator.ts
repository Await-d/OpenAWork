/**
 * T-12：把 `desktop_control` 的 manager 包装为 agent-core 的 {@link GuiOperator}。
 *
 * 职责：把 GUI 归一化坐标动作（UI-TARS 动作空间，坐标为 0–1000 归一化值）
 * 翻译成 `desktop_control` 的实际调用，并统一以结果对象（而非异常）表达执行失败。
 *
 * 坐标链路：`start_box`（字符串 / 数字数组）→ 解析成数字 → 归一化中心 →
 * 逻辑像素（`pointToPixel` / `boxToPixelCenter`）。
 *
 * 说明：`GuiParsedAction` 的真实字段是 `{ name, raw, params }`（不是
 * `action_inputs`）。因此这里同时支持两种参数来源：
 *  1. `params` 中的对象形态（T-11 Runner 可传结构化参数）；
 *  2. `raw` 文本经 `parseSingleAction` 解析出的命名参数（`start_box` / `end_box` /
 *     `keys` / `content` / `direction` 等）。
 */
import {
  boxToPixelCenter,
  normalizeActionName,
  parseSingleAction,
  pointToPixel,
} from '@openAwork/agent-core';
import type {
  GuiBox,
  GuiOperator,
  GuiOperatorCapabilities,
  GuiOperatorExecutionResult,
  GuiOperatorScreenshot,
  GuiParsedAction,
  GuiPoint,
  GuiSize,
} from '@openAwork/agent-core';
import type {
  DesktopControlClickAction,
  DesktopControlManager,
  DesktopControlMouseButton,
} from '../desktop-control.js';

export interface DesktopControlOperatorOptions {
  /** 注入的 desktop_control manager，便于测试与复用。 */
  readonly manager: DesktopControlManager;
  /** 逻辑屏幕尺寸，用于 0–1000 归一化坐标 → 像素换算。 */
  readonly screenSize: GuiSize;
  /** 设备像素比，默认 1；>1 表示尺寸来自物理像素截图，需还原为逻辑坐标。 */
  readonly dpr?: number;
}

interface OperatorContext {
  readonly manager: DesktopControlManager;
  readonly screenSize: GuiSize;
  readonly dpr: number;
}

/** `wait` 动作未给出毫秒数时的默认值。 */
const DEFAULT_WAIT_MS = 5000;
/** `wait` 的毫秒数上限（与 desktop_control schema 的 max 对齐）。 */
const MAX_WAIT_MS = 10000;
/** `scroll` 方向换算出的单次滚动量。 */
const DEFAULT_SCROLL_STEP = 600;
/** `drag` 的默认按键与时长（与 desktop_control schema 默认值对齐）。 */
const DEFAULT_DRAG_BUTTON: DesktopControlMouseButton = 'left';
const DEFAULT_DRAG_MS = 300;
/** `long_press` 的默认按键与时长。 */
const DEFAULT_LONG_PRESS_BUTTON: DesktopControlMouseButton = 'left';
const DEFAULT_LONG_PRESS_MS = 800;

/**
 * 创建基于 `desktop_control` 的 {@link GuiOperator}。
 *
 * 执行失败（坐标非法、manager 抛错等）一律以
 * `{ success: false, detail }` 返回，不向上抛异常——这是 operator 契约要求。
 */
export function createDesktopControlOperator(options: DesktopControlOperatorOptions): GuiOperator {
  const context: OperatorContext = {
    manager: options.manager,
    screenSize: options.screenSize,
    dpr: options.dpr ?? 1,
  };

  return {
    screenshot: () => captureScreenshot(context),
    execute: (action) => executeAction(context, action),
  };
}

async function executeAction(
  context: OperatorContext,
  action: GuiParsedAction,
): Promise<GuiOperatorExecutionResult> {
  try {
    return await dispatchAction(context, action);
  } catch (error) {
    return {
      success: false,
      detail: `desktop_control 执行失败：${describeError(error)}`,
    };
  }
}

async function dispatchAction(
  context: OperatorContext,
  action: GuiParsedAction,
): Promise<GuiOperatorExecutionResult> {
  const name = normalizeActionName(action.name);
  const args = readActionArgs(action);

  switch (name) {
    case 'click':
      return clickAt(context, args, 'left', 'click');
    case 'double_click':
      return clickAt(context, args, 'left', 'double_click');
    case 'right_click':
      return clickAt(context, args, 'right', 'click');
    case 'middle_click':
      return clickAt(context, args, 'middle', 'click');
    case 'mouse_move':
      return moveTo(context, args);
    case 'long_press':
      return longPressAt(context, args);
    case 'drag':
      return dragBetween(context, args);
    case 'type':
      return typeText(context, args);
    case 'hotkey':
      return pressHotkey(context, args);
    case 'scroll':
      return scrollAt(context, args);
    case 'wait':
      return waitFor(context, args);
    default:
      return {
        success: false,
        detail: `GuiOperator 不支持的动作：${action.name}。`,
      };
  }
}

async function clickAt(
  context: OperatorContext,
  args: Readonly<Record<string, unknown>>,
  button: DesktopControlMouseButton,
  clickAction: DesktopControlClickAction,
): Promise<GuiOperatorExecutionResult> {
  const point = resolveSinglePoint(context, args);
  if (!point) {
    return {
      success: false,
      detail: '无法解析点击坐标：缺少合法的 start_box / point（0–1000 归一化坐标）。',
    };
  }

  await context.manager.click({
    action: 'click',
    x: point.x,
    y: point.y,
    button,
    clickAction,
  });
  return { success: true, detail: `已点击 (${point.x}, ${point.y})` };
}

async function moveTo(
  context: OperatorContext,
  args: Readonly<Record<string, unknown>>,
): Promise<GuiOperatorExecutionResult> {
  const point = resolveSinglePoint(context, args);
  if (!point) {
    return {
      success: false,
      detail: '无法解析鼠标移动坐标：缺少合法的 start_box / point（0–1000 归一化坐标）。',
    };
  }

  await context.manager.mouseMove({ action: 'mouse_move', x: point.x, y: point.y });
  return { success: true, detail: `已移动鼠标到 (${point.x}, ${point.y})` };
}

async function longPressAt(
  context: OperatorContext,
  args: Readonly<Record<string, unknown>>,
): Promise<GuiOperatorExecutionResult> {
  const point = resolveSinglePoint(context, args);
  if (!point) {
    return {
      success: false,
      detail: '无法解析长按坐标：缺少合法的 start_box / point（0–1000 归一化坐标）。',
    };
  }

  await context.manager.longPress({
    action: 'long_press',
    x: point.x,
    y: point.y,
    button: DEFAULT_LONG_PRESS_BUTTON,
    ms: DEFAULT_LONG_PRESS_MS,
  });
  return { success: true, detail: `已长按 (${point.x}, ${point.y})` };
}

async function dragBetween(
  context: OperatorContext,
  args: Readonly<Record<string, unknown>>,
): Promise<GuiOperatorExecutionResult> {
  const from = resolveFirstPoint(context, args, ['start_box', 'start_point', 'from_box']);
  const to = resolveFirstPoint(context, args, ['end_box', 'end_point', 'to_box']);
  if (!from || !to) {
    return {
      success: false,
      detail: '无法解析拖拽坐标：需要同时提供合法的 start_box 与 end_box（0–1000 归一化坐标）。',
    };
  }

  await context.manager.drag({
    action: 'drag',
    fromX: from.x,
    fromY: from.y,
    toX: to.x,
    toY: to.y,
    button: DEFAULT_DRAG_BUTTON,
    ms: DEFAULT_DRAG_MS,
  });
  return { success: true, detail: `已从 (${from.x}, ${from.y}) 拖拽到 (${to.x}, ${to.y})` };
}

async function typeText(
  context: OperatorContext,
  args: Readonly<Record<string, unknown>>,
): Promise<GuiOperatorExecutionResult> {
  const text = readString(args['content']) ?? readString(args['text']);
  if (!text) {
    return {
      success: false,
      detail: '无法解析输入文本：缺少合法的 content 参数。',
    };
  }

  await context.manager.type({ action: 'type', text });
  return { success: true, detail: `已输入 ${text.length} 个字符` };
}

async function pressHotkey(
  context: OperatorContext,
  args: Readonly<Record<string, unknown>>,
): Promise<GuiOperatorExecutionResult> {
  const keys = readKeys(args['keys'] ?? args['key']);
  if (keys.length < 2) {
    return {
      success: false,
      detail: '无法解析组合键：keys 需包含至少 2 个按键（如 ctrl+c）。',
    };
  }

  await context.manager.hotkey({ action: 'hotkey', keys });
  return { success: true, detail: `已按下组合键 ${keys.join('+')}` };
}

async function scrollAt(
  context: OperatorContext,
  args: Readonly<Record<string, unknown>>,
): Promise<GuiOperatorExecutionResult> {
  const direction = (readString(args['direction']) ?? 'down').toLowerCase();
  let scrollX = readFiniteNumber(args['scrollX']) ?? 0;
  let scrollY = readFiniteNumber(args['scrollY']) ?? 0;

  if (scrollX === 0 && scrollY === 0) {
    switch (direction) {
      case 'down':
        scrollY = DEFAULT_SCROLL_STEP;
        break;
      case 'up':
        scrollY = -DEFAULT_SCROLL_STEP;
        break;
      case 'right':
        scrollX = DEFAULT_SCROLL_STEP;
        break;
      case 'left':
        scrollX = -DEFAULT_SCROLL_STEP;
        break;
      default:
        return {
          success: false,
          detail: `无法解析滚动方向：${direction}（支持 up / down / left / right）。`,
        };
    }
  }

  const point = resolveFirstPoint(context, args, ['start_box', 'point', 'box']);
  await context.manager.scroll(
    point
      ? { action: 'scroll', x: point.x, y: point.y, scrollX, scrollY }
      : { action: 'scroll', scrollX, scrollY },
  );
  return {
    success: true,
    detail: point ? `已在 (${point.x}, ${point.y}) 滚动` : '已滚动',
  };
}

async function waitFor(
  context: OperatorContext,
  args: Readonly<Record<string, unknown>>,
): Promise<GuiOperatorExecutionResult> {
  const rawMs = readFiniteNumber(args['ms'] ?? args['time'] ?? args['duration']) ?? DEFAULT_WAIT_MS;
  const ms = Math.min(MAX_WAIT_MS, Math.max(0, Math.round(rawMs)));

  await context.manager.wait({ action: 'wait', ms });
  return { success: true, detail: `已等待 ${ms} 毫秒` };
}

async function captureScreenshot(context: OperatorContext): Promise<GuiOperatorScreenshot> {
  const result = await context.manager.screenshot({ action: 'screenshot' });

  const dataBase64 = readScreenshotBase64(result);
  if (!dataBase64) {
    throw new Error('桌面截图结果缺少 base64 数据（data 字段）。');
  }

  const mediaType =
    readString(result['mediaType']) ?? readString(result['mimeType']) ?? 'image/png';
  // Rust 侧 ScreenshotResponse 未返回宽高，缺省时回退到注入的逻辑屏幕尺寸。
  const width = readPositiveNumber(result['width']) ?? context.screenSize.width;
  const height = readPositiveNumber(result['height']) ?? context.screenSize.height;

  return { dataBase64, mediaType, width, height };
}

/**
 * 把 `manager.status()` 的能力位映射为 {@link GuiOperatorCapabilities}。
 *
 * 当前 `GuiOperator` 接口本身不含 `capabilities()`，故以独立函数暴露，
 * 供上层做能力路由 / 降级，而不污染接口契约。
 */
export async function resolveDesktopControlCapabilities(
  manager: DesktopControlManager,
): Promise<GuiOperatorCapabilities> {
  const status = await manager.status();
  if (!status.enabled || !status.capabilities) {
    return { supportedActions: [] };
  }

  const { capabilities } = status;
  const supportedActions: string[] = [];
  if (capabilities.screenshot.available) supportedActions.push('screenshot');
  if (capabilities.click.available) {
    supportedActions.push('click', 'double_click', 'right_click');
  }
  if (capabilities.typeText.available) supportedActions.push('type');
  if (capabilities.hotkey.available) supportedActions.push('hotkey');
  if (capabilities.scroll.available) supportedActions.push('scroll');
  if (capabilities.wait.available) supportedActions.push('wait');
  if (capabilities.drag?.available) supportedActions.push('drag');
  if (capabilities.mouseMove?.available) supportedActions.push('mouse_move');
  if (capabilities.longPress?.available) supportedActions.push('long_press');

  return { supportedActions };
}

/**
 * 汇总动作参数：先合并 `params` 中的对象形态，再用 `raw` 解析出的命名参数补齐。
 * `raw` 的命名参数优先级更低，避免覆盖 Runner 显式传入的结构化参数。
 */
function readActionArgs(action: GuiParsedAction): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  for (const param of action.params) {
    if (param && typeof param === 'object' && !Array.isArray(param)) {
      Object.assign(args, param as Record<string, unknown>);
    }
  }

  const parsed = parseSingleAction(action.raw);
  if (parsed) {
    for (const [key, value] of Object.entries(parsed.args)) {
      if (!(key in args)) {
        args[key] = value;
      }
    }
  }

  return args;
}

/** 单点动作：依次尝试 start_box / point / box，最后回退到显式 x/y。 */
/**
 * 单点动作取点：**优先**使用 parser 已换算好的绝对像素（`start_coords` / `coords`），
 * 其次才回退到需要换算的 `start_box` / `point` / `box`，最后回退到显式 `x`/`y`。
 *
 * ⚠️ 坐标语义陷阱：`GuiAgentRunner` 重建的 `raw` 中，`start_box` 已被 `parseActionVlm`
 * **归一化为 0–1 比例**（实测 `click(start_box='(500,500)')` → `raw` 为
 * `start_box=[0.5,0.5,0.5,0.5]`），而同一条 `raw` 中的 `start_coords` 是绝对像素。
 * 若把 `start_box` 当作 0–1000 再换算，会得到亚像素坐标、点击落到屏幕左上角。
 * 因此这里把 `start_box` / `box` 一律按 **0–1 比例**解释（与 `raw` 的实际语义一致）。
 */
function resolveSinglePoint(
  context: OperatorContext,
  args: Readonly<Record<string, unknown>>,
): GuiPoint | null {
  // 1. parser 已算好的绝对像素（raw 中的 start_coords / end_coords / coords）
  const fromCoords = resolveFirstAbsolutePoint(context, args, [
    'start_coords',
    'coords',
    'end_coords',
  ]);
  if (fromCoords) {
    return fromCoords;
  }

  // 2. 归一化 box（0–1 比例，来自 raw）或显式 0–1000 box
  const fromBox = resolveFirstPoint(context, args, ['start_box', 'point', 'box']);
  if (fromBox) {
    return fromBox;
  }

  // 3. 显式 x / y
  const x = readFiniteNumber(args['x']);
  const y = readFiniteNumber(args['y']);
  if (x === null || y === null) {
    return null;
  }
  return pointToPixel({ x, y }, context.screenSize, { dpr: context.dpr });
}

/** 直接读取已是绝对像素的坐标数组（不做任何归一化换算）。 */
function resolveFirstAbsolutePoint(
  context: OperatorContext,
  args: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): GuiPoint | null {
  for (const key of keys) {
    const numbers = readNumbers(args[key]);
    if (!numbers) continue;

    if (numbers.length >= 2) {
      const x = numbers[0];
      const y = numbers[1];
      if (x === undefined || y === undefined) continue;
      if (numbers.length === 2) {
        return { x, y };
      }
      // 4 个数字：取中心；已是像素，故不再做归一化
      const x2 = numbers[2];
      const y2 = numbers[3];
      if (x2 === undefined || y2 === undefined) continue;
      return { x: (x + x2) / 2, y: (y + y2) / 2 };
    }
  }
  return null;
}

function resolveFirstPoint(
  context: OperatorContext,
  args: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): GuiPoint | null {
  for (const key of keys) {
    const point = resolvePixelPoint(args[key], context);
    if (point) {
      return point;
    }
  }
  return null;
}

function resolvePixelPoint(value: unknown, context: OperatorContext): GuiPoint | null {
  const numbers = readNumbers(value);
  if (!numbers) {
    return null;
  }

  if (numbers.length === 2) {
    const [x, y] = numbers;
    if (x === undefined || y === undefined) {
      return null;
    }
    // 单点（2 个数字）：走 pointToPixel，避免 boxCenter 对退化矩形的抛错。
    return pointToPixel({ x, y }, context.screenSize, { dpr: context.dpr });
  }

  if (numbers.length === 4) {
    const [x1, y1, x2, y2] = numbers;
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
      return null;
    }
    // 退化矩形（x1>=x2 或 y1>=y2，模型对"点"常见的输出）：按单点处理，
    // 避免 boxCenter 抛错（operator 契约要求失败以结果返回）。
    if (x1 >= x2 || y1 >= y2) {
      return pointToPixel({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 }, context.screenSize, {
        dpr: context.dpr,
      });
    }
    return safeBoxCenter([x1, y1, x2, y2], context);
  }

  return null;
}

function safeBoxCenter(box: GuiBox, context: OperatorContext): GuiPoint | null {
  try {
    return boxToPixelCenter(box, context.screenSize, { dpr: context.dpr });
  } catch {
    return null;
  }
}

/**
 * 解析坐标值：支持数字、数字数组，以及字符串形态
 * `"(500,500)"` / `"[x1,y1,x2,y2]"` / `"[\"1\",\"2\"]"`。
 * 非法或非有限数返回 null。
 */
function readNumbers(value: unknown): number[] | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [value] : null;
  }

  if (Array.isArray(value)) {
    const numbers = value.map((item) => Number(item));
    return numbers.length > 0 && numbers.every((item) => Number.isFinite(item)) ? numbers : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const stripped = value.replace(/["'()[\]{}]/g, '').trim();
  if (stripped.length === 0) {
    return null;
  }

  const parts = stripped
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }

  const numbers = parts.map((part) => Number(part));
  return numbers.every((item) => Number.isFinite(item)) ? numbers : null;
}

function readKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(/[+,]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function readScreenshotBase64(result: Readonly<Record<string, unknown>>): string | null {
  const candidates = [
    result['data'],
    result['screenshotBase64'],
    result['imageBase64'],
    result['base64'],
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = readFiniteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}
