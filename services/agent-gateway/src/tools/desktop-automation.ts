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
  press(selector: string | undefined, key: string): Promise<void>;
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
  press(selector: string | undefined, key: string): Promise<unknown>;
  reload(): Promise<unknown>;
  screenshot(options?: { type?: 'png' }): Promise<string | Uint8Array>;
  snapshot(): Promise<DesktopAutomationSnapshot>;
  start(startUrl?: string): Promise<unknown>;
  type(selector: string, text: string): Promise<unknown>;
  waitForSelector(selector: string): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
}

interface BrowserAutomationLaunchOptions {
  executablePath?: string;
}

interface BrowserAutomationStartOptions {
  launchOptions?: BrowserAutomationLaunchOptions;
}

type BrowserAutomationProbeSource =
  | 'managed'
  | 'override'
  | 'system-chrome'
  | 'system-chromium'
  | 'system-edge'
  | 'system-brave'
  | 'system-vivaldi'
  | 'system-opera';

interface BrowserAutomationProbeResult {
  available: boolean;
  source: BrowserAutomationProbeSource | null;
  executablePath: string | null;
  reason: string;
  installable: boolean;
}

type BrowserAutomationProbe = () => Promise<BrowserAutomationProbeResult>;

type BrowserAutomationModule = {
  DesktopBrowserAutomation: new (
    options?: BrowserAutomationStartOptions,
  ) => BrowserAutomationRuntime;
  probeLiveBrowserAvailability: BrowserAutomationProbe;
};

/**
 * 与 `browser-live/manager.ts` 的 `buildSessionOptions` 保持同一来源不对称策略：
 * - `override` / `system-*`：显式传 `executablePath`，让 Playwright 直接启动该二进制；
 * - `managed`：省略 `executablePath`，交给 Playwright 按自身修订号解析与校验。
 */
function buildBrowserStartOptions(
  probe: BrowserAutomationProbeResult,
): BrowserAutomationStartOptions {
  if (probe.source !== null && probe.source !== 'managed' && probe.executablePath) {
    return { launchOptions: { executablePath: probe.executablePath } };
  }
  return {};
}

function buildBrowserUnavailableError(probe: BrowserAutomationProbeResult): Error {
  return new Error(
    `desktop_automation 无法启动：未找到可用的 Chromium 系浏览器（原因：${probe.reason}）。` +
      '请在聊天浏览器预览面板点击「安装调试浏览器」完成安装，' +
      '或安装 Google Chrome / Microsoft Edge，或在终端执行 npx playwright install chromium。',
  );
}

/** Playwright 托管浏览器缺失/残缺时抛出的原始错误特征。 */
const PLAYWRIGHT_MISSING_BROWSER_PATTERN = /Executable doesn't exist|playwright install/i;

/**
 * 收口 `browserType.launch()` 的残留失败：把 Playwright 原始的
 * “run npx playwright install” 文案替换为可操作的引导；其他错误保持原样。
 */
function wrapBrowserLaunchError(error: unknown): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  if (!PLAYWRIGHT_MISSING_BROWSER_PATTERN.test(cause.message)) {
    return cause;
  }
  return new Error(
    'desktop_automation 启动浏览器失败：托管 Playwright 浏览器缺失或安装不完整。' +
      '请在聊天浏览器预览面板点击「安装调试浏览器」重新安装，' +
      '或安装 Google Chrome / Microsoft Edge，或在终端执行 npx playwright install chromium。' +
      `原始错误：${cause.message}`,
  );
}

export interface DesktopAutomationManager {
  status(): Promise<DesktopAutomationStatus>;
  start(startUrl?: string): Promise<void>;
  goto(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  press(selector: string | undefined, key: string): Promise<void>;
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
  selector: z.string().min(1).optional(),
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
    '通过统一的 action 接口控制桌面端专属的浏览器自动化运行时。仅在 gateway 作为桌面 sidecar 运行时可用。' +
    'press 动作省略 selector 时执行全局（页面级）按键，提供 selector 时执行元素级按键。',
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
      const probe = await browserAutomation.probeLiveBrowserAvailability();
      if (!probe.available) {
        throw buildBrowserUnavailableError(probe);
      }
      this.desktop = new browserAutomation.DesktopBrowserAutomation(
        buildBrowserStartOptions(probe),
      );
    }

    return this.desktop;
  }

  async start(startUrl?: string): Promise<void> {
    const desktop = await this.getDesktop();
    if (!desktop.isStarted()) {
      try {
        await desktop.start(startUrl);
      } catch (error) {
        throw wrapBrowserLaunchError(error);
      }
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

  async press(selector: string | undefined, key: string): Promise<void> {
    const desktop = await this.getDesktop();
    if (typeof selector === 'string' && selector.length > 0) {
      await desktop.press(selector, key);
      return;
    }
    await desktop.press(undefined, key);
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

  async press(selector: string | undefined, key: string): Promise<void> {
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
