/**
 * 260530-team-page · content-kit tokens
 *
 * 把 TeamPage 内容区各 tab 中散落、反复 copy 的 color-mix / 间距 / 圆角
 * 收敛到一处轻量常量，让 StatCard / MetricGrid / SectionPanel / EmptyState
 * 等原子有统一的视觉语言。
 *
 * 这不是全量 design token 化（见 260516 收尾轮里 D-1 被推迟的判断），
 * 只是把"内容区卡片体系"这一簇高频复制值集中，降低后续视觉漂移成本。
 */

import type { CSSProperties } from 'react';

// ─── 颜色 / 表面 ─────────────────────────────────────────────────

/** 卡片 / 面板的常规边框（半透明，弱化网格感）。 */
export const CK_BORDER = 'color-mix(in srgb, var(--border-default) 50%, transparent)';

/** 更弱的分隔边框（章节内分隔线、次级边框）。 */
export const CK_BORDER_SUBTLE = 'color-mix(in srgb, var(--border-default) 28%, transparent)';

/** 卡片常规底色（overlay 压在 base 上，避免纯色块）。 */
export const CK_SURFACE = 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))';

/** 更轻的底色（次级容器 / hover 前底）。 */
export const CK_SURFACE_SOFT = 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))';

/** accent 软底（强调容器、选中态）。 */
export const CK_ACCENT_SOFT = 'color-mix(in srgb, var(--accent) 12%, transparent)';

/** accent 边框（选中 / 强调容器）。 */
export const CK_ACCENT_BORDER = 'color-mix(in srgb, var(--accent) 40%, transparent)';

/** 虚线边框（空态 / 占位）。 */
export const CK_DASHED_BORDER =
  '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)';

// ─── 间距 / 圆角 ─────────────────────────────────────────────────

export const CK_RADIUS = 10;
export const CK_RADIUS_SM = 8;
export const CK_RADIUS_LG = 12;

export const CK_GAP = 10;
export const CK_GAP_SM = 6;
export const CK_GAP_LG = 14;

export const CK_PAD = '10px 12px';
export const CK_PAD_LG = '12px 14px';
/** 紧凑内边距：按钮 / pill / 行内徽章。 */
export const CK_PAD_SM = '4px 10px';

// ─── 文本 ────────────────────────────────────────────────────────

/** 区块小标题（大写、字距、muted）。 */
export const CK_SECTION_LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

// ─── 语义色（趋势 / 状态强调）────────────────────────────────────

export type CkTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

/** tone → 主前景色（值色 / 强调文字）。 */
export function ckToneColor(tone: CkTone): string {
  switch (tone) {
    case 'accent':
      return 'var(--accent)';
    case 'success':
      return 'var(--success)';
    case 'warning':
      return 'var(--warning)';
    case 'danger':
      return 'var(--danger)';
    default:
      return 'var(--fg-strong)';
  }
}

/** tone → 与该色匹配的软底（用于 pill / 高亮容器）。 */
export function ckToneSoftBg(tone: CkTone): string {
  switch (tone) {
    case 'accent':
      return 'color-mix(in srgb, var(--accent) 12%, transparent)';
    case 'success':
      return 'color-mix(in srgb, var(--success) 14%, transparent)';
    case 'warning':
      return 'color-mix(in srgb, var(--warning) 14%, transparent)';
    case 'danger':
      return 'color-mix(in srgb, var(--danger) 14%, transparent)';
    default:
      return 'color-mix(in srgb, var(--fg-muted) 14%, transparent)';
  }
}
