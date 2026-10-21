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
  | 'clipboard'
  /** 主文档滚动指标（内容高度 / 视口 / 当前位置）：客户端据此画出可拖动的滚动条。 */
  | 'scroll'
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

/** screencast 帧（JPEG / PNG base64）。字段名对齐 CDP `Page.screencastFrame` 的 metadata。 */
export interface BrowserLiveFramePayload {
  mimeType: 'image/jpeg' | 'image/png';
  data: string;
  deviceWidth: number;
  deviceHeight: number;
  offsetTop: number;
  pageScaleFactor: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  /** 上行 ack 必须回传该 CDP frame sessionId，否则不再产出下一帧。 */
  frameSessionId: number;
  /**
   * 该帧所属的**页面代次**（主文档每导航一次自增）。
   *
   * 客户端快速切标签时，旧页面在切换前一瞬产出的帧会晚于新导航到达；只靠「收到帧的
   * 时间」无法把它与旧标签解耦，旧内容就会画进新标签。带上代次后客户端只认「当前
   * 代次」的帧，其余丢弃（仍回 ack 维持背压）。
   *
   * 老网关不下发该字段：缺省视为未知，客户端退回原来的时序判定。
   */
  generation?: number;
}

/**
 * 二进制帧的头部（不含图像字节）。
 *
 * 字段与 {@link BrowserLiveFramePayload} 一一对应，只是把 `data` 从 JSON 里拆出来：
 * base64 会让每帧多背 33% 体积，还要在两端各付一次编解码 CPU。
 */
export interface BrowserLiveFrameBinaryHeader {
  /** 与 JSON 信封一致的用户级单调序号。 */
  seq: number;
  /** 与 JSON 信封一致的网关生成时间戳。 */
  ts: number;
  mimeType: string;
  deviceWidth: number;
  deviceHeight: number;
  offsetTop: number;
  pageScaleFactor: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  frameSessionId: number;
  /** 该帧所属页面代次；与 JSON 帧的 `generation` 同义（老网关不填）。 */
  generation?: number;
}

/**
 * 二进制帧线路格式：
 *
 * ```
 * [0]                 kind = BROWSER_LIVE_BINARY_FRAME_KIND
 * [1..4]              headerLength（uint32，little-endian）
 * [5 .. 5+len)        header JSON（UTF-8）
 * [5+len .. ]         JPEG 原始字节
 * ```
 *
 * 用固定 5 字节前缀而不是「整包 JSON + 分隔符」：客户端不需要扫描字符串边界，
 * 也不存在图像字节里恰好出现分隔符的歧义。
 */
export const BROWSER_LIVE_BINARY_FRAME_KIND = 1;

/** 二进制帧信封的载荷：`data` 是 `ArrayBuffer`，其余字段同 JSON 帧。 */
export type BrowserLiveBinaryFramePayload = Omit<BrowserLiveFramePayload, 'data'> & {
  data: ArrayBuffer;
};

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
 *
 * **不含源码全文**：一条 console 可能带 12 帧，每帧附一份源文件会让单条日志膨胀到
 * 几十 KB，经 WS 传到浏览器端只是白白占带宽与主线程。展示层需要的只是「文件名 +
 * 行列」，因此线上协议刻意只带位置。
 */
export interface BrowserLiveResolvedStackFrame {
  url: string;
  line: number;
  column: number;
  functionName?: string;
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
  /**
   * 该日志所属的页面代次。
   *
   * 与帧同源（主文档导航自增）：快速切标签时旧页面最后几条日志会晚到，只按「当前
   * 激活标签」归属就会记到新标签上。消费端据此丢弃过期代次的日志。老网关不填。
   */
  generation?: number;
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
  /** 该请求所属的页面代次（同 console 的 `generation`）。老网关不填。 */
  generation?: number;
}

export interface BrowserLiveNavPayload {
  url: string;
  title: string;
  timestamp: number;
  /**
   * 这次导航之后的页面代次（与 `BrowserLiveFramePayload.generation` 同一口径）。
   *
   * 客户端靠它**精确**设置「可接受的最小代次」：写成「上一代 + 1」是猜测，一旦远端
   * 因故没有真正导航（同址跳转、导航失败），猜测值会永久高于实际代次，所有帧都被
   * 拒收 → 画面永久空白。老网关不下发时退回原来的时序判定。
   */
  generation?: number;
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
  /** 该异常所属的页面代次（同 console 的 `generation`）。老网关不填。 */
  generation?: number;
}

export interface BrowserLiveDevicePayload {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
}

/** `copySelection` 的回包：远端正选中文本；没有选区时为空串。 */
export interface BrowserLiveClipboardPayload {
  text: string;
}

/**
 * `scroll.metrics` / `scrollTo` 的回包：主文档的滚动几何。
 *
 * 实时画面是远端页面的位图，浏览器自己的滚动条不会出现在截图里；客户端只能拿这些
 * 数字在本地画一条可拖动的滚动条。`maxScrollY` 为 0 表示页面不可滚动。
 */
export interface BrowserLiveScrollPayload {
  /** 当前纵向滚动位置（CSS px）。 */
  scrollY: number;
  /** 可滚动距离 = `contentHeight - viewportHeight`（不小于 0）。 */
  maxScrollY: number;
  /** 视口高度（CSS px）。 */
  viewportHeight: number;
  /** 主文档内容高度（CSS px）。 */
  contentHeight: number;
  /** 该指标所属的页面代次；老网关不填。 */
  generation?: number;
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
      /**
       * CDP 修饰键位掩码：Alt=1、Ctrl=2、Meta=4、Shift=8。
       *
       * 不传时页面收到的是「无修饰按键」——`Shift+Enter` 会变成 `Enter`、
       * `Shift+方向键` 不再选择文本，这是快捷键语义错乱的根源。
       */
      modifiers?: number;
      /**
       * 交给 Blink 执行的编辑命令（`selectAll` / `undo` / `redo` / `cut` …）。
       *
       * 实时画面里的 `Ctrl/Cmd+A/Z/Y/X` 不能只发 `keyDown`：页面拿到的是键盘事件，
       * 但浏览器原生的编辑行为（全选、撤销栈、剪切）不会被 CDP 的 `dispatchKeyEvent`
       * 自动触发，必须走 `commands` 这一层。
       */
      commands?: string[];
    }
  | {
      /**
       * 直接插入文本（输入法组合结果 / 粘贴）。
       *
       * 逐字符发 `char` 在中文、日文、韩文输入法下会把一个词拆成多次输入，甚至把
       * 拼音字母直接打进页面；`Input.insertText` 是一条完整的文本插入，行为与真实
       * 输入法提交一致。
       */
      ch: 'input';
      kind: 'text';
      text: string;
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
  /** 浏览器历史后退：实时分支没有 iframe，页面历史在网关侧（保留 SPA state）。 */
  | { ch: 'control'; action: 'goBack' }
  | { ch: 'control'; action: 'goForward' }
  | {
      ch: 'control';
      action: 'screencast.start';
      /**
       * 帧的等比缩放盒与 JPEG 质量（可选，加法字段）。
       *
       * 客户端按「画面实际显示尺寸」算出自己真正需要的上限：面板窄时让网关少传
       * 像素（编码、传输、解码同步变快），面板宽时再用满默认盒子。缺省 / 非法值
       * 一律沿用服务端默认（最长边 1024 / 质量 50），老客户端行为不变。
       */
      maxWidth?: number;
      maxHeight?: number;
      quality?: number;
      /** screencast 编码格式：jpeg 为默认有损，png 为无损。 */
      format?: 'jpeg' | 'png';
      /**
       * 客户端是否支持二进制帧（`BROWSER_LIVE_BINARY_FRAME_KIND` 线路格式）。
       * 缺省 false：网关继续发 JSON + base64，老客户端不受影响。
       */
      binary?: boolean;
    }
  | { ch: 'control'; action: 'screencast.stop' }
  /**
   * 重新武装 screencast（沿用当前帧盒 / 质量），**立即产出一帧**。
   *
   * 场景：切标签 / 导航后客户端会丢弃「旧文档还在时」的帧；而 screencast 只在页面
   * 产生新 damage 时才推帧，静态页（含 `about:blank`）此后不再产帧，画面就永久空白。
   * `Page.startScreencast` 幂等且会立刻按当前视口推一帧，因此用它显式补帧。
   */
  | { ch: 'control'; action: 'screencast.refresh' }
  /**
   * 读取主文档滚动几何；回 `scroll` 通道。
   *
   * 实时画面不渲染浏览器滚动条，客户端需要这些数字才能画出一条按比例、可拖动的
   * 滚动条。页面动态长高 / 内部滚动后由客户端定期重取。
   */
  | { ch: 'control'; action: 'scroll.metrics' }
  /** 把主文档滚到指定位置（CSS px，负值 / 超界由服务端夹取）；回包带最新指标。 */
  | { ch: 'control'; action: 'scrollTo'; y: number }
  | { ch: 'control'; action: 'pick'; x: number; y: number }
  /**
   * 复制远端正选中文本。
   *
   * 实时画面里的 `Ctrl/Cmd+C` 不能交给本地浏览器：选区在远端页面，本地剪贴板里
   * 什么都没有。这里让网关取一次 `window.getSelection()`，回 `clipboard` 通道，
   * 前端再写入本地剪贴板。
   */
  | { ch: 'control'; action: 'copySelection' }
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

/**
 * controller 侧未确认帧的高水位：达到即暂停向它下发新帧。
 *
 * 注意它**不**用来暂停 CDP 产帧——网关收到帧就立刻 ack CDP（否则帧率被一个完整
 * 往返钉死），这里只限制「还没被客户端消费完的帧」有多少。等待下发的帧另有一个
 * 只保最新的槽位，所以配额满时客户端看到的是最新画面，而不是一串过期帧。
 */
export const BROWSER_LIVE_HIGH_WATER_FRAMES = 3;
