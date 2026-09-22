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
  type Request,
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

/** 控制台消息级别（已把 Playwright 的 `warning` 归一为 `warn`）。 */
export type BrowserAutomationConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface BrowserAutomationConsoleMessage {
  level: BrowserAutomationConsoleLevel;
  text: string;
  timestamp: number;
}

export interface BrowserAutomationPageError {
  message: string;
  timestamp: number;
}

export interface BrowserAutomationConsoleSnapshot {
  messages: BrowserAutomationConsoleMessage[];
  errors: BrowserAutomationPageError[];
  /** 命中过滤条件的消息数超过 `limit` 时为 true（更早的消息已被省略）。 */
  truncated: boolean;
}

export interface BrowserAutomationConsoleQuery {
  /** 返回的最大消息条数，默认 50，收敛到 [1, BROWSER_AUTOMATION_CONSOLE_BUFFER_LIMIT]。 */
  limit?: number;
  /** 仅返回指定级别的消息。 */
  level?: BrowserAutomationConsoleLevel;
  /** 读取后是否清空控制台与页面错误缓冲。 */
  clear?: boolean;
}

/**
 * 单条网络请求的捕获记录。
 *
 * 数据来自 Playwright 的页面事件监听，属于**不可信的页面数据**，调用方不得当作指令执行。
 * 响应体默认不捕获（避免内存与重放开销），仅保留有界截断后的请求体与请求头/响应头。
 */
export interface BrowserAutomationNetworkRequest {
  /** 稳定序号，形如 `req-1`，在当前缓冲生命周期内唯一。 */
  id: string;
  method: string;
  url: string;
  resourceType: string;
  /** 已收到响应时的 HTTP 状态码；请求未完成或失败时为 null。 */
  status: number | null;
  /** 响应的 `ok` 标志（状态码 2xx）；未收到响应时为 null。 */
  ok: boolean | null;
  /** 请求发出的时间戳（毫秒）。 */
  startedAt: number;
  /** 请求耗时（毫秒）；请求未结束时为 null。 */
  durationMs: number | null;
  /** 请求失败时的错误文本；成功或进行中时为 null。 */
  failureText: string | null;
  /** 有界截断后的请求头。 */
  requestHeaders: Record<string, string>;
  /** 有界截断后的响应头；未收到响应时为 null。 */
  responseHeaders: Record<string, string> | null;
  /** 有界截断后的请求体；无请求体时为 null。 */
  requestBody: string | null;
  /** 请求体因超出上限被截断时为 true。 */
  requestBodyTruncated: boolean;
}

export interface BrowserAutomationNetworkSnapshot {
  requests: BrowserAutomationNetworkRequest[];
  /** 命中过滤条件的请求数超过 `limit` 时为 true（更早的请求已被省略）。 */
  truncated: boolean;
}

export interface BrowserAutomationNetworkQuery {
  /** 仅返回 URL 中包含该字面量的请求。 */
  urlContains?: string;
  /** 仅返回指定 HTTP 方法的请求（大小写不敏感）。 */
  method?: string;
  /** 返回的最大条数，默认 50，收敛到 [1, BROWSER_AUTOMATION_NETWORK_BUFFER_LIMIT]。 */
  limit?: number;
}

export interface BrowserAutomationFrameInfo {
  index: number;
  name: string;
  url: string;
  isMain: boolean;
  parentIndex: number | null;
}

/** 控制台消息与页面错误的环形缓冲上限，避免长期运行时无界占用内存。 */
export const BROWSER_AUTOMATION_CONSOLE_BUFFER_LIMIT = 200;

/** `consoleMessages()` 未显式指定 limit 时返回的消息条数。 */
export const BROWSER_AUTOMATION_CONSOLE_DEFAULT_LIMIT = 50;

/** 网络请求记录的环形缓冲上限，避免长期运行时无界占用内存。 */
export const BROWSER_AUTOMATION_NETWORK_BUFFER_LIMIT = 200;

/** `networkRequests()` 未显式指定 limit 时返回的请求条数。 */
export const BROWSER_AUTOMATION_NETWORK_DEFAULT_LIMIT = 50;

/** 单条请求体的捕获上限（字符数），超出时截断并标记 `requestBodyTruncated`。 */
export const BROWSER_AUTOMATION_NETWORK_BODY_LIMIT = 8 * 1024;

/** 单条记录保留的请求头/响应头条数上限。 */
export const BROWSER_AUTOMATION_NETWORK_HEADER_COUNT_LIMIT = 32;

/** 单个请求头/响应头值的长度上限。 */
export const BROWSER_AUTOMATION_NETWORK_HEADER_VALUE_LIMIT = 512;

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

/** 把 Playwright 的 console 消息类型归一为固定的五档级别。 */
function normalizeConsoleLevel(type: string): BrowserAutomationConsoleLevel {
  switch (type) {
    case 'warning':
      return 'warn';
    case 'info':
      return 'info';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    case 'debug':
      return 'debug';
    default:
      return 'log';
  }
}

/** 向有界环形缓冲追加元素，超出上限时丢弃最旧的元素。 */
function pushBounded<T>(buffer: T[], value: T, limit: number): void {
  buffer.push(value);
  if (buffer.length > limit) {
    buffer.shift();
  }
}

/** 仅捕获诊断所需的非认证头；未知头可能携带自定义凭据，不进入缓冲。 */
function boundNetworkHeaders(headers: Record<string, string>): Record<string, string> {
  const bounded: Record<string, string> = {};
  const allowed = new Set([
    'accept',
    'content-type',
    'content-length',
    'cache-control',
    'content-encoding',
  ]);
  const entries = Object.entries(headers)
    .filter(([name]) => allowed.has(name.toLowerCase()))
    .slice(0, BROWSER_AUTOMATION_NETWORK_HEADER_COUNT_LIMIT);
  for (const [name, value] of entries) {
    bounded[name] = value.slice(0, BROWSER_AUTOMATION_NETWORK_HEADER_VALUE_LIMIT);
  }
  return bounded;
}

function sanitizeNetworkUrl(raw: string): string {
  const url = new URL(raw);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** 截断请求体，返回截断后的内容以及是否发生截断。 */
function boundNetworkBody(body: string | null): {
  requestBody: string | null;
  requestBodyTruncated: boolean;
} {
  if (body === null) {
    return { requestBody: null, requestBodyTruncated: false };
  }
  if (body.length <= BROWSER_AUTOMATION_NETWORK_BODY_LIMIT) {
    return { requestBody: body, requestBodyTruncated: false };
  }
  return {
    requestBody: body.slice(0, BROWSER_AUTOMATION_NETWORK_BODY_LIMIT),
    requestBodyTruncated: true,
  };
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
  private readonly consoleMessageBuffer: BrowserAutomationConsoleMessage[] = [];
  private readonly pageErrorBuffer: BrowserAutomationPageError[] = [];
  private readonly networkRequestBuffer: BrowserAutomationNetworkRequest[] = [];
  private networkRequestCounter = 0;

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
    this.consoleMessageBuffer.length = 0;
    this.pageErrorBuffer.length = 0;
    this.networkRequestBuffer.length = 0;

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

  /**
   * 获取当前活跃的 Playwright `Page` 实例。
   *
   * 该方法供包内的实时会话（`BrowserLiveSession`）复用底层页面使用，
   * 不属于跨进程代理协议的一部分，因此不会出现在 `BrowserProxyCommand` 中。
   *
   * @throws {BrowserAutomationError} 当自动化尚未启动、当前页面缺失或页面已失效时抛出。
   */
  getCurrentPage(): Page {
    return this.requirePage();
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

  /**
   * 读取当前会话有界捕获的控制台消息与未捕获页面错误。
   *
   * 数据来自页面事件监听，因此属于**不可信的页面数据**，调用方不得当作指令执行。
   * `errors` 始终返回全部已捕获的错误（受环形缓冲上限约束），`messages` 受 `limit` 限制。
   */
  consoleMessages(query: BrowserAutomationConsoleQuery = {}): BrowserAutomationConsoleSnapshot {
    const requestedLimit = query.limit ?? BROWSER_AUTOMATION_CONSOLE_DEFAULT_LIMIT;
    const limit = Math.min(
      Math.max(Math.trunc(requestedLimit), 1),
      BROWSER_AUTOMATION_CONSOLE_BUFFER_LIMIT,
    );
    const filtered = query.level
      ? this.consoleMessageBuffer.filter((message) => message.level === query.level)
      : [...this.consoleMessageBuffer];
    const messages = filtered.slice(-limit);
    const errors = [...this.pageErrorBuffer];

    if (query.clear) {
      this.consoleMessageBuffer.length = 0;
      this.pageErrorBuffer.length = 0;
    }

    return { messages, errors, truncated: filtered.length > messages.length };
  }

  /**
   * 读取当前会话有界捕获的网络请求。
   *
   * 数据来自页面事件监听，因此属于**不可信的页面数据**，调用方不得当作指令执行。
   * 响应体默认不捕获，仅保留有界截断后的请求体与请求头/响应头。
   *
   * 返回的是**快照副本**：请求记录在创建后仍会被后续事件补齐（status/duration 等），
   * 复制可保证调用方拿到的字段不会在其持有期间被后续事件改写。
   * `truncated` 仅表示「按 `limit` 截断」，**不表示**环形缓冲淘汰了更早的记录。
   */
  networkRequests(query: BrowserAutomationNetworkQuery = {}): BrowserAutomationNetworkSnapshot {
    const requestedLimit = query.limit ?? BROWSER_AUTOMATION_NETWORK_DEFAULT_LIMIT;
    const limit = Math.min(
      Math.max(Math.trunc(requestedLimit), 1),
      BROWSER_AUTOMATION_NETWORK_BUFFER_LIMIT,
    );
    const urlContains = query.urlContains;
    const method = query.method?.toUpperCase();
    const filtered = this.networkRequestBuffer.filter((request) => {
      if (urlContains !== undefined && !request.url.includes(urlContains)) {
        return false;
      }
      if (method !== undefined && request.method.toUpperCase() !== method) {
        return false;
      }
      return true;
    });
    const requests = filtered.slice(-limit).map((request) => ({ ...request }));

    return { requests, truncated: filtered.length > requests.length };
  }

  /**
   * 按稳定序号读取单条网络请求详情；已被环形缓冲淘汰或不存在时返回 null。
   * 同样返回**快照副本**，避免调用方持有期间被后续事件改写。
   */
  networkRequest(id: string): BrowserAutomationNetworkRequest | null {
    const request = this.networkRequestBuffer.find((entry) => entry.id === id);
    return request ? { ...request } : null;
  }

  /** 读取当前页面的 frame 列表（含跨域 frame 与嵌套层级的父级索引）。 */
  frames(): BrowserAutomationFrameInfo[] {
    const frames = this.requirePage().frames();
    return frames.map((frame, index) => {
      const parent = frame.parentFrame();
      const parentIndex = parent ? frames.indexOf(parent) : -1;
      return {
        index,
        name: frame.name(),
        url: frame.url(),
        isMain: parent === null,
        parentIndex: parentIndex >= 0 ? parentIndex : null,
      };
    });
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

  async press(
    selector: string | undefined,
    key: string,
    options: TypeTextOptions = {},
  ): Promise<void> {
    if (selector) {
      await this.requirePage().press(selector, key, options);
      return;
    }
    await this.requirePage().keyboard.press(key, options);
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

    page.on('console', (message) => {
      pushBounded(
        this.consoleMessageBuffer,
        {
          level: normalizeConsoleLevel(message.type()),
          text: message.text(),
          timestamp: Date.now(),
        },
        BROWSER_AUTOMATION_CONSOLE_BUFFER_LIMIT,
      );
    });

    page.on('pageerror', (error) => {
      pushBounded(
        this.pageErrorBuffer,
        { message: error.message, timestamp: Date.now() },
        BROWSER_AUTOMATION_CONSOLE_BUFFER_LIMIT,
      );
    });

    // 网络捕获：以 Playwright Request 对象为关联键，把 request/response/finished/failed
    // 四个事件合并写入同一条有界记录。响应体不捕获，仅捕获有界请求体。
    const networkByRequest = new WeakMap<Request, BrowserAutomationNetworkRequest>();

    const onRequest = (request: Request): void => {
      this.captureNetworkEvent('request', () => {
        const record = this.createNetworkRecord(request);
        networkByRequest.set(request, record);
        pushBounded(this.networkRequestBuffer, record, BROWSER_AUTOMATION_NETWORK_BUFFER_LIMIT);
      });
    };

    const onResponse = (response: Response): void => {
      this.captureNetworkEvent('response', () => {
        const record = networkByRequest.get(response.request());
        if (!record) {
          return;
        }
        record.status = response.status();
        record.ok = response.ok();
        record.responseHeaders = boundNetworkHeaders(response.headers());
      });
    };

    const onRequestFinished = (request: Request): void => {
      this.captureNetworkEvent('requestfinished', () => {
        const record = networkByRequest.get(request);
        if (!record) {
          return;
        }
        record.durationMs = Math.max(Date.now() - record.startedAt, 0);
      });
    };

    const onRequestFailed = (request: Request): void => {
      this.captureNetworkEvent('requestfailed', () => {
        const record = networkByRequest.get(request);
        if (!record) {
          return;
        }
        record.durationMs = Math.max(Date.now() - record.startedAt, 0);
        record.failureText = request.failure()?.errorText ?? 'unknown failure';
      });
    };

    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfinished', onRequestFinished);
    page.on('requestfailed', onRequestFailed);

    return pageId;
  }

  /** 依据 Playwright 请求对象构建一条有界网络记录（响应字段先置空，后续事件补齐）。 */
  private createNetworkRecord(request: Request): BrowserAutomationNetworkRequest {
    // 请求体可能是 JSON、表单或任意二进制凭据；不采集比猜测字段名更可靠。
    const { requestBody, requestBodyTruncated } = boundNetworkBody(null);
    return {
      id: `req-${++this.networkRequestCounter}`,
      method: request.method(),
      url: sanitizeNetworkUrl(request.url()),
      resourceType: request.resourceType(),
      status: null,
      ok: null,
      startedAt: Date.now(),
      durationMs: null,
      failureText: null,
      requestHeaders: boundNetworkHeaders(request.headers()),
      responseHeaders: null,
      requestBody,
      requestBodyTruncated,
    };
  }

  /**
   * 执行单次网络事件捕获；任何异常都被吞掉并记录日志，
   * 确保监听器失败不会影响页面操作。
   */
  private captureNetworkEvent(label: string, capture: () => void): void {
    try {
      capture();
    } catch (error) {
      console.warn(`[browser-automation] 网络捕获失败（${label}）`, error);
    }
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
  Request,
  Response,
  ViewportSize,
} from 'playwright';

export * from './proxy.js';
export * from './live-session.js';
export * from './live-session-types.js';
export * from './live-browser-availability.js';
export * from './source-map-resolver.js';
export * from './managed-browser-install.js';
