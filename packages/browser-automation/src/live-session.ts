import { Buffer } from 'node:buffer';

import type {
  CDPSession,
  ConsoleMessage,
  Frame,
  Page,
  PageScreenshotOptions,
  Request,
  Response,
} from 'playwright';

import {
  BrowserAutomationError,
  DesktopBrowserAutomation,
  type NavigateOptions,
  type SupportedBrowserEngine,
} from './index.js';
import type {
  BrowserLiveA11yNodeLike,
  BrowserLiveA11ySnapshotResult,
  BrowserLiveConsoleLevel,
  BrowserLiveDeviceMetrics,
  BrowserLiveDomNodeLike,
  BrowserLiveDomTreeResult,
  BrowserLiveEvent,
  BrowserLiveInputEvent,
  BrowserLiveNodeAtPointOptions,
  BrowserLiveNodeInfo,
  BrowserLiveScreencastOptions,
  BrowserLiveSelectorStrategy,
  BrowserLiveSessionOptions,
} from './live-session-types.js';
import {
  BROWSER_LIVE_A11Y_MAX_NODES,
  BROWSER_LIVE_DOM_DEFAULT_DEPTH,
  BROWSER_LIVE_DOM_MAX_DEPTH,
  BROWSER_LIVE_DOM_MAX_NODES,
} from './live-session-types.js';
import { ScreencastConvergence, readJpegDimensions } from './screencast-convergence.js';
import {
  resolveStackFrames,
  type RawStackFrame,
  type ResolvedStackFrame,
} from './source-map-resolver.js';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'proxy-authorization',
  'x-auth-token',
]);

const NAVIGATION_SETTLE_DELAY_MS = 150;
const NAVIGATION_TITLE_RETRY_DELAY_MS = 50;

/**
 * 关联 CDP 原始栈时的 FIFO 上限。
 *
 * Playwright 的 `page.on('console')` 不暴露栈，而 CDP 的 `Runtime.consoleAPICalled`
 * 有；两侧事件在同一轮 I/O 中先后到达，因此以「最近 64 条 CDP console 样本」的 FIFO
 * 按 level 顺序匹配。溢出时淘汰最旧样本，被淘汰调用对应的 console 事件将退化为
 * 不带栈下发（宁缺毋滥，避免把错误的栈安到别的调用上）。
 */
const CDP_CONSOLE_FIFO_LIMIT = 64;

/** 未捕获异常样本的 FIFO 上限（异常频率低，取更小值即可）。 */
const CDP_EXCEPTION_FIFO_LIMIT = 16;

/**
 * 关联重试上限。两侧事件偶发落在不同的 I/O 轮次，因此匹配失败时最多重试
 * `CORRELATION_RETRY_LIMIT` 次、每次间隔 `CORRELATION_RETRY_DELAY_MS`；仍失败才回退为无栈。
 */
const CORRELATION_RETRY_LIMIT = 3;
const CORRELATION_RETRY_DELAY_MS = 10;

function isNavigationContextError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('Execution context was destroyed') ||
    error.message.includes('most likely because of a navigation')
  );
}

interface ScreencastFramePayload {
  data: string;
  sessionId: number;
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    timestamp?: number;
  };
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    sanitized[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? '***' : value;
  }
  return sanitized;
}

/** CDP `Runtime.CallFrame` 的子集；`lineNumber` / `columnNumber` 为 0-based。 */
interface CdpCallFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface CdpStackTrace {
  callFrames?: CdpCallFrame[];
}

interface CdpConsoleApiCalledEvent {
  type?: string;
  stackTrace?: CdpStackTrace;
}

interface CdpExceptionThrownEvent {
  exceptionDetails?: {
    stackTrace?: CdpStackTrace;
  };
}

/** 把 CDP 栈归一为线路/解析器共用的 `RawStackFrame`（保持 0-based）。 */
function normalizeCdpCallFrames(stackTrace: CdpStackTrace | undefined): RawStackFrame[] {
  const frames: RawStackFrame[] = [];
  for (const frame of stackTrace?.callFrames ?? []) {
    frames.push({
      url: frame.url ?? '',
      line: frame.lineNumber ?? 0,
      column: frame.columnNumber ?? 0,
      ...(frame.functionName !== undefined && frame.functionName !== ''
        ? { functionName: frame.functionName }
        : {}),
    });
  }
  return frames;
}

interface CdpConsoleSample {
  level: BrowserLiveConsoleLevel;
  stack: RawStackFrame[] | null;
}

interface PendingConsoleEvent {
  level: BrowserLiveConsoleLevel;
  text: string;
  timestamp: number;
  attempts: number;
}

interface PendingPageErrorEvent {
  message: string;
  timestamp: number;
  attempts: number;
}

function normalizeConsoleLevel(type: string): BrowserLiveConsoleLevel {
  switch (type) {
    case 'warn':
    case 'warning':
      return 'warn';
    case 'info':
      return 'info';
    case 'error':
      return 'error';
    case 'debug':
      return 'debug';
    default:
      return 'log';
  }
}

function toAttributeRecord(attributes: string[] | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  if (!attributes) return record;
  for (let index = 0; index + 1 < attributes.length; index += 2) {
    const name = attributes[index];
    const value = attributes[index + 1];
    if (name === undefined || value === undefined) continue;
    record[name] = value;
  }
  return record;
}

const IMPLICIT_ROLE_BY_TAG: Record<string, string> = {
  button: 'button',
  select: 'combobox',
  textarea: 'textbox',
  img: 'img',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
};

const IMPLICIT_ROLE_BY_INPUT_TYPE: Record<string, string> = {
  button: 'button',
  checkbox: 'checkbox',
  email: 'textbox',
  radio: 'radio',
  reset: 'button',
  search: 'searchbox',
  submit: 'button',
  text: 'textbox',
};

function escapeDoubleQuotedValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function resolveNodeRole(tagName: string, attributes: Record<string, string>): string | null {
  const explicitRole = attributes['role'];
  if (explicitRole !== undefined && explicitRole.trim() !== '') {
    return explicitRole.trim();
  }
  if (tagName === 'a') {
    return attributes['href'] !== undefined ? 'link' : null;
  }
  if (tagName === 'input') {
    const type = (attributes['type'] ?? 'text').toLowerCase();
    return IMPLICIT_ROLE_BY_INPUT_TYPE[type] ?? 'textbox';
  }
  return IMPLICIT_ROLE_BY_TAG[tagName] ?? null;
}

function resolveAccessibleName(attributes: Record<string, string>, text: string): string | null {
  const ariaLabel = attributes['aria-label'];
  if (ariaLabel !== undefined && ariaLabel.trim() !== '') {
    return ariaLabel.trim();
  }
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  return normalizedText !== '' ? normalizedText : null;
}

function buildRoleNameSelector(
  tagName: string,
  attributes: Record<string, string>,
  text: string,
): string | null {
  const role = resolveNodeRole(tagName, attributes);
  if (role === null) return null;
  const name = resolveAccessibleName(attributes, text);
  if (name === null) return null;
  return `role=${role}[name="${escapeDoubleQuotedValue(name)}"]`;
}

async function countSelectorMatches(page: Page, selector: string): Promise<number> {
  try {
    return await page.locator(selector).count();
  } catch (error) {
    console.debug(
      `[browser-live-session] selector failed to resolve: ${selector}`,
      error instanceof Error ? error.message : String(error),
    );
    return 0;
  }
}

interface NodeSelectorResolution {
  selectorHint: string;
  selectorStrategy: BrowserLiveSelectorStrategy;
  selectorUnique: boolean;
}

interface NodeSelectorInput {
  x: number;
  y: number;
  nodeName: string;
  attributes: Record<string, string>;
  text: string;
}

interface SelectorCandidate {
  strategy: BrowserLiveSelectorStrategy;
  selector: string;
}

interface CdpDomNodeLike {
  nodeId: number;
  backendNodeId: number;
  nodeName: string;
  attributes?: string[];
  childNodeCount?: number;
  children?: CdpDomNodeLike[];
}

interface DomTraversalState {
  remaining: number;
  truncated: boolean;
}

function normalizeDomDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) {
    return BROWSER_LIVE_DOM_DEFAULT_DEPTH;
  }
  return Math.min(Math.max(Math.floor(depth), 1), BROWSER_LIVE_DOM_MAX_DEPTH);
}

function mapDomNode(node: CdpDomNodeLike, state: DomTraversalState): BrowserLiveDomNodeLike | null {
  if (state.remaining <= 0) {
    state.truncated = true;
    return null;
  }
  state.remaining -= 1;

  const childCount = node.childNodeCount ?? node.children?.length ?? 0;
  const mapped: BrowserLiveDomNodeLike = {
    nodeId: node.nodeId,
    backendNodeId: node.backendNodeId,
    nodeName: node.nodeName,
    attributes: toAttributeRecord(node.attributes),
    childCount,
  };

  const children = node.children ?? [];
  if (children.length > 0) {
    const mappedChildren: BrowserLiveDomNodeLike[] = [];
    for (const child of children) {
      const mappedChild = mapDomNode(child, state);
      if (!mappedChild) {
        break;
      }
      mappedChildren.push(mappedChild);
    }
    if (mappedChildren.length > 0) {
      mapped.children = mappedChildren;
    }
  }

  if (childCount > (mapped.children?.length ?? 0)) {
    state.truncated = true;
  }

  return mapped;
}

interface CdpAxValueLike {
  value?: unknown;
}

interface CdpAxPropertyLike {
  name: string;
  value: CdpAxValueLike;
}

interface CdpAxNodeLike {
  nodeId: string;
  ignored: boolean;
  role?: CdpAxValueLike;
  name?: CdpAxValueLike;
  value?: CdpAxValueLike;
  description?: CdpAxValueLike;
  properties?: CdpAxPropertyLike[];
  parentId?: string;
  childIds?: string[];
}

interface AxTraversalState {
  remaining: number;
  count: number;
}

function readAxString(source: CdpAxValueLike | undefined): string {
  const value = source?.value;
  return typeof value === 'string' ? value : '';
}

function readAxOptionalString(source: CdpAxValueLike | undefined): string | undefined {
  const value = source?.value;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readAxProperties(node: CdpAxNodeLike): Map<string, unknown> {
  const properties = new Map<string, unknown>();
  for (const property of node.properties ?? []) {
    properties.set(property.name, property.value.value);
  }
  return properties;
}

function readAxOptionalBoolean(
  properties: Map<string, unknown>,
  name: string,
): boolean | undefined {
  const value = properties.get(name);
  return typeof value === 'boolean' ? value : undefined;
}

function readAxChecked(properties: Map<string, unknown>): boolean | 'mixed' | undefined {
  const value = properties.get('checked');
  if (value === 'mixed') return 'mixed';
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function readAxLevel(properties: Map<string, unknown>): number | undefined {
  const value = properties.get('level');
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mapAxNode(
  node: CdpAxNodeLike,
  byId: Map<string, CdpAxNodeLike>,
  state: AxTraversalState,
  seen: Set<string>,
): BrowserLiveA11yNodeLike | null {
  if (state.remaining <= 0 || seen.has(node.nodeId)) {
    return null;
  }
  state.remaining -= 1;
  state.count += 1;
  seen.add(node.nodeId);

  const properties = readAxProperties(node);
  const mapped: BrowserLiveA11yNodeLike = {
    role: readAxString(node.role),
    name: readAxString(node.name),
    ignored: node.ignored,
  };

  const value = readAxOptionalString(node.value);
  if (value !== undefined) mapped.value = value;
  const description = readAxOptionalString(node.description);
  if (description !== undefined) mapped.description = description;
  const focused = readAxOptionalBoolean(properties, 'focused');
  if (focused !== undefined) mapped.focused = focused;
  const disabled = readAxOptionalBoolean(properties, 'disabled');
  if (disabled !== undefined) mapped.disabled = disabled;
  const expanded = readAxOptionalBoolean(properties, 'expanded');
  if (expanded !== undefined) mapped.expanded = expanded;
  const selected = readAxOptionalBoolean(properties, 'selected');
  if (selected !== undefined) mapped.selected = selected;
  const checked = readAxChecked(properties);
  if (checked !== undefined) mapped.checked = checked;
  const level = readAxLevel(properties);
  if (level !== undefined) mapped.level = level;

  for (const childId of node.childIds ?? []) {
    const child = byId.get(childId);
    if (!child) continue;
    const mappedChild = mapAxNode(child, byId, state, seen);
    if (!mappedChild) continue;
    (mapped.children ??= []).push(mappedChild);
  }

  return mapped;
}

export class BrowserLiveSession {
  private readonly options: BrowserLiveSessionOptions;
  private automation: DesktopBrowserAutomation | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private screencastActive = false;
  private screencastOptions: BrowserLiveScreencastOptions = {};
  private deviceConvergence: ScreencastConvergence | null = null;

  private readonly eventListeners = new Set<(event: BrowserLiveEvent) => void>();
  private readonly detachers: Array<() => void> = [];
  private readonly requestIds = new WeakMap<Request, string>();
  private readonly requestStartTimes = new WeakMap<Request, number>();
  private requestIdCounter = 0;
  private navigationGeneration = 0;
  private navigationSettleTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly cdpConsoleFifo: CdpConsoleSample[] = [];
  private readonly cdpExceptionFifo: Array<RawStackFrame[] | null> = [];
  private readonly pendingConsoleEvents: PendingConsoleEvent[] = [];
  private readonly pendingPageErrorEvents: PendingPageErrorEvent[] = [];
  private consoleFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushingPendingEvents = false;

  constructor(options: BrowserLiveSessionOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.automation) {
      throw new BrowserAutomationError('Browser live session is already started.');
    }

    const automation = new DesktopBrowserAutomation({
      engine: this.options.engine ?? 'chromium',
      launchOptions: this.options.launchOptions,
      contextOptions: this.options.contextOptions,
    });

    try {
      await automation.start(this.options.startUrl);
      const page = automation.getCurrentPage();
      const cdp = await page.context().newCDPSession(page);

      this.automation = automation;
      this.page = page;
      this.cdp = cdp;
      this.attachPageListeners(page);
      this.attachCdpListeners(cdp);
      await cdp.send('Runtime.enable');
    } catch (error) {
      await closeQuietly(automation);
      throw error;
    }
  }

  isStarted(): boolean {
    return Boolean(this.automation && this.page && !this.page.isClosed());
  }

  getEngine(): SupportedBrowserEngine {
    return this.options.engine ?? 'chromium';
  }

  /**
   * 获取当前活跃的 Playwright `Page`。
   *
   * 与 `DesktopBrowserAutomation.getCurrentPage()` 同构：供包内实时逻辑与集成测试
   * 直接复用底层页面（例如校验选择器唯一性）。
   *
   * @throws {BrowserAutomationError} 会话尚未启动时抛出。
   */
  getCurrentPage(): Page {
    return this.requirePage();
  }

  supportsScreencast(): boolean {
    return this.getEngine() === 'chromium';
  }

  onEvent(handler: (event: BrowserLiveEvent) => void): () => void {
    this.eventListeners.add(handler);
    return () => {
      this.eventListeners.delete(handler);
    };
  }

  async goto(url: string, options: NavigateOptions = {}): Promise<void> {
    await this.requirePage().goto(url, options);
  }

  async reload(): Promise<void> {
    await this.requirePage().reload();
  }

  async currentUrl(): Promise<string> {
    return this.requirePage().url();
  }

  async currentTitle(): Promise<string> {
    return this.requirePage().title();
  }

  async startScreencast(options: BrowserLiveScreencastOptions = {}): Promise<void> {
    if (!this.supportsScreencast()) {
      throw new BrowserAutomationError(
        `Screencast is only supported on chromium, current engine: ${this.getEngine()}.`,
      );
    }
    const cdp = this.requireCdp();
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: options.quality,
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
      everyNthFrame: options.everyNthFrame,
    });
    this.screencastActive = true;
    this.screencastOptions = { ...options };
  }

  async ackScreencastFrame(frameSessionId: number): Promise<void> {
    await this.requireCdp().send('Page.screencastFrameAck', { sessionId: frameSessionId });
  }

  async stopScreencast(): Promise<void> {
    const cdp = this.cdp;
    if (!cdp || !this.screencastActive) return;

    this.stopDeviceConvergence();
    this.screencastActive = false;
    try {
      await cdp.send('Page.stopScreencast');
    } catch (error) {
      console.warn('[browser-live-session] failed to stop screencast', error);
    }
    this.emit({ type: 'screencastEnd' });
  }

  async setDeviceMetricsOverride(metrics: BrowserLiveDeviceMetrics): Promise<void> {
    await this.requireCdp().send('Emulation.setDeviceMetricsOverride', {
      width: metrics.width,
      height: metrics.height,
      deviceScaleFactor: metrics.deviceScaleFactor ?? 1,
      mobile: metrics.mobile ?? false,
    });
    this.startDeviceConvergence(metrics);
  }

  async clearDeviceMetricsOverride(): Promise<void> {
    await this.requireCdp().send('Emulation.clearDeviceMetricsOverride');
    await this.rearmScreencastAfterDeviceChange();
  }

  /**
   * 覆写设备指标后驱动 screencast 收敛到目标视口。
   *
   * 只重开一次 screencast 并不够：过渡帧可能带着新尺寸的元数据、位图却仍缩放在旧
   * 视口上（见 `screencast-convergence.ts`）。这里交给有界控制器，按帧校验位图与
   * 元数据，直到收敛或用尽次数/截止时间。
   */
  private startDeviceConvergence(metrics: BrowserLiveDeviceMetrics): void {
    this.stopDeviceConvergence();
    if (!this.screencastActive) return;

    const convergence = new ScreencastConvergence({
      target: { width: Math.round(metrics.width), height: Math.round(metrics.height) },
      rearm: () => this.startScreencast(this.screencastOptions),
      isActive: () => this.screencastActive && this.isStarted(),
    });
    this.deviceConvergence = convergence;
    convergence.start();
  }

  private stopDeviceConvergence(): void {
    this.deviceConvergence?.dispose();
    this.deviceConvergence = null;
  }

  /**
   * 设备指标覆写后重开 screencast，强制以当前视口产出一帧。
   *
   * Chromium 的 screencast 只在页面产生新 damage、且上一帧已 ack 时推送新帧：覆写
   * 视口时若恰有帧在途，这次 resize 的 damage 会被合并/丢弃，此后静态页面不再产生
   * damage，画面就永远停在覆写前的旧尺寸。`Page.startScreencast` 是幂等的，重发会
   * 立即按当前（新）视口推一帧并恢复后续产帧。
   */
  private async rearmScreencastAfterDeviceChange(): Promise<void> {
    if (!this.screencastActive) return;
    await this.startScreencast(this.screencastOptions);
  }

  /**
   * 覆写远端浏览器的 User-Agent；`null` / 空串表示恢复浏览器默认 UA。
   *
   * UA 与设备指标一样属于 `Emulation` 域的纯覆写命令，不需要 enable。
   */
  async setUserAgentOverride(userAgent: string | null): Promise<void> {
    await this.requireCdp().send('Emulation.setUserAgentOverride', {
      userAgent: userAgent ?? '',
    });
  }

  async dispatchInput(event: BrowserLiveInputEvent): Promise<void> {
    const cdp = this.requireCdp();
    switch (event.kind) {
      case 'mouse': {
        await cdp.send('Input.dispatchMouseEvent', {
          type: event.type,
          x: event.x,
          y: event.y,
          ...(event.button !== undefined ? { button: event.button } : {}),
          ...(event.clickCount !== undefined ? { clickCount: event.clickCount } : {}),
        });
        return;
      }
      case 'wheel': {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: event.x,
          y: event.y,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
        });
        return;
      }
      case 'key': {
        await cdp.send('Input.dispatchKeyEvent', {
          type: event.type,
          ...(event.key !== undefined ? { key: event.key } : {}),
          ...(event.text !== undefined ? { text: event.text } : {}),
          ...(event.code !== undefined ? { code: event.code } : {}),
          ...(event.windowsVirtualKeyCode !== undefined
            ? { windowsVirtualKeyCode: event.windowsVirtualKeyCode }
            : {}),
        });
        return;
      }
      default: {
        const unreachable: never = event;
        throw new BrowserAutomationError(
          `Unsupported live input event: ${JSON.stringify(unreachable)}`,
        );
      }
    }
  }

  async nodeAtPoint(
    x: number,
    y: number,
    options: BrowserLiveNodeAtPointOptions = {},
  ): Promise<BrowserLiveNodeInfo | null> {
    const cdp = this.requireCdp();
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await cdp.send('DOM.getDocument', { depth: 0 });

    let backendNodeId: number;
    try {
      const hit = await cdp.send('DOM.getNodeForLocation', { x, y });
      backendNodeId = hit.backendNodeId;
    } catch (error) {
      console.warn('[browser-live-session] no node found at point', error);
      return null;
    }

    const pushed = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', {
      backendNodeIds: [backendNodeId],
    });
    const nodeId = pushed.nodeIds[0];
    if (nodeId === undefined || nodeId === 0) return null;

    const described = await cdp.send('DOM.describeNode', { nodeId });
    const node = described.node;
    const attributes = toAttributeRecord(node.attributes);
    const style = await cdp.send('CSS.getComputedStyleForNode', { nodeId });
    const computedStyles: Record<string, string> = {};
    for (const entry of style.computedStyle) {
      computedStyles[entry.name] = entry.value;
    }

    const text = await this.readNodeText(backendNodeId);
    const selector = await this.resolveNodeSelector({
      x,
      y,
      nodeName: node.nodeName,
      attributes,
      text,
    });

    const info: BrowserLiveNodeInfo = {
      selectorHint: selector.selectorHint,
      selectorStrategy: selector.selectorStrategy,
      selectorUnique: selector.selectorUnique,
      nodeName: node.nodeName,
      attributes,
      text,
      computedStyles,
    };
    if (options.fullComputedStyles) {
      info.fullComputedStyles = computedStyles;
    }
    return info;
  }

  async domTree(options: { depth?: number } = {}): Promise<BrowserLiveDomTreeResult> {
    const cdp = this.requireCdp();
    await cdp.send('DOM.enable');
    const depth = normalizeDomDepth(options.depth);
    const document = await cdp.send('DOM.getDocument', { depth });
    const state: DomTraversalState = {
      remaining: BROWSER_LIVE_DOM_MAX_NODES,
      truncated: false,
    };
    const root = mapDomNode(document.root, state);
    if (!root) {
      throw new BrowserAutomationError('DOM.getDocument returned no root node.');
    }
    return { root, truncated: state.truncated };
  }

  /**
   * 读取当前页面的无障碍树。
   *
   * Playwright 1.58 已移除 `page.accessibility.snapshot()`（运行时为 undefined），
   * 因此直接走 CDP `Accessibility.getFullAXTree`（本会话本就只在 chromium 下可用）。
   */
  async accessibilitySnapshot(): Promise<BrowserLiveA11ySnapshotResult> {
    const cdp = this.requireCdp();
    await cdp.send('Accessibility.enable');
    const result = await cdp.send('Accessibility.getFullAXTree');
    const nodes = result.nodes ?? [];
    if (nodes.length === 0) {
      return { root: null, nodeCount: 0 };
    }

    const byId = new Map<string, CdpAxNodeLike>();
    for (const node of nodes) {
      byId.set(node.nodeId, node);
    }

    const rootNode =
      nodes.find((node) => readAxString(node.role) === 'RootWebArea') ??
      nodes.find((node) => node.parentId === undefined) ??
      nodes[0];
    if (!rootNode) {
      return { root: null, nodeCount: 0 };
    }

    const state: AxTraversalState = { remaining: BROWSER_LIVE_A11Y_MAX_NODES, count: 0 };
    const root = mapAxNode(rootNode, byId, state, new Set<string>());
    return { root, nodeCount: state.count };
  }

  async screenshot(
    options: { fullPage?: boolean; type?: 'png' | 'jpeg'; quality?: number } = {},
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const type = options.type ?? 'png';
    const screenshotOptions: PageScreenshotOptions = { type, fullPage: options.fullPage };
    if (options.quality !== undefined) {
      screenshotOptions.quality = options.quality;
    }
    const buffer = await this.requirePage().screenshot(screenshotOptions);
    return {
      buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
      mimeType: type === 'jpeg' ? 'image/jpeg' : 'image/png',
    };
  }

  async close(): Promise<void> {
    this.clearNavigationSettleTimer();
    this.clearConsoleFlushTimer();
    this.pendingConsoleEvents.length = 0;
    this.pendingPageErrorEvents.length = 0;
    this.resetCdpStackBuffers();
    this.stopDeviceConvergence();

    const automation = this.automation;
    if (!automation) {
      this.detachListeners();
      return;
    }

    this.automation = null;
    await this.stopScreencast();
    this.detachListeners();
    this.page = null;
    this.cdp = null;
    this.eventListeners.clear();
    await automation.close();
  }

  private attachPageListeners(page: Page): void {
    const onConsole = (message: ConsoleMessage): void => {
      this.pendingConsoleEvents.push({
        level: normalizeConsoleLevel(message.type()),
        text: message.text(),
        timestamp: Date.now(),
        attempts: 0,
      });
      this.scheduleConsoleFlush();
    };
    page.on('console', onConsole);
    this.detachers.push(() => page.off('console', onConsole));

    const onPageError = (error: Error): void => {
      this.pendingPageErrorEvents.push({
        message: error.message,
        timestamp: Date.now(),
        attempts: 0,
      });
      this.scheduleConsoleFlush();
    };
    page.on('pageerror', onPageError);
    this.detachers.push(() => page.off('pageerror', onPageError));

    const onRequest = (request: Request): void => {
      this.requestStartTimes.set(request, Date.now());
      this.emitRequest(request);
    };
    page.on('request', onRequest);
    this.detachers.push(() => page.off('request', onRequest));

    const onResponse = (response: Response): void => {
      this.emitResponse(response, response.request());
    };
    page.on('response', onResponse);
    this.detachers.push(() => page.off('response', onResponse));

    const onRequestFailed = (request: Request): void => {
      this.emitRequestFailed(request);
    };
    page.on('requestfailed', onRequestFailed);
    this.detachers.push(() => page.off('requestfailed', onRequestFailed));

    const onFrameNavigated = (frame: Frame): void => {
      this.scheduleNavigation(frame);
    };
    page.on('framenavigated', onFrameNavigated);
    this.detachers.push(() => page.off('framenavigated', onFrameNavigated));
  }

  private attachCdpListeners(cdp: CDPSession): void {
    const onScreencastFrame = (payload: ScreencastFramePayload): void => {
      const convergence = this.deviceConvergence;
      if (convergence) {
        const bitmap = readJpegDimensions(payload.data);
        convergence.noteFrame({
          metadataWidth: payload.metadata.deviceWidth,
          metadataHeight: payload.metadata.deviceHeight,
          bitmapWidth: bitmap?.width ?? null,
          bitmapHeight: bitmap?.height ?? null,
        });
      }

      this.emit({
        type: 'screencastFrame',
        data: payload.data,
        deviceWidth: payload.metadata.deviceWidth,
        deviceHeight: payload.metadata.deviceHeight,
        offsetTop: payload.metadata.offsetTop,
        pageScaleFactor: payload.metadata.pageScaleFactor,
        scrollOffsetX: payload.metadata.scrollOffsetX,
        scrollOffsetY: payload.metadata.scrollOffsetY,
        frameSessionId: payload.sessionId,
        timestamp: payload.metadata.timestamp ?? Date.now(),
      });
    };
    cdp.on('Page.screencastFrame', onScreencastFrame);
    this.detachers.push(() => cdp.off('Page.screencastFrame', onScreencastFrame));

    const onRuntimeConsole = (payload: CdpConsoleApiCalledEvent): void => {
      const stack = normalizeCdpCallFrames(payload.stackTrace);
      this.pushConsoleSample({
        level: normalizeConsoleLevel(payload.type ?? 'log'),
        stack: stack.length > 0 ? stack : null,
      });
    };
    cdp.on('Runtime.consoleAPICalled', onRuntimeConsole);
    this.detachers.push(() => cdp.off('Runtime.consoleAPICalled', onRuntimeConsole));

    const onRuntimeException = (payload: CdpExceptionThrownEvent): void => {
      const stack = normalizeCdpCallFrames(payload.exceptionDetails?.stackTrace);
      this.pushExceptionSample(stack.length > 0 ? stack : null);
    };
    cdp.on('Runtime.exceptionThrown', onRuntimeException);
    this.detachers.push(() => cdp.off('Runtime.exceptionThrown', onRuntimeException));
  }

  private detachListeners(): void {
    const detachers = this.detachers.splice(0, this.detachers.length);
    for (const detach of detachers) {
      try {
        detach();
      } catch (error) {
        console.warn('[browser-live-session] failed to remove listener', error);
      }
    }
  }

  private pushConsoleSample(sample: CdpConsoleSample): void {
    this.cdpConsoleFifo.push(sample);
    if (this.cdpConsoleFifo.length > CDP_CONSOLE_FIFO_LIMIT) {
      this.cdpConsoleFifo.shift();
    }
  }

  private pushExceptionSample(stack: RawStackFrame[] | null): void {
    this.cdpExceptionFifo.push(stack);
    if (this.cdpExceptionFifo.length > CDP_EXCEPTION_FIFO_LIMIT) {
      this.cdpExceptionFifo.shift();
    }
  }

  /**
   * 按 level 从 CDP console FIFO 取一条样本并移除。
   * `undefined` = 尚未拿到（等延迟 flush 重试）；`null` = 命中但无栈；数组 = 命中且有栈。
   * 若 FIFO 非空但没有任何同 level 样本，则视为无法可靠关联，返回 `undefined`。
   */
  private takeConsoleSample(level: BrowserLiveConsoleLevel): RawStackFrame[] | null | undefined {
    const index = this.cdpConsoleFifo.findIndex((sample) => sample.level === level);
    if (index === -1) {
      return undefined;
    }
    const [sample] = this.cdpConsoleFifo.splice(index, 1);
    return sample?.stack ?? null;
  }

  /** 取最早的未捕获异常样本；`undefined` = 尚未拿到，`null` = 命中但无栈。 */
  private takeExceptionSample(): RawStackFrame[] | null | undefined {
    const [sample] = this.cdpExceptionFifo.splice(0, 1);
    return sample;
  }

  private resetCdpStackBuffers(): void {
    this.cdpConsoleFifo.length = 0;
    this.cdpExceptionFifo.length = 0;
  }

  /**
   * Playwright 的事件先于本会话的 CDP 事件到达（同一轮 I/O），因此把 emit 延迟到
   * 下一个宏任务：此时 `Runtime.consoleAPICalled` / `Runtime.exceptionThrown` 已入 FIFO，
   * 可以一次性发出带完整栈的事件（单一 emit，不重复、不重排 console 序列）。
   */
  private scheduleConsoleFlush(delayMs = 0): void {
    if (this.consoleFlushTimer !== null) {
      return;
    }
    this.consoleFlushTimer = setTimeout(() => {
      this.consoleFlushTimer = null;
      void this.flushPendingEvents();
    }, delayMs);
  }

  private clearConsoleFlushTimer(): void {
    if (this.consoleFlushTimer === null) {
      return;
    }
    clearTimeout(this.consoleFlushTimer);
    this.consoleFlushTimer = null;
  }

  private async flushPendingEvents(): Promise<void> {
    if (this.flushingPendingEvents) {
      return;
    }
    this.flushingPendingEvents = true;
    try {
      for (;;) {
        const consoles = this.pendingConsoleEvents.splice(0, this.pendingConsoleEvents.length);
        const pageErrors = this.pendingPageErrorEvents.splice(0, this.pendingPageErrorEvents.length);
        if (consoles.length === 0 && pageErrors.length === 0) {
          return;
        }

        // 从队首按顺序关联；一旦某条尚未拿到 CDP 样本，就把它及其后的全部挂起，
        // 保证不会让后续事件越过它、也不会把栈错配到别的调用上。
        const matchedConsoles: Array<{ pending: PendingConsoleEvent; stack: RawStackFrame[] | null }> =
          [];
        let consoleHoldFrom = -1;
        for (let index = 0; index < consoles.length; index += 1) {
          const pending = consoles[index];
          if (pending === undefined) continue;
          const sample = this.takeConsoleSample(pending.level);
          if (sample === undefined && pending.attempts < CORRELATION_RETRY_LIMIT) {
            pending.attempts += 1;
            consoleHoldFrom = index;
            break;
          }
          matchedConsoles.push({ pending, stack: sample ?? null });
        }
        if (consoleHoldFrom >= 0) {
          this.pendingConsoleEvents.unshift(...consoles.slice(consoleHoldFrom));
        }

        const matchedErrors: Array<{ pending: PendingPageErrorEvent; stack: RawStackFrame[] | null }> =
          [];
        let errorHoldFrom = -1;
        for (let index = 0; index < pageErrors.length; index += 1) {
          const pending = pageErrors[index];
          if (pending === undefined) continue;
          const sample = this.takeExceptionSample();
          if (sample === undefined && pending.attempts < CORRELATION_RETRY_LIMIT) {
            pending.attempts += 1;
            errorHoldFrom = index;
            break;
          }
          matchedErrors.push({ pending, stack: sample ?? null });
        }
        if (errorHoldFrom >= 0) {
          this.pendingPageErrorEvents.unshift(...pageErrors.slice(errorHoldFrom));
        }

        const consoleEvents = await Promise.all(
          matchedConsoles.map(({ pending, stack }) => this.buildConsoleEvent(pending, stack)),
        );
        for (const event of consoleEvents) {
          this.emit(event);
        }

        const pageErrorEvents = await Promise.all(
          matchedErrors.map(({ pending, stack }) => this.buildPageErrorEvent(pending, stack)),
        );
        for (const event of pageErrorEvents) {
          this.emit(event);
        }

        if (this.pendingConsoleEvents.length > 0 || this.pendingPageErrorEvents.length > 0) {
          this.scheduleConsoleFlush(CORRELATION_RETRY_DELAY_MS);
          return;
        }
      }
    } finally {
      this.flushingPendingEvents = false;
    }
  }

  private async buildConsoleEvent(
    pending: PendingConsoleEvent,
    stack: RawStackFrame[] | null | undefined,
  ): Promise<Extract<BrowserLiveEvent, { type: 'console' }>> {
    const event: Extract<BrowserLiveEvent, { type: 'console' }> = {
      type: 'console',
      level: pending.level,
      text: pending.text,
      timestamp: pending.timestamp,
    };
    if (stack && stack.length > 0) {
      event.stack = stack;
      event.sourceMappedStack = await resolveStackFrames(stack);
    }
    return event;
  }

  private async buildPageErrorEvent(
    pending: PendingPageErrorEvent,
    stack: RawStackFrame[] | null | undefined,
  ): Promise<Extract<BrowserLiveEvent, { type: 'pageerror' }>> {
    const event: Extract<BrowserLiveEvent, { type: 'pageerror' }> = {
      type: 'pageerror',
      message: pending.message,
      timestamp: pending.timestamp,
    };
    if (stack && stack.length > 0) {
      event.stack = stack;
      event.sourceMappedStack = await resolveStackFrames(stack);
    }
    return event;
  }

  private async readNodeText(backendNodeId: number): Promise<string> {
    const cdp = this.requireCdp();
    try {
      const resolved = await cdp.send('DOM.resolveNode', { backendNodeId });
      const objectId = resolved.object.objectId;
      if (!objectId) return '';
      const result = await cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function () { return this.textContent || ""; }',
        returnByValue: true,
      });
      const value = result.result.value;
      return typeof value === 'string' ? value : '';
    } catch (error) {
      console.warn('[browser-live-session] failed to read node text', error);
      return '';
    }
  }

  private requestIdFor(request: Request): string {
    const existing = this.requestIds.get(request);
    if (existing) return existing;
    this.requestIdCounter += 1;
    const next = `req-${this.requestIdCounter}`;
    this.requestIds.set(request, next);
    return next;
  }

  private emitRequest(request: Request): void {
    this.emit({
      type: 'network',
      phase: 'request',
      requestId: this.requestIdFor(request),
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      requestHeadersSanitized: sanitizeHeaders(request.headers()),
    });
  }

  private emitResponse(response: Response, request: Request): void {
    const startedAt = this.requestStartTimes.get(request);
    this.emit({
      type: 'network',
      phase: 'response',
      requestId: this.requestIdFor(request),
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      status: response.status(),
      statusText: response.statusText(),
      durationMs: startedAt === undefined ? undefined : Date.now() - startedAt,
      responseHeadersSanitized: sanitizeHeaders(response.headers()),
    });
  }

  private emitRequestFailed(request: Request): void {
    const startedAt = this.requestStartTimes.get(request);
    const failure = request.failure();
    this.emit({
      type: 'network',
      phase: 'failed',
      requestId: this.requestIdFor(request),
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      durationMs: startedAt === undefined ? undefined : Date.now() - startedAt,
      ...(failure ? { errorText: failure.errorText } : {}),
    });
  }

  private scheduleNavigation(frame: Frame): void {
    const page = this.page;
    if (!page || frame !== page.mainFrame()) return;

    // 主文档提交后旧文档的 CDP 样本不再可信（含 Runtime.enable 的重放），清空避免错配。
    this.resetCdpStackBuffers();

    this.navigationGeneration += 1;
    const generation = this.navigationGeneration;
    const url = frame.url();

    this.clearNavigationSettleTimer();
    this.navigationSettleTimer = setTimeout(() => {
      this.navigationSettleTimer = null;
      void this.emitNavigation(generation, url);
    }, NAVIGATION_SETTLE_DELAY_MS);
  }

  private clearNavigationSettleTimer(): void {
    if (this.navigationSettleTimer === null) return;
    clearTimeout(this.navigationSettleTimer);
    this.navigationSettleTimer = null;
  }

  private async emitNavigation(generation: number, url: string): Promise<void> {
    const page = this.page;
    if (!page || generation !== this.navigationGeneration) return;

    const title = await this.readTitleAfterNavigation(page);

    if (generation !== this.navigationGeneration) return;
    this.emit({ type: 'nav', url, title, timestamp: Date.now() });
  }

  private async readTitleAfterNavigation(page: Page): Promise<string> {
    try {
      return await page.title();
    } catch (error) {
      if (isNavigationContextError(error)) {
        console.debug(error instanceof Error ? error.message : String(error));
      } else {
        console.warn('[browser-live-session] failed to read page title after navigation', error);
      }
    }

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), NAVIGATION_TITLE_RETRY_DELAY_MS);
    });

    try {
      return await page.title();
    } catch {
      return '';
    }
  }

  private emit(event: BrowserLiveEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn('[browser-live-session] event listener threw', error);
      }
    }
  }

  private async resolveNodeSelector(input: NodeSelectorInput): Promise<NodeSelectorResolution> {
    const page = this.requirePage();
    const tagName = input.nodeName.toLowerCase();
    const candidates: SelectorCandidate[] = [];

    const testId = input.attributes['data-testid'];
    if (testId !== undefined && testId !== '') {
      candidates.push({
        strategy: 'data-testid',
        selector: `[data-testid="${escapeDoubleQuotedValue(testId)}"]`,
      });
    }

    const id = input.attributes['id'];
    if (id !== undefined && id !== '') {
      candidates.push({
        strategy: 'id',
        selector: `[id="${escapeDoubleQuotedValue(id)}"]`,
      });
    }

    const roleNameSelector = buildRoleNameSelector(tagName, input.attributes, input.text);
    if (roleNameSelector !== null) {
      candidates.push({ strategy: 'role-name', selector: roleNameSelector });
    }

    for (const candidate of candidates) {
      if ((await countSelectorMatches(page, candidate.selector)) === 1) {
        return {
          selectorHint: candidate.selector,
          selectorStrategy: candidate.strategy,
          selectorUnique: true,
        };
      }
    }

    const cssPath = (await this.buildCssPathFromPoint(input.x, input.y)) ?? tagName;
    const cssPathUnique = (await countSelectorMatches(page, cssPath)) === 1;
    return {
      selectorHint: cssPath,
      selectorStrategy: 'css-path',
      selectorUnique: cssPathUnique,
    };
  }

  private async buildCssPathFromPoint(x: number, y: number): Promise<string | null> {
    const page = this.requirePage();
    return await page.evaluate((point: { x: number; y: number }): string | null => {
      const target = document.elementFromPoint(point.x, point.y);
      if (!target) return null;
      const segments: string[] = [];
      let current: Element | null = target;
      while (current) {
        const element: Element = current;
        const tag = element.tagName.toLowerCase();
        const parent: Element | null = element.parentElement;
        if (!parent) {
          segments.unshift(tag);
          break;
        }
        const sameTagSiblings = Array.from(parent.children).filter(
          (child) => child.tagName === element.tagName,
        );
        const index = sameTagSiblings.indexOf(element) + 1;
        segments.unshift(`${tag}:nth-of-type(${index})`);
        current = parent;
      }
      return segments.length > 0 ? segments.join(' > ') : null;
    }, { x, y });
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new BrowserAutomationError('Browser live session is not started. Call start() first.');
    }
    return this.page;
  }

  private requireCdp(): CDPSession {
    if (!this.cdp) {
      throw new BrowserAutomationError('Browser live session is not started. Call start() first.');
    }
    return this.cdp;
  }
}

async function closeQuietly(automation: DesktopBrowserAutomation): Promise<void> {
  try {
    await automation.close();
  } catch (error) {
    console.warn('[browser-live-session] failed to close automation after start failure', error);
  }
}
