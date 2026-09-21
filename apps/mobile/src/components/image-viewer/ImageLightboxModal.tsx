/**
 * 移动端全屏图片查看器（W2a 骨架：T-08 + T-10；W2b 缩放接线；W2c 工具栏与变换接线：T-11）。
 *
 * 语义基线是 Web 端 `apps/web/src/components/chat/image/image-lightbox.tsx`，
 * 但索引 / 进度 / 变换 / 文案 / 尺寸等可判定逻辑全部复用 `./lightbox-model`——
 * 本文件只负责 RN 侧渲染与触摸通道，不另立一套语义。
 *
 * 范围（W2a 骨架 + W2b 缩放 + W2c 工具栏）：
 * - 双模式：`items` 非空时优先，否则把单图 `src` 包装成单元素数组，下游只处理一种形状；
 * - 原生分页：横向 `ScrollView` + `pagingEnabled`，页宽随 `useWindowDimensions()` 重算；
 *   变换（`scale` / `rotation`）与 `onZoomChange` 只接给**当前页**，离屏页恒为默认变换
 *   且不上报 —— 缩放当前页不会带动其余已挂载的页；
 * - 关闭三通道：`Modal.onRequestClose`（Android 硬件返回键的唯一入口）/ 点图片外空白区 /
 *   工具栏关闭按钮 —— 三者都走 `resolveBackAction`（已缩放或已旋转时先复位，不关闭）；
 *   关闭按钮从右上角移入底部工具栏，避免同屏出现两个语义相同的关闭入口；
 * - 空态：`!open` 或没有任何有效条目 → 返回 `null`，不渲染空壳；
 * - 缩放（W2b）：每页图片交给 `ZoomableImage`（iOS 原生 `ScrollView` / Android 自研
 *   `PanResponder`），缩放层上报 `onZoomChange(zoomed, scale)`；
 * - 工具栏（W2c）：`./LightboxToolbar` 负责 −/百分比/＋/左旋/右旋/重置全部/关闭，
 *   全部动作经 `transformReducer` 派发，本组件只持有状态与派发器。
 *
 * 事实来源分层（不要在这里再推一份）：
 * - `zoomed` 门控布尔**只**由缩放层用 `deriveZoomed(scale)` 派生并上报，本组件只持有它，
 *   分页 `ScrollView` 的 `scrollEnabled={!zoomed}` 与工具栏都只读这个布尔值；
 * - `scale` / `rotation`（变换状态）由本组件的 `useReducer(transformReducer, …)` 持有：
 *   工具栏是命令来源，缩放层的上报经 `setScale` 回灌 → 捏合 / 双击后的读数与返回键语义
 *   才和实际画面一致。
 *
 * 明确**不在**本阶段：下载 / 保存 / 分享（`expo-sharing` / `expo-media-library` 未安装）；
 * 窗口化渲染（只挂载当前页 ±1 / `FlatList` 虚拟化）同样不在本期：分页用 `contentOffset`
 * 做外部索引同步，换成虚拟化列表要一并改写索引同步，风险大于收益，留待后续评估。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';
import { radii } from '../../theme/radii';
import { spacing } from '../../theme/spacing';
import { textPresets } from '../../theme/typography';
import {
  INITIAL_TRANSFORM_STATE,
  formatProgress,
  goToIndex,
  hasMultiple,
  pageIndexFromOffset,
  resolveAltText,
  resolveBackAction,
  resolveIndex,
  resolveRotatedDisplaySize,
  shouldResetTransform,
  transformReducer,
  type DisplayBounds,
  type DisplaySize,
  type ImageIntrinsicSize,
  type TransformAction,
} from './lightbox-model';
import {
  LIGHTBOX_CLOSE_A11Y_LABEL,
  LightboxToolbar,
  TOOLBAR_TOUCH_TARGET_SIZE,
} from './LightboxToolbar';
import { ZoomableImage } from './ZoomableImage';

/** 遮罩不透明度：查看器压暗底层界面以突出图像本身。 */
const SCRIM_OPACITY = 0.94;

/** 图片与屏幕边缘的呼吸留白。 */
const PAGE_PADDING = spacing[4];

/** 顶部进度条占用高度（不含安全区）。 */
const TOOLBAR_RESERVE = spacing[11];

/** 底部工具栏占用高度（不含安全区）：按钮 + 下侧呼吸留白。 */
const BOTTOM_TOOLBAR_RESERVE = TOOLBAR_TOUCH_TARGET_SIZE + spacing[2];

/** 底部说明文字预留高度（最多两行）。 */
const CAPTION_RESERVE = spacing[8];

/** 进度读屏播报的最小间隔（毫秒）：连续翻页时不刷屏。 */
const PROGRESS_ANNOUNCE_THROTTLE_MS = 1200;

/** 内禀尺寸未知时的占位（交给 `resolveRotatedDisplaySize` 走 48px 兜底）。 */
const EMPTY_INTRINSIC_SIZE: ImageIntrinsicSize = {};

/** 查看器条目（对齐 Web 端 `ImageLightboxItem` 契约）。 */
export interface ImageLightboxItem {
  readonly src: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly fileName?: string;
}

export interface ImageLightboxModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** 单图模式（向后兼容）：`items` 非空时被忽略。 */
  readonly src?: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly fileName?: string;
  /** 图集模式；非空时优先于单图 `src`。 */
  readonly items?: readonly ImageLightboxItem[];
  /** 受控下标；不传则组件内部维护。 */
  readonly index?: number;
  readonly onIndexChange?: (index: number) => void;
}

interface LightboxPageProps {
  readonly item: ImageLightboxItem;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly bounds: DisplayBounds;
  /** 当前缩放比例（工具栏命令 + 缩放层回灌的合成结果）；离屏页恒为默认 1×。 */
  readonly scale: number;
  /** 当前旋转角度（度，累计值）；离屏页恒为默认 0。 */
  readonly rotation: number;
  readonly onDismissRequest: () => void;
  /**
   * 缩放层上报的门控与真实比例，本页只做透传。**只有当前页传**：离屏页不上报，
   * 否则它们的复位 / 回弹回执会写进父层的共享变换状态。
   */
  readonly onZoomChange?: (zoomed: boolean, scale: number) => void;
}

/**
 * 单页（一图一页）。
 *
 * 空白区铺一层背景板负责「点图片外关闭」；图片本体与说明文字是它的上层兄弟节点，
 * 命中测试天然落在图片 / 文字上，因此点图片与工具栏区域不会冒泡触发关闭，
 * 也不需要额外的 `onPress` 吞事件。
 */
function LightboxPage({
  item,
  pageWidth,
  pageHeight,
  bounds,
  scale,
  rotation,
  onDismissRequest,
  onZoomChange,
}: LightboxPageProps) {
  const [failed, setFailed] = useState(false);
  const [intrinsicSize, setIntrinsicSize] = useState<ImageIntrinsicSize>(EMPTY_INTRINSIC_SIZE);

  const altText = resolveAltText(item.alt, item.caption);
  // 旋转 90° / 270° 时先交换宽高再 contain：缩小后的视觉盒才能在页面内不出界。
  const displaySize = resolveRotatedDisplaySize(intrinsicSize, rotation, bounds);

  const handleLoad = useCallback((sourceSize: DisplaySize) => {
    setIntrinsicSize(sourceSize);
  }, []);

  const handleError = useCallback(() => {
    setFailed(true);
    AccessibilityInfo.announceForAccessibility(`图片加载失败：${altText}`);
  }, [altText]);

  return (
    <View style={[styles.page, { width: pageWidth, height: pageHeight }]}>
      <Pressable
        style={styles.backdrop}
        onPress={onDismissRequest}
        accessibilityRole="button"
        accessibilityLabel={LIGHTBOX_CLOSE_A11Y_LABEL}
      />

      {failed ? (
        <View style={styles.errorBox} accessible accessibilityRole="alert">
          <Ionicons name="image-outline" size={spacing[6]} color={colors.danger} />
          <Text style={styles.errorTitle}>图片加载失败</Text>
          <Text style={styles.errorHint} numberOfLines={3}>
            {altText}
          </Text>
        </View>
      ) : (
        <ZoomableImage
          src={item.src}
          displaySize={displaySize}
          scale={scale}
          rotation={rotation}
          onLoad={handleLoad}
          onError={handleError}
          onZoomChange={onZoomChange}
          accessibilityLabel={altText}
        />
      )}

      {item.caption ? (
        <Text style={styles.caption} numberOfLines={2}>
          {item.caption}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * 全屏图片查看器覆盖层。受控 `index` 优先；`src` / `items` 两种输入最终收敛成同一形状。
 */
export function ImageLightboxModal({
  open,
  onClose,
  src,
  alt,
  caption,
  fileName,
  items,
  index,
  onIndexChange,
}: ImageLightboxModalProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const previousSrcRef = useRef<string | null>(null);
  const lastAnnouncedAtRef = useRef(0);

  const [internalIndex, setInternalIndex] = useState(0);
  const [transform, dispatchTransform] = useReducer(transformReducer, INITIAL_TRANSFORM_STATE);
  // 缩放门控（单一事实来源的持有者）：只由缩放层 `ZoomableImage` 上报，本组件不自己
  // 推导 scale。分页 `ScrollView` 与工具栏都只读这个布尔值。
  const [zoomed, setZoomed] = useState(false);

  // 图集非空优先；单图包成单元素数组 —— 下游只处理 `items` 一种形状。
  const effectiveItems = useMemo<readonly ImageLightboxItem[]>(() => {
    const fromGallery = items?.filter((item) => item.src.length > 0) ?? [];
    if (fromGallery.length > 0) {
      return fromGallery;
    }
    return src && src.length > 0 ? [{ src, alt, caption, fileName }] : [];
  }, [items, src, alt, caption, fileName]);

  const count = effectiveItems.length;
  const currentIndex = resolveIndex(index, internalIndex, count);
  const currentItem = effectiveItems[currentIndex];
  const currentSrc = currentItem?.src;
  const multiple = hasMultiple(count);

  const bounds = useMemo<DisplayBounds>(
    () => ({
      maxWidth: Math.max(windowWidth - PAGE_PADDING * 2, 1),
      maxHeight: Math.max(
        windowHeight -
          insets.top -
          insets.bottom -
          // 顶部只有多图时才渲染进度条；单图不留这块空白，图片可以更大。
          (multiple ? TOOLBAR_RESERVE : 0) -
          BOTTOM_TOOLBAR_RESERVE -
          CAPTION_RESERVE,
        1,
      ),
    }),
    [windowWidth, windowHeight, insets.top, insets.bottom, multiple],
  );

  // 打开动作与「当前图片变化」都要复位变换与缩放门控（C2：锚定 src，而不是 index）。
  // `resetAll` 在初始态返回同一对象引用，不会触发额外渲染。
  useEffect(() => {
    if (!open) {
      previousSrcRef.current = null;
      return;
    }
    // previousSrcRef 为 null 表示「本次是打开动作」，与换图区分开。
    const isOpening = previousSrcRef.current === null;
    if (shouldResetTransform(previousSrcRef.current, currentSrc, isOpening)) {
      dispatchTransform({ type: 'resetAll' });
      setZoomed(false);
      lastAnnouncedAtRef.current = 0;
    }
    previousSrcRef.current = currentSrc ?? null;
  }, [open, currentSrc]);

  // 多图才播报进度；节流，避免连续翻页时读屏刷屏。
  useEffect(() => {
    if (!open || !multiple) {
      return;
    }
    const now = Date.now();
    if (now - lastAnnouncedAtRef.current < PROGRESS_ANNOUNCE_THROTTLE_MS) {
      return;
    }
    lastAnnouncedAtRef.current = now;
    AccessibilityInfo.announceForAccessibility(formatProgress(currentIndex, count));
  }, [open, multiple, currentIndex, count]);

  // 关闭四通道共用：变换未复位时先复位（先重置再关闭），否则真正关闭。
  const handleDismissRequest = useCallback(() => {
    if (resolveBackAction(transform) === 'resetAll') {
      dispatchTransform({ type: 'resetAll' });
      setZoomed(false);
      return;
    }
    onClose();
  }, [transform, onClose]);

  /**
   * 工具栏 / 缩放层共用的派发入口。
   *
   * 「旋转不保留缩放」这条规则放在这里，而不是散进工具栏：缩放层内部的平移与焦点基准
   * 建立在未旋转的宽高比上，旋转落地必须回到 1×。两个动作都经 `transformReducer` 计算，
   * 本组件不自己算 scale —— React 会把两条 dispatch 合并成一次渲染。
   */
  const dispatchTransformAction = useCallback((action: TransformAction) => {
    dispatchTransform(action);
    if (action.type === 'rotateLeft' || action.type === 'rotateRight') {
      dispatchTransform({ type: 'resetZoom' });
    }
  }, []);

  /**
   * 缩放层上报：门控布尔直接落地（单一事实来源），同时把**真实比例**回灌进变换状态。
   * 少了这一步，捏合 / 双击后的工具栏读数与「返回键先复位」语义就会和实际画面脱节。
   */
  const handleZoomChange = useCallback((nextZoomed: boolean, nextScale: number) => {
    setZoomed(nextZoomed);
    dispatchTransform({ type: 'setScale', scale: nextScale });
  }, []);

  // 分页 → 索引：由落点偏移反推页下标，再走 goToIndex 的 no-op 语义，
  // 边界不回绕、也不把相同下标回抛给受控调用点。
  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = pageIndexFromOffset(event.nativeEvent.contentOffset.x, windowWidth, count);
      const result = goToIndex(currentIndex, nextIndex, count);
      if (result.kind === 'change') {
        setInternalIndex(result.index);
        onIndexChange?.(result.index);
      }
    },
    [windowWidth, count, currentIndex, onIndexChange],
  );

  // 空态：未打开，或没有任何有效条目 → 不渲染空壳。
  if (!open || !currentItem) {
    return null;
  }

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={handleDismissRequest}
    >
      <View style={styles.root}>
        <View style={styles.scrim} pointerEvents="none" />

        <ScrollView
          style={styles.pager}
          horizontal
          pagingEnabled
          bounces={false}
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: currentIndex * windowWidth, y: 0 }}
          onMomentumScrollEnd={handleMomentumScrollEnd}
        >
          {effectiveItems.map((item, itemIndex) => {
            // 变换只作用于当前页：离屏页恒为默认（1× / 0°）且不上报 —— 否则缩放当前页会
            // 把所有已挂载的页一起带动（各自跑一遍动画），离屏页的回执还会覆盖父层状态。
            const isCurrentPage = itemIndex === currentIndex;
            return (
              <LightboxPage
                key={`${itemIndex}:${item.src}`}
                item={item}
                pageWidth={windowWidth}
                pageHeight={windowHeight}
                bounds={bounds}
                scale={isCurrentPage ? transform.scale : INITIAL_TRANSFORM_STATE.scale}
                rotation={isCurrentPage ? transform.rotation : INITIAL_TRANSFORM_STATE.rotation}
                onDismissRequest={handleDismissRequest}
                onZoomChange={isCurrentPage ? handleZoomChange : undefined}
              />
            );
          })}
        </ScrollView>

        {multiple ? (
          <View
            style={[
              styles.progressRow,
              {
                paddingTop: insets.top + spacing[2],
                paddingLeft: insets.left + spacing[4],
                paddingRight: insets.right + spacing[4],
              },
            ]}
            pointerEvents="box-none"
          >
            <View style={styles.progressPill}>
              <Text style={styles.progressText}>{formatProgress(currentIndex, count)}</Text>
            </View>
          </View>
        ) : null}

        <LightboxToolbar
          transform={transform}
          dispatchTransform={dispatchTransformAction}
          onClose={handleDismissRequest}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            // 不留上侧内边距：工具栏顶边贴着按钮，避免「按钮上方 8px 空白」点空白关闭。
            paddingBottom: insets.bottom + spacing[2],
            paddingLeft: insets.left + spacing[4],
            paddingRight: insets.right + spacing[4],
          }}
        />
      </View>
    </Modal>
  );
}

const ABSOLUTE_FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrim: {
    ...ABSOLUTE_FILL,
    backgroundColor: colors.black,
    opacity: SCRIM_OPACITY,
  },
  pager: {
    flex: 1,
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: ABSOLUTE_FILL,
  caption: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing[3],
    paddingHorizontal: spacing[4],
  },
  progressRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing[2],
  },
  progressPill: {
    backgroundColor: colors.surfaceGlass,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[3],
  },
  progressText: {
    ...textPresets.label,
    color: colors.textDefault,
  },
  errorBox: {
    alignItems: 'center',
    gap: spacing[2],
    maxWidth: '82%',
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[6],
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    // 深色遮罩上用 danger 的 14% 底色：danger 实色文字压在近黑底上仍满足对比度。
    backgroundColor: colors.dangerMuted,
  },
  errorTitle: {
    ...textPresets.subheading,
    color: colors.danger,
  },
  errorHint: {
    ...textPresets.bodySmall,
    color: colors.textSubtle,
    textAlign: 'center',
  },
});
