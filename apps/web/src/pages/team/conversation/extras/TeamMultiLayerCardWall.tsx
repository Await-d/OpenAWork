/**
 * TeamMultiLayerCardWall · 层级泳道式「角色窗口墙」
 *
 * 设计目标：右侧面板不再把各层级消息合并成一条时间线（见 TeamMultiLayerFeed），
 * 而是为每个「角色实例」开一个独立的小对话窗口 —— 一个窗口 = 一个角色实例的完整
 * 上下文，用户不必在交织的消息流里来回辨认「这句话到底是谁说的」。
 *
 * 为什么按层级分泳道，而不是平铺网格：
 * 团队的本质是层级对话，角色实例之间存在上下（父子）关系（数据见
 * LayerMessages.sourceLayer / sourceDisplayName）。纵向按层级深度排泳道、泳道内横向
 * 并排同层实例，才能在不画连线的前提下把「谁是谁的上游」表达出来。
 *
 * 布局：
 *   - 顶部：层级数 / 实例数 / 消息数 指标 + 全部展开收起
 *   - 主体：层级轨道（左）+ 泳道（右）。一条泳道 = 一个层级，泳道内是该层的角色实例卡片
 *   - 卡片：身份头（实例名 + 层级 + 状态）+ 上游徽章 + 消息区 + 底栏
 *
 * 卡片两态（固定卡宽 → 窄而高的长方形，泳道内自动折行并排）：
 *   - 折叠（默认）：只展示**最新一条**消息，用于扫视「谁刚说了什么」；
 *     长消息按约 3 行截断，不滚动。
 *   - 展开：缩小版 chat 布局 —— assistant 左对齐气泡、用户右对齐气泡，
 *     固定更高的高度 + 独立滚动 + 贴底跟随。
 *   - 展开态按会话分键持久化到 localStorage：刷新 / 重建面板后仍保持
 *     用户刚摆好的阅读态（见 card-wall-expanded-state.ts）。
 *
 * 卡片内的可操作项（不必切回 feed 视图才能用）：
 *   - 待处理权限：按 `sessionId` 把网关返回的整棵子树权限请求各归其位，
 *     在卡片上直接点「本会话允许 / 允许一次 / 永久允许 / 拒绝」。
 *     贴在消息区**之外**，折叠态也不会被裁掉。
 *   - 完整会话：非主会话卡片提供入口，在底部「层级对话」抽屉里打开该角色实例的
 *     完整会话（卡片上的展开只渲染最近 40 条，抽屉里是真·完整会话）。
 *
 * 生命周期：实例结束 / 关闭后卡片**不消失**，而是切到终态展示态 ——
 *   - completed → ✓ 已完成 / failed → ✕ 已失败 / cancelled → ⊘ 已取消
 *   - 色点换成图标徽章、边框改虚线、底部加终态标识条（含结束时间），失败时补一行原因
 *   - 两态仍可折叠/展开，用户随时能回看已关闭实例的完整对话
 *   - 唯一例外：当前会话正在本地流式输出时不判终态（用户可能刚给已结束的
 *     实例发了新消息），见 resolveTerminalStatus 注释
 *
 * 密度：卡片宽度固定（CARD_WIDTH），泳道内 flex-wrap 折行 —— 面板越宽并排越多，
 * 而不是把单张卡片拉宽。这样每张卡始终是同一个「长方形」，视觉节奏稳定。
 *
 * 性能策略：卡片内消息用 TeamMessageBody 渲染（markdown / 事件卡 / JSON），
 * 不挂载 ChatMessageGroupList 那套完整消息机制；折叠态只渲染 1 条，展开态最多渲染
 * 最近 EXPANDED_MESSAGE_LIMIT 条，更早的折叠成一行提示。
 *
 * 滚动：每个卡片是独立滚动容器，贴底逻辑统一走 useStickToBottom ——
 * 用户上滚即暂停跟随，不会出现「正在读历史被拽回底部」。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { InlinePermissionQuickBar } from '../../../../components/chat/session/ChatPageSections.js';
import type { ResolveInlinePermissionActionsFn } from '../../../../components/chat/session/ChatPageSections.js';
import {
  getRoleLayerIdentity,
  getRoleLayerIdentityFromAgentId,
  type RoleLayerIdentity,
} from '../../runtime/data/role-layer-identity.js';
import {
  isTerminalLifecycle,
  type InstanceLifecycle,
  type LayerMessages,
} from './team-layer-messages.js';
import { readCardWallExpandedKeys, writeCardWallExpandedKeys } from './card-wall-expanded-state.js';
import { TeamMessageBody } from './team-message-content.js';
import { TeamRoleTypingIndicator } from './TeamRoleTypingIndicator.js';
import { useStickToBottom } from './use-stick-to-bottom.js';

/**
 * 卡片墙渲染权限条所需的字段。
 *
 * 刻意不直接依赖 web-client 的 `PendingPermissionRequest`：卡片墙是纯展示层，
 * 它只需要知道「这条权限要显示成什么」，不需要知道「后端返回了什么」。
 * `PendingPermissionRequest` 结构上是本类型的超集，调用方直接透传即可。
 */
export interface CardPendingPermission {
  requestId: string;
  sessionId: string;
  status: 'pending' | 'approved' | 'rejected';
  toolName: string;
  reason: string;
  scope: string;
  riskLevel: string;
  previewAction?: string;
}

export interface TeamMultiLayerCardWallProps {
  /** 当前聚焦的层级 —— 该层泳道下的卡片会被高亮。 */
  activeLayer?: string | null;
  /** 全部角色实例消息组。 */
  layers: LayerMessages[];
  /** 点击卡片身份头 —— 聚焦该层级。 */
  onLayerSelect?: (layer: string) => void;
  /**
   * 当前会话 id。展开态按它分键持久化 —— 不同 team 会话的实例集合完全不同，
   * 共用一个键会让 A 会话展开过的卡片 id 泄进 B 会话。
   * 不传时退化为「不持久化」（内嵌 / 测试场景），不写 localStorage。
   */
  scopeKey?: string | null;
  /**
   * 当前会话树下的待处理权限请求（**含所有后代角色实例**，网关恢复接口一并返回）。
   * 卡片按 `sessionId` 各取自己那几条 —— 权限是实例级的，不能全堆到主会话上。
   */
  pendingPermissions?: readonly CardPendingPermission[];
  /**
   * 把 requestId 解析成可点动作。与 feed 视图共用 `TeamConversationView` 里
   * 同一份实现（它已经按 `request.sessionId` 定位目标会话），所以卡片里点
   * 「允许 / 拒绝」和主对话区里点是完全同一条链路。
   */
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  /**
   * 打开某个角色实例的完整会话（切主对话区过去）。
   * 不传则不渲染入口 —— 内嵌只读场景不该给出会跳走的按钮。
   */
  onOpenSession?: (sessionId: string) => void;
}

// ─── 尺寸常量 ───────────────────────────────────────────────────────

/**
 * 卡片宽度（px）。刻意固定而不拉伸填满：右侧面板本身只有 45% 宽，
 * 固定宽度才能让每张卡稳定呈现「窄而高的长方形」，并让泳道内自动折行并排。
 */
const CARD_WIDTH = 268;

/** 折叠态：消息区最大高度，约 3 行。 */
const COLLAPSED_BODY_MAX_HEIGHT = 58;
/** 展开态：消息区高度与上限 —— 固定高度是为了让展开卡高度一致，读起来像一列 chat 窗。 */
const EXPANDED_BODY_HEIGHT = 360;
const EXPANDED_BODY_MAX_HEIGHT = 440;
/** 展开态最多渲染的消息条数（更早的折叠为一行提示）。 */
const EXPANDED_MESSAGE_LIMIT = 40;

/** 层级深度序 —— 决定泳道从上到下的排列，也是「上下关系」的视觉依据。 */
const LAYER_DEPTH: Record<string, number> = {
  reception: 0,
  pm1: 1,
  pm2: 2,
  executor: 3,
  tester: 4,
  reviewer: 5,
};

// ─── 样式 ───────────────────────────────────────────────────────────

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--bg-base)',
};

const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '12px var(--spacing-3, 12px)',
  borderBottom: '1px solid var(--border-default)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base)), var(--bg-base))',
  flexShrink: 0,
};

const HEADER_TITLE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--spacing-2, 8px)',
};

const HEADER_NAME_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--fg-strong)',
};

const HEADER_HINT_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  lineHeight: 1.4,
};

const METRIC_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-2, 8px)',
  flexWrap: 'wrap',
};

const METRIC_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 'var(--radius-pill, 9999px)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

const HEADER_BULK_BUTTON_STYLE: CSSProperties = {
  marginLeft: 'auto',
  padding: '3px 9px',
  borderRadius: 'var(--radius-sm, 6px)',
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-surface) 60%, transparent)',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const WALL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '12px var(--spacing-3, 12px) 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const LANE_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'stretch',
};

const RAIL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: 12,
  flexShrink: 0,
  paddingTop: 5,
};

const RAIL_DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const RAIL_LINE_STYLE: CSSProperties = {
  flex: 1,
  width: 1,
  minHeight: 12,
  background: 'var(--border-default)',
};

/** 泳道内卡片容器：固定卡宽 + 自动折行，面板越宽并排越多。 */
const CARD_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  gap: 8,
  minWidth: 0,
};

const LANE_BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  minWidth: 0,
  flex: 1,
};

const LANE_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
};

const LANE_CODE_STYLE: CSSProperties = {
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

const LANE_NAME_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  whiteSpace: 'nowrap',
};

const LANE_META_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const CARD_BASE_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  overflow: 'hidden',
  borderRadius: 'var(--radius-md, 10px)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
};

const CARD_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  flexShrink: 0,
};

const CARD_TITLE_BUTTON_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flex: 1,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

const CARD_TITLE_TEXT_STYLE: CSSProperties = {
  display: 'grid',
  gap: 1,
  minWidth: 0,
};

const CARD_NAME_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const CARD_SUB_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const CARD_EXPAND_BUTTON_STYLE: CSSProperties = {
  display: 'inline-grid',
  placeItems: 'center',
  width: 20,
  height: 20,
  flexShrink: 0,
  borderRadius: 'var(--radius-sm, 6px)',
  border: '1px solid var(--border-default)',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 10,
  lineHeight: 1,
  cursor: 'pointer',
};

const STATUS_DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const UPSTREAM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  margin: '0 10px',
  padding: '3px 7px',
  borderRadius: 'var(--radius-sm, 6px)',
  background: 'color-mix(in srgb, var(--bg-base) 70%, transparent)',
  fontSize: 10,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  flexShrink: 0,
};

const UPSTREAM_ARROW_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-subtle)',
  flexShrink: 0,
};

const CARD_BODY_BASE_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 10px',
  overflowX: 'hidden',
  overscrollBehavior: 'contain',
  minHeight: 0,
};

const COLLAPSED_BODY_STYLE: CSSProperties = {
  ...CARD_BODY_BASE_STYLE,
  maxHeight: COLLAPSED_BODY_MAX_HEIGHT,
  overflowY: 'hidden',
};

const EXPANDED_BODY_STYLE: CSSProperties = {
  ...CARD_BODY_BASE_STYLE,
  height: EXPANDED_BODY_HEIGHT,
  maxHeight: EXPANDED_BODY_MAX_HEIGHT,
  overflowY: 'auto',
};

const OMITTED_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-subtle)',
  textAlign: 'center',
  padding: '2px 0',
  borderBottom: '1px dashed var(--border-subtle)',
  flexShrink: 0,
};

const EMPTY_BODY_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-subtle)',
  padding: '4px 0',
};

/** 终态状态图标徽章 —— 替换普通色点，让「已结束」在一堆卡片里一眼可辨。 */
const STATUS_GLYPH_STYLE: CSSProperties = {
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
const ENDED_STRIP_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 10px',
  fontSize: 10.5,
  fontWeight: 700,
  borderTop: '1px solid var(--border-subtle)',
  flexShrink: 0,
};

/** 失败原因 —— 单行省略，完整内容走 title 提示。 */
const FAILURE_REASON_STYLE: CSSProperties = {
  padding: '3px 10px 5px',
  fontSize: 10.5,
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
const PERMISSION_STRIP_STYLE: CSSProperties = {
  margin: '0 10px 8px',
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm, 6px)',
  border: '1px solid color-mix(in srgb, var(--warning) 34%, var(--border-subtle))',
  background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
  flexShrink: 0,
};

/** 折叠态的最新消息：左侧一道层级色竖线做归属暗示，不套气泡外壳。 */
const LATEST_MESSAGE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 3,
  paddingLeft: 8,
  borderLeftWidth: 2,
  borderLeftStyle: 'solid',
  minWidth: 0,
};

const LATEST_MESSAGE_ROLE_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.2,
};

const LATEST_MESSAGE_TEXT_STYLE: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.5,
};

/** 展开态的缩小版 chat：气泡按说话人左右分列。 */
const BUBBLE_BASE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: '6px 9px',
  borderRadius: 10,
  maxWidth: '92%',
  minWidth: 0,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border-subtle)',
  background: 'color-mix(in srgb, var(--bg-base) 60%, transparent)',
};

const BUBBLE_ASSISTANT_STYLE: CSSProperties = {
  ...BUBBLE_BASE_STYLE,
  justifySelf: 'start',
  borderRadius: '10px 10px 10px 3px',
};

const BUBBLE_USER_STYLE: CSSProperties = {
  ...BUBBLE_BASE_STYLE,
  justifySelf: 'end',
  borderRadius: '10px 10px 3px 10px',
  borderColor: 'color-mix(in srgb, var(--accent) 26%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
};

const BUBBLE_ROLE_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.2,
};

const BUBBLE_TEXT_STYLE: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.55,
};

const CARD_FOOTER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  padding: '6px 10px',
  marginTop: 'auto',
  borderTop: '1px solid var(--border-subtle)',
  fontSize: 10,
  color: 'var(--fg-muted)',
  flexShrink: 0,
  fontVariantNumeric: 'tabular-nums',
};

const CARD_ACTION_STYLE: CSSProperties = {
  padding: '2px 7px',
  borderRadius: 'var(--radius-sm, 6px)',
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-surface) 60%, transparent)',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const WALL_EMPTY_STYLE: CSSProperties = {
  padding: '32px 12px',
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.7,
};

// ─── 状态 ───────────────────────────────────────────────────────────

type CardStatus =
  'streaming' | 'active' | 'error' | 'idle' | 'empty' | 'completed' | 'failed' | 'cancelled';

interface CardStatusTone {
  color: string;
  label: string;
  pulse: boolean;
  /** 状态图标。终态用图标而不是色点，让「已结束」在一堆卡片里一眼可辨。 */
  glyph: string;
}

const STATUS_TONES: Record<CardStatus, CardStatusTone> = {
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

// ─── 辅助函数 ───────────────────────────────────────────────────────

interface LayerLane {
  layer: string;
  identity: RoleLayerIdentity;
  instances: LayerMessages[];
  messageCount: number;
}

function layerDepth(layer: string): number {
  return LAYER_DEPTH[layer] ?? Number.MAX_SAFE_INTEGER;
}

function parseTimestamp(value: number | string | undefined): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTimestamp(instance: LayerMessages): number {
  const last = instance.messages[instance.messages.length - 1];
  return parseTimestamp(last?.createdAt);
}

/** 活跃实例置顶，其余按最近消息时间倒序 —— 让「正在说话的人」总在最前面。 */
function compareInstances(a: LayerMessages, b: LayerMessages): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  return latestTimestamp(b) - latestTimestamp(a);
}

/** 卡片（= 角色实例）稳定标识，同时用作 React key 与展开态集合的键。 */
function instanceKey(instance: LayerMessages): string {
  return instance.sessionIds[0] ?? `${instance.layer}:${instance.displayName ?? 'unknown'}`;
}

/** 按层级分组为泳道，并依层级深度从上到下排序。 */
function buildLanes(layers: LayerMessages[]): LayerLane[] {
  const grouped = new Map<string, LayerMessages[]>();

  for (const instance of layers) {
    const key = instance.layer?.trim() || 'reception';
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(instance);
    } else {
      grouped.set(key, [instance]);
    }
  }

  return Array.from(grouped.entries())
    .map(([layer, instances]) => ({
      layer,
      identity: getRoleLayerIdentity(layer),
      instances: [...instances].sort(compareInstances),
      messageCount: instances.reduce(
        (sum, item) => sum + item.messages.length + (item.streamingMessage ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => layerDepth(a.layer) - layerDepth(b.layer) || a.layer.localeCompare(b.layer));
}

/** 终态卡片状态。已结束的实例必须继续出卡片，所以这几个状态是一等展示态。 */
type TerminalCardStatus = Extract<CardStatus, 'completed' | 'failed' | 'cancelled'>;

/**
 * 取实例的终态；非终态返回 null。
 * 先落到局部变量再判定，让类型谓词把联合类型收窄成终态字面量。
 *
 * 唯一的例外是「当前会话正在本地流式输出」：终态描述的是**上一轮**已经收尾，
 * 用户完全可以在一个已结束的角色实例上再发一条消息 —— 此时 handoff 还是旧的
 * 终态记录（新一轮 handoff 要等后端派发才建），但实例实际上已经活了。若还按
 * 终态渲染，卡片会一边说「已完成」一边把正在生成的回复藏起来（终态卡片不显示
 * 流式内容），用户只会以为消息发丢了。
 *
 * 这个判断只在当前会话条目上可能成立（`isActive` 仅对主会话置真，
 * 且 `streamingMessage` 只在本地真有活跃流时才由 View 层注入），
 * 所以子实例残留的过期流式占位不会误判成「活着」。
 */
function resolveTerminalStatus(instance: LayerMessages): TerminalCardStatus | null {
  if (instance.isActive && instance.streamingMessage) {
    return null;
  }
  const lifecycle: InstanceLifecycle | null | undefined = instance.lifecycle;
  if (isTerminalLifecycle(lifecycle)) {
    return lifecycle;
  }
  return null;
}

/**
 * 该角色实例自己那条 session 上未处理的权限请求。
 *
 * 必须按 `sessionId` 过滤：权限请求是**实例级**的（子角色实例也会请求权限），
 * 网关恢复接口会把整棵子树的待处理权限一并返回，若不区分就会在每张卡片上
 * 重复渲染同一个请求 —— 点哪张卡都弹同一批按钮。
 */
function selectPendingPermissions(
  permissions: readonly CardPendingPermission[] | undefined,
  instance: LayerMessages,
): CardPendingPermission[] {
  const ownerSessionId = instance.sessionIds[0];
  if (!permissions || permissions.length === 0 || !ownerSessionId) {
    return [];
  }
  return permissions.filter(
    (permission) => permission.status === 'pending' && permission.sessionId === ownerSessionId,
  );
}

function resolveCardStatus(instance: LayerMessages): CardStatus {
  // 终态优先于一切：已结束 / 已关闭的实例不会再产出任何内容。即便前端还残留一条
  // streamingMessage（推送丢失会让流式占位没被正式消息取代），也绝不能显示成「正在生成」。
  const terminal = resolveTerminalStatus(instance);
  if (terminal) return terminal;
  if (instance.streamingMessage) return 'streaming';
  const last = instance.messages[instance.messages.length - 1];
  if (last?.status === 'error') return 'error';
  if (instance.messages.length === 0) return 'empty';
  if (instance.isActive) return 'active';
  return 'idle';
}

/** 终态时间标签：当天只给 HH:MM，跨天补 MM-DD —— 窄卡片里塞不下完整日期。 */
function formatEndedAt(value: number | null | undefined, now: number = Date.now()): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value2: number): string => String(value2).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const current = new Date(now);
  const sameDay =
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate();
  return sameDay ? time : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

/** 流式内容是否已有正文 —— 没有正文时用 typing 占位，而不是渲染一个空气泡。 */
function hasStreamContent(streaming: ChatMessage | null): boolean {
  return streaming !== null && streaming.content.trim().length > 0;
}

/**
 * 内容签名 —— 变化即视为该卡片有新内容产出，触发贴底跟随。
 * 覆盖「新增消息」与「同一条消息的流式增量」两种情况。
 */
function buildMessageSignature(messages: ChatMessage[], streaming: ChatMessage | null): string {
  const last = messages[messages.length - 1];
  return [
    String(messages.length),
    last?.id ?? '',
    String(last?.content?.length ?? 0),
    String(last?.parts?.length ?? 0),
    streaming ? `stream:${streaming.content?.length ?? 0}` : '',
  ].join('|');
}

// ─── 子组件 ─────────────────────────────────────────────────────────

interface CardMessageProps {
  message: ChatMessage;
  fallbackIdentity: RoleLayerIdentity;
  /** `latest`：折叠态的紧凑单条；`bubble`：展开态的 chat 气泡。 */
  variant: 'latest' | 'bubble';
  streaming: boolean;
}

function CardMessage({
  message,
  fallbackIdentity,
  variant,
  streaming,
}: CardMessageProps): ReactElement {
  const isUser = message.role === 'user';
  // assistant 消息优先按 agentId 反解身份 —— 同一张卡片里的消息也可能来自不同 agent。
  const identity =
    !isUser && message.agentId
      ? getRoleLayerIdentityFromAgentId(message.agentId)
      : fallbackIdentity;
  const roleLabel = isUser ? '用户' : identity.short;

  if (variant === 'latest') {
    return (
      <div
        style={{
          ...LATEST_MESSAGE_STYLE,
          borderLeftColor: isUser
            ? 'color-mix(in srgb, var(--accent) 45%, transparent)'
            : `color-mix(in srgb, ${identity.color} 55%, transparent)`,
        }}
      >
        <span
          style={{
            ...LATEST_MESSAGE_ROLE_STYLE,
            color: isUser ? 'var(--fg-muted)' : identity.color,
          }}
        >
          {roleLabel}
          {streaming ? ' · 正在生成' : ''}
        </span>
        <TeamMessageBody message={message} textStyle={LATEST_MESSAGE_TEXT_STYLE} />
      </div>
    );
  }

  return (
    <div style={isUser ? BUBBLE_USER_STYLE : BUBBLE_ASSISTANT_STYLE}>
      <span
        style={{
          ...BUBBLE_ROLE_STYLE,
          color: isUser ? 'var(--fg-muted)' : identity.color,
        }}
      >
        {roleLabel}
        {streaming ? ' · 正在生成' : ''}
      </span>
      <TeamMessageBody message={message} textStyle={BUBBLE_TEXT_STYLE} />
    </div>
  );
}

interface LayerRoleCardProps {
  instance: LayerMessages;
  identity: RoleLayerIdentity;
  expanded: boolean;
  onToggleExpanded: (key: string) => void;
  onLayerSelect?: (layer: string) => void;
  /** 该实例自己那条 session 上未处理的权限请求。 */
  pendingPermissions?: readonly CardPendingPermission[];
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  onOpenSession?: (sessionId: string) => void;
}

function LayerRoleCard({
  instance,
  identity,
  expanded,
  onToggleExpanded,
  onLayerSelect,
  pendingPermissions,
  resolveInlinePermissionActions,
  onOpenSession,
}: LayerRoleCardProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 终态实例一律不再显示流式内容：它已经结束了，残留的 streamingMessage（推送丢失时会留下）
  // 只会让人误以为它还在说话。折叠态因此回落到最后一条正式消息，正好是它的「临终留言」。
  const terminalStatus = resolveTerminalStatus(instance);
  const streaming = terminalStatus ? null : (instance.streamingMessage ?? null);
  const streamHasContent = hasStreamContent(streaming);
  const status = resolveCardStatus(instance);
  const tone = STATUS_TONES[status];
  const key = instanceKey(instance);
  const endedLabel = terminalStatus ? formatEndedAt(instance.endedAt) : null;
  const failureReason = terminalStatus === 'failed' ? instance.failureReason?.trim() || null : null;

  // 折叠态不渲染历史消息（只留最新一条）；展开态渲染最近 EXPANDED_MESSAGE_LIMIT 条。
  const visibleMessages = useMemo(
    () => (expanded ? instance.messages.slice(-EXPANDED_MESSAGE_LIMIT) : []),
    [expanded, instance.messages],
  );
  const latestMessage = useMemo(
    () => streaming ?? instance.messages[instance.messages.length - 1] ?? null,
    [instance.messages, streaming],
  );
  const hiddenCount = expanded ? Math.max(0, instance.messages.length - visibleMessages.length) : 0;

  const signature = expanded
    ? buildMessageSignature(visibleMessages, streaming)
    : [
        String(instance.messages.length),
        latestMessage?.id ?? '',
        String(streaming?.content?.length ?? 0),
      ].join('|');
  const hasContent = latestMessage !== null;
  // 折叠态不滚动（只看最新一条），因此只在展开态开启贴底跟随。
  const { pinned, pinToBottom } = useStickToBottom(scrollRef, signature, expanded && hasContent);

  const sourceIdentity = instance.sourceLayer ? getRoleLayerIdentity(instance.sourceLayer) : null;
  const showTypingPlaceholder = streaming !== null && !streamHasContent;

  // 权限请求按实例的 session 归位（见 selectPendingPermissions 注释）。
  const cardPermissions = selectPendingPermissions(pendingPermissions, instance);
  const showPermissionStrip =
    cardPermissions.length > 0 && resolveInlinePermissionActions !== undefined;

  // 主会话卡片不给「打开完整会话」入口 —— 用户此刻就在这个会话里，点了只会触发
  // 一次无意义的重新选中（还会顺带切 middle tab、关掉文件编辑器浮层）。
  const openSessionTarget = instance.isActive ? undefined : instance.sessionIds[0];
  const canOpenSession = Boolean(openSessionTarget && onOpenSession);

  const handleSelect = useCallback(() => {
    onLayerSelect?.(instance.layer);
  }, [instance.layer, onLayerSelect]);

  const handleToggle = useCallback(() => {
    onToggleExpanded(key);
  }, [key, onToggleExpanded]);

  const handleOpenSession = useCallback(() => {
    if (openSessionTarget) {
      onOpenSession?.(openSessionTarget);
    }
  }, [onOpenSession, openSessionTarget]);

  const cardStyle: CSSProperties = {
    ...CARD_BASE_STYLE,
    flex: `0 0 ${String(CARD_WIDTH)}px`,
    width: CARD_WIDTH,
    maxWidth: '100%',
    ...(instance.isActive
      ? {
          borderColor: `color-mix(in srgb, ${identity.color} 55%, transparent)`,
          background: `color-mix(in srgb, ${identity.color} 6%, var(--bg-overlay))`,
        }
      : null),
    // 终态：边框改虚线、底色按状态色轻微染色，和「活着」的卡片区分开。
    // 刻意不降低不透明度 —— 已结束的实例仍要被阅读，弱化到发灰就本末倒置了。
    ...(terminalStatus
      ? {
          borderStyle: 'dashed',
          borderColor: `color-mix(in srgb, ${tone.color} 36%, var(--border-subtle))`,
          background: `color-mix(in srgb, ${tone.color} 4%, var(--bg-overlay))`,
        }
      : null),
  };

  return (
    <section style={cardStyle} aria-label={`${instance.displayName ?? identity.label} 的对话窗口`}>
      <header style={CARD_HEADER_STYLE}>
        <button
          type="button"
          style={CARD_TITLE_BUTTON_STYLE}
          onClick={handleSelect}
          title={`聚焦${identity.label}`}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 22,
              height: 22,
              borderRadius: '50%',
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 800,
              color: identity.color,
              background: `color-mix(in srgb, ${identity.color} 18%, var(--bg-surface))`,
              border: `1px solid color-mix(in srgb, ${identity.color} 42%, transparent)`,
            }}
          >
            {identity.initials}
          </span>
          <span style={CARD_TITLE_TEXT_STYLE}>
            <span style={CARD_NAME_STYLE}>{instance.displayName ?? identity.label}</span>
            <span style={CARD_SUB_STYLE}>
              {identity.code ? `${identity.code} · ` : ''}
              {identity.label}
            </span>
          </span>
        </button>
        <button
          type="button"
          style={CARD_EXPAND_BUTTON_STYLE}
          onClick={handleToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? '收起' : '展开'}${instance.displayName ?? identity.label}的对话`}
          title={expanded ? '收起为最新一条' : '展开为对话详情'}
        >
          {expanded ? '▾' : '▴'}
        </button>
        {terminalStatus ? (
          // 终态：色点换成图标徽章。一眼能分出「还在跑」的脉冲点和「已经结束」的图标。
          <span
            role="img"
            aria-label={tone.label}
            title={endedLabel ? `${tone.label} · ${endedLabel}` : tone.label}
            style={{
              ...STATUS_GLYPH_STYLE,
              color: tone.color,
              border: `1px solid color-mix(in srgb, ${tone.color} 45%, transparent)`,
              background: `color-mix(in srgb, ${tone.color} 12%, transparent)`,
            }}
          >
            {tone.glyph}
          </span>
        ) : (
          <span
            role="img"
            aria-label={tone.label}
            title={tone.label}
            style={{
              ...STATUS_DOT_STYLE,
              background: tone.color,
              ...(tone.pulse
                ? {
                    animation: 'team-flow-node-pulse 1.8s ease-in-out infinite',
                    // team-flow-node-pulse 读取这两个变量（见 team-runtime-flow-animations.css）。
                    ['--team-flow-glow' as string]: `color-mix(in srgb, ${identity.color} 45%, transparent)`,
                    ['--team-flow-glow-mid' as string]: identity.color,
                  }
                : null),
            }}
          />
        )}
      </header>

      {/* 上游徽章 —— 层级对话的上下关系在这里落地 */}
      <div style={UPSTREAM_STYLE}>
        <span aria-hidden style={UPSTREAM_ARROW_STYLE}>
          ↳
        </span>
        {sourceIdentity ? (
          <>
            <span style={{ color: sourceIdentity.color, fontWeight: 700, flexShrink: 0 }}>
              上游 {sourceIdentity.short}
            </span>
            <span
              style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={instance.sourceDisplayName ?? undefined}
            >
              {instance.sourceDisplayName ?? sourceIdentity.label}
            </span>
          </>
        ) : (
          <span>顶层入口</span>
        )}
      </div>

      {/* 待处理权限 —— 放在消息区之外，折叠态也不会被裁掉（见 PERMISSION_STRIP_STYLE） */}
      {showPermissionStrip && resolveInlinePermissionActions ? (
        <div style={PERMISSION_STRIP_STYLE}>
          <InlinePermissionQuickBar
            dense
            permissions={cardPermissions}
            resolveActions={resolveInlinePermissionActions}
          />
        </div>
      ) : null}

      <div ref={scrollRef} style={expanded ? EXPANDED_BODY_STYLE : COLLAPSED_BODY_STYLE}>
        {hiddenCount > 0 ? <div style={OMITTED_STYLE}>更早 {hiddenCount} 条已折叠</div> : null}

        {expanded ? (
          <>
            {visibleMessages.length === 0 && !showTypingPlaceholder ? (
              <div style={EMPTY_BODY_STYLE}>该角色暂无消息。</div>
            ) : null}
            {visibleMessages.map((message) => (
              <CardMessage
                key={message.id}
                message={message}
                fallbackIdentity={identity}
                variant="bubble"
                streaming={false}
              />
            ))}
            {streaming && streamHasContent ? (
              <CardMessage
                message={streaming}
                fallbackIdentity={identity}
                variant="bubble"
                streaming
              />
            ) : null}
            {showTypingPlaceholder ? (
              <TeamRoleTypingIndicator roleLayer={instance.layer} visible />
            ) : null}
          </>
        ) : (
          <>
            {latestMessage && !showTypingPlaceholder ? (
              <CardMessage
                message={latestMessage}
                fallbackIdentity={identity}
                variant="latest"
                streaming={streaming !== null}
              />
            ) : null}
            {showTypingPlaceholder ? (
              <TeamRoleTypingIndicator roleLayer={instance.layer} visible />
            ) : null}
            {latestMessage === null ? <div style={EMPTY_BODY_STYLE}>该角色暂无消息。</div> : null}
          </>
        )}
      </div>

      {/* 终态标识条 —— 折叠 / 展开两态都显示：实例关掉了，但它的对话仍可查阅。 */}
      {terminalStatus ? (
        <div
          style={{
            ...ENDED_STRIP_STYLE,
            color: tone.color,
            background: `color-mix(in srgb, ${tone.color} 7%, transparent)`,
          }}
        >
          <span aria-hidden>{tone.glyph}</span>
          <span>{tone.label}</span>
          {endedLabel ? (
            <span style={{ color: 'var(--fg-muted)', fontWeight: 600 }}>· {endedLabel}</span>
          ) : null}
        </div>
      ) : null}

      {failureReason ? (
        <div style={FAILURE_REASON_STYLE} title={failureReason}>
          {failureReason}
        </div>
      ) : null}

      <footer style={CARD_FOOTER_STYLE}>
        <span>
          {instance.messages.length} 条{status === 'streaming' ? ' · 正在生成' : ''}
        </span>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {expanded && hasContent && !pinned ? (
            <button type="button" style={CARD_ACTION_STYLE} onClick={pinToBottom}>
              回到底部
            </button>
          ) : null}
          {canOpenSession ? (
            <button
              type="button"
              style={CARD_ACTION_STYLE}
              onClick={handleOpenSession}
              title="在底部面板打开该角色的完整会话"
              aria-label={`打开${instance.displayName ?? identity.label}的完整会话`}
            >
              完整会话
            </button>
          ) : null}
          <button type="button" style={CARD_ACTION_STYLE} onClick={handleToggle}>
            {expanded ? '收起' : '展开'}
          </button>
        </span>
      </footer>
    </section>
  );
}

interface LayerLaneRowProps {
  lane: LayerLane;
  isLast: boolean;
  activeLayer?: string | null;
  expandedKeys: ReadonlySet<string>;
  onToggleExpanded: (key: string) => void;
  onLayerSelect?: (layer: string) => void;
  pendingPermissions?: readonly CardPendingPermission[];
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  onOpenSession?: (sessionId: string) => void;
}

function LayerLaneRow({
  lane,
  isLast,
  activeLayer,
  expandedKeys,
  onToggleExpanded,
  onLayerSelect,
  pendingPermissions,
  resolveInlinePermissionActions,
  onOpenSession,
}: LayerLaneRowProps): ReactElement {
  const instanceCount = lane.instances.length;
  const laneFocused = activeLayer === lane.layer;
  // 层级序号由 LAYER_DEPTH 推导，**不能**用泳道在数组里的下标 —— 只有部分层级有实例时
  // （例如只有 pm1 与执行层在场），下标会把执行层标成「第 2 层」，而架构上执行层固定是第 4 层。
  // 编号必须与「哪些层恰好有实例」无关。
  const depth = layerDepth(lane.layer);
  const ordinal = depth === Number.MAX_SAFE_INTEGER ? null : depth + 1;
  // 「主会话所在层」必须由数据推导（哪个泳道里有 isActive 实例），不能由 activeLayer 推导：
  // activeLayer 还承载「用户点选过的层级」，用它会把这个标签错误地贴到用户点选的那一层上。
  const holdsActiveInstance = lane.instances.some((instance) => instance.isActive);
  // 已结束的实例仍然留在泳道里（这是刻意的），单独计数让用户知道这一层「跑完了几个」。
  const endedCount = lane.instances.filter(
    (instance) => resolveTerminalStatus(instance) !== null,
  ).length;

  return (
    <div style={LANE_STYLE}>
      <div style={RAIL_STYLE} aria-hidden>
        <span
          style={{
            ...RAIL_DOT_STYLE,
            background: lane.identity.color,
            // 聚焦反馈放在轨道节点上：用 boxShadow 描一圈，不改变布局尺寸（避免聚焦时抖动）。
            ...(laneFocused
              ? {
                  boxShadow: `0 0 0 3px color-mix(in srgb, ${lane.identity.color} 24%, transparent)`,
                }
              : null),
          }}
        />
        {isLast ? null : <span style={RAIL_LINE_STYLE} />}
      </div>
      <div style={LANE_BODY_STYLE}>
        <div style={LANE_HEADER_STYLE}>
          <span
            style={{
              ...LANE_CODE_STYLE,
              color: lane.identity.color,
              background: `color-mix(in srgb, ${lane.identity.color} 16%, transparent)`,
              border: `1px solid color-mix(in srgb, ${lane.identity.color} 34%, transparent)`,
            }}
          >
            {lane.identity.code ?? (ordinal === null ? '·' : String(ordinal))}
          </span>
          <span
            style={{
              ...LANE_NAME_STYLE,
              color: laneFocused ? lane.identity.color : 'var(--fg-strong)',
            }}
          >
            {lane.identity.label}
          </span>
          <span style={LANE_META_STYLE}>
            {ordinal === null ? '' : `第 ${ordinal} 层 · `}
            {instanceCount} 个角色 · {lane.messageCount} 条
            {endedCount > 0 ? ` · ${endedCount} 个已结束` : ''}
            {holdsActiveInstance ? ' · 主会话所在层' : ''}
            {laneFocused && !holdsActiveInstance ? ' · 已聚焦' : ''}
          </span>
        </div>
        <div style={CARD_ROW_STYLE}>
          {lane.instances.map((instance) => {
            const key = instanceKey(instance);
            return (
              <LayerRoleCard
                key={key}
                instance={instance}
                identity={lane.identity}
                expanded={expandedKeys.has(key)}
                onToggleExpanded={onToggleExpanded}
                onLayerSelect={onLayerSelect}
                pendingPermissions={pendingPermissions}
                resolveInlinePermissionActions={resolveInlinePermissionActions}
                onOpenSession={onOpenSession}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── 主组件 ─────────────────────────────────────────────────────────

export function TeamMultiLayerCardWall({
  activeLayer,
  layers,
  onLayerSelect,
  scopeKey,
  pendingPermissions,
  resolveInlinePermissionActions,
  onOpenSession,
}: TeamMultiLayerCardWallProps): ReactElement {
  const lanes = useMemo(() => buildLanes(layers), [layers]);
  // 展开态从 localStorage 还原（按会话分键）——刷新一次就要把刚摆好的阅读态
  // 全部折回折叠态，等于让用户重做一遍。
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() =>
    readCardWallExpandedKeys(scopeKey),
  );

  // 会话切换时重新装载。侧栏在嵌入式场景（LayerConversationDrawer / 只读预览）
  // 不一定会随 sessionId 变化而重新挂载，只靠 useState 初始化会在组件复用后
  // 把上一个会话的展开态套到新会话上。
  const scopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return;
    scopeKeyRef.current = scopeKey;
    setExpandedKeys(readCardWallExpandedKeys(scopeKey));
  }, [scopeKey]);

  const instanceCount = useMemo(
    () => lanes.reduce((sum, lane) => sum + lane.instances.length, 0),
    [lanes],
  );
  const messageCount = useMemo(
    () => lanes.reduce((sum, lane) => sum + lane.messageCount, 0),
    [lanes],
  );
  const endedInstanceCount = useMemo(
    () =>
      lanes.reduce(
        (sum, lane) =>
          sum +
          lane.instances.filter((instance) => resolveTerminalStatus(instance) !== null).length,
        0,
      ),
    [lanes],
  );

  const handleToggleExpanded = useCallback((key: string) => {
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const allKeys = useMemo(
    () => lanes.flatMap((lane) => lane.instances.map((instance) => instanceKey(instance))),
    [lanes],
  );
  const allExpanded = allKeys.length > 0 && allKeys.every((key) => expandedKeys.has(key));

  // 依赖用「键集合的签名」而不是 allKeys 数组引用：流式输出每个 token 都会让
  // layers / lanes / allKeys 换新引用，直接依赖数组会把 localStorage 写成
  // 「每个 token 一次同步写」的热点。签名只在实际卡片集合变化时才变。
  const allKeysSignature = allKeys.join('\u0000');

  useEffect(() => {
    // 签名空 = 实例数据还没到（首帧 layers 为空）。此刻写盘会把上一次的展开态
    // 整个清空 —— 宁可不写，等数据到了再收敛。
    if (!scopeKey || allKeysSignature.length === 0) return;
    const liveKeys = new Set(allKeysSignature.split('\u0000'));
    writeCardWallExpandedKeys(
      scopeKey,
      [...expandedKeys].filter((key) => liveKeys.has(key)),
    );
  }, [allKeysSignature, expandedKeys, scopeKey]);

  const handleToggleAll = useCallback(() => {
    setExpandedKeys(allExpanded ? new Set<string>() : new Set(allKeys));
  }, [allExpanded, allKeys]);

  return (
    <div style={PANEL_STYLE} aria-label="团队角色窗口墙">
      <div style={HEADER_STYLE}>
        <div style={HEADER_TITLE_STYLE}>
          <span style={HEADER_NAME_STYLE}>角色窗口墙</span>
          <span style={HEADER_HINT_STYLE}>
            折叠只看最新一条，展开看完整对话；已结束的角色窗口仍可查阅
          </span>
        </div>
        <div style={METRIC_ROW_STYLE}>
          <span style={METRIC_PILL_STYLE}>{lanes.length} 个层级</span>
          <span style={METRIC_PILL_STYLE}>{instanceCount} 个角色</span>
          <span style={METRIC_PILL_STYLE}>{messageCount} 条消息</span>
          {endedInstanceCount > 0 ? (
            <span style={METRIC_PILL_STYLE}>{endedInstanceCount} 个已结束</span>
          ) : null}
          {instanceCount > 0 ? (
            <button type="button" style={HEADER_BULK_BUTTON_STYLE} onClick={handleToggleAll}>
              {allExpanded ? '全部收起' : '全部展开'}
            </button>
          ) : null}
        </div>
      </div>
      <div style={WALL_STYLE}>
        {lanes.length === 0 ? (
          <div style={WALL_EMPTY_STYLE}>
            还没有任何角色的对话。
            <br />
            团队开始协作后，这里会为每个角色实例开一个独立的对话窗口。
          </div>
        ) : (
          lanes.map((lane, index) => (
            <LayerLaneRow
              key={lane.layer}
              lane={lane}
              isLast={index === lanes.length - 1}
              activeLayer={activeLayer}
              expandedKeys={expandedKeys}
              onToggleExpanded={handleToggleExpanded}
              onLayerSelect={onLayerSelect}
              pendingPermissions={pendingPermissions}
              resolveInlinePermissionActions={resolveInlinePermissionActions}
              onOpenSession={onOpenSession}
            />
          ))
        )}
      </div>
    </div>
  );
}
