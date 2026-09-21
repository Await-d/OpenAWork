/**
 * iOS 缩放层（W2b / T-09；W2c / T-11 追加旋转与受控缩放）。
 *
 * iOS 上 `minimumZoomScale` / `maximumZoomScale` / `bouncesZoom` / `centerContent` /
 * `zoomScale` 都是真实生效的原生属性（Android 上是静默 no-op，见同目录 `.android.tsx`），
 * 因此这里不重写手势，只做四件事：
 * 1. 把原生 `zoomScale` 读出来，经 `deriveZoomed` 派生成门控布尔后上报父层；
 * 2. 切换图片（`src`）与**旋转**（`rotation`）变化时把原生缩放重置回 1× —— 通过把二者
 *    放进 `ScrollView` 的 `key` 触发重挂载达成，不依赖命令式 API（W2b 已验证同款方案）；
 * 3. 受控缩放：父层的 `scale` 直接落到 `zoomScale` 原生属性上（声明式，`RCTScrollView`
 *    的 setter 会保留 `contentOffset`）；捏合产生的真实比例在静止一个窗口后补报一次，
 *    让父层读数与返回键语义拿到最终值；
 * 4. 保持与 Android 侧**逐字一致**的 props 契约（`./zoomable-image-props`）。
 *
 * 旋转的视觉几何：父层给的 `displaySize` 是**旋转后的视觉盒**，`<Image>` 必须按
 * `resolveRotatedContentSize` 得到**旋转前**的尺寸布局再施加 `rotate` —— 直接拿视觉盒
 * 布局会让 `contain` 先按错误宽高比缩一圈（四分之一转下两者互为转置）。
 *
 * 与 Android 的已知差异（有意为之，见交付说明）：
 * - 没有双击放大：iOS 没有对应的原生动词，而 `scrollResponderZoomTo` 的矩形语义在
 *   居中 / 回弹场景下不可靠，本阶段不做，避免引入不可真机验证的行为；
 * - 缩放的视口 = 图片自身的显示尺寸（与 Android 的平移夹取基准一致）：放大后可在
 *   图片框内平移，越界部分由外层分页 `ScrollView` 在页面边界裁剪；
 * - 工具栏的 ± 命令经 `zoomScale` 下发，与正在进行的捏合之间最多差一次「上报 → 回灌」
 *   的时延（几十毫秒量级），期间不会每帧写回原生值。
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { MAX_ZOOM_SCALE, MIN_ZOOM_SCALE, deriveZoomed } from './pinch-zoom-math';
import { normalizeRotationDegrees, resolveRotatedContentSize } from './lightbox-model';
import type { ZoomableImageLoadPayload, ZoomableImageProps } from './zoomable-image-props';

/** 滚动事件节流（毫秒）：缩放过程只需要「是否已缩放」的翻转信号。 */
const SCROLL_EVENT_THROTTLE_MS = 16;

/** 未缩放比例（1×）：`zoomScale` 缺失或非有限时的兜底基准。 */
const FIT_SCALE = 1;

/** 捏合静止多久后补报一次最终比例（毫秒）：原生捏合没有「结束」回调。 */
const ZOOM_SETTLE_REPORT_DELAY_MS = 150;

/** 补报阈值：与上一次上报相差小于它就当没变，避免重复渲染父层。 */
const REPORT_EPSILON = 0.01;

export function ZoomableImage({
  src,
  displaySize,
  scale,
  rotation = 0,
  onZoomChange,
  onLoad,
  onError,
  accessibilityLabel,
}: ZoomableImageProps) {
  const reportedZoomedRef = useRef(false);
  const lastReportedScaleRef = useRef(FIT_SCALE);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onZoomChangeRef = useRef(onZoomChange);

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  // 切换图片 / 旋转 / 重新打开：原生 `zoomScale` 由 ScrollView 的 `key` 重挂载归位（不依赖
  // 命令式 API），这里负责把门控与读数同步回父层 —— 否则父层可能仍以为处于缩放态而锁死翻页。
  useEffect(() => {
    clearSettleTimer();
    reportedZoomedRef.current = false;
    lastReportedScaleRef.current = FIT_SCALE;
    onZoomChangeRef.current?.(false, FIT_SCALE);
  }, [src, rotation, clearSettleTimer]);

  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  // 原生缩放会把 `zoomScale` 塞进滚动事件（iOS `scrollViewDidZoom` → `onScroll`，
  // 载荷在 `ScrollEvent.cpp` 的 `payload.setProperty(runtime, 'zoomScale', …)` 里）。
  // 「是否已缩放」只在翻转时上报（避免父层每帧重渲染）；最终比例靠静止补报。
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const rawZoomScale = event.nativeEvent.zoomScale;
      const zoomScale = Number.isFinite(rawZoomScale) ? rawZoomScale : FIT_SCALE;
      const zoomed = deriveZoomed(zoomScale);
      if (zoomed !== reportedZoomedRef.current) {
        reportedZoomedRef.current = zoomed;
        lastReportedScaleRef.current = zoomScale;
        onZoomChangeRef.current?.(zoomed, zoomScale);
      }
      clearSettleTimer();
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        if (Math.abs(zoomScale - lastReportedScaleRef.current) < REPORT_EPSILON) {
          return;
        }
        lastReportedScaleRef.current = zoomScale;
        onZoomChangeRef.current?.(deriveZoomed(zoomScale), zoomScale);
      }, ZOOM_SETTLE_REPORT_DELAY_MS);
    },
    [clearSettleTimer],
  );

  const handleLoad = useCallback(
    (payload: ZoomableImageLoadPayload) => {
      const width = payload.nativeEvent.source?.width;
      const height = payload.nativeEvent.source?.height;
      if (typeof width !== 'number' || typeof height !== 'number') {
        return;
      }
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return;
      }
      onLoad?.({ width, height });
    },
    [onLoad],
  );

  const rotationDegrees = normalizeRotationDegrees(rotation);
  const contentSize = resolveRotatedContentSize(displaySize, rotation);
  // 受控比例始终是有限数字：`zoomScale` 在 RN 里是**受控**原生属性，传 `undefined` 会被
  // 当成「清空」，反而把原生比例打回最小值，因此缺省时显式给 1×。
  const commandScale = scale !== undefined && Number.isFinite(scale) ? scale : FIT_SCALE;

  return (
    <View
      style={[styles.root, { width: displaySize.width, height: displaySize.height }]}
      pointerEvents="box-none"
    >
      <ScrollView
        key={`${src}:${rotationDegrees}`}
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { width: displaySize.width, height: displaySize.height },
        ]}
        minimumZoomScale={MIN_ZOOM_SCALE}
        maximumZoomScale={MAX_ZOOM_SCALE}
        zoomScale={commandScale}
        bouncesZoom
        bounces={false}
        centerContent
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={SCROLL_EVENT_THROTTLE_MS}
        onScroll={handleScroll}
      >
        <Image
          source={{ uri: src }}
          style={[contentSize, { transform: [{ rotate: `${rotationDegrees}deg` }] }]}
          resizeMode="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel}
          onLoad={handleLoad}
          onError={onError}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    width: '100%',
    height: '100%',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
