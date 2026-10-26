import type { BrowserDevicePreset } from '../device-presets.js';

/**
 * CDP 实时画面的几何计算：帧等比布局、内容盒、设备点映射、设备同步目标与
 * 截图尺寸解析。纯函数，从 `cdp-live-engine.tsx` 抽出。
 */

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
export const SCROLLBAR_WIDTH = 10;
export const SCROLLBAR_EDGE_INSET = 2;

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
export function readDevicePixelRatio(): number {
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
