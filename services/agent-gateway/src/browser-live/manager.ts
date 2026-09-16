/**
 * 浏览器实时预览（P3-core）的会话管理器。
 *
 * 与 `tools/desktop-automation.ts` 同构：工厂 + 模块级单例，浏览器包**永远**在异步
 * 方法里动态 import —— Playwright 只允许在桌面 sidecar runtime 里加载，绝不能在
 * 模块顶层引入（否则普通网关进程也会拖起 Playwright）。
 *
 * 一个用户最多一条 live session；`acquire` / `release` 用引用计数表达「当前有多少
 * 个 WS 订阅者」；计数归零后先保温 `BROWSER_LIVE_IDLE_TTL_MS`，期间再次 acquire 会
 * 取消回收定时器，超时才真正 `close()`。
 */

import { randomUUID } from 'node:crypto';

const DEFAULT_BROWSER_LIVE_IDLE_TTL_MS = 120_000;

/** 与路由层错误分类器共享的契约字符串（disabled runtime）。 */
export const BROWSER_LIVE_DISABLED_MESSAGE = 'browser live view is disabled in this runtime';

/**
 * 与路由层错误分类器共享的契约前缀（runtime 已启用但探测不到浏览器）。
 * 完整消息形如 `browser live view is unavailable in this runtime: browser-missing`。
 */
export const BROWSER_LIVE_UNAVAILABLE_MESSAGE = 'browser live view is unavailable in this runtime';

/** `acquire()` 在探测失败时抛出的错误消息：带机器可读的 reason，便于路由层分类。 */
export function buildBrowserLiveUnavailableMessage(reason: string | undefined): string {
  return `${BROWSER_LIVE_UNAVAILABLE_MESSAGE}: ${reason ?? 'browser-missing'}`;
}

export type BrowserLiveConsoleLevelLike = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** 生成后脚本栈帧的结构镜像（CDP 约定，0-based，避免顶层依赖 Playwright 类型）。 */
export interface BrowserLiveStackFrameLike {
  url: string;
  line: number;
  column: number;
  functionName?: string;
}

/** 套用 source map 后栈帧的结构镜像。 */
export interface BrowserLiveResolvedStackFrameLike {
  url: string;
  line: number;
  column: number;
  functionName?: string;
  source: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
  sourceName: string | null;
  mapped: boolean;
}

/** `@openAwork/browser-automation` 的事件联合的结构镜像（避免顶层依赖 Playwright 类型）。 */
export type BrowserLiveEventLike =
  | {
      type: 'console';
      level: BrowserLiveConsoleLevelLike;
      text: string;
      timestamp: number;
      stack?: BrowserLiveStackFrameLike[];
      sourceMappedStack?: BrowserLiveResolvedStackFrameLike[];
    }
  | {
      type: 'pageerror';
      message: string;
      timestamp: number;
      stack?: BrowserLiveStackFrameLike[];
      sourceMappedStack?: BrowserLiveResolvedStackFrameLike[];
    }
  | {
      type: 'network';
      phase: 'request' | 'response' | 'failed';
      requestId: string;
      method: string;
      url: string;
      resourceType?: string;
      status?: number;
      statusText?: string;
      durationMs?: number;
      errorText?: string;
      requestHeadersSanitized?: Record<string, string>;
      responseHeadersSanitized?: Record<string, string>;
    }
  | { type: 'nav'; url: string; title: string; timestamp: number }
  | {
      type: 'screencastFrame';
      data: string;
      deviceWidth: number;
      deviceHeight: number;
      offsetTop: number;
      pageScaleFactor: number;
      scrollOffsetX: number;
      scrollOffsetY: number;
      frameSessionId: number;
      timestamp: number;
    }
  | { type: 'screencastEnd' };

export type BrowserLiveInputEventLike =
  | {
      kind: 'mouse';
      type: 'mouseMoved' | 'mousePressed' | 'mouseReleased';
      x: number;
      y: number;
      button?: 'left' | 'right' | 'middle';
      clickCount?: number;
    }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | {
      kind: 'key';
      type: 'keyDown' | 'keyUp' | 'char';
      key?: string;
      text?: string;
      code?: string;
      windowsVirtualKeyCode?: number;
    };

export interface BrowserLiveDeviceMetricsLike {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
}

export interface BrowserLiveNodeInfoLike {
  selectorHint: string;
  nodeName: string;
  attributes: Record<string, string>;
  text: string;
  computedStyles: Record<string, string>;
  fullComputedStyles?: Record<string, string>;
  selectorStrategy?: string;
  selectorUnique?: boolean;
}

export interface BrowserLiveDomNodeLike {
  nodeId: number;
  backendNodeId: number;
  nodeName: string;
  attributes: Record<string, string>;
  childCount: number;
  children?: BrowserLiveDomNodeLike[];
}

export interface BrowserLiveDomTreeResultLike {
  root: BrowserLiveDomNodeLike;
  truncated: boolean;
}

export interface BrowserLiveA11yNodeLike {
  role: string;
  name: string;
  value?: string;
  description?: string;
  ignored: boolean;
  focused?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  level?: number;
  children?: BrowserLiveA11yNodeLike[];
}

export interface BrowserLiveA11ySnapshotResultLike {
  root: BrowserLiveA11yNodeLike | null;
  nodeCount: number;
}

export interface BrowserLiveNodeAtPointOptionsLike {
  fullComputedStyles?: boolean;
}

export interface BrowserLiveScreencastOptionsLike {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  everyNthFrame?: number;
}

export interface BrowserLiveScreenshotOptionsLike {
  fullPage?: boolean;
  type?: 'png' | 'jpeg';
  quality?: number;
}

/** `BrowserLiveSession` 的结构镜像，供测试注入 fake，无需加载 Playwright。 */
export interface BrowserLiveSessionLike {
  start(): Promise<void>;
  isStarted(): boolean;
  getEngine(): 'chromium' | 'firefox' | 'webkit';
  supportsScreencast(): boolean;
  onEvent(handler: (event: BrowserLiveEventLike) => void): () => void;
  goto(url: string): Promise<void>;
  reload(): Promise<void>;
  currentUrl(): Promise<string>;
  currentTitle(): Promise<string>;
  startScreencast(options?: BrowserLiveScreencastOptionsLike): Promise<void>;
  ackScreencastFrame(frameSessionId: number): Promise<void>;
  stopScreencast(): Promise<void>;
  setDeviceMetricsOverride(metrics: BrowserLiveDeviceMetricsLike): Promise<void>;
  clearDeviceMetricsOverride(): Promise<void>;
  setUserAgentOverride(userAgent: string | null): Promise<void>;
  dispatchInput(event: BrowserLiveInputEventLike): Promise<void>;
  nodeAtPoint(
    x: number,
    y: number,
    options?: BrowserLiveNodeAtPointOptionsLike,
  ): Promise<BrowserLiveNodeInfoLike | null>;
  domTree(options?: { depth?: number }): Promise<BrowserLiveDomTreeResultLike>;
  accessibilitySnapshot(): Promise<BrowserLiveA11ySnapshotResultLike>;
  screenshot(options?: BrowserLiveScreenshotOptionsLike): Promise<{ buffer: Buffer; mimeType: string }>;
  close(): Promise<void>;
}

export interface BrowserLiveAvailability {
  available: boolean;
  engine: string | null;
  screencast: boolean;
  reason?: string;
  /** 当前原因是否可以通过安装浏览器解决（disabled runtime 时不携带该字段）。 */
  installable?: boolean;
  /** 可用浏览器的来源：`managed` | `override` | `system-*`（探针契约的结构镜像）。 */
  source?: BrowserLiveProbeSourceLike | null;
  /** managed 安装的 Playwright 修订号；系统浏览器与 override 为 null。 */
  expectedRevision?: string | null;
  /** 探测解析到的可执行文件路径（不可用时可能指向缺失的 managed 安装）。 */
  executablePath?: string | null;
}

/** 可用浏览器来源（`@openAwork/browser-automation` 探针契约的结构镜像）。 */
export type BrowserLiveProbeSourceLike =
  | 'managed'
  | 'override'
  | 'system-chrome'
  | 'system-chromium'
  | 'system-edge'
  | 'system-brave'
  | 'system-vivaldi'
  | 'system-opera';

/** 探测结论 token。 */
export type BrowserLiveProbeReasonLike =
  | 'ready'
  | 'browser-missing'
  | 'browser-outdated'
  | 'probe-failed';

/** `@openAwork/browser-automation` 探针结果的结构镜像（避免顶层依赖 Playwright 类型）。 */
export interface BrowserLiveProbeResultLike {
  available: boolean;
  engine: string;
  source: BrowserLiveProbeSourceLike | null;
  executablePath: string | null;
  expectedRevision: string | null;
  reason: BrowserLiveProbeReasonLike;
  installable: boolean;
}

/** 只声明网关会主动注入的启动项（`LaunchOptions` 的子集）。 */
export interface BrowserLiveLaunchOptionsLike {
  executablePath?: string;
}

/** `BrowserLiveSessionOptions` 的结构镜像；目前只用到 `launchOptions`。 */
export interface BrowserLiveSessionOptionsLike {
  launchOptions?: BrowserLiveLaunchOptionsLike;
}

export type BrowserLiveProbeLike = () => Promise<BrowserLiveProbeResultLike>;

export interface BrowserLiveHandle {
  readonly id: string;
  readonly userId: string;
  readonly session: BrowserLiveSessionLike;
}

export interface BrowserLiveManager {
  availability(): Promise<BrowserLiveAvailability>;
  acquire(userId: string): Promise<BrowserLiveHandle>;
  release(handle: BrowserLiveHandle): void;
  handleFor(userId: string): BrowserLiveHandle | null;
  close(): Promise<void>;
}

type BrowserLiveSessionFactory = (
  options: BrowserLiveSessionOptionsLike,
) => BrowserLiveSessionLike | Promise<BrowserLiveSessionLike>;

export interface BrowserLiveManagerOptions {
  enabled: boolean;
  idleTtlMs?: number;
  /** 测试注入用；缺省时惰性 import 真实的 `BrowserLiveSession`。 */
  createSession?: BrowserLiveSessionFactory;
  /** 测试注入用；缺省时惰性 import 真实的 Playwright 可用性探针。 */
  probeBrowserAvailability?: BrowserLiveProbeLike;
}

interface BrowserLiveModule {
  BrowserLiveSession: new (options?: BrowserLiveSessionOptionsLike) => BrowserLiveSessionLike;
  probeLiveBrowserAvailability: BrowserLiveProbeLike;
}

interface LiveSessionEntry {
  handle: BrowserLiveHandle;
  refCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/**
 * 来源不对称（有意为之）：
 * - `override` 与所有 `system-*`：显式传 `executablePath`。Playwright 会直接启动该
 *   二进制并跳过修订号校验——override 是用户显式指定，系统浏览器本就是稳定版而不是
 *   Playwright 匹配的修订版，这是唯一的回退路径。
 * - `managed`：省略 `executablePath`，让 Playwright 自己解析并校验 `chromium-<revision>`，
 *   保留它内建的修订号/完整性检查。
 */
function buildSessionOptions(probe: BrowserLiveProbeResultLike): BrowserLiveSessionOptionsLike {
  if (probe.source !== null && probe.source !== 'managed' && probe.executablePath) {
    return { launchOptions: { executablePath: probe.executablePath } };
  }
  return {};
}

class BrowserLiveManagerImpl implements BrowserLiveManager {
  private readonly enabled: boolean;
  private readonly idleTtlMs: number;
  private readonly createSession: BrowserLiveSessionFactory | null;
  private readonly probeBrowserAvailability: BrowserLiveProbeLike | null;
  private readonly entries = new Map<string, LiveSessionEntry>();
  private readonly creating = new Map<string, Promise<LiveSessionEntry>>();

  constructor(options: BrowserLiveManagerOptions) {
    this.enabled = options.enabled;
    this.idleTtlMs =
      options.idleTtlMs ?? readPositiveIntEnv('BROWSER_LIVE_IDLE_TTL_MS', DEFAULT_BROWSER_LIVE_IDLE_TTL_MS);
    this.createSession = options.createSession ?? null;
    this.probeBrowserAvailability = options.probeBrowserAvailability ?? null;
  }

  async availability(): Promise<BrowserLiveAvailability> {
    if (!this.enabled) {
      return {
        available: false,
        engine: null,
        screencast: false,
        reason: BROWSER_LIVE_DISABLED_MESSAGE,
      };
    }

    const probe = await this.probeBrowser();
    if (!probe.available) {
      return {
        available: false,
        engine: probe.executablePath ? 'chromium' : null,
        screencast: false,
        reason: probe.reason,
        installable: probe.installable,
        source: probe.source,
        expectedRevision: probe.expectedRevision,
        executablePath: probe.executablePath,
      };
    }

    for (const entry of this.entries.values()) {
      if (entry.handle.session.isStarted()) {
        const engine = entry.handle.session.getEngine();
        return {
          available: true,
          engine,
          screencast: engine === 'chromium',
        };
      }
    }

    // 无活跃会话时也必须从探测结果推导能力：探测已经解析到可执行文件，说明
    // chromium 立即可用；否则冷启动的 UI 会误判「没有 live/ screencast 引擎」。
    return {
      available: true,
      engine: probe.engine,
      screencast: probe.engine === 'chromium',
    };
  }

  async acquire(userId: string): Promise<BrowserLiveHandle> {
    this.assertEnabled();

    const existing = this.entries.get(userId);
    if (existing) {
      existing.refCount += 1;
      this.cancelIdleTimer(existing);
      return existing.handle;
    }

    const probe = await this.requireAvailableBrowser();

    let pending = this.creating.get(userId);
    if (!pending) {
      pending = this.createEntry(userId, probe);
      this.creating.set(userId, pending);
      // 无论成功失败都清理 creating 表；这里单独挂 handler，避免 .finally 产生的
      // 派生 promise 在失败时变成 unhandled rejection。
      void pending.then(
        () => {
          this.creating.delete(userId);
        },
        () => {
          this.creating.delete(userId);
        },
      );
    }

    const entry = await pending;
    entry.refCount += 1;
    this.cancelIdleTimer(entry);
    return entry.handle;
  }

  release(handle: BrowserLiveHandle): void {
    const entry = this.entries.get(handle.userId);
    if (!entry || entry.handle.id !== handle.id) {
      return;
    }
    if (entry.refCount > 0) {
      entry.refCount -= 1;
    }
    if (entry.refCount > 0) {
      return;
    }
    this.scheduleIdleClose(entry);
  }

  handleFor(userId: string): BrowserLiveHandle | null {
    return this.entries.get(userId)?.handle ?? null;
  }

  async close(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.creating.clear();

    for (const entry of entries) {
      this.cancelIdleTimer(entry);
      await this.closeSession(entry.handle.session);
    }
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new Error(BROWSER_LIVE_DISABLED_MESSAGE);
    }
  }

  private async requireAvailableBrowser(): Promise<BrowserLiveProbeResultLike> {
    const probe = await this.probeBrowser();
    if (!probe.available) {
      throw new Error(buildBrowserLiveUnavailableMessage(probe.reason));
    }
    return probe;
  }

  private async probeBrowser(): Promise<BrowserLiveProbeResultLike> {
    if (this.probeBrowserAvailability) {
      return await this.probeBrowserAvailability();
    }

    const browserAutomation =
      (await import('@openAwork/browser-automation')) as BrowserLiveModule;
    return await browserAutomation.probeLiveBrowserAvailability();
  }

  private async createEntry(
    userId: string,
    probe: BrowserLiveProbeResultLike,
  ): Promise<LiveSessionEntry> {
    const session = await this.resolveSession(buildSessionOptions(probe));
    await session.start();
    const handle: BrowserLiveHandle = { id: randomUUID(), userId, session };
    const entry: LiveSessionEntry = { handle, refCount: 0, idleTimer: null };
    this.entries.set(userId, entry);
    return entry;
  }

  private async resolveSession(
    options: BrowserLiveSessionOptionsLike,
  ): Promise<BrowserLiveSessionLike> {
    if (this.createSession) {
      return await this.createSession(options);
    }

    const browserAutomation =
      (await import('@openAwork/browser-automation')) as BrowserLiveModule;
    return new browserAutomation.BrowserLiveSession(options);
  }

  private scheduleIdleClose(entry: LiveSessionEntry): void {
    if (entry.idleTimer) {
      return;
    }

    const timer = setTimeout(() => {
      entry.idleTimer = null;
      void this.disposeEntry(entry.handle.userId, entry.handle.id);
    }, this.idleTtlMs);
    const unrefable = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
    unrefable.unref?.();
    entry.idleTimer = timer;
  }

  private cancelIdleTimer(entry: LiveSessionEntry): void {
    if (!entry.idleTimer) {
      return;
    }
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  private async disposeEntry(userId: string, handleId: string): Promise<void> {
    const entry = this.entries.get(userId);
    if (!entry || entry.handle.id !== handleId) {
      return;
    }
    if (entry.refCount > 0) {
      return;
    }

    this.cancelIdleTimer(entry);
    this.entries.delete(userId);
    await this.closeSession(entry.handle.session);
  }

  private async closeSession(session: BrowserLiveSessionLike): Promise<void> {
    try {
      await session.close();
    } catch (error) {
      console.warn('[browser-live-manager] failed to close live session', error);
    }
  }
}

export function createBrowserLiveManager(
  options: BrowserLiveManagerOptions,
): BrowserLiveManager {
  return new BrowserLiveManagerImpl(options);
}

/**
 * 实时预览是否启用。
 *
 * `OPENAWORK_BROWSER_LIVE` 是专用开关；`DESKTOP_AUTOMATION` 保留为兼容别名——
 * 桌面端 sidecar 一直用它注入，不能移除。两者分开后，Web / 服务器部署可以只开
 * 实时预览，而不顺带把 `desktop_automation` 工具暴露给 Agent。
 */
export function isBrowserLiveEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env['OPENAWORK_BROWSER_LIVE'] === '1' || env['DESKTOP_AUTOMATION'] === '1';
}

export const browserLiveManager = createBrowserLiveManager({
  enabled: isBrowserLiveEnabled(process.env),
});
