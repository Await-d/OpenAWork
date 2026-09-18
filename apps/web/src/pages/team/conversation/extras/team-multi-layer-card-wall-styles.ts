import type { CSSProperties } from 'react';
import {
  CARD_WIDTH,
  COLLAPSED_BODY_HEIGHT,
  EXPANDED_BODY_HEIGHT,
  EXPANDED_BODY_MAX_HEIGHT,
} from './team-multi-layer-card-wall-constants.js';

export const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--bg-base)',
};

export const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '12px var(--spacing-3, 12px)',
  borderBottom: '1px solid var(--border-default)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base)), var(--bg-base))',
  flexShrink: 0,
};

export const HEADER_TITLE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--spacing-2, 8px)',
};

export const HEADER_NAME_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--fg-strong)',
};

export const HEADER_HINT_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  lineHeight: 1.4,
};

export const METRIC_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-2, 8px)',
  flexWrap: 'wrap',
};

export const METRIC_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 'var(--radius-pill, 9999px)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

/** 批量展开 / 收起按钮：底色与 hover 态由 `.team-v2-control--surface` 提供。 */
export const HEADER_BULK_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  marginLeft: 'auto',
  minHeight: 20,
  padding: '3px 9px',
  borderRadius: 'var(--radius-sm, 6px)',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const WALL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '7px 7px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

export const LANE_STYLE: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'stretch',
};

/** 紧凑层级的并排行：接待层 + 规划层各占一半宽（见 COMPACT_LANE_LAYERS）。 */
export const COMPACT_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  // 窄面板（半宽放不下 ~190px）时自动折回上下两行，不把卡片挤扁。
  flexWrap: 'wrap',
};

/**
 * 并排单元格。basis 取基准卡宽 —— 也就是「两半各自都要放得下一张同宽的卡片」
 * 才并排：面板不够宽时自动折回上下两行（整行满宽）。这样全墙卡片宽度一致，
 * 不会出现上半屏 280px、下半屏 560px 的两种卡型。
 */
export const COMPACT_CELL_STYLE: CSSProperties = {
  flex: `1 1 ${String(CARD_WIDTH)}px`,
  minWidth: 0,
};

export const RAIL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: 12,
  flexShrink: 0,
  paddingTop: 5,
};

export const RAIL_DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

export const RAIL_LINE_STYLE: CSSProperties = {
  flex: 1,
  width: 1,
  minHeight: 12,
  background: 'var(--border-default)',
};

/** 泳道内卡片容器：固定卡宽 + 自动折行，面板越宽并排越多。 */
export const CARD_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  gap: 6,
  minWidth: 0,
};

export const LANE_BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  minWidth: 0,
  flex: 1,
};

export const LANE_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
};

export const LANE_CODE_STYLE: CSSProperties = {
  display: 'inline-grid',
  placeItems: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  borderRadius: 4,
  fontSize: 9,
  fontWeight: 800,
  lineHeight: 1,
  textTransform: 'uppercase',
  flexShrink: 0,
};

export const LANE_NAME_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  whiteSpace: 'nowrap',
};

export const LANE_META_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/**
 * 卡片本体。
 *
 * 边界靠「背景层级 + shadow-sm」表达，不描边（描边政策：线是例外，不是默认）——
 * 直角描边在折叠态只会让 268px 的小卡片显得碎，阴影 + 提亮的表面更能读成「一扇窗口」。
 */
export const CARD_BASE_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  overflow: 'hidden',
  borderRadius: 'var(--radius-lg, 12px)',
  background: 'var(--bg-overlay)',
  boxShadow: 'var(--shadow-sm)',
};

export const CARD_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 7px 4px',
  flexShrink: 0,
};

/**
 * 身份头按钮（点击聚焦该层级）。
 *
 * 内边距 + 负外边距的组合是为了让 hover 时出现的底色是一块贴着内容的小圆角，
 * 而不是把整个头部条刷亮；负边距保证不因此改变头部的视觉对齐。
 */
export const CARD_TITLE_BUTTON_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flex: 1,
  margin: '-2px -4px',
  padding: '2px 4px',
  border: 'none',
  borderRadius: 'var(--radius-sm, 6px)',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

export const CARD_TITLE_TEXT_STYLE: CSSProperties = {
  display: 'grid',
  gap: 1,
  minWidth: 0,
};

export const CARD_NAME_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export const CARD_SUB_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/**
 * 展开 / 收起按钮。
 *
 * 刻意不写 background / hover：交给 team 页的通用控件态
 * （`.team-v2-control` + `--surface` 变体，见 team-runtime.css）统一提供
 * default / hover / active / focus-visible。内联 background 会压过这些规则，
 * 一个没有 hover 反馈的图标按钮在密集的卡片墙里等于不可点。
 */
export const CARD_EXPAND_BUTTON_STYLE: CSSProperties = {
  display: 'inline-grid',
  placeItems: 'center',
  width: 22,
  height: 22,
  flexShrink: 0,
  borderRadius: 'var(--radius-sm, 6px)',
  color: 'var(--fg-muted)',
  fontSize: 10,
  lineHeight: 1,
  cursor: 'pointer',
};

export const STATUS_DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

/**
 * 上游来源行。
 *
 * 刻意不做成「底色 + 圆角」的徽章条：它每张卡片都有，做成实心条就在墙面上
 * 拉出 6 条等宽灰带，比消息本身还抢眼。压成一行细字（谁指向我），关系照样
 * 一眼可见，卡片重心回到消息。
 */
export const UPSTREAM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 7px',
  marginBottom: 4,
  fontSize: 10,
  lineHeight: 1.4,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  flexShrink: 0,
};

export const UPSTREAM_ARROW_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-subtle)',
  flexShrink: 0,
};

/**
 * 消息区（两态共用的「对话凹槽」）。
 *
 * 用比卡片更暗一档的表面把消息圈出来：卡片墙的主体是「谁说了什么」，消息区
 * 必须有独立表面，否则文字直接浮在卡片底色上，卡片看起来像一块没排版的灰布。
 * 凹槽本身不描边，靠明度差切分。
 */
export const CARD_BODY_BASE_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  margin: '0 5px',
  padding: '5px 6px',
  borderRadius: 'var(--radius-md, 8px)',
  background: 'color-mix(in srgb, var(--bg-base) 52%, transparent)',
  overflowX: 'hidden',
  overscrollBehavior: 'contain',
  minHeight: 0,
};

/**
 * 折叠态固定高度而非 `max-height`：卡片墙是拿来「扫视」的，折叠卡高矮不齐
 * 会让整条泳道的底边参差得像没对齐的便签墙。固定高度后同排卡片高度一致，
 * 露出几行算几行，多出来的部分由下面的渐隐负责收口。
 */
export const COLLAPSED_BODY_STYLE: CSSProperties = {
  ...CARD_BODY_BASE_STYLE,
  height: COLLAPSED_BODY_HEIGHT,
  overflowY: 'hidden',
  marginBottom: 6,
};

export const EXPANDED_BODY_STYLE: CSSProperties = {
  ...CARD_BODY_BASE_STYLE,
  height: EXPANDED_BODY_HEIGHT,
  maxHeight: EXPANDED_BODY_MAX_HEIGHT,
  overflowY: 'auto',
  marginBottom: 8,
};

export const OMITTED_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-subtle)',
  textAlign: 'center',
  padding: '2px 0',
  flexShrink: 0,
};

export const EMPTY_BODY_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-subtle)',
  padding: '4px 0',
};

/** 终态状态图标徽章 —— 替换普通色点，让「已结束」在一堆卡片里一眼可辨。 */
export const STATUS_GLYPH_STYLE: CSSProperties = {
  display: 'inline-grid',
  placeItems: 'center',
  width: 16,
  height: 16,
  borderRadius: '50%',
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1,
  flexShrink: 0,
};

/** 终态标识条 —— 折叠 / 展开两态都显示，明确「这个实例已经结束」。 */
export const ENDED_STRIP_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  margin: '0 5px',
  padding: '3px 6px',
  borderRadius: 'var(--radius-sm, 6px)',
  fontSize: 10,
  fontWeight: 700,
  flexShrink: 0,
};

/** 失败原因 —— 单行省略，完整内容走 title 提示。 */
export const FAILURE_REASON_STYLE: CSSProperties = {
  padding: '3px 7px 0',
  fontSize: 10,
  lineHeight: 1.4,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flexShrink: 0,
};

/**
 * 待处理权限条容器。
 *
 * 刻意放在**消息区之外**（上游徽章与消息区之间），而不是塞进消息流里：
 *   1. 折叠态的消息区只有约 3 行高且 `overflow: hidden`，权限条放进去会被直接裁掉 ——
 *      而权限请求是必须被看见、必须被处置的，裁掉等于这个实例卡死没人知道。
 *   2. 它不是对话内容，是「需要你现在做决定」的告警，贴在卡片固定区域语义更准。
 */
export const PERMISSION_STRIP_STYLE: CSSProperties = {
  margin: '0 5px 5px',
  padding: '5px 6px',
  borderRadius: 'var(--radius-sm, 6px)',
  background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
  flexShrink: 0,
};

/**
 * 折叠态的最新消息：**单行**纯文本预览，左侧一道层级色竖线做归属暗示。
 *
 * 这里刻意不用 markdown 渲染：折叠态只回答「谁刚说了什么」，一行足够。
 * 多行内容、角色标签、时间戳一律留到展开态 —— 否则卡片会被撑高，一屏能放的窗口变少。
 * 文本走 `getTeamMessagePreviewText`（去 markdown 标记 / 归纳 JSON / 截断），
 * 保证任何形态的消息在单行里都可读。
 */
export const LATEST_MESSAGE_STYLE: CSSProperties = {
  display: 'block',
  paddingLeft: 6,
  borderLeftWidth: 2,
  borderLeftStyle: 'solid',
  borderRadius: '2px',
  minWidth: 0,
};

export const LATEST_MESSAGE_TEXT_STYLE: CSSProperties = {
  display: 'block',
  fontSize: 12,
  lineHeight: 1.55,
  color: 'var(--fg-default)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** 展开态的缩小版 chat：气泡按说话人左右分列，靠明度差而不是描边分形。 */
export const BUBBLE_BASE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: '6px 9px',
  borderRadius: 'var(--radius-md, 8px)',
  maxWidth: '92%',
  minWidth: 0,
  background: 'color-mix(in srgb, var(--bg-surface) 62%, transparent)',
};

export const BUBBLE_ASSISTANT_STYLE: CSSProperties = {
  ...BUBBLE_BASE_STYLE,
  justifySelf: 'start',
  borderBottomLeftRadius: 'var(--radius-xs, 4px)',
};

export const BUBBLE_USER_STYLE: CSSProperties = {
  ...BUBBLE_BASE_STYLE,
  justifySelf: 'end',
  borderBottomRightRadius: 'var(--radius-xs, 4px)',
  background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
};

export const BUBBLE_ROLE_STYLE: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: 0.2,
};

export const BUBBLE_TEXT_STYLE: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.6,
};

/**
 * 卡片底栏：只放动作，不再放「N 条」（已并入头部副行）。
 * 卡片动作在折叠态最多一个，实心条底栏换来的是一条空灰带 + 一个重复的「展开」。
 */
export const CARD_FOOTER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
  padding: '3px 7px 6px',
  fontSize: 10,
  color: 'var(--fg-muted)',
  flexShrink: 0,
  fontVariantNumeric: 'tabular-nums',
};

/**
 * 卡片动作按钮（完整会话 / 回到底部）。
 * 同样把 background / hover 交给 `.team-v2-control--surface` 统一提供 ——
 * 内联 background 会压过 hover 规则，按钮就只剩一个「点了没反应」的静态色块。
 */
export const CARD_ACTION_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 20,
  padding: '3px 8px',
  borderRadius: 'var(--radius-sm, 6px)',
  color: 'var(--fg-muted)',
  fontSize: 10.5,
  fontWeight: 600,
  lineHeight: 1,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const WALL_EMPTY_STYLE: CSSProperties = {
  padding: '32px 12px',
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.7,
};
