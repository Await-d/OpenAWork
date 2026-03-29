import { DesktopBrowserAutomation } from '@openAwork/browser-automation';

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
