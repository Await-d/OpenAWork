/**
 * 查看器工具栏（W2c / T-11）。
 *
 * 动作顺序对齐 Web 端 `image-lightbox__toolbar`：
 * `−｜百分比｜＋｜分隔｜左旋｜右旋｜分隔｜重置全部` + 右侧固定的「关闭」。
 *
 * 职责边界（本文件**不计算**任何 transform 数值）：
 * - 缩放 / 旋转 / 重置全部一律通过传入的 `dispatchTransform` 派发 `transformReducer`
 *   动作，读数与禁用态由 `./lightbox-model` 的 `formatZoomPercent` /
 *   `resolveTransformControls` 给出；
 * - 关闭只回调 `onClose`，「已缩放 / 已旋转时先复位再关闭」的语义由父层
 *   （`resolveBackAction`）决定 —— 返回键、点空白区、本按钮三通道共用同一实现。
 *
 * 布局取舍（375px 窄屏）：图标按钮 44pt + 缩放读数 + 两处分隔在 375px 下放不下一行，
 * 因此把变换区做成**横向可滚动**的条带，而「关闭」固定在条带右侧不参与滚动 ——
 * 关闭是唯一必须始终可点的出口，不能因为需要滑动而丢失。屏幕更宽时条带内容自然铺满，
 * 不出现滚动；不让按钮低于 44pt 是为了守住最小可点面积。
 *
 * 三态（pressed / disabled / focus）全部走主题 token：主强调色只用于聚焦环（active 态），
 * 不使用任何硬编码色值。
 */
import { useCallback, useState, type ComponentProps } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { radii } from '../../theme/radii';
import { spacing } from '../../theme/spacing';
import { textPresets } from '../../theme/typography';
import {
  formatZoomPercent,
  resolveTransformControls,
  type TransformAction,
  type TransformState,
} from './lightbox-model';

/** 触控目标边长（44pt，满足最小可点区域）；父层也用它计算图片可用区。 */
export const TOOLBAR_TOUCH_TARGET_SIZE = spacing[11];

/** 关闭动作的无障碍标签（返回键 / 点空白 / 本按钮三通道语义一致）。 */
export const LIGHTBOX_CLOSE_A11Y_LABEL = '关闭图片预览';

/** 工具栏图标尺寸。 */
const TOOL_ICON_SIZE = spacing[5];

/** 按钮之间的间距。 */
const TOOL_GAP = spacing[1];

/** 缩放读数按钮的最小宽度（"500%" 也不换行）。 */
const PERCENT_MIN_WIDTH = spacing[14];

/** 按下态不透明度（与查看器既有关闭按钮一致）。 */
const PRESSED_OPACITY = 0.6;

/** 禁用态不透明度。 */
const DISABLED_OPACITY = 0.4;

/** 分隔线不透明度：深色遮罩上必须用浅色线条（`lineDefault` 在近黑底上不可见）。 */
const DIVIDER_OPACITY = 0.24;

/** 分隔线高度。 */
const DIVIDER_HEIGHT = spacing[5];

/** 聚焦环宽度（2px，对齐设计规范的 accent 焦点环）。 */
const FOCUS_RING_WIDTH = spacing[0.5];

type ToolIconName = ComponentProps<typeof Ionicons>['name'];

interface ToolButtonProps {
  readonly accessibilityLabel: string;
  readonly accessibilityHint?: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  /** 图标按钮：Ionicons 名称。 */
  readonly icon?: ToolIconName;
  /** 左旋图标是右旋图标的镜像（Ionicons 无 rotate-left，用 scaleX 翻转）。 */
  readonly mirroredIcon?: boolean;
  /** 文本按钮（缩放读数）：与 `icon` 二选一。 */
  readonly label?: string;
}

/**
 * 工具栏按钮：自持聚焦态（无需父层集中管理），按下 / 禁用 / 聚焦三态各自独立。
 * 禁用时同时置 `disabled` 与 `accessibilityState`，读屏用户能听到「不可用」。
 */
function ToolButton({
  accessibilityLabel,
  accessibilityHint,
  onPress,
  disabled = false,
  icon,
  mirroredIcon = false,
  label,
}: ToolButtonProps) {
  const [focused, setFocused] = useState(false);

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onFocus={handleFocus}
      onBlur={handleBlur}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        label !== undefined ? styles.buttonWithLabel : null,
        focused ? styles.buttonFocused : null,
        pressed ? styles.buttonPressed : null,
        disabled ? styles.buttonDisabled : null,
      ]}
    >
      {icon !== undefined ? (
        <Ionicons
          name={icon}
          size={TOOL_ICON_SIZE}
          color={disabled ? colors.textSubtle : colors.textStrong}
          style={mirroredIcon ? styles.mirroredIcon : undefined}
        />
      ) : (
        <Text style={styles.percentLabel} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** 动作分组之间的竖线（纯装饰，不参与可访问性树）。 */
function ToolDivider() {
  return <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no" />;
}

export interface LightboxToolbarProps {
  /** 当前变换状态：缩放读数与按钮禁用态的唯一来源。 */
  readonly transform: TransformState;
  /** 变换动作派发器（必须是 `useReducer(transformReducer, …)` 的 dispatch）。 */
  readonly dispatchTransform: (action: TransformAction) => void;
  /** 关闭请求（先复位再关闭由父层的 `resolveBackAction` 决定）。 */
  readonly onClose: () => void;
  /** 容器定位与安全区样式（由父层给出）。 */
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * 全屏查看器工具栏。受控：`transform` 进、`dispatchTransform` 出，组件内不存变换状态
 * —— 缩放与旋转的单一事实来源始终是父层的 `transformReducer`。
 */
export function LightboxToolbar({
  transform,
  dispatchTransform,
  onClose,
  style,
}: LightboxToolbarProps) {
  const controls = resolveTransformControls(transform);
  const percentText = formatZoomPercent(transform.scale);

  const handleZoomOut = useCallback(
    () => dispatchTransform({ type: 'zoomOut' }),
    [dispatchTransform],
  );
  const handleZoomIn = useCallback(
    () => dispatchTransform({ type: 'zoomIn' }),
    [dispatchTransform],
  );
  const handleResetZoom = useCallback(
    () => dispatchTransform({ type: 'resetZoom' }),
    [dispatchTransform],
  );
  const handleRotateLeft = useCallback(
    () => dispatchTransform({ type: 'rotateLeft' }),
    [dispatchTransform],
  );
  const handleRotateRight = useCallback(
    () => dispatchTransform({ type: 'rotateRight' }),
    [dispatchTransform],
  );
  const handleResetAll = useCallback(
    () => dispatchTransform({ type: 'resetAll' }),
    [dispatchTransform],
  );

  return (
    <View style={[styles.container, style]}>
      <ScrollView
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        style={styles.strip}
        contentContainerStyle={styles.stripContent}
        accessibilityRole="toolbar"
      >
        <ToolButton
          icon="remove-outline"
          accessibilityLabel="缩小"
          onPress={handleZoomOut}
          disabled={!controls.canZoomOut}
        />
        <ToolButton
          label={percentText}
          accessibilityLabel={`当前缩放 ${percentText}，重置缩放`}
          accessibilityHint="只复位缩放，保留旋转角度"
          onPress={handleResetZoom}
        />
        <ToolButton
          icon="add-outline"
          accessibilityLabel="放大"
          onPress={handleZoomIn}
          disabled={!controls.canZoomIn}
        />
        <ToolDivider />
        <ToolButton
          icon="refresh-outline"
          mirroredIcon
          accessibilityLabel="向左旋转 90 度"
          accessibilityHint="旋转会重置缩放"
          onPress={handleRotateLeft}
        />
        <ToolButton
          icon="refresh-outline"
          accessibilityLabel="向右旋转 90 度"
          accessibilityHint="旋转会重置缩放"
          onPress={handleRotateRight}
        />
        <ToolDivider />
        <ToolButton
          icon="arrow-undo-outline"
          accessibilityLabel="重置全部"
          accessibilityHint="缩放与旋转一并复位"
          onPress={handleResetAll}
          disabled={!controls.canReset}
        />
      </ScrollView>
      <ToolButton
        icon="close-outline"
        accessibilityLabel={LIGHTBOX_CLOSE_A11Y_LABEL}
        onPress={onClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOOL_GAP,
  },
  strip: {
    // 关闭按钮固定在右侧：条带只吃剩余宽度，内容超宽时内部横向滚动。
    flex: 1,
  },
  stripContent: {
    alignItems: 'center',
    gap: TOOL_GAP,
  },
  button: {
    width: TOOLBAR_TOUCH_TARGET_SIZE,
    height: TOOLBAR_TOUCH_TARGET_SIZE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.lineDefault,
  },
  buttonWithLabel: {
    width: 'auto',
    minWidth: PERCENT_MIN_WIDTH,
    paddingHorizontal: spacing[2],
  },
  buttonFocused: {
    borderWidth: FOCUS_RING_WIDTH,
    borderColor: colors.accent,
    backgroundColor: colors.accentMuted,
  },
  buttonPressed: {
    opacity: PRESSED_OPACITY,
  },
  buttonDisabled: {
    opacity: DISABLED_OPACITY,
  },
  mirroredIcon: {
    transform: [{ scaleX: -1 }],
  },
  percentLabel: {
    ...textPresets.label,
    color: colors.textStrong,
  },
  divider: {
    width: 1,
    height: DIVIDER_HEIGHT,
    backgroundColor: colors.white,
    opacity: DIVIDER_OPACITY,
  },
});
