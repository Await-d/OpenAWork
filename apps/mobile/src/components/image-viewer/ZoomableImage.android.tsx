/**
 * Android 缩放层（W2b / T-09）：自研 `PanResponder` + `Animated`。
 *
 * **为什么不复用原生缩放**：`ScrollView` 的 `minimumZoomScale` / `maximumZoomScale` /
 * `bouncesZoom` / `centerContent` / `zoomScale` 在 Android 上全是**静默 no-op**
 * （JS 层透传、Android 原生零实现），`scrollResponderZoomTo()` 更会直接 `invariant`
 * 抛错（W1/T-02 四重证据）。因此 Android 必须自研手势。
 *
 * 五类陷阱的处理（逐条对应 T-02 结论）：
 * 1. **双指基线时机**：第二指落下不会触发 `Grant`（只触发 `onPanResponderStart`），
 *    抬起一指也不会触发 `Release`（`Release` = 全部离开）。因此基线统一在
 *    `Grant / Start / End` 里按 `evt.nativeEvent.touches.length` 重建，并用 `identifier`
 *    配对查找（**不假设 `touches[0] / touches[1]` 顺序稳定**）。判定「两指」用
 *    `touches.length >= 2`，**不用** `gestureState.numberActiveTouches`（官方文档明确
 *    它在非 responder 时不可靠）。
 * 2. **与原生分页 ScrollView 的竞态**：单指落在图片上就同步成为 JS responder（否则拿不到
 *    单击 / 双击事件，也收不到第二指的 `Start`），但 `onShouldBlockNativeResponder`
 *    只在「已缩放」时返回 true —— 未缩放时放行原生响应者，翻页照常；两指同时落下时
 *    额外用 `onStartShouldSetPanResponderCapture` 抢占。缩放态下 `blockNativeResponder`
 *    会 `requestDisallowInterceptTouchEvent(true)` 托住原生分页；父层
 *    `scrollEnabled={!zoomed}` 是第二道闸（抢到手与置位之间有约 1 帧窗口，已在交付说明中
 *    标注）。
 * 3. **焦点缩放 + 平移夹取**：全部走 `./pinch-zoom-math`；内容（含缩放）不大于视口时
 *    `translate` 恒为 0，杜绝「图飘走」。
 * 4. **`Animated` 取值方向**：`useNativeDriver: true` 只用于动画（双击缩放 / 归位），
 *    手势期用 `setValue`；并且**不读 `Animated.Value._value`** —— JS 侧镜像 `ref` 才是
 *    手势期唯一事实来源，手势结束再写回 React state（经 `onZoomChange`）驱动门控。
 *    动画被打断时镜像与屏幕会分叉（`animateTransform` 提前写入的是**目标值**）：只能靠
 *    `stopAnimation` 的回调异步读回屏幕值再校正，见 `stopAnimationAndReadBack`。
 * 5. **双击检测**：RN 无内置双击，用 `DOUBLE_TAP_WINDOW_MS` 时间戳窗口。本阶段单击图片
 *    没有动作（关闭走「图片外空白区」），因此不存在「单击动作需延迟一个窗口」的冲突；
 *    若给图片加单击动作（如切换工具栏），该动作必须延迟一个窗口后再派发。
 *
 * W2c / T-11 追加：
 * - **受控缩放**：父层的 `scale`（工具栏 ± / 复位命令）与内部比例明显不同时采纳为绝对
 *   比例（带动画 + 平移夹取 + 回执）；手势进行中不介入，避免与手指打架；
 * - **旋转**：`rotation` 变化时内部比例归零到 1×（宽高比变化 → 原生缩放基准失效），
 *   `<Image>` 按 `resolveRotatedContentSize` 的**旋转前**尺寸布局、再施加 `rotate`，
 *   视觉盒恰好等于父层给的 `displaySize`（`resolveRotatedDisplaySize` 的结果）。
 *   已知取舍：焦点缩放的锚点公式建立在「舞台未旋转」的局部坐标上，旋转态下捏合的
 *   锚点会有偏差（旋转已把比例归零，偏移有界），列入真机走查。
 *
 * 坐标约定：位移与焦点都在**相对内容中心**的局部坐标里，与
 * `transform: [{ translateX }, { translateY }, { scale }]` 的原生语义（先缩放后平移）
 * 对齐；焦点由「页面坐标 − 舞台中心（`measureInWindow`）」得到。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type NativeTouchEvent,
  type PanResponderGestureState,
} from 'react-native';
import { spacing } from '../../theme/spacing';
import {
  DOUBLE_TAP_WINDOW_MS,
  MAX_ZOOM_SCALE,
  MIN_ZOOM_SCALE,
  ZOOMED_TOLERANCE,
  clampTranslate,
  deriveZoomed,
  distanceBetween,
  focusPointZoom,
  midpoint,
  nextDoubleTapScale,
  scaleFromPinchDistance,
  type Point,
} from './pinch-zoom-math';
import { normalizeRotationDegrees, resolveRotatedContentSize } from './lightbox-model';
import type { ZoomableImageLoadPayload, ZoomableImageProps } from './zoomable-image-props';

/** 单击 / 拖拽判定容差（8px，与 Android `ViewConfiguration` 的 touchSlop 同数量级）。 */
const TAP_MOVE_TOLERANCE = spacing[2];

/** 动画时长（双击缩放 / 归位）：短促无过冲，不抢占交互注意力。 */
const ZOOM_ANIMATION_DURATION_MS = 180;

/** 未缩放比例（1×）。 */
const FIT_SCALE = 1;

/** 受控缩放的采纳容差：与内部比例相差小于它就当作回执，不重复动画。 */
const COMMAND_SCALE_EPSILON = 0.01;

/** 中断动画时要读回的 `Animated.Value` 个数（scale / translateX / translateY）。 */
const READBACK_VALUE_COUNT = 3;

/** 零位移（内容不大于视口时复用同一对象）。 */
const ZERO_TRANSLATE: Point = Object.freeze({ x: 0, y: 0 });

/** 双指（捏合）手势基线。 */
interface PinchGestureSession {
  readonly kind: 'pinch';
  readonly firstIdentifier: string;
  readonly secondIdentifier: string;
  readonly startDistance: number;
  readonly startScale: number;
  readonly startTranslate: Point;
  /** 手势起点的焦点（相对内容中心的局部坐标）：焦点缩放的锚点。 */
  readonly startFocal: Point;
  /** 手势起点的焦点（页面坐标）：只用于两指整体移动的漂移量。 */
  readonly startFocalPage: Point;
}

/** 单指（已缩放时的平移）手势基线。 */
interface PanGestureSession {
  readonly kind: 'pan';
  readonly touchIdentifier: string;
  readonly startPointPage: Point;
  readonly startTranslate: Point;
}

type GestureSession = PinchGestureSession | PanGestureSession;

/** 按 `identifier` 查找触摸点：`touches` 顺序不可假设稳定。 */
function findTouch(
  touches: readonly NativeTouchEvent[],
  identifier: string,
): NativeTouchEvent | null {
  return touches.find((touch) => touch.identifier === identifier) ?? null;
}

/** 触摸点 → 页面坐标（非有限分量按 0 归一，公共数学层仍会再兜底一次）。 */
function toPagePoint(touch: NativeTouchEvent): Point {
  return {
    x: Number.isFinite(touch.pageX) ? touch.pageX : 0,
    y: Number.isFinite(touch.pageY) ? touch.pageY : 0,
  };
}

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
  const rootRef = useRef<View | null>(null);
  const scaleValue = useRef(new Animated.Value(FIT_SCALE)).current;
  const translateXValue = useRef(new Animated.Value(0)).current;
  const translateYValue = useRef(new Animated.Value(0)).current;

  // JS 侧镜像：手势期唯一事实来源（绝不读 `Animated.Value._value`）。
  const scaleRef = useRef<number>(FIT_SCALE);
  const translateRef = useRef<Point>(ZERO_TRANSLATE);
  const sessionRef = useRef<GestureSession | null>(null);
  const gestureActiveRef = useRef(false);
  const tapCandidateRef = useRef(false);
  const lastTapAtRef = useRef(0);
  const reportedZoomedRef = useRef(false);
  const blockNativeResponderRef = useRef(false);
  const stageCenterRef = useRef<Point | null>(null);
  const displaySizeRef = useRef(displaySize);
  const onZoomChangeRef = useRef(onZoomChange);

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  useEffect(() => {
    displaySizeRef.current = displaySize;
  }, [displaySize]);

  // 切换图片 / 旋转 / 重新打开：一律回到 1×，并把门控同步回父层（单一事实来源）。
  // 旋转必须归零：宽高比变了，原有的比例与位移基准全部失效。
  useEffect(() => {
    sessionRef.current = null;
    gestureActiveRef.current = false;
    tapCandidateRef.current = false;
    lastTapAtRef.current = 0;
    scaleRef.current = FIT_SCALE;
    translateRef.current = ZERO_TRANSLATE;
    reportedZoomedRef.current = false;
    blockNativeResponderRef.current = false;
    scaleValue.setValue(FIT_SCALE);
    translateXValue.setValue(0);
    translateYValue.setValue(0);
    onZoomChangeRef.current?.(false, FIT_SCALE);
  }, [src, rotation, scaleValue, translateXValue, translateYValue]);

  /** 页面坐标 → 舞台局部坐标（相对内容中心）；未测量时退回居中缩放。 */
  const resolveFocal = useCallback((pagePoint: Point): Point => {
    const center = stageCenterRef.current;
    if (!center) {
      return ZERO_TRANSLATE;
    }
    return { x: pagePoint.x - center.x, y: pagePoint.y - center.y };
  }, []);

  /** 测量舞台中心（窗口坐标）：`onLayout` 与每次手势开始时刷新。 */
  const measureStage = useCallback(() => {
    const node = rootRef.current;
    if (!node) {
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
      ) {
        return;
      }
      stageCenterRef.current = { x: x + width / 2, y: y + height / 2 };
    });
  }, []);

  /** 手势期写值：镜像 ref 与原生 `Animated.Value` 同步前进。 */
  const applyTransform = useCallback(
    (nextScale: number, nextTranslate: Point) => {
      scaleRef.current = nextScale;
      translateRef.current = nextTranslate;
      scaleValue.setValue(nextScale);
      translateXValue.setValue(nextTranslate.x);
      translateYValue.setValue(nextTranslate.y);
    },
    [scaleValue, translateXValue, translateYValue],
  );

  /**
   * 上报门控（缩放层是唯一事实来源）：`zoomed` 由 `deriveZoomed(scale)` 派生；
   * `force` 用于手势结束 / 动画结束时的最终值回写（供 W2c 工具栏读数）。
   * 同时维护 `blockNativeResponderRef`，让原生分页在缩放态下不参与竞争。
   */
  const syncZoomReport = useCallback((nextScale: number, force: boolean) => {
    const zoomed = deriveZoomed(nextScale);
    blockNativeResponderRef.current = zoomed;
    if (!force && zoomed === reportedZoomedRef.current) {
      return;
    }
    reportedZoomedRef.current = zoomed;
    onZoomChangeRef.current?.(zoomed, nextScale);
  }, []);

  /** 原生驱动的位移动画（transform 走 `useNativeDriver: true`）。 */
  const animateTransform = useCallback(
    (nextScale: number, nextTranslate: Point) => {
      scaleRef.current = nextScale;
      translateRef.current = nextTranslate;
      blockNativeResponderRef.current = deriveZoomed(nextScale);
      Animated.parallel([
        Animated.timing(scaleValue, {
          toValue: nextScale,
          duration: ZOOM_ANIMATION_DURATION_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateXValue, {
          toValue: nextTranslate.x,
          duration: ZOOM_ANIMATION_DURATION_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateYValue, {
          toValue: nextTranslate.y,
          duration: ZOOM_ANIMATION_DURATION_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        // 动画被新手势打断（finished === false）时，状态由手势接管，不回写；
        // 镜像与屏幕的分叉由 `stopAnimationAndReadBack` 在读回后校正。
        if (finished) {
          syncZoomReport(nextScale, true);
        }
      });
    },
    [scaleValue, syncZoomReport, translateXValue, translateYValue],
  );

  /**
   * 把已建立的手势基线重锚到屏幕当前值。
   *
   * 只在「动画被打断」时用得上：`animateTransform` 在启动前就把镜像写成了**目标值**，
   * 打断瞬间同步建立的基线因此可能拿着目标值。触摸几何（`startDistance` / `startFocal` /
   * `startPointPage`）保持原样 —— 采样时刻距此只有几毫秒，误差有界；但位移与比例是基线的
   * 原点，必须重锚，否则单指平移会整体偏移、焦点缩放的锚点也会漂。
   */
  const rebaseSession = useCallback((nextScale: number, nextTranslate: Point) => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    sessionRef.current =
      session.kind === 'pan'
        ? { ...session, startTranslate: nextTranslate }
        : { ...session, startScale: nextScale, startTranslate: nextTranslate };
  }, []);

  /**
   * 打断进行中的动画，并把 JS 镜像校正回**屏幕当前值**。
   *
   * `useNativeDriver: true` 的动画在 JS 侧取不到当前值（RN 的
   * `AnimatedValue.stopAnimation` 走 `NativeAnimatedAPI.getValue`，回读是异步的，且不会
   * 顺手更新 `_value`），所以判定必须等三个值全部回来：
   * - 回读期间镜像若被别的写入改过（新手势推进 / 新动画 / 复位），读回值已经过期，丢弃；
   * - 读回值 === 镜像 → 没有动画被打断，同步建立的基线仍然有效，什么都不做；
   * - 读回值 !== 镜像 → 动画确实停在中间帧：校正镜像、重算原生响应者闸门，再按手势是否
   *   还在进行选择「重锚基线」或「把真实值回执给父层」。
   */
  const stopAnimationAndReadBack = useCallback(() => {
    const requestedScale = scaleRef.current;
    const requestedTranslate = translateRef.current;
    let remaining = READBACK_VALUE_COUNT;
    let readScale = requestedScale;
    let readTranslate = requestedTranslate;

    const settle = () => {
      remaining -= 1;
      if (remaining > 0) {
        return;
      }
      // 请求之后镜像被改写 → 读回值已过期（写入方比它新），不覆盖。
      if (scaleRef.current !== requestedScale || translateRef.current !== requestedTranslate) {
        return;
      }
      if (
        readScale === requestedScale &&
        readTranslate.x === requestedTranslate.x &&
        readTranslate.y === requestedTranslate.y
      ) {
        return;
      }
      scaleRef.current = readScale;
      translateRef.current = readTranslate;
      blockNativeResponderRef.current = deriveZoomed(readScale);
      if (gestureActiveRef.current) {
        rebaseSession(readScale, readTranslate);
        return;
      }
      // 手指在读回落地前就抬起了：把冻结在屏幕上的真实值回执给父层，
      // 否则工具栏读数与返回键语义会停在动画目标值上。
      syncZoomReport(readScale, true);
    };

    scaleValue.stopAnimation((value) => {
      readScale = value;
      settle();
    });
    translateXValue.stopAnimation((value) => {
      readTranslate = { ...readTranslate, x: value };
      settle();
    });
    translateYValue.stopAnimation((value) => {
      readTranslate = { ...readTranslate, y: value };
      settle();
    });
  }, [rebaseSession, scaleValue, syncZoomReport, translateXValue, translateYValue]);

  /** 归位到指定比例（平移量按新比例重新夹取）。 */
  const settleTo = useCallback(
    (targetScale: number) => {
      const contentSize = displaySizeRef.current;
      const nextTranslate = clampTranslate({
        translate: translateRef.current,
        contentSize,
        viewportSize: contentSize,
        scale: targetScale,
      });
      animateTransform(targetScale, nextTranslate);
    },
    [animateTransform],
  );

  // 受控缩放（工具栏 ± / 复位命令）：只有「与内部比例明显不同」才采纳，手势进行中一律不介入
  // —— 手势期内部比例由手指驱动，父层拿到的是回执，回灌回来时两者已经相等，不应再动画一次。
  // 采纳动画结束后由 `animateTransform` 回执最终比例（含门控布尔），父层无需自己推导。
  useEffect(() => {
    if (scale === undefined || !Number.isFinite(scale)) {
      return;
    }
    if (gestureActiveRef.current) {
      return;
    }
    if (Math.abs(scale - scaleRef.current) < COMMAND_SCALE_EPSILON) {
      return;
    }
    settleTo(Math.min(Math.max(scale, MIN_ZOOM_SCALE), MAX_ZOOM_SCALE));
  }, [scale, settleTo]);

  /** 手势收尾：回弹带（|scale − 1| ≤ 容差）内归一到恰好 1×，否则回写最终门控值。 */
  const finishGesture = useCallback(() => {
    if (!gestureActiveRef.current) {
      return;
    }
    gestureActiveRef.current = false;
    sessionRef.current = null;
    const currentScale = scaleRef.current;
    if (!deriveZoomed(currentScale) && currentScale !== FIT_SCALE) {
      settleTo(FIT_SCALE);
      return;
    }
    syncZoomReport(currentScale, true);
  }, [settleTo, syncZoomReport]);

  /** 建立双指基线：初始距离 / 初始比例 / 初始位移 / 初始焦点。 */
  const startPinchSession = useCallback(
    (touches: readonly NativeTouchEvent[]) => {
      const first = touches[0];
      const second = touches[1];
      if (!first || !second) {
        return;
      }
      const firstPoint = toPagePoint(first);
      const secondPoint = toPagePoint(second);
      const focalPage = midpoint(firstPoint, secondPoint);
      sessionRef.current = {
        kind: 'pinch',
        firstIdentifier: first.identifier,
        secondIdentifier: second.identifier,
        startDistance: distanceBetween(firstPoint, secondPoint),
        startScale: scaleRef.current,
        startTranslate: translateRef.current,
        startFocal: resolveFocal(focalPage),
        startFocalPage: focalPage,
      };
      tapCandidateRef.current = false;
      // 注意：`onShouldBlockNativeResponder` 只在 **grant 时**被采样（PanResponder.js
      // 在 `onResponderGrant` 里调用它），因此这里置位只对下一次授权生效。本次捏合的
      // 原生竞态由父层 `scrollEnabled={!zoomed}` 兜底（约 1 帧窗口，T-02 已确认）。
      blockNativeResponderRef.current = true;
    },
    [resolveFocal],
  );

  /** 建立单指平移基线（仅在已缩放时使用，此时平移不会抢走翻页手势）。 */
  const startPanSession = useCallback((touches: readonly NativeTouchEvent[]) => {
    const touch = touches[0];
    if (!touch) {
      return;
    }
    sessionRef.current = {
      kind: 'pan',
      touchIdentifier: touch.identifier,
      startPointPage: toPagePoint(touch),
      startTranslate: translateRef.current,
    };
  }, []);

  /** 依当前触摸数重建基线：≥2 指 → 捏合；1 指且已缩放 → 平移。 */
  const beginGesture = useCallback(
    (touches: readonly NativeTouchEvent[]) => {
      if (touches.length >= 2) {
        startPinchSession(touches);
        return;
      }
      if (touches.length === 1 && deriveZoomed(scaleRef.current)) {
        startPanSession(touches);
      }
    },
    [startPanSession, startPinchSession],
  );

  /** 手势推进：捏合走焦点缩放 + 平移夹取；单指走纯平移。 */
  const updateGesture = useCallback(
    (touches: readonly NativeTouchEvent[]) => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }
      const contentSize = displaySizeRef.current;
      if (session.kind === 'pinch') {
        const first = findTouch(touches, session.firstIdentifier);
        const second = findTouch(touches, session.secondIdentifier);
        if (!first || !second) {
          // 一指已抬起：基线作废，交给 `onPanResponderEnd` 按剩余手指数重建。
          sessionRef.current = null;
          return;
        }
        const firstPoint = toPagePoint(first);
        const secondPoint = toPagePoint(second);
        const nextScale = scaleFromPinchDistance(
          session.startDistance,
          distanceBetween(firstPoint, secondPoint),
          session.startScale,
        );
        const focalPage = midpoint(firstPoint, secondPoint);
        const anchored = focusPointZoom({
          scale: session.startScale,
          nextScale,
          focal: session.startFocal,
          translate: session.startTranslate,
        });
        // 两指整体平移：焦点在页面坐标里的漂移量直接加到锚定结果上。
        const nextTranslate = clampTranslate({
          translate: {
            x: anchored.x + (focalPage.x - session.startFocalPage.x),
            y: anchored.y + (focalPage.y - session.startFocalPage.y),
          },
          contentSize,
          viewportSize: contentSize,
          scale: nextScale,
        });
        applyTransform(nextScale, nextTranslate);
        syncZoomReport(nextScale, false);
        return;
      }
      const touch = findTouch(touches, session.touchIdentifier);
      if (!touch) {
        sessionRef.current = null;
        return;
      }
      const point = toPagePoint(touch);
      const nextTranslate = clampTranslate({
        translate: {
          x: session.startTranslate.x + (point.x - session.startPointPage.x),
          y: session.startTranslate.y + (point.y - session.startPointPage.y),
        },
        contentSize,
        viewportSize: contentSize,
        scale: scaleRef.current,
      });
      applyTransform(scaleRef.current, nextTranslate);
    },
    [applyTransform, syncZoomReport],
  );

  /** 双击放大 / 复位：手写时间戳窗口消歧。 */
  const handleTap = useCallback(
    (event: GestureResponderEvent) => {
      const now = Date.now();
      const isDoubleTap = now - lastTapAtRef.current <= DOUBLE_TAP_WINDOW_MS;
      lastTapAtRef.current = isDoubleTap ? 0 : now;
      if (!isDoubleTap) {
        // 本阶段单击图片没有动作（关闭走图片外空白区），所以无需延迟派发。
        return;
      }
      const contentSize = displaySizeRef.current;
      const nextScale = nextDoubleTapScale(scaleRef.current, ZOOMED_TOLERANCE);
      const focal = resolveFocal({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
      const anchored = focusPointZoom({
        scale: scaleRef.current,
        nextScale,
        focal,
        translate: translateRef.current,
      });
      animateTransform(
        nextScale,
        clampTranslate({
          translate: anchored,
          contentSize,
          viewportSize: contentSize,
          scale: nextScale,
        }),
      );
    },
    [animateTransform, resolveFocal],
  );

  const handleGrant = useCallback(
    (event: GestureResponderEvent) => {
      const touches = event.nativeEvent.touches;
      // 动画进行中被打断：先停住并请求读回屏幕当前值（避免原生动画与手势 `setValue`
      // 互相覆盖）。读回是异步的，所以基线先按镜像同步建立；读回落地后若发现镜像其实
      // 落后于屏幕（打断确实发生了），再按屏幕值重算闸门并重锚基线。
      stopAnimationAndReadBack();
      measureStage();
      gestureActiveRef.current = true;
      tapCandidateRef.current = touches.length === 1;
      blockNativeResponderRef.current = deriveZoomed(scaleRef.current);
      beginGesture(touches);
    },
    [beginGesture, measureStage, stopAnimationAndReadBack],
  );

  /** 第二指落下（`Grant` 不会再次触发）：在 `Start` 里重建捏合基线。 */
  const handleStart = useCallback(
    (event: GestureResponderEvent) => {
      if (event.nativeEvent.touches.length >= 2) {
        tapCandidateRef.current = false;
      }
      beginGesture(event.nativeEvent.touches);
    },
    [beginGesture],
  );

  const handleMove = useCallback(
    (event: GestureResponderEvent, gestureState: PanResponderGestureState) => {
      if (sessionRef.current) {
        tapCandidateRef.current = false;
      } else if (
        Math.abs(gestureState.dx) > TAP_MOVE_TOLERANCE ||
        Math.abs(gestureState.dy) > TAP_MOVE_TOLERANCE
      ) {
        tapCandidateRef.current = false;
      }
      updateGesture(event.nativeEvent.touches);
    },
    [updateGesture],
  );

  /** 手指抬起：`End` 按剩余手指数重建基线，全部离开才算手势结束。 */
  const handleEnd = useCallback(
    (event: GestureResponderEvent) => {
      sessionRef.current = null;
      beginGesture(event.nativeEvent.touches);
      if (event.nativeEvent.touches.length === 0) {
        finishGesture();
      }
    },
    [beginGesture, finishGesture],
  );

  const handleRelease = useCallback(
    (event: GestureResponderEvent, gestureState: PanResponderGestureState) => {
      const wasTap =
        tapCandidateRef.current &&
        Math.abs(gestureState.dx) <= TAP_MOVE_TOLERANCE &&
        Math.abs(gestureState.dy) <= TAP_MOVE_TOLERANCE;
      finishGesture();
      if (wasTap) {
        handleTap(event);
      }
    },
    [finishGesture, handleTap],
  );

  const handleTerminate = useCallback(() => {
    tapCandidateRef.current = false;
    finishGesture();
  }, [finishGesture]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // 陷阱 2：两指同时落下时同步抢占（不能只等 move 阶段）。
        onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2,
        // 单指落在图片上就接管：既要单击 / 双击，也要第二指的 `Start`；
        // 未缩放时 `onShouldBlockNativeResponder` 返回 false，原生分页不受影响。
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onShouldBlockNativeResponder: () => blockNativeResponderRef.current,
        onPanResponderTerminationRequest: () => true,
        onPanResponderGrant: handleGrant,
        onPanResponderStart: handleStart,
        onPanResponderMove: handleMove,
        onPanResponderEnd: handleEnd,
        onPanResponderRelease: handleRelease,
        onPanResponderTerminate: handleTerminate,
      }),
    [handleEnd, handleGrant, handleMove, handleRelease, handleStart, handleTerminate],
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
  // 旋转前的布局尺寸（四分之一转下与视觉盒互为转置）：先按它布局、再 rotate，旋转后的
  // 视觉盒恰好等于 `displaySize`，既不裁剪也不多留白。
  const contentSize = resolveRotatedContentSize(displaySize, rotation);

  return (
    <View
      ref={rootRef}
      style={[styles.root, { width: displaySize.width, height: displaySize.height }]}
      pointerEvents="box-none"
      onLayout={measureStage}
      {...panResponder.panHandlers}
    >
      <Animated.View
        style={[
          styles.stage,
          { width: contentSize.width, height: contentSize.height },
          {
            // 数组顺序即矩阵乘法顺序：rotate 先作用于内容，再等比 scale，最后屏幕空间平移
            // —— 与 `./pinch-zoom-math` 的 `screen = translate + scale × local` 约定一致。
            transform: [
              { translateX: translateXValue },
              { translateY: translateYValue },
              { scale: scaleValue },
              { rotate: `${rotationDegrees}deg` },
            ],
          },
        ]}
      >
        <Image
          source={{ uri: src }}
          style={styles.image}
          resizeMode="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel}
          onLoad={handleLoad}
          onError={onError}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
