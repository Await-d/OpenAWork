import type { ToolDefinition } from '@openAwork/agent-core';
import { DesktopBrowserAutomation } from '@openAwork/browser-automation';
import { z } from 'zod';

export interface DesktopAutomationDriver {
  start(startUrl?: string): Promise<void>;
  isStarted(): boolean;
  goto(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
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

export interface DesktopAutomationManager {
  status(): Promise<DesktopAutomationStatus>;
  start(startUrl?: string): Promise<void>;
  goto(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  screenshot(): Promise<string>;
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

const desktopAutomationClickInputSchema = z.object({
  action: z.literal('click'),
  selector: z.string().min(1),
});

const desktopAutomationTypeInputSchema = z.object({
  action: z.literal('type'),
  selector: z.string().min(1),
  text: z.string(),
});

const desktopAutomationScreenshotInputSchema = z.object({
  action: z.literal('screenshot'),
});

const desktopAutomationToolInputSchema = z.discriminatedUnion('action', [
  desktopAutomationStatusInputSchema,
  desktopAutomationStartInputSchema,
  desktopAutomationGotoInputSchema,
  desktopAutomationClickInputSchema,
  desktopAutomationTypeInputSchema,
  desktopAutomationScreenshotInputSchema,
]);

type DesktopAutomationToolInput = z.infer<typeof desktopAutomationToolInputSchema>;

export const desktopAutomationToolDefinition: ToolDefinition<
  typeof desktopAutomationToolInputSchema,
  z.ZodString
> = {
  name: 'desktop_automation',
  description:
    'Control the desktop-only browser automation runtime through a single action-based interface. Use only when the gateway is running as the desktop sidecar.',
  inputSchema: desktopAutomationToolInputSchema,
  outputSchema: z.string(),
  timeout: 120000,
  execute: async () => {
    throw new Error('desktop_automation must execute through the gateway-managed sandbox path');
  },
};

class DesktopAutomationDriverImpl implements DesktopAutomationDriver {
  constructor(private readonly desktop = new DesktopBrowserAutomation()) {}

  async start(startUrl?: string): Promise<void> {
    if (!this.desktop.isStarted()) {
      await this.desktop.start(startUrl);
      return;
    }
    if (startUrl) {
      await this.desktop.goto(startUrl);
    }
  }

  isStarted(): boolean {
    return this.desktop.isStarted();
  }

  async goto(url: string): Promise<void> {
    await this.desktop.goto(url);
  }

  async click(selector: string): Promise<void> {
    await this.desktop.click(selector);
  }

  async type(selector: string, text: string): Promise<void> {
    await this.desktop.type(selector, text);
  }

  async screenshot(): Promise<string> {
    const screenshot = await this.desktop.screenshot({ type: 'png' });
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

  async click(selector: string): Promise<void> {
    this.assertEnabled();
    await this.driver.click(selector);
  }

  async type(selector: string, text: string): Promise<void> {
    this.assertEnabled();
    await this.driver.type(selector, text);
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
    case 'click': {
      await manager.click(input.selector);
      return JSON.stringify({ ok: true });
    }
    case 'type': {
      await manager.type(input.selector, input.text);
      return JSON.stringify({ ok: true });
    }
    case 'screenshot': {
      return JSON.stringify({ screenshotBase64: await manager.screenshot() });
    }
  }
}
