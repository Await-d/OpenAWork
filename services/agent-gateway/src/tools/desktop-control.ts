import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { readBridgeErrorMessage } from './desktop-control-bridge-error.js';
import {
  desktopControlBridgeStatusSchema,
  type DesktopControlStatus,
} from './desktop-control-status.js';

const DESKTOP_CONTROL_DISABLED_MESSAGE = 'desktop control is disabled in this runtime';

type DesktopControlFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type DesktopControlActionResult = Readonly<Record<string, unknown>>;

export type DesktopControlMouseButton = 'left' | 'right' | 'middle';
export type DesktopControlClickAction = 'click' | 'double_click' | 'down' | 'up';

// 鼠标按下/抬起不单独暴露 press/release 动作，继续由 click 的
// clickAction: 'down' | 'up' 承担；long_press 只是 down + wait + up 的语法糖。

// manager 层输入：x/y 一定已解析完成。工具层的 box / 可选 x/y 会在
// runDesktopControlTool 中先经 resolvePointInput 归一，再调用这些方法。
export interface DesktopControlClickInput {
  readonly action: 'click';
  readonly x: number;
  readonly y: number;
  readonly button: DesktopControlMouseButton;
  readonly clickAction: DesktopControlClickAction;
}

export interface DesktopControlMouseMoveInput {
  readonly action: 'mouse_move';
  readonly x: number;
  readonly y: number;
}

export interface DesktopControlLongPressInput {
  readonly action: 'long_press';
  readonly x: number;
  readonly y: number;
  readonly button: DesktopControlMouseButton;
  readonly ms: number;
}

export interface DesktopControlManager {
  status(): Promise<DesktopControlStatus>;
  screenshot(input: DesktopControlScreenshotInput): Promise<DesktopControlActionResult>;
  click(input: DesktopControlClickInput): Promise<DesktopControlActionResult>;
  type(input: DesktopControlTypeInput): Promise<DesktopControlActionResult>;
  key(input: DesktopControlKeyInput): Promise<DesktopControlActionResult>;
  hotkey(input: DesktopControlHotkeyInput): Promise<DesktopControlActionResult>;
  scroll(input: DesktopControlScrollInput): Promise<DesktopControlActionResult>;
  wait(input: DesktopControlWaitInput): Promise<DesktopControlActionResult>;
  drag(input: DesktopControlDragInput): Promise<DesktopControlActionResult>;
  mouseMove(input: DesktopControlMouseMoveInput): Promise<DesktopControlActionResult>;
  longPress(input: DesktopControlLongPressInput): Promise<DesktopControlActionResult>;
}

interface DesktopControlManagerOptions {
  readonly bridgeUrl?: string;
  readonly token?: string;
  readonly fetchImpl?: DesktopControlFetch;
}

const desktopControlStatusInputSchema = z.object({
  action: z.literal('status'),
});

const desktopControlScreenshotInputSchema = z.object({
  action: z.literal('screenshot'),
  delayMs: z.number().int().min(0).max(5000).optional(),
});

// box 是「绝对截图像素」的 [x1, y1, x2, y2]，落点取矩形中心。
// 注意：0–1000 归一化坐标换算属于 Phase 1（只有 GUI Runner 才知道逻辑截图尺寸），本任务不做。
const desktopControlBoxSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

const desktopControlMouseButtonSchema = z.enum(['left', 'right', 'middle']);
const desktopControlClickActionSchema = z.enum(['click', 'double_click', 'down', 'up']);

const desktopControlClickInputSchema = z.object({
  action: z.literal('click'),
  // x/y 与 box 二选一，由 union 级 superRefine 统一强制校验。
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  box: desktopControlBoxSchema.optional(),
  button: desktopControlMouseButtonSchema.default('left'),
  clickAction: desktopControlClickActionSchema.default('click'),
});

const desktopControlTypeInputSchema = z.object({
  action: z.literal('type'),
  text: z.string().min(1),
});

const desktopControlKeyInputSchema = z.object({
  action: z.literal('key'),
  key: z.string().min(1),
});

const desktopControlHotkeyInputSchema = z.object({
  action: z.literal('hotkey'),
  keys: z.array(z.string().min(1)).min(2).max(4),
});

const desktopControlScrollInputSchema = z.object({
  action: z.literal('scroll'),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  scrollX: z.number().finite().default(0),
  scrollY: z.number().finite().default(0),
});

const desktopControlWaitInputSchema = z.object({
  action: z.literal('wait'),
  ms: z.number().int().min(0).max(10000).default(2000),
});

const desktopControlDragInputSchema = z.object({
  action: z.literal('drag'),
  fromX: z.number().finite(),
  fromY: z.number().finite(),
  toX: z.number().finite(),
  toY: z.number().finite(),
  button: desktopControlMouseButtonSchema.default('left'),
  ms: z.number().int().min(0).max(5000).default(300),
});

const desktopControlMouseMoveInputSchema = z.object({
  action: z.literal('mouse_move'),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  box: desktopControlBoxSchema.optional(),
});

const desktopControlLongPressInputSchema = z.object({
  action: z.literal('long_press'),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  box: desktopControlBoxSchema.optional(),
  button: desktopControlMouseButtonSchema.default('left'),
  ms: z.number().int().min(100).max(10000).default(800),
});

const desktopControlActionUnionSchema = z.discriminatedUnion('action', [
  desktopControlStatusInputSchema,
  desktopControlScreenshotInputSchema,
  desktopControlClickInputSchema,
  desktopControlTypeInputSchema,
  desktopControlKeyInputSchema,
  desktopControlHotkeyInputSchema,
  desktopControlScrollInputSchema,
  desktopControlWaitInputSchema,
  desktopControlDragInputSchema,
  desktopControlMouseMoveInputSchema,
  desktopControlLongPressInputSchema,
]);

type DesktopControlPointActionInput =
  | z.infer<typeof desktopControlClickInputSchema>
  | z.infer<typeof desktopControlMouseMoveInputSchema>
  | z.infer<typeof desktopControlLongPressInputSchema>;

// discriminatedUnion 的成员必须是 ZodObject，成员上一旦挂 refine 就会退化成
// ZodEffects 而无法参与判别，因此「box 与 x/y 二选一 + box 形状合法」放在 union 层统一校验。
function refineDesktopControlPointInput(
  value: DesktopControlPointActionInput,
  ctx: z.RefinementCtx,
): void {
  const hasBox = value.box !== undefined;
  const hasX = value.x !== undefined;
  const hasY = value.y !== undefined;

  if (hasBox && (hasX || hasY)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['box'],
      message: 'box 与 x/y 只能二选一。',
    });
    return;
  }

  if (!hasBox && !(hasX && hasY)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['x'],
      message: '必须提供 box，或同时提供 x 与 y。',
    });
    return;
  }

  if (value.box !== undefined) {
    const [x1, y1, x2, y2] = value.box;
    if (!(x1 < x2 && y1 < y2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['box'],
        message: 'box 必须满足 x1 < x2 且 y1 < y2。',
      });
    }
  }
}

const desktopControlToolInputSchema = desktopControlActionUnionSchema.superRefine((value, ctx) => {
  if (value.action === 'click' || value.action === 'mouse_move' || value.action === 'long_press') {
    refineDesktopControlPointInput(value, ctx);
  }
});

type DesktopControlToolInput = z.infer<typeof desktopControlToolInputSchema>;
export type DesktopControlScreenshotInput = z.infer<typeof desktopControlScreenshotInputSchema>;
export type DesktopControlDragInput = z.infer<typeof desktopControlDragInputSchema>;
export type DesktopControlTypeInput = z.infer<typeof desktopControlTypeInputSchema>;
export type DesktopControlKeyInput = z.infer<typeof desktopControlKeyInputSchema>;
export type DesktopControlHotkeyInput = z.infer<typeof desktopControlHotkeyInputSchema>;
export type DesktopControlScrollInput = z.infer<typeof desktopControlScrollInputSchema>;
export type DesktopControlWaitInput = z.infer<typeof desktopControlWaitInputSchema>;

const desktopControlBridgeResultSchema = z.record(z.unknown());
export const desktopControlToolDefinition: ToolDefinition<
  typeof desktopControlToolInputSchema,
  z.ZodString
> = {
  name: 'desktop_control',
  description:
    '通过桌面端本机桥控制系统桌面：截图、坐标点击、鼠标移动、拖拽、长按、文本/按键/组合键输入、滚动和等待。' +
    '坐标可用绝对像素 x/y，也可用 box（[x1,y1,x2,y2] 绝对截图像素矩形，取中心点；与 x/y 二选一）。' +
    '鼠标按下/抬起请使用 click 的 clickAction: down/up，不提供独立的 press/release。' +
    '仅在桌面端本机运行时可用。',
  inputSchema: desktopControlToolInputSchema,
  outputSchema: z.string(),
  timeout: 120000,
  execute: async () => {
    throw new Error('desktop_control must execute through the gateway-managed sandbox path');
  },
};

class DesktopControlManagerImpl implements DesktopControlManager {
  private readonly bridgeUrl: string | null;
  private readonly token: string | null;
  private readonly fetchImpl: DesktopControlFetch;

  constructor(options: DesktopControlManagerOptions) {
    this.bridgeUrl = normalizeBridgeUrl(options.bridgeUrl);
    this.token = normalizeToken(options.token);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async status(): Promise<DesktopControlStatus> {
    if (!this.bridgeUrl) {
      return { enabled: false, reason: 'OPENAWORK_DESKTOP_CONTROL_URL 未配置。' };
    }
    if (!this.token) {
      return { enabled: false, reason: 'OPENAWORK_DESKTOP_CONTROL_TOKEN 未配置。' };
    }

    try {
      const response = await this.fetchImpl(`${this.bridgeUrl}/status`, {
        headers: {
          authorization: `Bearer ${this.token}`,
        },
      });
      if (!response.ok) {
        return {
          enabled: false,
          reason: `desktop control bridge status failed with HTTP ${response.status}`,
        };
      }
      return desktopControlBridgeStatusSchema.parse(await response.json());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        enabled: false,
        reason: message.length > 0 ? message : 'desktop control bridge unavailable',
      };
    }
  }

  async screenshot(input: DesktopControlScreenshotInput): Promise<DesktopControlActionResult> {
    return this.callBridge('screenshot', { delayMs: input.delayMs });
  }

  async click(input: DesktopControlClickInput): Promise<DesktopControlActionResult> {
    return this.callBridge('click', {
      x: input.x,
      y: input.y,
      button: input.button,
      action: input.clickAction,
    });
  }

  async type(input: DesktopControlTypeInput): Promise<DesktopControlActionResult> {
    return this.callBridge('type', { text: input.text });
  }

  async key(input: DesktopControlKeyInput): Promise<DesktopControlActionResult> {
    return this.callBridge('key', { key: input.key });
  }

  async hotkey(input: DesktopControlHotkeyInput): Promise<DesktopControlActionResult> {
    return this.callBridge('hotkey', { keys: input.keys });
  }

  async scroll(input: DesktopControlScrollInput): Promise<DesktopControlActionResult> {
    return this.callBridge('scroll', {
      x: input.x,
      y: input.y,
      scrollX: input.scrollX,
      scrollY: input.scrollY,
    });
  }

  async wait(input: DesktopControlWaitInput): Promise<DesktopControlActionResult> {
    return this.callBridge('wait', { ms: input.ms });
  }

  async drag(input: DesktopControlDragInput): Promise<DesktopControlActionResult> {
    return this.callBridge('drag', {
      fromX: input.fromX,
      fromY: input.fromY,
      toX: input.toX,
      toY: input.toY,
      button: input.button,
      ms: input.ms,
    });
  }

  async mouseMove(input: DesktopControlMouseMoveInput): Promise<DesktopControlActionResult> {
    return this.callBridge('mouse_move', { x: input.x, y: input.y });
  }

  async longPress(input: DesktopControlLongPressInput): Promise<DesktopControlActionResult> {
    return this.callBridge('long_press', {
      x: input.x,
      y: input.y,
      button: input.button,
      ms: input.ms,
    });
  }

  private async callBridge(
    action: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<DesktopControlActionResult> {
    const status = await this.status();
    if (!status.enabled || !this.bridgeUrl || !this.token) {
      throw new Error(DESKTOP_CONTROL_DISABLED_MESSAGE);
    }

    const response = await this.fetchImpl(`${this.bridgeUrl}/actions/${action}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const message = await readBridgeErrorMessage(response);
      throw new Error(message || `desktop control bridge failed with HTTP ${response.status}`);
    }

    return desktopControlBridgeResultSchema.parse(await response.json());
  }
}

function normalizeBridgeUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, '');
}

function normalizeToken(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function createDesktopControlManager(
  options: DesktopControlManagerOptions,
): DesktopControlManager {
  return new DesktopControlManagerImpl(options);
}

export const desktopControlManager = createDesktopControlManager({
  bridgeUrl: process.env['OPENAWORK_DESKTOP_CONTROL_URL'],
  token: process.env['OPENAWORK_DESKTOP_CONTROL_TOKEN'],
});

interface DesktopControlPointSource {
  readonly x?: number;
  readonly y?: number;
  readonly box?: readonly [number, number, number, number];
}

// 工具层坐标输入统一入口：box 取中心，x/y 直接透传，保证下游 manager 一定拿到确定的 x/y。
// box 目前是绝对截图像素；0–1000 归一化换算属于 Phase 1。
function resolvePointInput(input: DesktopControlPointSource): {
  readonly x: number;
  readonly y: number;
} {
  if (input.box) {
    const [x1, y1, x2, y2] = input.box;
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }
  if (typeof input.x === 'number' && typeof input.y === 'number') {
    return { x: input.x, y: input.y };
  }
  throw new Error('desktop control requires box or both x and y');
}

export async function runDesktopControlTool(
  input: DesktopControlToolInput,
  manager: DesktopControlManager = desktopControlManager,
): Promise<string> {
  switch (input.action) {
    case 'status': {
      return JSON.stringify(await manager.status());
    }
    case 'screenshot': {
      return JSON.stringify(await manager.screenshot(input));
    }
    case 'click': {
      const point = resolvePointInput(input);
      return JSON.stringify(
        await manager.click({
          action: 'click',
          x: point.x,
          y: point.y,
          button: input.button,
          clickAction: input.clickAction,
        }),
      );
    }
    case 'type': {
      return JSON.stringify(await manager.type(input));
    }
    case 'key': {
      return JSON.stringify(await manager.key(input));
    }
    case 'hotkey': {
      return JSON.stringify(await manager.hotkey(input));
    }
    case 'scroll': {
      return JSON.stringify(await manager.scroll(input));
    }
    case 'wait': {
      return JSON.stringify(await manager.wait(input));
    }
    case 'drag': {
      return JSON.stringify(await manager.drag(input));
    }
    case 'mouse_move': {
      const point = resolvePointInput(input);
      return JSON.stringify(
        await manager.mouseMove({ action: 'mouse_move', x: point.x, y: point.y }),
      );
    }
    case 'long_press': {
      const point = resolvePointInput(input);
      return JSON.stringify(
        await manager.longPress({
          action: 'long_press',
          x: point.x,
          y: point.y,
          button: input.button,
          ms: input.ms,
        }),
      );
    }
  }

  const exhaustive: never = input;
  return exhaustive;
}
