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

export interface DesktopControlManager {
  status(): Promise<DesktopControlStatus>;
  screenshot(input: DesktopControlScreenshotInput): Promise<DesktopControlActionResult>;
  click(input: DesktopControlClickInput): Promise<DesktopControlActionResult>;
  type(input: DesktopControlTypeInput): Promise<DesktopControlActionResult>;
  key(input: DesktopControlKeyInput): Promise<DesktopControlActionResult>;
  hotkey(input: DesktopControlHotkeyInput): Promise<DesktopControlActionResult>;
  scroll(input: DesktopControlScrollInput): Promise<DesktopControlActionResult>;
  wait(input: DesktopControlWaitInput): Promise<DesktopControlActionResult>;
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

const desktopControlClickInputSchema = z.object({
  action: z.literal('click'),
  x: z.number().finite(),
  y: z.number().finite(),
  button: z.enum(['left', 'right', 'middle']).default('left'),
  clickAction: z.enum(['click', 'double_click', 'down', 'up']).default('click'),
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

const desktopControlToolInputSchema = z.discriminatedUnion('action', [
  desktopControlStatusInputSchema,
  desktopControlScreenshotInputSchema,
  desktopControlClickInputSchema,
  desktopControlTypeInputSchema,
  desktopControlKeyInputSchema,
  desktopControlHotkeyInputSchema,
  desktopControlScrollInputSchema,
  desktopControlWaitInputSchema,
]);

type DesktopControlToolInput = z.infer<typeof desktopControlToolInputSchema>;
export type DesktopControlScreenshotInput = z.infer<typeof desktopControlScreenshotInputSchema>;
export type DesktopControlClickInput = z.infer<typeof desktopControlClickInputSchema>;
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
    '通过桌面端本机桥控制系统桌面：截图、坐标点击、文本/按键/组合键输入、滚动和等待。仅在桌面端本机运行时可用。',
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
      return JSON.stringify(await manager.click(input));
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
  }

  const exhaustive: never = input;
  return exhaustive;
}
