/**
 * 缩放图片组件的平台中立 props 契约（W2b / T-09）。
 *
 * `ZoomableImage.ios.tsx`（原生 `ScrollView` 缩放）与 `ZoomableImage.android.tsx`
 * （自研 `PanResponder` + `Animated`）是两条完全不同的手势路径，但必须对外暴露
 * **同一份** props：契约只在这里定义一次，两个平台实现各自 import，避免两边各自演化
 * 出分叉。`ImageLightboxModal` 只依赖 `./ZoomableImage`（RN 平台后缀解析），不关心
 * 具体实现。
 *
 * 与 `./pinch-zoom-math` 一样**不 import `react` / `react-native`**（只依赖类型），
 * 因此可以被平台实现与纯逻辑测试共同引用。
 */
import type { DisplaySize } from './lightbox-model';

/** `<Image onLoad>` 的原生载荷最小投影：只取内禀宽高。 */
export interface ZoomableImageLoadPayload {
  readonly nativeEvent: {
    readonly source?: {
      readonly width?: unknown;
      readonly height?: unknown;
    };
  };
}

export interface ZoomableImageProps {
  /** 图片地址（`data:` URI 或 http(s)）。 */
  readonly src: string;
  /**
   * 旋转后的视觉盒（`resolveRotatedDisplaySize` 的结果）：既是原生视图尺寸，也是缩放层的
   * 视口基准。旋转前的布局尺寸由缩放层用 `resolveRotatedContentSize` 推导。
   */
  readonly displaySize: DisplaySize;
  /**
   * 受控缩放（可选，W2c）：工具栏 / 复位命令下达的**绝对**比例。缩放层只在它与自身当前
   * 比例明显不同时采纳（回执不来回打架），采纳结果仍经 `onZoomChange` 上报。
   */
  readonly scale?: number;
  /**
   * 旋转角度（度，累计值；缺省按 0）。90° / 270° 会改变宽高比 → 旋转落地时必须把缩放
   * 归零到 1×：iOS 用重挂载原生滚动视图达成，Android 在 rotation 变化时重置内部比例。
   */
  readonly rotation?: number;
  /**
   * 缩放状态上报（**门控单一事实来源**）：`zoomed` 由缩放层用 `deriveZoomed(scale)`
   * 派生后上报，父层只读、不自己再算一份；`scale` 是同一时刻的真实比例（供工具栏读数
   * 与返回键语义回灌 `transformReducer` 的 `setScale`）。
   */
  readonly onZoomChange?: (zoomed: boolean, scale: number) => void;
  /** 图片加载完成：回调内禀尺寸，父层据此重算 `displaySize`。 */
  readonly onLoad?: (sourceSize: DisplaySize) => void;
  /** 图片加载失败（错误态渲染由父层负责）。 */
  readonly onError?: () => void;
  /** 无障碍文案（父层用 `resolveAltText` 兜底后的结果）。 */
  readonly accessibilityLabel?: string;
}
