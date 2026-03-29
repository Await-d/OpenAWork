import type {
  BrowserAutomationSnapshot,
  ClickOptions,
  DesktopBrowserAutomation,
  FillOptions,
  NavigateOptions,
  SelectOptions,
  StartBrowserAutomationOptions,
  SupportedBrowserEngine,
  TypeTextOptions,
  WaitForSelectorOptions,
} from './index.js';

export type BrowserProxyCommand =
  | { type: 'start'; options?: StartBrowserAutomationOptions }
  | { type: 'close' }
  | { type: 'isStarted' }
  | { type: 'newPage'; url?: string }
  | { type: 'switchToPage'; pageId: string }
  | { type: 'closePage'; pageId: string }
  | { type: 'listPageIds' }
  | { type: 'getEngine' }
  | { type: 'snapshot' }
  | { type: 'goto'; url: string; options?: NavigateOptions }
  | { type: 'reload'; options?: NavigateOptions }
  | { type: 'goBack'; options?: NavigateOptions }
  | { type: 'goForward'; options?: NavigateOptions }
  | { type: 'waitForSelector'; selector: string; options?: WaitForSelectorOptions }
  | { type: 'waitForTimeout'; ms: number }
  | { type: 'click'; selector: string; options?: ClickOptions }
  | { type: 'dblClick'; selector: string; options?: Omit<ClickOptions, 'clickCount'> }
  | { type: 'fill'; selector: string; value: string; options?: FillOptions }
  | { type: 'type'; selector: string; value: string; options?: TypeTextOptions }
  | { type: 'press'; selector: string; key: string; options?: TypeTextOptions }
  | { type: 'check'; selector: string; options?: ClickOptions }
  | { type: 'uncheck'; selector: string; options?: ClickOptions }
  | {
      type: 'hover';
      selector: string;
      options?: Omit<ClickOptions, 'clickCount' | 'button' | 'delay'>;
    }
  | { type: 'focus'; selector: string }
  | { type: 'selectOption'; selector: string; values: string | string[]; options?: SelectOptions }
  | { type: 'textContent'; selector: string }
  | { type: 'innerText'; selector: string }
  | { type: 'getAttribute'; selector: string; name: string }
  | { type: 'currentUrl' }
  | { type: 'currentTitle' }
  | { type: 'content' }
  | { type: 'screenshot'; options?: { path?: string; fullPage?: boolean; type?: 'png' | 'jpeg' } };

export interface BrowserAutomationProxyTransport {
  execute<T = unknown>(command: BrowserProxyCommand): Promise<T>;
}

export class MobileBrowserAutomationProxy {
  constructor(private readonly transport: BrowserAutomationProxyTransport) {}

  async start(options?: StartBrowserAutomationOptions): Promise<void> {
    await this.transport.execute({ type: 'start', options });
  }

  async close(): Promise<void> {
    await this.transport.execute({ type: 'close' });
  }

  async isStarted(): Promise<boolean> {
    return this.transport.execute<boolean>({ type: 'isStarted' });
  }

  async newPage(url?: string): Promise<string> {
    return this.transport.execute<string>({ type: 'newPage', url });
  }

  async switchToPage(pageId: string): Promise<void> {
    await this.transport.execute({ type: 'switchToPage', pageId });
  }

  async closePage(pageId: string): Promise<void> {
    await this.transport.execute({ type: 'closePage', pageId });
  }

  async listPageIds(): Promise<string[]> {
    return this.transport.execute<string[]>({ type: 'listPageIds' });
  }

  async getEngine(): Promise<SupportedBrowserEngine> {
    return this.transport.execute<SupportedBrowserEngine>({ type: 'getEngine' });
  }

  async snapshot(): Promise<BrowserAutomationSnapshot> {
    return this.transport.execute<BrowserAutomationSnapshot>({ type: 'snapshot' });
  }

  async goto(url: string, options?: NavigateOptions): Promise<void> {
    await this.transport.execute({ type: 'goto', url, options });
  }

  async reload(options?: NavigateOptions): Promise<void> {
    await this.transport.execute({ type: 'reload', options });
  }

  async goBack(options?: NavigateOptions): Promise<void> {
    await this.transport.execute({ type: 'goBack', options });
  }

  async goForward(options?: NavigateOptions): Promise<void> {
    await this.transport.execute({ type: 'goForward', options });
  }

  async waitForSelector(selector: string, options?: WaitForSelectorOptions): Promise<void> {
    await this.transport.execute({ type: 'waitForSelector', selector, options });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.transport.execute({ type: 'waitForTimeout', ms });
  }

  async click(selector: string, options?: ClickOptions): Promise<void> {
    await this.transport.execute({ type: 'click', selector, options });
  }

  async dblClick(selector: string, options?: Omit<ClickOptions, 'clickCount'>): Promise<void> {
    await this.transport.execute({ type: 'dblClick', selector, options });
  }

  async fill(selector: string, value: string, options?: FillOptions): Promise<void> {
    await this.transport.execute({ type: 'fill', selector, value, options });
  }

  async type(selector: string, value: string, options?: TypeTextOptions): Promise<void> {
    await this.transport.execute({ type: 'type', selector, value, options });
  }

  async press(selector: string, key: string, options?: TypeTextOptions): Promise<void> {
    await this.transport.execute({ type: 'press', selector, key, options });
  }

  async check(selector: string, options?: ClickOptions): Promise<void> {
    await this.transport.execute({ type: 'check', selector, options });
  }

  async uncheck(selector: string, options?: ClickOptions): Promise<void> {
    await this.transport.execute({ type: 'uncheck', selector, options });
  }

  async hover(
    selector: string,
    options?: Omit<ClickOptions, 'clickCount' | 'button' | 'delay'>,
  ): Promise<void> {
    await this.transport.execute({ type: 'hover', selector, options });
  }

  async focus(selector: string): Promise<void> {
    await this.transport.execute({ type: 'focus', selector });
  }

  async selectOption(
    selector: string,
    values: string | string[],
    options?: SelectOptions,
  ): Promise<string[]> {
    return this.transport.execute<string[]>({ type: 'selectOption', selector, values, options });
  }

  async textContent(selector: string): Promise<string | null> {
    return this.transport.execute<string | null>({ type: 'textContent', selector });
  }

  async innerText(selector: string): Promise<string> {
    return this.transport.execute<string>({ type: 'innerText', selector });
  }

  async getAttribute(selector: string, name: string): Promise<string | null> {
    return this.transport.execute<string | null>({ type: 'getAttribute', selector, name });
  }

  async currentUrl(): Promise<string> {
    return this.transport.execute<string>({ type: 'currentUrl' });
  }

  async currentTitle(): Promise<string> {
    return this.transport.execute<string>({ type: 'currentTitle' });
  }

  async content(): Promise<string> {
    return this.transport.execute<string>({ type: 'content' });
  }

  async screenshot(options?: {
    path?: string;
    fullPage?: boolean;
    type?: 'png' | 'jpeg';
  }): Promise<string | Uint8Array> {
    return this.transport.execute<string | Uint8Array>({ type: 'screenshot', options });
  }
}

export class InProcessDesktopProxyTransport implements BrowserAutomationProxyTransport {
  constructor(private readonly desktop: DesktopBrowserAutomation) {}

  async execute<T = unknown>(command: BrowserProxyCommand): Promise<T> {
    switch (command.type) {
      case 'start': {
        await this.desktop.start(command.options?.startUrl);
        return undefined as T;
      }
      case 'close': {
        await this.desktop.close();
        return undefined as T;
      }
      case 'isStarted':
        return this.desktop.isStarted() as T;
      case 'newPage':
        return (await this.desktop.newPage(command.url)) as T;
      case 'switchToPage': {
        this.desktop.switchToPage(command.pageId);
        return undefined as T;
      }
      case 'closePage': {
        await this.desktop.closePage(command.pageId);
        return undefined as T;
      }
      case 'listPageIds':
        return this.desktop.listPageIds() as T;
      case 'getEngine':
        return this.desktop.getEngine() as T;
      case 'snapshot':
        return (await this.desktop.snapshot()) as T;
      case 'goto': {
        await this.desktop.goto(command.url, command.options);
        return undefined as T;
      }
      case 'reload': {
        await this.desktop.reload(command.options);
        return undefined as T;
      }
      case 'goBack': {
        await this.desktop.goBack(command.options);
        return undefined as T;
      }
      case 'goForward': {
        await this.desktop.goForward(command.options);
        return undefined as T;
      }
      case 'waitForSelector': {
        await this.desktop.waitForSelector(command.selector, command.options);
        return undefined as T;
      }
      case 'waitForTimeout': {
        await this.desktop.waitForTimeout(command.ms);
        return undefined as T;
      }
      case 'click': {
        await this.desktop.click(command.selector, command.options);
        return undefined as T;
      }
      case 'dblClick': {
        await this.desktop.dblClick(command.selector, command.options);
        return undefined as T;
      }
      case 'fill': {
        await this.desktop.fill(command.selector, command.value, command.options);
        return undefined as T;
      }
      case 'type': {
        await this.desktop.type(command.selector, command.value, command.options);
        return undefined as T;
      }
      case 'press': {
        await this.desktop.press(command.selector, command.key, command.options);
        return undefined as T;
      }
      case 'check': {
        await this.desktop.check(command.selector, command.options);
        return undefined as T;
      }
      case 'uncheck': {
        await this.desktop.uncheck(command.selector, command.options);
        return undefined as T;
      }
      case 'hover': {
        await this.desktop.hover(command.selector, command.options);
        return undefined as T;
      }
      case 'focus': {
        await this.desktop.focus(command.selector);
        return undefined as T;
      }
      case 'selectOption':
        return (await this.desktop.selectOption(
          command.selector,
          command.values,
          command.options,
        )) as T;
      case 'textContent':
        return (await this.desktop.textContent(command.selector)) as T;
      case 'innerText':
        return (await this.desktop.innerText(command.selector)) as T;
      case 'getAttribute':
        return (await this.desktop.getAttribute(command.selector, command.name)) as T;
      case 'currentUrl':
        return this.desktop.currentUrl() as T;
      case 'currentTitle':
        return (await this.desktop.currentTitle()) as T;
      case 'content':
        return (await this.desktop.content()) as T;
      case 'screenshot':
        return (await this.desktop.screenshot(command.options)) as T;
      default: {
        const unreachable: never = command;
        throw new Error(`Unhandled browser proxy command: ${JSON.stringify(unreachable)}`);
      }
    }
  }
}

export function createMobileBrowserAutomationProxy(
  transport: BrowserAutomationProxyTransport,
): MobileBrowserAutomationProxy {
  return new MobileBrowserAutomationProxy(transport);
}
