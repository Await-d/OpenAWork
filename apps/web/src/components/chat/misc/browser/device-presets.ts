/**
 * 浏览器预览的设备预设与缩放档位（纯数据 + 纯函数，零副作用）。
 *
 * - 「自适应」是默认预设：宽度 / 高度恒为 0，表示视口由面板自身尺寸决定
 *   （CDP 实时分支用面板测量值驱动 `device` 上行，iframe 回退分支用 CSS 铺满）。
 * - 固定预设用真实设备像素尺寸驱动 `device` 上行；移动端预设额外带上真实 UA，
 *   非移动端 / 自适应统一用空串清除覆写（服务端收到空串即恢复浏览器默认 UA）。
 * - 缩放是**纯前端**的 CSS `transform: scale()`，不写进设备指标、也不写 pageScale；
 *   坐标映射（`toDevicePoint`）按同一档位反算。
 */

/** 单个设备预设。`width` / `height` 为 0 表示自适应（跟随面板尺寸）。 */
export interface BrowserDevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  userAgent?: string;
}

/** 自适应预设的稳定 id：不锁定设备尺寸。 */
const RESPONSIVE_DEVICE_PRESET_ID = 'responsive';

/** 默认预设：自适应，避免一打开预览就被塞进某个设备尺寸。 */
export const DEFAULT_DEVICE_PRESET_ID = RESPONSIVE_DEVICE_PRESET_ID;

const IPHONE_375_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const IPHONE_430_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

/** 设备预设列表，第一项恒为自适应。 */
export const BROWSER_DEVICE_PRESETS: readonly BrowserDevicePreset[] = [
  {
    id: RESPONSIVE_DEVICE_PRESET_ID,
    label: '自适应',
    width: 0,
    height: 0,
    deviceScaleFactor: 1,
    mobile: false,
  },
  {
    id: 'phone-375',
    label: '手机 375×812',
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true,
    userAgent: IPHONE_375_USER_AGENT,
  },
  {
    id: 'phone-430',
    label: '大屏手机 430×932',
    width: 430,
    height: 932,
    deviceScaleFactor: 3,
    mobile: true,
    userAgent: IPHONE_430_USER_AGENT,
  },
  {
    id: 'tablet-768',
    label: '平板 768×1024',
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    mobile: false,
  },
  {
    id: 'laptop-1280',
    label: '笔记本 1280×800',
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  },
  {
    id: 'desktop-1920',
    label: '桌面 1920×1080',
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  },
];

/** 可选缩放档位（1 = 100%）。 */
export const BROWSER_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5] as const;

/** 按 id 解析预设；未知 id 返回 null，调用方回退到自适应。 */
export function resolveDevicePreset(id: string): BrowserDevicePreset | null {
  return BROWSER_DEVICE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** 在缩放档位内按方向取相邻档；未知档位或已到端点时返回原值。 */
export function stepBrowserZoom(zoom: number, direction: 'in' | 'out'): number {
  const index = BROWSER_ZOOM_LEVELS.findIndex((level) => level === zoom);
  if (index < 0) return zoom;
  const next = BROWSER_ZOOM_LEVELS[index + (direction === 'in' ? 1 : -1)];
  return next ?? zoom;
}
