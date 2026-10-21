/**
 * `CdpLiveEngine` —— CDP 实时预览的 DOM 视图（绝不创建原生 webview）。
 *
 * 数据流：
 * screencast 帧（二进制 JPEG / JSON base64）→ 离主线程解码 → 画进 `<canvas>` → 回 ack；
 * DOM 上的鼠标 / 滚轮 / 键盘事件 → 设备像素坐标 → `{ ch: 'input' }` 上行。
 *
 * 两个容易踩坏的点：
 * 1. **ack 决定在途配额**：hub 对 CDP 侧收到帧即放行，但对本端有「未 ack 在途帧数」
 *    上限；漏 ack 会让那一帧的配额白占到 watchdog 才回收，帧率被自己压低。
 * 2. **坐标必须用帧的 `deviceWidth` / `deviceHeight`**：
 *    `Emulation.setDeviceMetricsOverride` 不会改变 Playwright 自己的 viewport，
 *    帧 metadata 才是唯一可信的尺寸来源。
 * 3. **缩放只走 CSS `transform`**：不写设备指标、不写 pageScale；`toDevicePoint`
 *    按同一档位反算，缩放后点击 / hover 才不会偏。
 *
 * 颜色 / 间距 / 圆角一律走 E · Nebula token（`var(--…)`），禁止硬编码色值。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import type { BrowserLiveDeviceMessage, BrowserLiveInputMessage } from '@openAwork/shared';

import { canDecodeFrameOffThread } from '../frame-decode.js';
import { resolveDevicePreset, type BrowserDevicePreset } from '../device-presets.js';
import { PREVIEW_IME_ATTRIBUTE } from '../hooks/use-browser-preview-shortcuts.js';
import { resolveQualityPreset } from '../quality-presets.js';
import { DEFAULT_URL } from '../browser-storage.js';
import { NAVIGABLE_URL_PATTERN } from '../browser-url.js';
import { createPointerInputBatch } from '../pointer-input-batch.js';
import { useCdpLivePick, type CdpLivePickFeedback } from '../hooks/use-cdp-live-pick.js';
import { useCdpLiveFrames } from '../hooks/use-cdp-live-frames.js';
import { useDocumentVisibility } from '../hooks/use-document-visibility.js';
import type { BrowserLivePhase, BrowserLiveSession } from '../hooks/use-browser-live-session.js';
import { LiveScrollbar } from './live-scrollbar.js';
import './cdp-live-engine.css';

/** 设备尺寸 / UA 下发的防抖窗口：拖拽面板大小时不逐帧打 socket。 */
export const DEVICE_SYNC_DEBOUNCE_MS = 200;

export interface LiveRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FrameMetrics {
  deviceWidth: number;
  deviceHeight: number;
}

/** 退化盒子（0 / 缺失）下兜底绘制的最大边长（CSS 像素）。 */
export const FALLBACK_FRAME_MAX_SIZE = 2048;

/** 自绘滚动条的视觉参数：宽 10px，离画面右缘留 2px 缝。 */
const SCROLLBAR_WIDTH = 10;
const SCROLLBAR_EDGE_INSET = 2;

/**
 * 把帧按 `deviceWidth` / `deviceHeight` 等比放进可用盒子：返回渲染尺寸，
 * 绝不拉伸（letterbox 交给外层居中）。
 *
 * 可用盒子退化（0 / NaN / 未测量）时**不返回 null**，而是按帧自身设备尺寸兜底
 * （最长边裁剪到 `FALLBACK_FRAME_MAX_SIZE`）：只要帧有效就必须有渲染尺寸——
 * 面板高度塌陷时宁可让外围 CSS 裁剪画面，也不能出现「帧在流、画面为空」。
 */
export function computeFrameLayout(
  available: { width: number; height: number } | null | undefined,
  frame: FrameMetrics,
): { width: number; height: number } | null {
  const deviceWidth = frame.deviceWidth;
  const deviceHeight = frame.deviceHeight;
  if (!(deviceWidth > 0) || !(deviceHeight > 0)) return null;

  const availableWidth = available?.width ?? 0;
  const availableHeight = available?.height ?? 0;
  const scale =
    availableWidth > 0 && availableHeight > 0
      ? Math.min(availableWidth / deviceWidth, availableHeight / deviceHeight)
      : Math.min(1, FALLBACK_FRAME_MAX_SIZE / Math.max(deviceWidth, deviceHeight));
  return {
    width: Math.max(1, Math.round(deviceWidth * scale)),
    height: Math.max(1, Math.round(deviceHeight * scale)),
  };
}

/** 画面在容器内的真实内容盒（小画面居中，四周是 letterbox 空白）。 */
export function computeContentBox(container: LiveRect, frame: FrameMetrics): LiveRect | null {
  const layout = computeFrameLayout(container, frame);
  if (!layout) return null;
  return {
    left: container.left + (container.width - layout.width) / 2,
    top: container.top + (container.height - layout.height) / 2,
    width: layout.width,
    height: layout.height,
  };
}

/**
 * 渲染 CSS 像素 → 设备像素。
 *
 * 缩放是围绕内容盒中心的 CSS `transform: scale()`，所以先把屏幕坐标按 zoom
 * 反算回未缩放的内容盒坐标，再做等比映射——少这一步，放大 / 缩小之后点击与
 * hover 都会落在错误的位置。
 *
 * 落在 letterbox 区域（画面之外）的点击返回 null，避免把空白处的坐标当成
 * 真实点击下发到远端。
 */
export function toDevicePoint(input: {
  container: LiveRect;
  frame: FrameMetrics;
  clientX: number;
  clientY: number;
  /** 纯前端缩放档位；缺省 1（100%）。 */
  zoom?: number;
}): { x: number; y: number } | null {
  const box = computeContentBox(input.container, input.frame);
  if (!box) return null;

  const zoom = input.zoom !== undefined && input.zoom > 0 ? input.zoom : 1;
  const centerX = box.left + box.width / 2;
  const centerY = box.top + box.height / 2;
  const localX = (input.clientX - centerX) / zoom + box.width / 2;
  const localY = (input.clientY - centerY) / zoom + box.height / 2;
  if (localX < 0 || localY < 0 || localX > box.width || localY > box.height) return null;

  const deviceWidth = Math.max(1, input.frame.deviceWidth);
  const deviceHeight = Math.max(1, input.frame.deviceHeight);
  return {
    x: Math.min(Math.max(Math.round((localX / box.width) * deviceWidth), 0), deviceWidth - 1),
    y: Math.min(Math.max(Math.round((localY / box.height) * deviceHeight), 0), deviceHeight - 1),
  };
}

/** 一次 `device` 上行要下发的目标（固定预设 / 自适应面板尺寸）。 */
export interface DeviceSyncTarget {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  /** 空串 = 清除 UA 覆写，恢复服务端默认。 */
  userAgent: string;
}

/**
 * 解析设备同步目标：固定预选用预设尺寸，自适应用当前面板测量值
 * （视口跟随面板，不需要单独发一条「清除」消息）。
 */
export function resolveDeviceSyncTarget(
  preset: BrowserDevicePreset | null,
  panelSize: { width: number; height: number } | null,
  displayScale = 1,
): DeviceSyncTarget | null {
  if (preset !== null && preset.width > 0 && preset.height > 0) {
    return {
      width: Math.round(preset.width),
      height: Math.round(preset.height),
      deviceScaleFactor: preset.deviceScaleFactor,
      mobile: preset.mobile,
      userAgent: preset.userAgent ?? '',
    };
  }

  if (!panelSize || !(panelSize.width >= 1) || !(panelSize.height >= 1)) return null;
  // 视口物理像素 = 面板尺寸 × deviceScaleFactor，帧才可能拿到比 CSS 像素更细的位图。
  // 只改 screencast 盒子是不够的——CDP 从不放大位图。倍数已经在调用方按 DPR 收敛过，
  // 这里不再二次缩放。
  return {
    width: Math.round(panelSize.width),
    height: Math.round(panelSize.height),
    deviceScaleFactor: displayScale,
    mobile: false,
    userAgent: '',
  };
}

/** 客户端协商的帧盒上限（物理像素）；与网关侧校验上限一致。 */
export const SCREENCAST_FRAME_EDGE_LIMIT = 2048;

/**
 * 面板尺寸的稳定化容差（相对边长）。
 *
 * 帧盒变化会让网关重开 `Page.startScreencast` 并全量重编码一帧，因此不能按像素级变化
 * 触发。10% 是取舍：拖拽时重编码次数从「每像素一次」降到「每十来个像素一次」，
 * 而 10% 以内的尺寸差在画面上看不出来（帧盒本来就会被等比缩放进显示盒）。
 */
export const SURFACE_SIZE_EPSILON_RATIO = 0.1;

/** 读取本机显示器 DPR；非浏览器环境或异常值一律按 1 处理。 */
function readDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  const value = window.devicePixelRatio;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * 把画质档位的像素倍数收敛到显示器 DPR 以内：`min(档位倍数, devicePixelRatio)`。
 *
 * 档位倍数描述的是「愿意要多少物理像素」，而显示器能给的上限就是 CSS 像素 × DPR。
 * 在 1x 屏幕上按 1.5 倍取像素，等于让 Chromium 把页面按 1.5 倍光栅化、再缩回去显示：
 * 编码 / 传输 / 解码成本全额支付，清晰度一点没涨——这是「又卡又糊」的典型来源。
 * 高 DPR 屏上则保留档位倍数（只到 DPR 为止），不会无谓地把帧撑大。
 */
export function resolveDisplayScale(presetScale: number, devicePixelRatio: number): number {
  const safePreset = Number.isFinite(presetScale) && presetScale > 0 ? presetScale : 1;
  const safeDpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(safePreset, safeDpr);
}

/**
 * 按「画面实际显示尺寸 × 实得像素倍数」算出帧盒。
 *
 * 下界 1 倍保证不糊（1:1 像素），上界封顶避免超高 DPR 面板把帧撑到几百万像素；
 * 尺寸未知（未测量 / 0）时不带字段，交给服务端默认定档——首次起流通常发生在
 * 已测量之后，这里只是兜底。
 */
export function resolveScreencastRequest(
  surfaceSize: { width: number; height: number } | null,
  displayScale = 1,
): { maxWidth?: number; maxHeight?: number } {
  if (surfaceSize === null || !(surfaceSize.width >= 1) || !(surfaceSize.height >= 1)) {
    return {};
  }
  const scale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
  return {
    maxWidth: Math.min(
      SCREENCAST_FRAME_EDGE_LIMIT,
      Math.max(1, Math.round(surfaceSize.width * scale)),
    ),
    maxHeight: Math.min(
      SCREENCAST_FRAME_EDGE_LIMIT,
      Math.max(1, Math.round(surfaceSize.height * scale)),
    ),
  };
}

interface CdpLiveEngineProps {
  session: BrowserLiveSession;
  /** 当前 tab 的地址：首次进入与地址变更时把远端导航过去。 */
  url: string;
  /** 当前激活标签 id：切换标签时清空画面，避免残留上一个标签的内容。 */
  tabId: string;
  /** 面板整体隐藏时保留挂载（与 iframe 分支一致），只是不显示。 */
  hidden: boolean;
  /** 元素拾取是否已武装（由工具栏驱动）。 */
  pickArmed: boolean;
  /** 拾取请求已发出：宿主解除武装。 */
  onPickConsumed: () => void;
  /** 拾取被 Esc 取消：宿主解除武装。 */
  onPickCancel: () => void;
  /**
   * 拾取意图：
   * - `composer`（缺省）：下发 `pick`，命中结果插进 composer；
   * - `styles`：下发 `node.styles`（回包带 `fullComputedStyles`，不写 composer），
   *   供元素检查器读取完整计算样式。
   */
  pickIntent?: 'composer' | 'styles';
  /** 拾取坐标上报：宿主记录坐标，供检查器的 `node.styles` 复用。 */
  onPickPoint?: (point: { x: number; y: number }) => void;
  /** 工具栏「刷新」信号：变化即向远端下发 reload（与 iframe 分支的刷新语义对齐）。 */
  refreshKey: number;
  /** 设备预设 id：固定尺寸下发预设视口，自适应下发面板测量值。 */
  devicePresetId: string;
  /** 画质档位（流畅 / 均衡 / 清晰）：决定帧盒倍数与起流质量。 */
  qualityPresetId: string;
  /** 纯前端缩放档位（1 = 100%）：只改 CSS transform 与坐标反算。 */
  zoom: number;
  /**
   * 帧率持续过低时宿主可切到原生渲染（iframe）：原生合成不受 CDP 的
   * 编码 / 传输 / 解码链路限制，输入也直达页面。缺省时提示条不出现。
   */
  onRequestNativeRender?: () => void;
  /**
   * 页面代次门槛（宿主持有，与控制台 / 网络的事件过滤共用同一份）。
   *
   * 缺省时引擎自己内部维护一个：面板单独挂载 / 单测场景仍然有代次过滤。
   */
  minGenerationRef?: RefObject<number | null>;
}

interface StatusChip {
  label: string;
  color: string;
  dot: string;
}

function describeStatusChip(phase: BrowserLivePhase): StatusChip {
  switch (phase) {
    case 'connected':
      return { label: '实时', color: 'var(--accent)', dot: 'var(--accent)' };
    case 'connecting':
      return { label: '连接中', color: 'var(--warning)', dot: 'var(--warning)' };
    case 'reconnecting':
      return { label: '重连中', color: 'var(--warning)', dot: 'var(--warning)' };
    case 'error':
      return { label: '已断开', color: 'var(--danger)', dot: 'var(--danger)' };
    default:
      return { label: '未启动', color: 'var(--fg-subtle)', dot: 'var(--fg-subtle)' };
  }
}

/** 阻断式状态文案：仅在画面无法给出有效内容时展示在中央。 */
function describeBlockingMessage(
  phase: BrowserLivePhase,
  lastError: string | null,
  hasFrame: boolean,
): { text: string; color: string } | null {
  if (phase === 'error') {
    return { text: lastError ?? '实时预览已断开', color: 'var(--danger)' };
  }
  if (hasFrame) return null;
  if (phase === 'reconnecting') {
    return { text: '连接已断开，正在重连…', color: 'var(--warning)' };
  }
  if (phase === 'connecting') {
    return { text: '正在连接实时预览…', color: 'var(--fg-muted)' };
  }
  if (phase === 'connected') {
    return { text: '等待实时画面…', color: 'var(--fg-muted)' };
  }
  return { text: '实时预览未启动', color: 'var(--fg-muted)' };
}

const STATUS_CHIP_STYLE: CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 18,
  padding: '0 8px',
  borderRadius: 'var(--radius-pill)',
  background: 'color-mix(in oklch, var(--bg-overlay) 88%, transparent)',
  border: '1px solid var(--border-default)',
  fontSize: 10,
  fontWeight: 600,
  pointerEvents: 'none',
};

/** 帧体量的短标签：角标宽度有限，只保留到 KB / 一位小数的 MB。 */
function formatFrameChars(chars: number): string {
  if (chars <= 0) return '0KB';
  if (chars >= 1024 * 1024) return `${(chars / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.round(chars / 1024)}KB`;
}

const SIZE_CHIP_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: 8,
  right: 8,
  padding: '2px 6px',
  borderRadius: 'var(--radius-xs)',
  background: 'color-mix(in oklch, var(--bg-overlay) 88%, transparent)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--fg-subtle)',
  fontSize: 10,
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'none',
};

const PICK_BANNER_STYLE: CSSProperties = {
  position: 'absolute',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 24,
  padding: '0 12px',
  borderRadius: 'var(--radius-pill)',
  background: 'color-mix(in oklch, var(--accent) 18%, var(--bg-overlay))',
  border: '1px solid var(--accent-border)',
  boxShadow: 'var(--shadow-md)',
  color: 'var(--accent)',
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

const PICK_BANNER_DOT_STYLE: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 'var(--radius-pill)',
  background: 'var(--accent)',
  boxShadow: '0 0 8px var(--accent)',
  animation: 'pulse 1.6s ease-in-out infinite',
};

/**
 * 低帧率提示阈值。
 *
 * 连续 `SLOW_FPS_SAMPLES` 个采样窗口都低于 `SLOW_FPS_THRESHOLD` 才提示：偶发的
 * 一次采样偏低（页面重载、主线程抖动）不代表链路有问题。
 */
const SLOW_FPS_THRESHOLD = 8;
const SLOW_FPS_SAMPLES = 3;

/**
 * 画面闸门的兜底放行时间。
 *
 * 正常情况下网关的 `nav` 事件 150ms 内就到（`NAVIGATION_SETTLE_DELAY_MS`）。
 * 目标页自己立刻跳走、或加载失败永远不回报时，靠这个超时避免画面永久空白。
 */
const GATE_RELEASE_TIMEOUT_MS = 1500;

/**
 * 代次过滤的兜底阈值：连续这么多帧都因代次过低被拒，就放弃过滤并接受实际代次。
 *
 * 阈值要大到「正常切换时的旧帧（个位数）」不会误触发，又要小到「异常情况」下用户
 * 不会面对长时间空白。按 30fps 估算，12 帧约 0.4s。
 */
const GENERATION_FALLBACK_REJECTS = 12;

/**
 * 把代次门槛写进「实际生效的那一份 ref」。
 *
 * 放在模块级是刻意的：在组件体内联写 `props.minGenerationRef.current = …` 会被
 * React Compiler 判成「修改不可变的 props」而报错、并放弃优化整个组件；把它挪出组件
 * 作用域后，编译器不再把这个写入认成对 props 的变更，语义完全不变。
 */
function writeMinGeneration(
  external: { current: number | null } | undefined,
  local: { current: number | null },
  value: number | null,
): void {
  const target = external ?? local;
  target.current = value;
}

/** 低帧率提示条：给出一条「换原生渲染」的出路，而不是让用户对着卡顿猜。 */
const SLOW_FPS_BANNER_STYLE: CSSProperties = {
  position: 'absolute',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 3,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  maxWidth: 'calc(100% - 32px)',
  padding: '6px 10px',
  borderRadius: 'var(--radius-pill)',
  border: '1px solid color-mix(in oklch, var(--warning) 40%, var(--border-default))',
  background: 'color-mix(in oklch, var(--bg-overlay) 92%, transparent)',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
};

const SLOW_FPS_ACTION_STYLE: CSSProperties = {
  border: '1px solid var(--accent-border)',
  borderRadius: 'var(--radius-xs)',
  background: 'var(--accent-subtle)',
  color: 'var(--accent)',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  cursor: 'pointer',
};

/** 拾取结果反馈：success / warning 两种语义色，非阻塞（不拦截指针）。 */
const PICK_TOAST_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  maxWidth: 'calc(100% - 32px)',
  padding: '8px 12px',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-md)',
  fontSize: 11,
  fontWeight: 600,
  pointerEvents: 'none',
};

/** 反馈里选择器的等宽展示：过长时省略，不撑破气泡。 */
const PICK_TOAST_SELECTOR_STYLE: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 220,
  fontFamily: 'var(--font-mono, monospace)',
  fontWeight: 500,
  opacity: 0.85,
};

interface PickToastChrome {
  background: string;
  border: string;
  color: string;
  icon: string;
  label: string;
}

function describePickToast(ambiguous: boolean): PickToastChrome {
  if (ambiguous) {
    return {
      background: 'var(--warning-muted)',
      border: '1px solid var(--warning-border)',
      color: 'var(--warning)',
      icon: 'M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
      label: '选择器可能不唯一，已引用到输入框',
    };
  }
  return {
    background: 'var(--success-muted)',
    border: '1px solid var(--success-border)',
    color: 'var(--success)',
    icon: 'M20 6 9 17l-5-5',
    label: '已引用元素到输入框',
  };
}

/** 拾取完成提示：短时展示后由 hook 自动清空，不拦截指针。 */
function PickToast({ feedback }: { feedback: CdpLivePickFeedback }) {
  const chrome = describePickToast(feedback.ambiguous);
  return (
    <div
      data-toast=""
      role="status"
      style={{
        ...PICK_TOAST_STYLE,
        background: chrome.background,
        border: chrome.border,
        color: chrome.color,
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <path d={chrome.icon} />
      </svg>
      <span>{chrome.label}</span>
      <code style={PICK_TOAST_SELECTOR_STYLE}>{feedback.selector}</code>
    </div>
  );
}

export function CdpLiveEngine({
  session,
  url,
  tabId,
  hidden,
  pickArmed,
  onPickConsumed,
  onPickCancel,
  pickIntent = 'composer',
  onPickPoint,
  refreshKey,
  devicePresetId,
  qualityPresetId,
  zoom,
  onRequestNativeRender,
  minGenerationRef: externalMinGenerationRef,
}: CdpLiveEngineProps) {
  const { send } = session;
  const surfaceRef = useRef<HTMLDivElement>(null);
  /**
   * 容器几何缓存。
   *
   * `mousemove` / `wheel` 里每帧直接 `getBoundingClientRect()`，一旦撞上 React 刚
   * 提交完 DOM（控制台徽章、日志行更新）就会强制一次同步布局——高频指针事件下
   * 这就是可感知的「鼠标移动发涩」。这里把读取收敛到「失效后的下一次访问」，
   * 失效点覆盖所有会改变矩形的位置来源。
   */
  const surfaceRectRef = useRef<LiveRect | null>(null);
  const invalidateSurfaceRect = useCallback(() => {
    surfaceRectRef.current = null;
  }, []);
  const readSurfaceRect = useCallback((): LiveRect | null => {
    const cached = surfaceRectRef.current;
    if (cached !== null) return cached;
    const element = surfaceRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const next: LiveRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    surfaceRectRef.current = next;
    return next;
  }, []);
  const navigatedUrlRef = useRef<string | null>(null);
  const lastRefreshKeyRef = useRef(refreshKey);
  const deviceSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 最近一次下发的 UA 覆写：默认 UA 时为空串，避免重复清除。 */
  const sentUserAgentRef = useRef('');
  /** 当前连接段是否已请求过 screencast：重连后需要重新请求，但同一段内不重复刷。 */
  const screencastArmedRef = useRef(false);
  /**
   * 记录当前连接段第一次起流时是否拿到了真实帧盒。
   *
   * ResizeObserver 的测量 effect 晚于起流 effect 执行；极快的本地网关可能在 surface
   * 尺寸还没测出时先发一次默认 1024 帧盒。只允许「无尺寸 → 已测尺寸」补发一次，避免
   * 首帧大图持续占用编码 / 解码预算，同时不把面板拖拽造成的每次 resize 变成重开。
   */
  const screencastRequestRef = useRef<{
    maxWidth?: number;
    maxHeight?: number;
    format?: 'jpeg' | 'png';
  } | null>(null);

  /**
   * 画面闸门：`true` 期间收到的帧只解码不绘制。
   *
   * 切标签 / 改地址时远端页面**还没**导航过去，会继续推旧文档的帧。只清一次 canvas
   * 没用——下一帧立刻把旧内容画回来，这就是「切到空白标签还显示上一个标签内容」。
   * 闸门的开启条件是「已要求导航」；关闭条件必须由网关侧的地址回报（`nav` 事件 /
   * 帧元数据里的地址）驱动，见下面的 `releasedRef` 说明。
   */
  const frameGateRef = useRef(false);

  /**
   * 可接受的**最小页面代次**（宿主可传入共享实例，让控制台 / 网络的事件过滤共用）。
   *
   * 闸门只覆盖「导航确认前」这段窗口，覆盖不了快速来回切换的竞态：切走再切回时，
   * 上一轮页面产出的帧可能在新一轮导航之后才到达，按时序判定就会画进新标签。
   * 门槛由网关回报的**精确**代次设置（`nav` / 帧），绝不做「上一代 + 1」猜测。
   */
  const localMinGenerationRef = useRef<number | null>(null);
  const minFrameGenerationRef = externalMinGenerationRef ?? localMinGenerationRef;

  /**
   * 抬高 / 重置代次门槛。
   *
   * 写入走模块级 `writeMinGeneration`：在组件内联写 `ref.current` 会被 React Compiler
   * 判成「修改 props（不可变值）」并让整个组件脱靶优化（实测 lint 直接报错）。
   */
  const setMinFrameGeneration = useCallback(
    (value: number | null): void => {
      writeMinGeneration(externalMinGenerationRef, localMinGenerationRef, value);
    },
    [externalMinGenerationRef],
  );

  /**
   * 画布的 CSS 显示尺寸（backing store 定档用）。
   *
   * 帧盒可以宽到 2048 物理像素，而画面最终只显示在几百 CSS 像素的盒子里。按显示尺寸
   * 定档能让「上传 + 缩放一张大纹理」的每帧成本降一个量级；用 ref 是因为它随面板拖拽
   * 高频变化，走 props 只会带来无谓渲染。
   */
  const canvasDisplaySizeRef = useRef<{ width: number; height: number } | null>(null);
  const canvasZoomRef = useRef(1);

  // 画面面：收帧 → 离主线程解码 → 画进 canvas → 回 ack。帧数据不进 React 状态——
  // 一帧一次 setState 会把渲染、大字符串拷贝与 GC 压力全摊在主线程上。
  const { canvasRef, frameRef, frameMetrics, bitmapMetrics, hasFrame, stats, clear } =
    useCdpLiveFrames({
      session,
      gateRef: frameGateRef,
      minGenerationRef: minFrameGenerationRef,
      displaySizeRef: canvasDisplaySizeRef,
      zoomRef: canvasZoomRef,
    });

  const lastTabIdRef = useRef(tabId);
  const lastTabUrlRef = useRef(url);
  /** 网关侧**实际**所处的地址（由 `nav` 事件回报）。用于区分「谁发起的导航」。 */
  const remoteUrlRef = useRef<string | null>(null);
  /** 网关回报过的最大页面代次（用于推算下一次可接受的门槛）。 */
  const lastFrameGenerationRef = useRef<number | null>(null);
  /** 闸门等待的目标地址；`null` = 闸门未拉起。 */
  const gateTargetRef = useRef<string | null>(null);
  /** 闸门兜底放行定时器：远端可能永远回不到目标地址（页面自跳转 / 加载失败）。 */
  const gateReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 代次过滤的兜底：连续拒收帧的计数（超过阈值就放弃过滤，宁可错位也不空白）。 */
  const rejectedFrameCountRef = useRef(0);

  const releaseGate = useCallback(() => {
    if (gateReleaseTimerRef.current !== null) {
      clearTimeout(gateReleaseTimerRef.current);
      gateReleaseTimerRef.current = null;
    }
    gateTargetRef.current = null;
    frameGateRef.current = false;
  }, []);

  const armGate = useCallback(
    (targetUrl: string) => {
      gateTargetRef.current = targetUrl;
      frameGateRef.current = true;
      if (gateReleaseTimerRef.current !== null) {
        clearTimeout(gateReleaseTimerRef.current);
      }
      // 空白页永远收不到帧，靠超时放行；有生命周期的页面通常 <1s 内就有 nav 回报。
      gateReleaseTimerRef.current = setTimeout(() => {
        gateReleaseTimerRef.current = null;
        gateTargetRef.current = null;
        frameGateRef.current = false;
        // 超时放行同样要补一帧：目标页可能永远不会回报 nav（自跳转 / 加载失败），
        // 不补就会停在一张空白画布上。
        send({ ch: 'control', action: 'screencast.refresh' });
      }, GATE_RELEASE_TIMEOUT_MS);
    },
    [send],
  );

  /**
   * 切标签 / 改地址：清空 + 拉闸门。
   *
   * 一个 effect 统管两件事，因为它们的判定必须共用同一份「上一次同步到的地址」：
   * - **切标签**：换的是另一条标签的历史，即使 URL 相同也要重载（远端要重新产帧）；
   * - **改地址**：先排除「这次变化来自远端自己」（SPA 路由 / 页内点链接）。那种情况
   *   远端已经停在新页面上了，再做清空 + navigate 就等于整页重载——画面闪白、页面
   *   状态全丢，用户看到的就是「点个链接就卡住」。
   */
  useEffect(() => {
    const tabChanged = lastTabIdRef.current !== tabId;
    const previousUrl = lastTabUrlRef.current;
    const urlChanged = previousUrl !== url;
    if (!tabChanged && !urlChanged) return;
    lastTabIdRef.current = tabId;
    lastTabUrlRef.current = url;

    if (!tabChanged && remoteUrlRef.current === url) {
      // 同一标签内的地址变化，且远端已经在这个地址上：无需清屏与 navigate。
      return;
    }

    clear();
    armGate(url);
    if (tabChanged && previousUrl === url) {
      // 两个标签 URL 相同：navigate 会被去重跳过，远端不产生新 damage，
      // 清空后会一直空白——补一次 reload 强制产帧。
      send({ ch: 'control', action: 'reload' });
    }
  }, [tabId, url, clear, send, armGate]);

  useEffect(
    () => () => {
      if (gateReleaseTimerRef.current !== null) {
        clearTimeout(gateReleaseTimerRef.current);
        gateReleaseTimerRef.current = null;
      }
    },
    [],
  );

  // 闸门放行信号来自网关侧的地址回报：`nav` 事件到达即说明主文档已经切过去了，
  // 之后的帧属于新页面。没有这条回报就只能在超时后盲放行。
  //
  // 放行后必须**立刻请求补一帧**：screencast 只在页面产生 damage 时推帧，静态页
  // （尤其 `about:blank`）加载完就不再产帧——闸门期间又把那些帧丢了，放开后就会
  // 永久空白。`screencast.refresh` 幂等地重发 start，立即按当前视口产一帧。
  useEffect(() => {
    return session.subscribe((envelope) => {
      if (envelope.ch !== 'nav') return;
      const payload = envelope.payload as
        { url?: unknown; generation?: unknown } | null | undefined;
      if (typeof payload?.url === 'string' && payload.url.length > 0) {
        remoteUrlRef.current = payload.url;
      }
      // 用网关回报的**精确**代次作为门槛：此后只接受该代次及更新的帧。
      // 绝不用「上一代 + 1」猜测——猜高了会在远端实际没导航（同址跳转 / 失败）时
      // 把所有帧永久拒收，画面从此空白。
      if (typeof payload?.generation === 'number') {
        lastFrameGenerationRef.current = payload.generation;
        setMinFrameGeneration(payload.generation);
      }
      if (gateTargetRef.current === null) return;
      releaseGate();
      send({ ch: 'control', action: 'screencast.refresh' });
    });
  }, [session, releaseGate, send, setMinFrameGeneration]);

  /**
   * 跟踪帧代次：正常情况用它抬门槛（老网关的 `nav` 不带代次时只能从帧上学习），
   * 同时提供一个**兜底**——连续拒收过多帧就放弃过滤。
   *
   * 兜底的场景：远端实际没有产生新的主文档导航（同址跳转、导航被页面取消、网关重启
   * 后代次从 0 重新计数），此时门槛高于所有帧的代次，画面会永久空白。宁可短暂错位
   * 也不要给用户一块没有任何出路的空白。
   */
  useEffect(() => {
    return session.subscribe((envelope) => {
      if (envelope.ch !== 'frame') return;
      const payload = envelope.payload as { generation?: unknown } | null | undefined;
      if (typeof payload?.generation !== 'number') return;
      const generation = payload.generation;

      const minimum = minFrameGenerationRef.current;
      if (minimum !== null && generation < minimum) {
        // 这一帧会被画面面拒收：累计计数，超过阈值就把门槛降到实际代次。
        rejectedFrameCountRef.current += 1;
        if (rejectedFrameCountRef.current >= GENERATION_FALLBACK_REJECTS) {
          rejectedFrameCountRef.current = 0;
          setMinFrameGeneration(generation);
          lastFrameGenerationRef.current = generation;
          // 立刻补一帧：被拒的帧都丢了，画布上可能还是空的。
          send({ ch: 'control', action: 'screencast.refresh' });
        }
        return;
      }

      rejectedFrameCountRef.current = 0;
      const previous = lastFrameGenerationRef.current;
      if (previous !== null && generation <= previous) return;
      lastFrameGenerationRef.current = generation;
      setMinFrameGeneration(generation);
    });
  }, [session, send, setMinFrameGeneration]);

  // 持续低帧率 → 提示可以切原生渲染。只统计连续窗口，偶发一次偏低不算。
  const [slowFps, setSlowFps] = useState(false);
  const slowSamplesRef = useRef(0);
  useEffect(() => {
    if (stats.fps <= 0) return;
    if (stats.fps >= SLOW_FPS_THRESHOLD) {
      slowSamplesRef.current = 0;
      setSlowFps(false);
      return;
    }
    slowSamplesRef.current += 1;
    if (slowSamplesRef.current >= SLOW_FPS_SAMPLES) {
      setSlowFps(true);
    }
  }, [stats.fps]);

  // 指针输入按帧合并：既不淹没远端 CDP 的输入队列，也不让每次移动都变成一次 damage。
  // 这里手写 `useMemo` 不是为了省计算，而是**身份语义**：批次对象承载着「挂起未冲刷的
  // 输入」，重建即丢帧；本文件虽被编译器接管（compiled 2 / bailout 0），但身份约束属于
  // 契约而非优化，写在源码里才不会随编译器行为漂移。
  const pointerInput = useMemo(() => createPointerInputBatch(send), [send]);
  useEffect(() => () => pointerInput.dispose(), [pointerInput]);

  /**
   * 是否处于拖动中（按下未松开）。
   *
   * 拖动首点立即上行，后续移动由 pointer batch 按动画帧合并：把硬件高频事件压到显示
   * 刷新率量级，避免拖拽时输入和 screencast 互相争抢链路。
   * 用 ref 而不是 state：高频路径不能在渲染期制造订阅。
   */
  const draggingRef = useRef(false);

  /**
   * 全局兜底：在容器外松开（拖到面板外 / 拖出窗口）也要退出拖动状态。
   *
   * 否则 `draggingRef` 会永久停在 `true`——此后所有悬停移动都变成「立即上行」，
   * 高频 `mouseMoved` 持续产帧，反而把链路拖慢。
   */
  useEffect(() => {
    const stopDragging = (): void => {
      draggingRef.current = false;
    };
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('blur', stopDragging);
    return () => {
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('blur', stopDragging);
    };
  }, []);

  /**
   * 停流判定：宿主把容器隐藏（`hidden`）**或**整个标签页 / 窗口不可见。后者宿主
   * 毫不知情，但帧照样推，是后台白烧 CPU 的主要来源。
   *
   * hook 必须无条件调用——`hidden || !useDocumentVisibility()` 会被短路掉，
   * 渲染期 hook 数量随之漂移。
   */
  const documentVisible = useDocumentVisibility();
  const paused = hidden || !documentVisible;

  const [surfaceSize, setSurfaceSize] = useState<{ width: number; height: number } | null>(null);
  const qualityPreset = useMemo(() => resolveQualityPreset(qualityPresetId), [qualityPresetId]);
  /**
   * 实际生效的像素倍数：档位倍数收敛到显示器 DPR 以内。
   *
   * 1x 屏幕上「均衡 / 清晰」档按 1.5 / 2 倍取像素纯属白付成本（Chromium 按倍数光栅化
   * 再缩回去显示，清晰度不涨、编码与解码全额变慢），因此统一按 `min(档位, DPR)` 收敛。
   * 帧盒与 `deviceScaleFactor` 必须用同一份值，否则会出现「位图更大但视口还是 1x」
   * 这种只花成本不涨清晰度的组合。
   */
  const effectiveDisplayScale = useMemo(
    () => resolveDisplayScale(qualityPreset.displayScale, readDevicePixelRatio()),
    [qualityPreset.displayScale],
  );
  // 帧盒只依赖测量尺寸与实得倍数。
  const screencastRequest = useMemo(
    () => resolveScreencastRequest(surfaceSize, effectiveDisplayScale),
    [effectiveDisplayScale, surfaceSize],
  );
  const [hovered, setHovered] = useState(false);

  const pick = useCdpLivePick({
    session,
    armed: pickArmed,
    action: pickIntent === 'styles' ? 'node.styles' : 'pick',
    // 取样式是检查器的读操作，不能把元素引用塞进 composer。
    insertIntoComposer: pickIntent !== 'styles',
    onPickSent: (point) => {
      onPickConsumed();
      onPickPoint?.(point);
    },
    onDisarm: onPickCancel,
  });

  // 画质档位变化必须重新起流：`Page.startScreencast` 只在起流时定档，而已武装状态会
  // 挡住下面的 effect，所以先解除武装，让它带着新帧盒 / 新质量重发一次 start。
  useEffect(() => {
    screencastArmedRef.current = false;
    screencastRequestRef.current = null;
  }, [qualityPresetId]);

  // screencast 只在通道 connected 后武装（本组件 effect 先于父 hook 建连，挂载期发必然被丢）；
  // 重连回到 connected 时重新请求——hub 只为新 controller 恢复产帧。
  //
  // 不可见即停流：预览宿主是 keep-alive 的，切走 tab / 收起面板只把容器
  // `display: none`；整页被切到后台时连这一步都没有。不停流的话后台仍会满速收帧、
  // 解码、重绘，白烧一整个核。重新可见时再请求一次即可——`Page.startScreencast` 幂等，
  // 且会立即按当前视口产出一帧，画面不会停在旧帧上（与卸载路径同一套 stop 语义：
  // 整条会话的产帧都会停，多端同时观看时由仍在观看的一端重新拉起）。
  useEffect(() => {
    if (session.phase !== 'connected') {
      screencastArmedRef.current = false;
      screencastRequestRef.current = null;
      return;
    }
    if (paused) {
      if (!screencastArmedRef.current) return;
      screencastArmedRef.current = false;
      screencastRequestRef.current = null;
      send({ ch: 'control', action: 'screencast.stop' });
      return;
    }
    const hasFrameBox =
      screencastRequest.maxWidth !== undefined && screencastRequest.maxHeight !== undefined;
    const firstRequestWasUnmeasured =
      screencastArmedRef.current &&
      screencastRequestRef.current !== null &&
      screencastRequestRef.current.maxWidth === undefined &&
      hasFrameBox;
    if (screencastArmedRef.current && !firstRequestWasUnmeasured) return;
    screencastArmedRef.current = true;
    screencastRequestRef.current = {
      maxWidth: screencastRequest.maxWidth,
      maxHeight: screencastRequest.maxHeight,
      ...(qualityPreset.format !== 'jpeg' ? { format: qualityPreset.format } : {}),
    };
    // 带上按面板显示尺寸 × DPR 算出的帧盒：窄面板不必按默认 1024 边产帧，高 DPR
    // 面板则要得更大以保住清晰度。能离线程解码就顺手协商二进制帧（省 base64）。
    send({
      ch: 'control',
      action: 'screencast.start',
      ...screencastRequest,
      ...(qualityPreset.quality !== undefined ? { quality: qualityPreset.quality } : {}),
      ...(qualityPreset.format !== 'jpeg' ? { format: qualityPreset.format } : {}),
      ...(canDecodeFrameOffThread() ? { binary: true } : {}),
    });
  }, [session.phase, paused, qualityPreset.format, qualityPreset.quality, screencastRequest, send]);

  // 卸载通知停止产帧（沿用原语义）。
  useEffect(() => {
    return () => {
      send({ ch: 'control', action: 'screencast.stop' });
    };
  }, [send]);

  // 首次进入 / 地址变更：让远端跟随当前 tab 的 URL。
  //
  // **占位页同样要下发**：`about:blank` 是合法的 CDP 导航，Playwright 会真的把主
  // 文档切过去。以前用 `NAVIGABLE_URL_PATTERN` 挡掉它，结果是切到新建的空白标签后
  // 远端仍停在旧页面上继续推旧帧——这正是「切到空地址标签还显示上一个标签内容」。
  useEffect(() => {
    if (navigatedUrlRef.current === url) return;
    navigatedUrlRef.current = url;
    // 远端自己导航到同一个地址（SPA 路由 / 页内链接）：地址回写触发的这次「变化」
    // 不需要再导航一次——重发 navigate 会整页重载并丢掉页面状态。
    if (remoteUrlRef.current === url) return;
    send({ ch: 'control', action: 'navigate', url });
    // 每条 navigate 都必须紧跟一次补帧请求：远端可能根本没产生新 damage（切到与
    // 当前页面相同的地址、或页面加载后即是静态内容），没有这一帧画面会一直空白。
    send({ ch: 'control', action: 'screencast.refresh' });
  }, [url, send]);

  // 工具栏刷新：iframe 分支靠 refreshKey 重挂载，实时分支要显式让远端 reload。
  useEffect(() => {
    if (lastRefreshKeyRef.current === refreshKey) return;
    lastRefreshKeyRef.current = refreshKey;
    send({ ch: 'control', action: 'reload' });
  }, [refreshKey, send]);

  // 测量可用盒子：ResizeObserver 优先，环境不支持时退回一次性测量。
  // 顺带作为几何缓存的失效点——尺寸变化必然伴随位置变化。
  //
  // 容差按边长比例取（`SURFACE_SIZE_EPSILON_RATIO`），不能只挡亚像素抖动：面板拖拽 /
  // 侧栏动画期间尺寸会连续变化几十像素，而 `surfaceSize` 一变就会重发
  // `screencast.start`，网关据此重开 `Page.startScreencast` 并**全量重编码一帧**。
  // 每 1px 重开一次，画面就会在整个拖拽期间持续抖着卡。比例容差让「大盒子多让一点、
  // 小盒子保持灵敏」，用户察觉不到差别。
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const measure = (): void => {
      invalidateSurfaceRect();
      const rect = element.getBoundingClientRect();
      setSurfaceSize((prev) =>
        prev !== null &&
        Math.abs(prev.width - rect.width) <= Math.max(1, prev.width * SURFACE_SIZE_EPSILON_RATIO) &&
        Math.abs(prev.height - rect.height) <= Math.max(1, prev.height * SURFACE_SIZE_EPSILON_RATIO)
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [invalidateSurfaceRect]);

  // 页面滚动 / 窗口缩放会移动容器但不改变它的尺寸，ResizeObserver 收不到：
  // 必须显式失效，否则指针坐标会落在旧位置上。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleGeometryChange = (): void => invalidateSurfaceRect();
    window.addEventListener('scroll', handleGeometryChange, true);
    window.addEventListener('resize', handleGeometryChange);
    return () => {
      window.removeEventListener('scroll', handleGeometryChange, true);
      window.removeEventListener('resize', handleGeometryChange);
    };
  }, [invalidateSurfaceRect]);

  // 设备同步：固定预设下发预设视口，自适应下发面板测量值（视口跟随面板）。
  // 防抖保证拖拽面板大小时不会逐帧打 socket；只在已连接时下发，重连成功后
  // 同样会重发一次，避免会话重建后视口悄悄退回默认尺寸。UA 只在变化时下发。
  useEffect(() => {
    if (session.phase !== 'connected') return;
    const target = resolveDeviceSyncTarget(
      resolveDevicePreset(devicePresetId),
      surfaceSize,
      effectiveDisplayScale,
    );
    if (!target) return;

    deviceSyncTimerRef.current = setTimeout(() => {
      deviceSyncTimerRef.current = null;
      const message: BrowserLiveDeviceMessage = {
        ch: 'device',
        width: target.width,
        height: target.height,
        deviceScaleFactor: target.deviceScaleFactor,
        mobile: target.mobile,
      };
      if (target.userAgent !== sentUserAgentRef.current) {
        message.userAgent = target.userAgent;
        sentUserAgentRef.current = target.userAgent;
      }
      send(message);
    }, DEVICE_SYNC_DEBOUNCE_MS);

    return () => {
      if (deviceSyncTimerRef.current !== null) {
        clearTimeout(deviceSyncTimerRef.current);
        deviceSyncTimerRef.current = null;
      }
    };
  }, [devicePresetId, effectiveDisplayScale, surfaceSize, send, session.phase]);

  // 滚轮必须用非 passive 监听：React 根容器上的 wheel 监听是 passive 的，
  // 在回调里 preventDefault 不会生效，本地面板会跟着一起滚。
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent): void => {
      const current = frameRef.current;
      if (!current) return;
      const container = readSurfaceRect();
      if (!container) return;
      const point = toDevicePoint({
        container,
        frame: current,
        clientX: event.clientX,
        clientY: event.clientY,
        zoom,
      });
      if (!point) return;
      // 拦本地滚动必须同步（每次事件都要 preventDefault），但上行按帧合并。
      event.preventDefault();
      pointerInput.wheel(point, { x: event.deltaX, y: event.deltaY });
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [pointerInput, readSurfaceRect, zoom]);

  const pointFromEvent = (event: MouseEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const current = frameRef.current;
    if (!current) return null;
    const container = readSurfaceRect();
    if (!container) return null;
    return toDevicePoint({
      container,
      frame: current,
      clientX: event.clientX,
      clientY: event.clientY,
      zoom,
    });
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    // 按下必须拿到绝对准确的矩形：缓存可能是上一次指针移动时的（滚动已经失效过，
    // 但面板布局也可能在同一帧内变过），这里强制重测一次。
    invalidateSurfaceRect();
    const container = readSurfaceRect();
    const ime = imeRef.current;
    if (ime !== null && container !== null) {
      // 把透明输入框挪到点击处：IME 候选框会跟着它，不会固定飘在左上角。
      ime.style.left = `${event.clientX - container.left}px`;
      ime.style.top = `${event.clientY - container.top}px`;
    }
    // 焦点交给 textarea：surface div 收不到 composition 事件，输入法没有入口。
    ime?.focus({ preventScroll: true });
    const point = pointFromEvent(event);
    if (!point) return;
    if (pickArmed) {
      // 拾取模式下点击不透传给远端：否则选元素会顺带触发页面交互。
      event.preventDefault();
      return;
    }
    draggingRef.current = true;
    send({
      ch: 'input',
      kind: 'mouse',
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: toMouseButton(event.button),
      clickCount: 1,
    });
  };

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>): void => {
    // 先清拖动状态：无论下面哪条分支返回，松开之后都不该再走「立即上行」。
    draggingRef.current = false;
    const point = pointFromEvent(event);
    if (!point) return;
    if (pickArmed) {
      event.preventDefault();
      pick.handlePick(point.x, point.y);
      return;
    }
    send({
      ch: 'input',
      kind: 'mouse',
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: toMouseButton(event.button),
      clickCount: 1,
    });
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
    const point = pointFromEvent(event);
    if (!point) return;
    // 拖动（按下未松开）期间由 pointer batch 立即发送首点、按动画帧合并后续坐标：
    // 保留首点跟手，同时避免硬件高频 mousemove 把远端输入与 screencast 一起洪泛。
    // 悬停 / 无按键移动仍然走按帧合并，把噪声压下去（悬停对延迟不敏感）。
    if (draggingRef.current) {
      pointerInput.moveImmediate(point);
      return;
    }
    // 同一帧内只发最后一次坐标：`mouseMoved` 是纯噪声洪泛的主要来源。
    pointerInput.move(point);
  };

  /**
   * IME（中文 / 日文 / 韩文）的承载元素。
   *
   * `tabIndex` 的 div 收不到 `composition*` 事件，输入法组合根本没有入口；这里放一个
   * 透明的 textarea 负责聚焦与组字，组合结果一次性走 `Input.insertText` 提交，
   * 不再把拼音字母逐字符打进页面。
   */
  const imeRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // 复制回包：把远端选中文本写进本地剪贴板。异步回包可能已失去用户手势上下文，
  // 浏览器拒绝时静默——远端选区不受影响，用户仍可改用截图 / 检查器取内容。
  useEffect(() => {
    return session.subscribe((envelope) => {
      if (envelope.ch !== 'clipboard') return;
      const payload = envelope.payload as { text?: unknown };
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (text.length === 0) return;
      const clipboard = navigator.clipboard;
      if (!clipboard) return;
      void clipboard.writeText(text).catch(() => undefined);
    });
  }, [session]);

  const sendTextInput = (text: string): void => {
    if (text.length === 0) return;
    send({ ch: 'input', kind: 'text', text });
  };

  /** textarea 的 input：组合期间不处理；其余（输入法提交、移动端键盘）整段提交。 */
  const handleImeInput = (event: FormEvent<HTMLTextAreaElement>): void => {
    if (composingRef.current) return;
    const value = event.currentTarget.value;
    if (value.length === 0) return;
    event.currentTarget.value = '';
    sendTextInput(value);
  };

  const handleImeCompositionStart = (): void => {
    composingRef.current = true;
  };

  const handleImeCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>): void => {
    composingRef.current = false;
    const value = event.currentTarget.value;
    event.currentTarget.value = '';
    sendTextInput(value);
  };

  /** 粘贴走本地剪贴板：远端读不到用户机器上的内容，取到文本后一次 insertText。 */
  const handleImePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const text = event.clipboardData.getData('text');
    if (text.length === 0) return;
    event.preventDefault();
    event.currentTarget.value = '';
    sendTextInput(text);
  };

  /** 键盘：可打印字符额外发 `char`（CDP 侧的文本输入靠它），避免重复注入。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // 输入法组合中（拼音 / 假名 / 死键）不拦截、不注入：交给输入法自己处理，
    // 最终文本由 compositionend 走一次 insertText 提交。
    if (event.nativeEvent.isComposing || composingRef.current || event.key === 'Process') {
      return;
    }

    // 拾取模式下键盘不注入远端；Esc 由 hook 在窗口捕获阶段处理并解除武装。
    if (pickArmed) {
      event.preventDefault();
      return;
    }

    const command = resolveEditCommand(event);
    if (command === 'paste') {
      // 不 preventDefault：让浏览器把 paste 事件派发到 textarea，由它读本地剪贴板。
      return;
    }
    if (command === 'copy') {
      // 选区在远端页面：请求网关取回文本，回包走 clipboard 通道写入本地剪贴板。
      event.preventDefault();
      send({ ch: 'control', action: 'copySelection' });
      return;
    }
    if (command !== null) {
      // 全选 / 撤销 / 重做 / 剪切必须走 Blink 的 commands：只发 keyDown 不会触发
      // 浏览器原生编辑行为，这是「快捷键没效果」的主因。
      event.preventDefault();
      const down = buildKeyMessage('keyDown', event);
      if (down.kind === 'key') {
        down.commands = [command];
      }
      send(down);
      return;
    }

    // F5 在 CDP 里不会刷新页面（那是浏览器 UI 行为），映射成预览自己的 reload。
    if (event.key === 'F5') {
      event.preventDefault();
      send({ ch: 'control', action: 'reload' });
      return;
    }

    // Alt/⌘ + ←/→：浏览器前进后退同样不会在远端发生，映射到会话历史。
    if (
      (event.altKey || event.metaKey) &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      event.preventDefault();
      send({
        ch: 'control',
        action: event.key === 'ArrowLeft' ? 'goBack' : 'goForward',
      });
      return;
    }

    // 其余修饰组合（Ctrl+W / Ctrl+T / Ctrl+F / Cmd+Q …）放行给宿主浏览器：
    // 它们既不是预览能执行的编辑动作，也不该被静默吞掉——以前这里无条件
    // preventDefault，用户会觉得「快捷键全都失灵」。
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    event.preventDefault();
    if (event.key.length === 1) {
      send({ ch: 'input', kind: 'key', type: 'char', text: event.key });
    }
    send(buildKeyMessage('keyDown', event));
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>): void => {
    // 组合期间的 keyUp 属于输入法内部状态，注入出去只会让页面收到多余按键。
    if (event.nativeEvent.isComposing || composingRef.current) return;
    event.preventDefault();
    if (pickArmed) return;
    send(buildKeyMessage('keyUp', event));
  };

  const layout = useMemo(
    () => (frameMetrics !== null ? computeFrameLayout(surfaceSize, frameMetrics) : null),
    [frameMetrics, surfaceSize],
  );

  // backing store 定档要的就是「画布在页面上占多少 CSS 像素」，即上面的 layout；
  // 用 effect 同步而不是渲染期写 ref（渲染期写 ref 会被 React Compiler 判为违规）。
  useEffect(() => {
    canvasDisplaySizeRef.current =
      layout === null ? null : { width: layout.width, height: layout.height };
  }, [layout]);

  useEffect(() => {
    canvasZoomRef.current = zoom > 0 ? zoom : 1;
  }, [zoom]);

  const chip = describeStatusChip(session.phase);
  const blocking = describeBlockingMessage(session.phase, session.lastError, hasFrame);

  return (
    <div
      ref={surfaceRef}
      className="cdp-live-engine__surface"
      data-pick-armed={pickArmed ? 'true' : 'false'}
      tabIndex={0}
      aria-label="浏览器实时预览"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      style={{
        position: 'absolute',
        inset: 0,
        display: hidden ? 'none' : 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: 'var(--bg-base)',
        cursor: pickArmed ? 'crosshair' : 'default',
        boxShadow: pickArmed
          ? 'inset 0 0 0 4px var(--accent-subtle)'
          : hovered
            ? 'inset 0 0 0 1px color-mix(in oklch, var(--accent) 22%, transparent)'
            : 'none',
        transition: 'box-shadow 100ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/*
        画面画布常驻挂载：首帧到达前尺寸为 0（不可见），解码完成后由
        `useCdpLiveFrames` 直接画进去——帧数据不经过 React 渲染。
      */}
      <canvas
        ref={canvasRef}
        aria-label="实时预览画面"
        data-testid="cdp-live-frame"
        style={{
          width: layout?.width ?? 0,
          height: layout?.height ?? 0,
          display: 'block',
          userSelect: 'none',
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: 'center',
        }}
      />

      {/*
        自绘滚动条贴在**画面**右缘而不是容器右缘：设备预设 / 缩放时画面会居中留白，
        贴容器会把滚动条画到页面之外的空白处。
      */}
      {layout !== null && !pickArmed && (
        <LiveScrollbar
          session={session}
          enabled={!hidden && session.phase === 'connected'}
          resetKey={`${tabId}:${url}:${refreshKey}`}
          onScrollTo={(nextScrollY) => send({ ch: 'control', action: 'scrollTo', y: nextScrollY })}
          style={{
            left: `calc(50% + ${
              (layout.width * zoom) / 2 - SCROLLBAR_EDGE_INSET - SCROLLBAR_WIDTH
            }px)`,
            top: `calc(50% - ${(layout.height * zoom) / 2}px)`,
            width: SCROLLBAR_WIDTH,
            height: layout.height * zoom,
          }}
        />
      )}

      {blocking !== null && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            textAlign: 'center',
            color: blocking.color,
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          {blocking.text}
        </div>
      )}

      {slowFps && onRequestNativeRender !== undefined && (
        <div style={SLOW_FPS_BANNER_STYLE} role="status">
          <span>
            实时画面仅 {stats.fps}fps（{formatFrameChars(stats.frameChars)} / 帧）
          </span>
          <button type="button" onClick={onRequestNativeRender} style={SLOW_FPS_ACTION_STYLE}>
            切换原生渲染
          </button>
        </div>
      )}

      <div style={STATUS_CHIP_STYLE}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 'var(--radius-pill)',
            background: chip.dot,
            boxShadow: session.phase === 'connected' ? '0 0 6px var(--accent)' : 'none',
          }}
        />
        <span style={{ color: chip.color }}>{chip.label}</span>
      </div>

      {frameMetrics !== null && (
        <div style={SIZE_CHIP_STYLE} data-testid="cdp-live-stats">
          视口 {frameMetrics.deviceWidth}×{frameMetrics.deviceHeight}
          {bitmapMetrics !== null
            ? ` · 位图 ${bitmapMetrics.width}×${bitmapMetrics.height}`
            : ' · 位图 —'}
          {stats.fps > 0
            ? ` · ${stats.fps}fps · ${formatFrameChars(stats.frameChars)} · 总${stats.processingMs}ms · 排队${stats.queueMs}ms · 解码${stats.decodeMs}ms · 绘制${stats.paintMs}ms`
            : ''}
        </div>
      )}

      {pickArmed && (
        <div style={PICK_BANNER_STYLE} role="status">
          <span style={PICK_BANNER_DOT_STYLE} />
          {pickIntent === 'styles'
            ? '拾取模式：点击元素读取完整样式，Esc 退出'
            : '拾取模式：点击页面元素，Esc 退出'}
        </div>
      )}

      {pick.feedback !== null && <PickToast feedback={pick.feedback} />}

      {/*
        透明输入框：唯一职责是承载 IME 组合与本地粘贴。
        `pointerEvents: none` 让鼠标事件继续由 surface 处理（坐标 / 拾取不受影响），
        只在按下时程序化聚焦；候选框位置随点击处移动（见 handleMouseDown）。
      */}
      <textarea
        ref={imeRef}
        aria-label="预览页输入"
        {...{ [PREVIEW_IME_ATTRIBUTE]: 'true' }}
        tabIndex={-1}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onInput={handleImeInput}
        onCompositionStart={handleImeCompositionStart}
        onCompositionEnd={handleImeCompositionEnd}
        onPaste={handleImePaste}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          padding: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'transparent',
          caretColor: 'transparent',
          opacity: 0,
          resize: 'none',
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 3,
        }}
      />
    </div>
  );
}

/** React 的 button 编码 → 线路协议的 button。 */
function toMouseButton(button: number): 'left' | 'right' | 'middle' {
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'left';
}

type BrowserEditCommand = 'selectAll' | 'undo' | 'redo' | 'cut' | 'copy' | 'paste';

/**
 * 把 `Ctrl/Cmd + 字母` 映射成编辑动作。
 *
 * 只认 A / Z / Y / X / C / V：保存、查找、刷新等组合保持原样，交给页面自己的
 * 快捷键或宿主的预览快捷键，避免抢掉它们的语义。
 */
function resolveEditCommand(event: KeyboardEvent<HTMLDivElement>): BrowserEditCommand | null {
  if (event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  switch (event.key.toLowerCase()) {
    case 'a':
      return 'selectAll';
    case 'z':
      return event.shiftKey ? 'redo' : 'undo';
    case 'y':
      return 'redo';
    case 'x':
      return 'cut';
    case 'c':
      return 'copy';
    case 'v':
      return 'paste';
    default:
      return null;
  }
}

/** React 修饰键 → CDP 位掩码：Alt=1、Ctrl=2、Meta=4、Shift=8。 */
function toModifierMask(event: KeyboardEvent<HTMLDivElement>): number {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

/** 组装键盘上行消息：只在有值时携带可选字段，避免下发无意义的 0。 */
function buildKeyMessage(
  type: 'keyDown' | 'keyUp' | 'char',
  event: KeyboardEvent<HTMLDivElement>,
): BrowserLiveInputMessage {
  const message: Extract<BrowserLiveInputMessage, { kind: 'key' }> = {
    ch: 'input',
    kind: 'key',
    type,
  };
  if (event.key.length > 0) message.key = event.key;
  if (event.code.length > 0) message.code = event.code;
  if (event.keyCode > 0) message.windowsVirtualKeyCode = event.keyCode;
  // 修饰键必须带上：否则 `Shift+Enter`、`Shift+方向键` 到页面就成了普通按键。
  const modifiers = toModifierMask(event);
  if (modifiers > 0) message.modifiers = modifiers;
  return message;
}
