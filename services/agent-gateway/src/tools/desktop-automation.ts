import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

export interface DesktopAutomationDriver {
  start(startUrl?: string): Promise<void>;
  isStarted(): boolean;
  goto(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  scroll(direction: DesktopAutomationScrollDirection, amount?: number): Promise<void>;
  wait(input: DesktopAutomationWaitInput): Promise<void>;
  content(): Promise<string>;
  snapshot(): Promise<DesktopAutomationSnapshot>;
  screenshot(): Promise<string>;
}

interface DesktopAutomationOptions {
  enabled: boolean;
  driver?: DesktopAutomationDriver;
}

export interface DesktopAutomationStatus {
  enabled: boolean;
  started: boolean;
}

interface BrowserAutomationRuntime {
  click(selector: string): Promise<unknown>;
  content(): Promise<string>;
  evaluate<T>(
    fn: string | ((...args: unknown[]) => T | Promise<T>),
    ...args: unknown[]
  ): Promise<T>;
  goBack(): Promise<unknown>;
  goForward(): Promise<unknown>;
  goto(url: string): Promise<unknown>;
  isStarted(): boolean;
  press(selector: string, key: string): Promise<unknown>;
  reload(): Promise<unknown>;
  screenshot(options?: { type?: 'png' }): Promise<string | Uint8Array>;
  snapshot(): Promise<DesktopAutomationSnapshot>;
  start(startUrl?: string): Promise<unknown>;
  type(selector: string, text: string): Promise<unknown>;
  waitForSelector(selector: string): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
}

type BrowserAutomationModule = {
  DesktopBrowserAutomation: new () => BrowserAutomationRuntime;
};

export interface DesktopAutomationManager {
  status(): Promise<DesktopAutomationStatus>;
  start(startUrl?: string): Promise<void>;
  goto(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  scroll(direction: DesktopAutomationScrollDirection, amount?: number): Promise<void>;
  wait(input: DesktopAutomationWaitInput): Promise<void>;
  content(): Promise<string>;
  snapshot(): Promise<DesktopAutomationSnapshot>;
  screenshot(): Promise<string>;
}

export type DesktopAutomationScrollDirection = 'up' | 'down';

export interface DesktopAutomationWaitInput {
  readonly ms?: number;
  readonly selector?: string;
}

export interface DesktopAutomationSnapshot {
  readonly currentPageId: string;
  readonly openPages: readonly string[];
  readonly url: string;
  readonly title: string;
}

const desktopAutomationStatusInputSchema = z.object({
  action: z.literal('status'),
});

const desktopAutomationStartInputSchema = z.object({
  action: z.literal('start'),
  url: z.string().url().optional(),
});

const desktopAutomationGotoInputSchema = z.object({
  action: z.literal('goto'),
  url: z.string().url(),
});

const desktopAutomationBackInputSchema = z.object({
  action: z.literal('back'),
});

const desktopAutomationForwardInputSchema = z.object({
  action: z.literal('forward'),
});

const desktopAutomationReloadInputSchema = z.object({
  action: z.literal('reload'),
});

const desktopAutomationClickInputSchema = z.object({
  action: z.literal('click'),
  selector: z.string().min(1),
});

const desktopAutomationTypeInputSchema = z.object({
  action: z.literal('type'),
  selector: z.string().min(1),
  text: z.string(),
});

const desktopAutomationPressInputSchema = z.object({
  action: z.literal('press'),
  selector: z.string().min(1),
  key: z.string().min(1),
});

const desktopAutomationScrollInputSchema = z.object({
  action: z.literal('scroll'),
  direction: z.enum(['up', 'down']).default('down'),
  amount: z.number().int().min(1).max(10000).optional(),
});

const desktopAutomationWaitInputSchema = z.object({
  action: z.literal('wait'),
  ms: z.number().int().min(0).max(60000).optional(),
  selector: z.string().min(1).optional(),
});

const desktopAutomationContentInputSchema = z.object({
  action: z.literal('content'),
});

const desktopAutomationSnapshotInputSchema = z.object({
  action: z.literal('snapshot'),
});

const desktopAutomationScreenshotInputSchema = z.object({
  action: z.literal('screenshot'),
});

const desktopAutomationToolInputSchema = z.discriminatedUnion('action', [
  desktopAutomationStatusInputSchema,
  desktopAutomationStartInputSchema,
  desktopAutomationGotoInputSchema,
  desktopAutomationBackInputSchema,
  desktopAutomationForwardInputSchema,
  desktopAutomationReloadInputSchema,
  desktopAutomationClickInputSchema,
  desktopAutomationTypeInputSchema,
  desktopAutomationPressInputSchema,
  desktopAutomationScrollInputSchema,
  desktopAutomationWaitInputSchema,
  desktopAutomationContentInputSchema,
  desktopAutomationSnapshotInputSchema,
  desktopAutomationScreenshotInputSchema,
]);

type DesktopAutomationToolInput = z.infer<typeof desktopAutomationToolInputSchema>;

export const desktopAutomationToolDefinition: ToolDefinition<
  typeof desktopAutomationToolInputSchema,
  z.ZodString
> = {
  name: 'desktop_automation',
  description:
    '通过统一的 action 接口控制桌面端专属的浏览器自动化运行时。仅在 gateway 作为桌面 sidecar 运行时可用。',
  inputSchema: desktopAutomationToolInputSchema,
  outputSchema: z.string(),
  timeout: 120000,
  execute: async () => {
    throw new Error('desktop_automation must execute through the gateway-managed sandbox path');
  },
};

class DesktopAutomationDriverImpl implements DesktopAutomationDriver {
  private desktop: BrowserAutomationRuntime | null = null;

  private async getDesktop(): Promise<BrowserAutomationRuntime> {
    if (!this.desktop) {
      const browserAutomation =
        (await import('@openAwork/browser-automation')) as BrowserAutomationModule;
      this.desktop = new browserAutomation.DesktopBrowserAutomation();
    }

    return this.desktop;
  }

  async start(startUrl?: string): Promise<void> {
    const desktop = await this.getDesktop();
    if (!desktop.isStarted()) {
      await desktop.start(startUrl);
      return;
    }
    if (startUrl) {
      await desktop.goto(startUrl);
    }
  }

  isStarted(): boolean {
    return this.desktop?.isStarted() ?? false;
  }

  async goto(url: string): Promise<void> {
    await (await this.getDesktop()).goto(url);
  }

  async back(): Promise<void> {
    await (await this.getDesktop()).goBack();
  }

  async forward(): Promise<void> {
    await (await this.getDesktop()).goForward();
  }

  async reload(): Promise<void> {
    await (await this.getDesktop()).reload();
  }

  async click(selector: string): Promise<void> {
    await (await this.getDesktop()).click(selector);
  }

  async type(selector: string, text: string): Promise<void> {
    await (await this.getDesktop()).type(selector, text);
  }

  async press(selector: string, key: string): Promise<void> {
    await (await this.getDesktop()).press(selector, key);
  }

  async scroll(direction: DesktopAutomationScrollDirection, amount = 800): Promise<void> {
    const deltaY = direction === 'up' ? -amount : amount;
    await (
      await this.getDesktop()
    ).evaluate((scrollDeltaY: unknown) => {
      if (typeof scrollDeltaY !== 'number') {
        return;
      }
      window.scrollBy(0, scrollDeltaY);
    }, deltaY);
  }

  async wait(input: DesktopAutomationWaitInput): Promise<void> {
    const desktop = await this.getDesktop();
    if (input.selector) {
      await desktop.waitForSelector(input.selector);
    }
    if (input.ms !== undefined && input.ms > 0) {
      await desktop.waitForTimeout(input.ms);
    }
  }

  async content(): Promise<string> {
    return (await this.getDesktop()).content();
  }

  async snapshot(): Promise<DesktopAutomationSnapshot> {
    return (await this.getDesktop()).snapshot();
  }

  async screenshot(): Promise<string> {
    const screenshot = await (await this.getDesktop()).screenshot({ type: 'png' });
    return typeof screenshot === 'string' ? screenshot : Buffer.from(screenshot).toString('base64');
  }
}

class DesktopAutomationManagerImpl implements DesktopAutomationManager {
  private readonly enabled: boolean;
  private readonly driver: DesktopAutomationDriver;

  constructor(options: DesktopAutomationOptions) {
    this.enabled = options.enabled;
    this.driver = options.driver ?? new DesktopAutomationDriverImpl();
  }

  async status(): Promise<DesktopAutomationStatus> {
    return { enabled: this.enabled, started: this.enabled && this.driver.isStarted() };
  }

  async start(startUrl?: string): Promise<void> {
    this.assertEnabled();
    await this.driver.start(startUrl);
  }

  async goto(url: string): Promise<void> {
    this.assertEnabled();
    await this.driver.goto(url);
  }

  async back(): Promise<void> {
    this.assertEnabled();
    await this.driver.back();
  }

  async forward(): Promise<void> {
    this.assertEnabled();
    await this.driver.forward();
  }

  async reload(): Promise<void> {
    this.assertEnabled();
    await this.driver.reload();
  }

  async click(selector: string): Promise<void> {
    this.assertEnabled();
    await this.driver.click(selector);
  }

  async type(selector: string, text: string): Promise<void> {
    this.assertEnabled();
    await this.driver.type(selector, text);
  }

  async press(selector: string, key: string): Promise<void> {
    this.assertEnabled();
    await this.driver.press(selector, key);
  }

  async scroll(direction: DesktopAutomationScrollDirection, amount?: number): Promise<void> {
    this.assertEnabled();
    await this.driver.scroll(direction, amount);
  }

  async wait(input: DesktopAutomationWaitInput): Promise<void> {
    this.assertEnabled();
    await this.driver.wait(input);
  }

  async content(): Promise<string> {
    this.assertEnabled();
    return this.driver.content();
  }

  async snapshot(): Promise<DesktopAutomationSnapshot> {
    this.assertEnabled();
    return this.driver.snapshot();
  }

  async screenshot(): Promise<string> {
    this.assertEnabled();
    return this.driver.screenshot();
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new Error('desktop-only automation is disabled in this runtime');
    }
  }
}

export function createDesktopAutomationManager(
  options: DesktopAutomationOptions,
): DesktopAutomationManager {
  return new DesktopAutomationManagerImpl(options);
}

export const desktopAutomationManager = createDesktopAutomationManager({
  enabled: process.env['DESKTOP_AUTOMATION'] === '1',
});

export async function runDesktopAutomationTool(
  input: DesktopAutomationToolInput,
  manager: DesktopAutomationManager = desktopAutomationManager,
): Promise<string> {
  switch (input.action) {
    case 'status': {
      return JSON.stringify(await manager.status());
    }
    case 'start': {
      await manager.start(input.url);
      return JSON.stringify({ ok: true });
    }
    case 'goto': {
      await manager.goto(input.url);
      return JSON.stringify({ ok: true });
    }
    case 'back': {
      await manager.back();
      return JSON.stringify({ ok: true });
    }
    case 'forward': {
      await manager.forward();
      return JSON.stringify({ ok: true });
    }
    case 'reload': {
      await manager.reload();
      return JSON.stringify({ ok: true });
    }
    case 'click': {
      await manager.click(input.selector);
      return JSON.stringify({ ok: true });
    }
    case 'type': {
      await manager.type(input.selector, input.text);
      return JSON.stringify({ ok: true });
    }
    case 'press': {
      await manager.press(input.selector, input.key);
      return JSON.stringify({ ok: true });
    }
    case 'scroll': {
      await manager.scroll(input.direction, input.amount);
      return JSON.stringify({ ok: true });
    }
    case 'wait': {
      await manager.wait({ ms: input.ms, selector: input.selector });
      return JSON.stringify({ ok: true });
    }
    case 'content': {
      return JSON.stringify({ content: await manager.content() });
    }
    case 'snapshot': {
      return JSON.stringify({ snapshot: await manager.snapshot() });
    }
    case 'screenshot': {
      return JSON.stringify({ screenshotBase64: await manager.screenshot() });
    }
  }

  const exhaustive: never = input;
  return exhaustive;
}
