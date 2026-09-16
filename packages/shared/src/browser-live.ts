/**
 * 浏览器实时预览（P3-core）的线路协议。
 *
 * 网关与 Web 端通过一条 WebSocket 双向通道通信：网关下行 screencast 帧与
 * console / network / nav 等事件，Web 端上行 input / ack / 控制指令。
 *
 * 为什么放在 `@openAwork/shared`：网关与 `@openAwork/web-client` 必须消费同一套
 * 信封，而 web-client 不能依赖 `@openAwork/browser-automation`（含 Playwright
 * 重依赖、且面向 Node）。本模块零运行时逻辑，只有类型与少量常量。
 */

/** 通道判别标签。 */
export type BrowserLiveChannel =
  | 'hello'
  | 'frame'
  | 'console'
  | 'network'
  | 'nav'
  | 'node'
  | 'dom'
  | 'a11y'
  | 'screenshot'
  | 'device'
  | 'error'
  | 'pong'
  | 'ack'
  | 'input'
  | 'control';

/** 统一信封。下行由网关递增 `seq`；上行 `seq` 恒为 0。 */
export interface BrowserLiveEnvelope<TPayload = unknown> {
  ch: BrowserLiveChannel;
  seq: number;
  ts: number;
  payload: TPayload;
}

/** 握手：WS 建立后由网关发送一次，声明实时引擎是否可用。 */
export interface BrowserLiveHelloPayload {
  available: boolean;
  engine: string | null;
  screencast: boolean;
  viewport: { width: number; height: number } | null;
  reason?: string;
}

/** screencast 帧（JPEG base64）。字段名对齐 CDP `Page.screencastFrame` 的 metadata。 */
export interface BrowserLiveFramePayload {
  mimeType: 'image/jpeg';
  data: string;
  deviceWidth: number;
  deviceHeight: number;
  offsetTop: number;
  pageScaleFactor: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  /** 上行 ack 必须回传该 CDP frame sessionId，否则不再产出下一帧。 */
  frameSessionId: number;
}

export type BrowserLiveConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/**
 * 生成后脚本中的一个原始栈帧（CDP `Runtime.CallFrame` 的镜像）。
 * `line` / `column` 均为 **0-based**，与 CDP 保持一致，不做 1-based 转换。
 */
export interface BrowserLiveStackFrame {
  url: string;
  line: number;
  column: number;
  functionName?: string;
}

/**
 * 套用 dev server source map 后的栈帧。`line` / `column` 是原始（生成后）位置；
 * `sourceLine` / `sourceColumn` 是映射出的原始源码位置（同样 0-based）。
 */
export interface BrowserLiveResolvedStackFrame {
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

export interface BrowserLiveConsolePayload {
  level: BrowserLiveConsoleLevel;
  text: string;
  timestamp: number;
  /** CDP 原始栈帧；未关联到 CDP 事件或缺省时为 `undefined`。 */
  stack?: BrowserLiveStackFrame[];
  /** 套用 source map 后的栈；仅在携带 `stack` 时出现。 */
  sourceMappedStack?: BrowserLiveResolvedStackFrame[];
}

/** 一次请求分 request / response / failed 三个阶段上报，消费端按 `requestId` 归并。 */
export interface BrowserLiveNetworkPayload {
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

export interface BrowserLiveNavPayload {
  url: string;
  title: string;
  timestamp: number;
}

/** 元素拾取结果。`selector` 由服务端生成，保证在目标页可唯一定位。 */
export interface BrowserLiveNodePayload {
  selector: string;
  nodeName: string;
  attributes: Record<string, string>;
  text: string;
  computedStyles: Record<string, string>;
  selectorStrategy?: string;
  selectorUnique?: boolean;
  /**
   * 完整计算样式映射（`node.styles` 请求专属）。元素拾取（`pick`）保持既有默认
   * 行为不携带该字段，供检查器按需拿到全部样式。
   */
  fullComputedStyles?: Record<string, string>;
}

/**
 * DOM 树节点（`dom.tree` 回包）。CDP 把属性表示为扁平的 `[name, value, ...]`
 * 数组，服务端归一为键值对后再下发。
 */
export interface BrowserLiveDomNode {
  nodeId: number;
  backendNodeId: number;
  nodeName: string;
  attributes: Record<string, string>;
  childCount: number;
  children?: BrowserLiveDomNode[];
}

/** `dom.tree` 回包。`truncated` 表示因深度上限或节点数上限被裁剪。 */
export interface BrowserLiveDomPayload {
  root: BrowserLiveDomNode;
  truncated: boolean;
}

/** 无障碍树节点（`a11y.tree` 回包）。 */
export interface BrowserLiveA11yNode {
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
  children?: BrowserLiveA11yNode[];
}

/** `a11y.tree` 回包。`nodeCount` 为实际下发树中的节点数（受上限裁剪后）。 */
export interface BrowserLiveA11yPayload {
  root: BrowserLiveA11yNode | null;
  nodeCount: number;
}

/** 截图落为 artifact 后的描述符；字节由既有 `GET /artifacts/:id` 取回。 */
export interface BrowserLiveScreenshotPayload {
  artifactId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface BrowserLiveErrorPayload {
  code: string;
  message: string;
  /** 未捕获异常的 CDP 原始栈帧；缺省表示未关联到。 */
  stack?: BrowserLiveStackFrame[];
  /** 套用 source map 后的异常栈；仅在携带 `stack` 时出现。 */
  sourceMappedStack?: BrowserLiveResolvedStackFrame[];
}

export interface BrowserLiveDevicePayload {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
}

// ── 上行消息 ────────────────────────────────────────────────────────────

export type BrowserLiveInputMessage =
  | {
      ch: 'input';
      kind: 'mouse';
      type: 'mouseMoved' | 'mousePressed' | 'mouseReleased';
      x: number;
      y: number;
      button?: 'left' | 'right' | 'middle';
      clickCount?: number;
    }
  | { ch: 'input'; kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | {
      ch: 'input';
      kind: 'key';
      type: 'keyDown' | 'keyUp' | 'char';
      key?: string;
      text?: string;
      code?: string;
      windowsVirtualKeyCode?: number;
    };

/** 帧确认。服务端收到 ack 才放行下一帧 —— 这是整条通道的背压机制。 */
export interface BrowserLiveAckMessage {
  ch: 'ack';
  frameSessionId: number;
}

export interface BrowserLiveDeviceMessage {
  ch: 'device';
  width: number;
  height: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
  /**
   * UA 覆写（可选，加法字段）：
   * - 缺省：保持服务端当前 UA，不做任何改动；
   * - 非空串：覆写为指定 UA（移动端预设会带真实 UA）；
   * - 空串：清除覆写，恢复浏览器默认 UA。
   */
  userAgent?: string;
}

export type BrowserLiveControlMessage =
  | { ch: 'control'; action: 'navigate'; url: string }
  | { ch: 'control'; action: 'reload' }
  | { ch: 'control'; action: 'screencast.start' }
  | { ch: 'control'; action: 'screencast.stop' }
  | { ch: 'control'; action: 'pick'; x: number; y: number }
  | { ch: 'control'; action: 'screenshot'; fullPage?: boolean }
  | { ch: 'control'; action: 'ping' }
  | { ch: 'control'; action: 'dom.tree'; depth?: number }
  | { ch: 'control'; action: 'a11y.tree' }
  | { ch: 'control'; action: 'node.styles'; x: number; y: number };

export type BrowserLiveClientMessage =
  | BrowserLiveInputMessage
  | BrowserLiveAckMessage
  | BrowserLiveDeviceMessage
  | BrowserLiveControlMessage;

// ── 常量 ────────────────────────────────────────────────────────────────

/** WS 路径（挂查询串 token，同 `/sessions/:id/stream` 约定）。 */
export const BROWSER_LIVE_WS_PATH = '/browser-live';

/** REST 控制端点前缀。 */
export const BROWSER_LIVE_REST_PREFIX = '/browser-live';

/** 单帧上限（base64 字符数）；超过直接丢弃，避免撑爆 WS 缓冲。 */
export const BROWSER_LIVE_MAX_FRAME_BYTES = 1_500_000;

/** 未确认帧的高水位：达到即停止 ack，让 CDP 侧自然暂停产帧。 */
export const BROWSER_LIVE_HIGH_WATER_FRAMES = 3;
