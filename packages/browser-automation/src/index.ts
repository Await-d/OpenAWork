import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type BrowserType,
  type Cookie,
  type Geolocation,
  type LaunchOptions,
  type Locator,
  type Page,
  type PageScreenshotOptions,
  type Response,
  type ViewportSize,
} from 'playwright';

export type SupportedBrowserEngine = 'chromium' | 'firefox' | 'webkit';

export interface StartBrowserAutomationOptions {
  engine?: SupportedBrowserEngine;
  launchOptions?: LaunchOptions;
  contextOptions?: BrowserContextOptions;
  startUrl?: string;
}

export interface NavigateOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  timeout?: number;
}

export interface WaitForSelectorOptions {
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
  timeout?: number;
}

export interface TypeTextOptions {
  delay?: number;
}

export interface FillOptions {
  timeout?: number;
  force?: boolean;
}

export interface ClickOptions {
  timeout?: number;
  force?: boolean;
  clickCount?: number;
  delay?: number;
  button?: 'left' | 'right' | 'middle';
}

export interface SelectOptions {
  timeout?: number;
}

export interface BrowserAutomationSnapshot {
  currentPageId: string;
  openPages: string[];
  url: string;
  title: string;
}

export interface EvaluatePageFunctionResult<T> {
  value: T;
}

export class BrowserAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserAutomationError';
  }
}

function resolveBrowserType(engine: SupportedBrowserEngine): BrowserType {
  switch (engine) {
    case 'chromium':
      return chromium;
    case 'firefox':
      return firefox;
    case 'webkit':
      return webkit;
    default:
      throw new BrowserAutomationError(`Unsupported browser engine: ${String(engine)}`);
  }
}

export class DesktopBrowserAutomation {
  private readonly engine: SupportedBrowserEngine;
  private readonly launchOptions: LaunchOptions;
  private readonly initialContextOptions: BrowserContextOptions;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pageCounter = 0;
  private currentPageId: string | null = null;
  private readonly pageById = new Map<string, Page>();

  constructor(options: StartBrowserAutomationOptions = {}) {
    this.engine = options.engine ?? 'chromium';
    this.launchOptions = options.launchOptions ?? {};
    this.initialContextOptions = options.contextOptions ?? {};
  }

  async start(startUrl?: string): Promise<void> {
    if (this.browser || this.context) {
      throw new BrowserAutomationError('Browser automation is already started.');
    }

    const browserType = resolveBrowserType(this.engine);
    this.browser = await browserType.launch(this.launchOptions);
    this.context = await this.browser.newContext(this.initialContextOptions);

    const page = await this.context.newPage();
    const pageId = this.registerPage(page);
    this.currentPageId = pageId;

    const targetUrl = startUrl;
    if (targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'load' });
    }
  }

  async restart(options: StartBrowserAutomationOptions = {}): Promise<void> {
    await this.close();

    const next = new DesktopBrowserAutomation({
      engine: options.engine ?? this.engine,
      launchOptions: options.launchOptions ?? this.launchOptions,
      contextOptions: options.contextOptions ?? this.initialContextOptions,
    });

    await next.start(options.startUrl);

    this.browser = next.browser;
    this.context = next.context;
    this.pageCounter = next.pageCounter;
    this.currentPageId = next.currentPageId;
    this.pageById.clear();
    for (const [id, page] of next.pageById.entries()) {
      this.pageById.set(id, page);
    }

    next.browser = null;
    next.context = null;
    next.currentPageId = null;
    next.pageById.clear();
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    this.context = null;
    this.pageCounter = 0;
    this.currentPageId = null;
    this.pageById.clear();

    if (browser) {
      await browser.close();
    }
  }

  isStarted(): boolean {
    return Boolean(this.browser && this.context);
  }

  getEngine(): SupportedBrowserEngine {
    return this.engine;
  }

  async newPage(url?: string): Promise<string> {
    const context = this.requireContext();
    const page = await context.newPage();
    const pageId = this.registerPage(page);
    this.currentPageId = pageId;

    if (url) {
      await page.goto(url, { waitUntil: 'load' });
    }

    return pageId;
  }

  listPageIds(): string[] {
    return [...this.pageById.keys()];
  }

  switchToPage(pageId: string): void {
    if (!this.pageById.has(pageId)) {
      throw new BrowserAutomationError(`Page not found: ${pageId}`);
    }
    this.currentPageId = pageId;
  }

  async closePage(pageId: string): Promise<void> {
    const page = this.pageById.get(pageId);
    if (!page) return;

    this.pageById.delete(pageId);
    if (this.currentPageId === pageId) {
      this.currentPageId = this.pageById.size > 0 ? (this.listPageIds()[0] ?? null) : null;
    }

    await page.close();
  }

  currentUrl(): string {
    return this.requirePage().url();
  }

  async currentTitle(): Promise<string> {
    return this.requirePage().title();
  }

  async content(): Promise<string> {
    return this.requirePage().content();
  }

  async snapshot(): Promise<BrowserAutomationSnapshot> {
    const page = this.requirePage();
    const currentPageId = this.requireCurrentPageId();
    return {
      currentPageId,
      openPages: this.listPageIds(),
      url: page.url(),
      title: await page.title(),
    };
  }

  async goto(url: string, options: NavigateOptions = {}): Promise<Response | null> {
    return this.requirePage().goto(url, options);
  }

  async reload(options: NavigateOptions = {}): Promise<Response | null> {
    return this.requirePage().reload(options);
  }

  async goBack(options: NavigateOptions = {}): Promise<Response | null> {
    return this.requirePage().goBack(options);
  }

  async goForward(options: NavigateOptions = {}): Promise<Response | null> {
    return this.requirePage().goForward(options);
  }

  async waitForNavigation(options: NavigateOptions = {}): Promise<Response | null> {
    return this.requirePage().waitForNavigation(options);
  }

  async waitForSelector(selector: string, options: WaitForSelectorOptions = {}): Promise<void> {
    await this.requirePage().waitForSelector(selector, options);
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.requirePage().waitForTimeout(ms);
  }

  async click(selector: string, options: ClickOptions = {}): Promise<void> {
    await this.requirePage().click(selector, options);
  }

  async dblClick(selector: string, options: Omit<ClickOptions, 'clickCount'> = {}): Promise<void> {
    await this.click(selector, { ...options, clickCount: 2 });
  }

  async fill(selector: string, value: string, options: FillOptions = {}): Promise<void> {
    await this.requirePage().fill(selector, value, options);
  }

  async type(selector: string, value: string, options: TypeTextOptions = {}): Promise<void> {
    await this.requirePage().type(selector, value, options);
  }

  async press(selector: string, key: string, options: TypeTextOptions = {}): Promise<void> {
    await this.requirePage().press(selector, key, options);
  }

  async check(selector: string, options: ClickOptions = {}): Promise<void> {
    await this.requirePage().check(selector, options);
  }

  async uncheck(selector: string, options: ClickOptions = {}): Promise<void> {
    await this.requirePage().uncheck(selector, options);
  }

  async hover(
    selector: string,
    options: Omit<ClickOptions, 'clickCount' | 'button' | 'delay'> = {},
  ): Promise<void> {
    await this.requirePage().hover(selector, options);
  }

  async focus(selector: string): Promise<void> {
    await this.requirePage().focus(selector);
  }

  async selectOption(
    selector: string,
    values: string | string[],
    options: SelectOptions = {},
  ): Promise<string[]> {
    const optionValues = Array.isArray(values) ? values : [values];
    return this.requirePage().selectOption(selector, optionValues, options);
  }

  async textContent(selector: string): Promise<string | null> {
    return this.requirePage().textContent(selector);
  }

  async innerText(selector: string): Promise<string> {
    return this.requirePage().innerText(selector);
  }

  async getAttribute(selector: string, name: string): Promise<string | null> {
    return this.requirePage().getAttribute(selector, name);
  }

  locator(selector: string): Locator {
    return this.requirePage().locator(selector);
  }

  async evaluate<T>(
    fn: string | ((...args: unknown[]) => T | Promise<T>),
    ...args: unknown[]
  ): Promise<T> {
    const source = typeof fn === 'string' ? fn : fn.toString();

    return this.requirePage().evaluate(
      (payload: { source: string; passedArgs: unknown[] }) => {
        const { source: fnSource, passedArgs } = payload;
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const wrapped = new Function('argv', `return (${fnSource})(...argv);`) as (
          argv: unknown[],
        ) => T;
        return wrapped(passedArgs);
      },
      { source, passedArgs: args },
    );
  }

  async evaluateSerialized<T>(
    fn: (...args: unknown[]) => T | Promise<T>,
    ...args: unknown[]
  ): Promise<EvaluatePageFunctionResult<T>> {
    const value = await this.evaluate(fn, ...args);
    return { value };
  }

  async screenshot(options: PageScreenshotOptions = {}): Promise<string | Uint8Array> {
    const result = await this.requirePage().screenshot(options);
    if (options.path) {
      return String(options.path);
    }
    return result;
  }

  async setViewportSize(size: ViewportSize): Promise<void> {
    await this.requirePage().setViewportSize(size);
  }

  async setUserAgent(userAgent: string): Promise<void> {
    const context = this.requireContext();
    const currentPage = this.requirePage();
    const url = currentPage.url();

    const cookies = await context.cookies();
    const storageState = await context.storageState();

    await context.close();

    this.context = await this.requireBrowser().newContext({
      ...this.initialContextOptions,
      userAgent,
      storageState,
    });

    if (cookies.length > 0) {
      await this.context.addCookies(cookies);
    }

    const page = await this.context.newPage();
    this.pageById.clear();
    const pageId = this.registerPage(page);
    this.currentPageId = pageId;

    if (url) {
      await page.goto(url, { waitUntil: 'load' });
    }
  }

  async cookies(urls?: string | string[]): Promise<Cookie[]> {
    const context = this.requireContext();
    if (!urls) {
      return context.cookies();
    }
    const value = Array.isArray(urls) ? urls : [urls];
    return context.cookies(value);
  }

  async setCookies(cookies: Cookie[]): Promise<void> {
    await this.requireContext().addCookies(cookies);
  }

  async clearCookies(): Promise<void> {
    await this.requireContext().clearCookies();
  }

  async setGeolocation(geolocation: Geolocation | null): Promise<void> {
    await this.requireContext().setGeolocation(geolocation);
  }

  private registerPage(page: Page): string {
    const pageId = `page-${++this.pageCounter}`;
    this.pageById.set(pageId, page);

    page.on('close', () => {
      this.pageById.delete(pageId);
      if (this.currentPageId === pageId) {
        this.currentPageId = this.pageById.size > 0 ? (this.listPageIds()[0] ?? null) : null;
      }
    });

    return pageId;
  }

  private requireBrowser(): Browser {
    if (!this.browser) {
      throw new BrowserAutomationError('Browser is not started. Call start() first.');
    }
    return this.browser;
  }

  private requireContext(): BrowserContext {
    if (!this.context) {
      throw new BrowserAutomationError('Browser context is not available. Call start() first.');
    }
    return this.context;
  }

  private requireCurrentPageId(): string {
    if (!this.currentPageId) {
      throw new BrowserAutomationError('No active page. Open a page first.');
    }
    return this.currentPageId;
  }

  private requirePage(): Page {
    const pageId = this.requireCurrentPageId();
    const page = this.pageById.get(pageId);
    if (!page) {
      throw new BrowserAutomationError('Active page does not exist anymore.');
    }
    return page;
  }
}

export { devices } from 'playwright';
export type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Cookie,
  Geolocation,
  LaunchOptions,
  Locator,
  Page,
  PageScreenshotOptions,
  Response,
  ViewportSize,
} from 'playwright';

export * from './proxy.js';
