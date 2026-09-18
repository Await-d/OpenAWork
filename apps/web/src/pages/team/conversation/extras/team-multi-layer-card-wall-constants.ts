import type { CardStatus, CardStatusTone } from './team-multi-layer-card-wall-types.js';

/**
 * 卡片宽度（px）。刻意固定而不拉伸填满：右侧面板本身只有 45% 宽，
 * 固定宽度才能让每张卡稳定呈现「窄而高的长方形」，并让泳道内自动折行并排。
 */
export const CARD_WIDTH = 336;
/**
 * 卡片可伸展到的上限。
 *
 * 为什么不是一个硬宽度：面板宽度差异极大（分屏 45% 可能只有 480px，宽屏能到 900px+）。
 * 写死一个值，窄面板会挤、宽面板会留一大片空白；只写 `flex: 1` 又会让单张卡在一整行里
 * 被拉成一条宽横幅，失去「窗口」的形状。所以用「基准宽度 + 等分剩余 + 上限」：
 * 一行放得下几张就放几张，剩下的横向空间由卡片吸收，最多到 320px。
 */
export const CARD_MAX_WIDTH = 448;

/**
 * 折叠态：消息区高度 = **一行**。
 * 30px = 上下内边距 10px + 正文 1 行（12px × 1.6 ≈ 19px）。
 * 折叠态只负责回答「谁刚说了什么」，一行足够；正文、角色标签、时间这些细节
 * 一律留到展开态，卡片因此变得极扁，一屏能放下更多窗口。
 */
export const COLLAPSED_BODY_HEIGHT = 30;
/** 展开态：消息区高度与上限 —— 固定高度是为了让展开卡高度一致，读起来像一列 chat 窗。 */
export const EXPANDED_BODY_HEIGHT = 360;
export const EXPANDED_BODY_MAX_HEIGHT = 440;
/** 展开态最多渲染的消息条数（更早的折叠为一行提示）。 */
export const EXPANDED_MESSAGE_LIMIT = 40;

/**
 * 实例稀少的层级：接待层与规划层。
 *
 * 这两层几乎只会存在一个角色实例（派活的入口 + 拆活的规划），各占一整行会在
 * 墙的顶部留出两大片空白。它们放在同一行左右并排，纵向上省掉一整行高度。
 */
export const COMPACT_LANE_LAYERS = new Set(['reception', 'pm1']);

/** 层级深度序 —— 决定泳道从上到下的排列，也是「上下关系」的视觉依据。 */
export const LAYER_DEPTH: Record<string, number> = {
  reception: 0,
  pm1: 1,
  pm2: 2,
  executor: 3,
  tester: 4,
  reviewer: 5,
};

export const STATUS_TONES: Record<CardStatus, CardStatusTone> = {
  streaming: { color: 'var(--accent)', label: '正在生成', pulse: true, glyph: '●' },
  active: { color: 'var(--success)', label: '当前角色', pulse: false, glyph: '●' },
  error: { color: 'var(--danger)', label: '出现错误', pulse: false, glyph: '●' },
  idle: { color: 'var(--fg-subtle)', label: '已就绪', pulse: false, glyph: '●' },
  empty: { color: 'var(--fg-subtle)', label: '暂无消息', pulse: false, glyph: '●' },
  // ─── 终态：实例已结束 / 已关闭 ───
  completed: { color: 'var(--success)', label: '已完成', pulse: false, glyph: '✓' },
  failed: { color: 'var(--danger)', label: '已失败', pulse: false, glyph: '✕' },
  cancelled: { color: 'var(--fg-muted)', label: '已取消', pulse: false, glyph: '⊘' },
};
