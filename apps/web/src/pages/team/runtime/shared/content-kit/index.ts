/**
 * 260530-team-page · content-kit barrel
 *
 * TeamPage 内容区共享展示原子。所有 tab 视图统一从此处消费，
 * 消除各自手搓的卡片 / 网格 / 空态 / 进度条内联样式。
 *
 * 约束：这些原子是纯展示层，不感知"哪个 tab"，差异通过 props / slot 注入。
 */

export {
  CK_BORDER,
  CK_BORDER_SUBTLE,
  CK_SURFACE,
  CK_SURFACE_SOFT,
  CK_ACCENT_SOFT,
  CK_ACCENT_BORDER,
  CK_DASHED_BORDER,
  CK_RADIUS,
  CK_RADIUS_SM,
  CK_RADIUS_LG,
  CK_GAP,
  CK_GAP_SM,
  CK_GAP_LG,
  CK_PAD,
  CK_PAD_LG,
  CK_PAD_SM,
  CK_SECTION_LABEL_STYLE,
  ckToneColor,
  ckToneSoftBg,
  type CkTone,
} from './content-kit-tokens.js';
export { StatCard, type StatCardProps } from './StatCard.js';
export { MetricGrid, type MetricGridProps } from './MetricGrid.js';
export { SectionPanel, type SectionPanelProps } from './SectionPanel.js';
export { EmptyState, type EmptyStateProps } from './EmptyState.js';
export { MiniBar, type MiniBarProps } from './MiniBar.js';
export { Sparkline, type SparklineProps } from './Sparkline.js';
export {
  SegmentedToggle,
  type SegmentedToggleProps,
  type SegmentedToggleOption,
} from './SegmentedToggle.js';
