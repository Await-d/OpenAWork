import type { BrowserContextOptions, LaunchOptions } from 'playwright';

import type { SupportedBrowserEngine } from './index.js';
import type { RawStackFrame, ResolvedStackFrame } from './source-map-resolver.js';

export type BrowserLiveConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type BrowserLiveSelectorStrategy = 'data-testid' | 'id' | 'role-name' | 'css-path';

export type BrowserLiveEvent =
  | {
      type: 'console';
      level: BrowserLiveConsoleLevel;
      text: string;
      timestamp: number;
      /** CDP 原始栈帧（0-based，见 `source-map-resolver.ts`）；关联失败时缺省。 */
      stack?: RawStackFrame[];
      /** 套用 dev server source map 后的栈；仅在拿到原始栈时出现。 */
      sourceMappedStack?: ResolvedStackFrame[];
      /** 产出该日志时的页面代次（主文档导航自增），供客户端丢弃过期页面的日志。 */
      generation?: number;
    }
  | {
      type: 'pageerror';
      message: string;
      timestamp: number;
      /** CDP `Runtime.exceptionThrown` 原始栈帧（0-based）；关联失败时缺省。 */
      stack?: RawStackFrame[];
      /** 套用 source map 后的异常栈；仅在拿到原始栈时出现。 */
      sourceMappedStack?: ResolvedStackFrame[];
      /** 产出该异常时的页面代次（同 console 的 `generation`）。 */
      generation?: number;
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
      /** 该请求所属的页面代次（同 console 的 `generation`）。 */
      generation?: number;
    }
  | { type: 'nav'; url: string; title: string; timestamp: number; generation: number }
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
      /** 该帧所属页面代次（主文档导航时自增），供客户端丢弃过期页面的帧。 */
      generation: number;
    }
  | { type: 'screencastEnd' };

export interface BrowserLiveNodeInfo {
  selectorHint: string;
  selectorStrategy: BrowserLiveSelectorStrategy;
  selectorUnique: boolean;
  nodeName: string;
  attributes: Record<string, string>;
  text: string;
  computedStyles: Record<string, string>;
  fullComputedStyles?: Record<string, string>;
}

/** `dom.tree` 的引擎级节点镜像（网关映射为线路协议）。 */
export interface BrowserLiveDomNodeLike {
  nodeId: number;
  backendNodeId: number;
  nodeName: string;
  attributes: Record<string, string>;
  childCount: number;
  children?: BrowserLiveDomNodeLike[];
}

export interface BrowserLiveDomTreeResult {
  root: BrowserLiveDomNodeLike;
  truncated: boolean;
}

/** `a11y.tree` 的引擎级节点镜像（网关映射为线路协议）。 */
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

export interface BrowserLiveA11ySnapshotResult {
  root: BrowserLiveA11yNodeLike | null;
  nodeCount: number;
}

export interface BrowserLiveNodeAtPointOptions {
  fullComputedStyles?: boolean;
}

/** `dom.tree` 未显式给 depth 时的默认深度。 */
export const BROWSER_LIVE_DOM_DEFAULT_DEPTH = 4;

/** `dom.tree` 允许的最大深度，更深的请求会被收敛到该值。 */
export const BROWSER_LIVE_DOM_MAX_DEPTH = 12;

/** DOM 树回包的节点总数上限，超出即裁剪并置 `truncated`。 */
export const BROWSER_LIVE_DOM_MAX_NODES = 2000;

/** 无障碍树回包的节点总数上限。 */
export const BROWSER_LIVE_A11Y_MAX_NODES = 2000;

export type BrowserLiveInputEvent =
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
      /** CDP 修饰键位掩码：Alt=1、Ctrl=2、Meta=4、Shift=8。 */
      modifiers?: number;
      /**
       * Blink 级编辑命令（`selectAll` / `undo` / `redo` / `cut` …）。
       *
       * CDP 的 `dispatchKeyEvent` 只负责把按键交给页面，浏览器原生编辑行为
       * （全选、撤销栈、剪切）不会因此发生，必须通过 `commands` 显式触发。
       */
      commands?: string[];
    }
  | {
      /** 输入法组合结果 / 粘贴：一条完整文本插入（`Input.insertText`）。 */
      kind: 'text';
      text: string;
    };

export interface BrowserLiveSessionOptions {
  engine?: SupportedBrowserEngine;
  launchOptions?: LaunchOptions;
  contextOptions?: BrowserContextOptions;
  startUrl?: string;
}

export interface BrowserLiveScreencastOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  format?: 'jpeg' | 'png';
  everyNthFrame?: number;
}

/**
 * 主文档滚动几何（`control.scroll.metrics` 的回包）。
 *
 * 实时画面是位图，浏览器自己的滚动条不会出现在截图里；客户端靠这份数据在本地画
 * 一条按比例、可拖动的滚动条。`maxScrollY` 为 0 表示页面不可滚动。
 */
export interface BrowserLiveScrollMetrics {
  scrollY: number;
  maxScrollY: number;
  viewportHeight: number;
  contentHeight: number;
}

export interface BrowserLiveDeviceMetrics {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
}
