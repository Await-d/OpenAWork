/**
 * TeamLayerChatPanel · 群聊式多层级消息汇总面板
 *
 * 设计目标：以「群聊」方式展示所有不同层级的对话消息汇总，让用户一眼看到
 * 团队各层级的实时动态。与普通群聊不同的是——消息不会混合成无差别的流，
 * 而是按层级分组、用层级标识（头像、名称、配色）做视觉分隔，
 * 每条消息都能清楚看出归属哪个层级。
 *
 * 布局：
 *   - 顶部：标题 + 摘要指标（层级数 / 消息数 / 会话数）
 *   - 消息流：按时间排序的扁平消息列表，相邻同层级消息归为同一组，
 *     组间插入层级分隔条（带层级图标 + 名称 + 消息计数），分隔条可点击选中层级
 *   - 每条消息：头像 + 名称 + 时间 + 消息摘要/详情
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { getRoleLayerIdentity } from '../../runtime/data/role-layer-identity.js';
import type { LayerMessages } from './TeamMultiLayerPanel.js';
import {
  getTeamMessageDetailText,
  getTeamMessagePreviewText,
  TeamMessageBody,
} from './team-message-content.js';

export interface TeamLayerChatPanelProps {
  /** 当前活跃层级（高亮标识）。 */
  activeLayer?: string | null;
  /** 当前主会话 id（用于排除标识）。 */
  currentSessionId?: string | null;
  /** 所有层级消息数据。 */
  layers: LayerMessages[];
  /** 点击「打开完整会话」回调。 */
  onOpenLayerSession?: (sessionId: string) => void;
  /** 层级选中回调（用于联动其他面板）。 */
  onLayerSelect?: (layer: string) => void;
}

// ─── 样式 ───────────────────────────────────────────────────────────

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--bg-base)',
  borderRight: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
};

const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: '6px var(--spacing-2, 8px)',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 36%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base)), var(--bg-base))',
  flexShrink: 0,
};

const HEADER_TITLE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--spacing-1, 4px)',
};

const METRIC_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-1, 4px)',
  flexWrap: 'wrap',
};

const WINDOW_SUMMARY_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--spacing-1, 4px)',
  flexWrap: 'wrap',
  paddingTop: 3,
  borderTop: '1px solid color-mix(in srgb, var(--border-subtle) 28%, transparent)',
  color: 'var(--fg-muted)',
  fontSize: 10,
  lineHeight: 1.35,
};

const METRIC_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '1px 6px',
  borderRadius: 'var(--radius-pill, 9999px)',
  border: '1px solid color-mix(in srgb, var(--border-subtle) 40%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, transparent)',
  color: 'var(--fg-muted)',
  fontSize: 9.5,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

const SCROLL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '0 2px 4px',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
};

const LOAD_MORE_HINT_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 3,
  padding: '6px 4px 4px',
  color: 'var(--fg-subtle)',
  fontSize: 10,
  lineHeight: 1.3,
  textAlign: 'center',
};

const LAYER_DIVIDER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  padding: '5px 4px 2px',
  marginTop: 0,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--fg-subtle)',
  borderBottomWidth: 1,
  borderBottomStyle: 'solid',
  borderBottomColor: 'color-mix(in srgb, var(--border-subtle) 30%, transparent)',
  flexShrink: 0,
  cursor: 'pointer',
  transition: 'background 120ms ease, border-color 120ms ease',
  borderRadius: 'var(--radius-xs, 4px) var(--radius-xs, 4px) 0 0',
  userSelect: 'none',
};

const LAYER_DIVIDER_HOVER_STYLE: CSSProperties = {
  ...LAYER_DIVIDER_STYLE,
  background: 'color-mix(in srgb, var(--bg-overlay) 50%, transparent)',
  borderBottomColor: 'color-mix(in srgb, var(--border-default) 20%, transparent)',
};

const MESSAGE_CARD_BASE_STYLE: CSSProperties = {
  display: 'flex',
  gap: 5,
  padding: '4px',
  borderRadius: 'var(--radius-sm, 6px)',
  background: 'transparent',
  borderWidth: 0,
  borderStyle: 'solid',
  borderColor: 'transparent',
  transition: 'background 120ms ease',
  cursor: 'default',
};

const MESSAGE_CARD_HOVER_STYLE: CSSProperties = {
  ...MESSAGE_CARD_BASE_STYLE,
  background: 'color-mix(in srgb, var(--bg-surface) 60%, transparent)',
};

const AVATAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: '50%',
  flexShrink: 0,
  fontSize: 10,
};

const MESSAGE_BODY_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  minWidth: 0,
  flex: 1,
};

const MESSAGE_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  flexWrap: 'wrap',
};

const LAYER_NAME_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  letterSpacing: '-0.01em',
};

const MESSAGE_TIME_STYLE: CSSProperties = {
  fontSize: 9.5,
  color: 'var(--fg-subtle)',
  fontVariantNumeric: 'tabular-nums',
  marginLeft: 'auto',
};

const MESSAGE_TEXT_CLAMP_STYLE: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--fg-default)',
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflowWrap: 'anywhere',
  cursor: 'pointer',
};

const MESSAGE_TEXT_FULL_STYLE: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: 'var(--fg-default)',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

/** JSON 内容专用样式：等宽字体 + 保持缩进 */
const MESSAGE_JSON_STYLE: CSSProperties = {
  ...MESSAGE_TEXT_FULL_STYLE,
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  fontSize: 11.5,
  whiteSpace: 'pre',
  overflowX: 'auto',
};

const EMPTY_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: 'var(--fg-subtle)',
  fontSize: 12,
  textAlign: 'center' as const,
  padding: 'var(--spacing-3, 12px) var(--spacing-2, 8px)',
};

const COUNT_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 15,
  padding: '0 5px',
  borderRadius: 'var(--radius-pill, 9999px)',
  fontSize: 9,
  fontWeight: 800,
  fontVariantNumeric: 'tabular-nums',
};

const OPEN_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '1px 6px',
  marginTop: 3,
  borderRadius: 'var(--radius-sm, 6px)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'color-mix(in srgb, var(--border-default) 25%, transparent)',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 9.5,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'all 120ms ease',
  whiteSpace: 'nowrap',
  alignSelf: 'flex-start',
};

const OPEN_BUTTON_HOVER_STYLE: CSSProperties = {
  ...OPEN_BUTTON_STYLE,
  borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
  color: 'var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
};

const SCROLL_BOTTOM_BTN_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 10px',
  borderRadius: 'var(--radius-pill, 9999px)',
  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-overlay))',
  color: 'var(--fg-strong)',
  fontSize: 10.5,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: 'var(--shadow-sm)',
  transition: 'all 120ms ease',
  whiteSpace: 'nowrap',
  zIndex: 10,
};

// ─── 辅助函数 ───────────────────────────────────────────────────────

interface FlattenedMessage {
  message: ChatMessage;
  layer: string;
  sessionId: string;
  timestamp: number;
}

const INITIAL_VISIBLE_MESSAGE_COUNT = 50;
const LOAD_MORE_BATCH_SIZE = 50;
const LOAD_MORE_SCROLL_THRESHOLD_PX = 48;

function parseTimestamp(ts: number | string | undefined): number {
  if (!ts) return 0;
  return typeof ts === 'string' ? parseInt(ts, 10) : ts;
}

function formatTime(ts: number | string | undefined): string {
  if (!ts) return '';
  const d = new Date(parseTimestamp(ts));
  if (isNaN(d.getTime())) return '';
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function getMessageDisplayText(message: ChatMessage): string {
  return getTeamMessagePreviewText(message, 180);
}

function getPrimarySessionId(
  layer: LayerMessages,
  currentSessionId?: string | null,
): string | null {
  const preferred = layer.sessionIds.find((id) => id !== currentSessionId);
  return preferred ?? layer.sessionIds[0] ?? null;
}

// ─── 消息组结构 ─────────────────────────────────────────────────────

interface MessageGroup {
  layer: string;
  sessionId: string;
  messages: FlattenedMessage[];
}

function flattenLayerMessages(layers: LayerMessages[]): FlattenedMessage[] {
  const allMessages: FlattenedMessage[] = [];

  for (const layer of layers) {
    const sessionId = layer.sessionIds[0] ?? '';
    for (const message of layer.messages) {
      allMessages.push({
        message,
        layer: layer.layer,
        sessionId,
        timestamp: parseTimestamp(message.createdAt),
      });
    }
  }

  allMessages.sort((a, b) => a.timestamp - b.timestamp);
  return allMessages;
}

/**
 * 把所有层级的消息按时间排序后，按「层级连续性」分组：
 * 相邻的同层级消息归为一组，层级切换时插入新的分组。
 */
function buildMessageGroups(
  visibleMessages: FlattenedMessage[],
  layers: LayerMessages[],
): MessageGroup[] {
  const groups: MessageGroup[] = [];
  const visibleSessionIds = new Set<string>();

  for (const item of visibleMessages) {
    visibleSessionIds.add(item.sessionId);
    const lastGroup = groups[groups.length - 1];
    // 按 sessionId 分组（同一角色实例的连续消息归为一组）
    if (lastGroup && lastGroup.sessionId === item.sessionId) {
      lastGroup.messages.push(item);
    } else {
      groups.push({ layer: item.layer, sessionId: item.sessionId, messages: [item] });
    }
  }

  // 可见窗口里没有已完成消息，但有流式消息时，补一个空 group 承载正在输入态。
  for (const layer of layers) {
    const sessionId = layer.sessionIds[0] ?? '';
    if (layer.streamingMessage && !visibleSessionIds.has(sessionId)) {
      groups.push({ layer: layer.layer, sessionId, messages: [] });
    }
  }

  return groups;
}

// ─── 消息卡片组件 ───────────────────────────────────────────────────

function LayerChatMessageCard({
  message,
  layer,
  sessionId,
  displayName,
  onOpenLayerSession,
}: {
  message: ChatMessage;
  layer: string;
  sessionId: string | null;
  displayName?: string | null;
  onOpenLayerSession?: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [openHovered, setOpenHovered] = useState(false);
  const id = getRoleLayerIdentity(layer);
  const isUser = message.role === 'user';
  const previewText = getMessageDisplayText(message);
  const detailText = getTeamMessageDetailText(message);
  const isLong = previewText.length > 120 || detailText.length > 180;
  const bodyTextStyle = isUser
    ? {
        color: 'var(--fg-strong)',
        fontWeight: 500,
        fontSize: 12.5,
        lineHeight: 1.55,
      }
    : undefined;

  const handleToggleExpand = useCallback(() => {
    if (isLong) setExpanded((prev) => !prev);
  }, [isLong]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (isLong && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        setExpanded((prev) => !prev);
      }
    },
    [isLong],
  );

  return (
    <div
      style={hovered ? MESSAGE_CARD_HOVER_STYLE : MESSAGE_CARD_BASE_STYLE}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-layer={layer}
      data-role={message.role}
    >
      {/* 头像 */}
      <div
        style={{
          ...AVATAR_STYLE,
          background: `color-mix(in srgb, ${id.color} 14%, transparent)`,
          color: id.color,
          border: `1px solid color-mix(in srgb, ${id.color} 28%, transparent)`,
        }}
        aria-hidden
      >
        {id.icon}
      </div>
      {/* 消息体 */}
      <div style={MESSAGE_BODY_STYLE}>
        <div style={MESSAGE_HEADER_STYLE}>
          <span style={{ ...LAYER_NAME_STYLE, color: id.color }}>{id.short}</span>
          {displayName ? (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 3,
                background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                color: 'var(--accent)',
                maxWidth: 80,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={displayName}
            >
              {displayName}
            </span>
          ) : null}
          {id.code && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                padding: '0 4px',
                borderRadius: 3,
                background: `color-mix(in srgb, ${id.color} 12%, transparent)`,
                color: id.color,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {id.code}
            </span>
          )}
          <span style={{ fontSize: 10, color: 'var(--fg-subtle)', fontWeight: 600 }}>
            {isUser ? '用户' : '助手'}
          </span>
          <time style={MESSAGE_TIME_STYLE}>{formatTime(message.createdAt)}</time>
        </div>
        {!isLong || expanded ? (
          <TeamMessageBody
            message={message}
            textStyle={bodyTextStyle}
            jsonStyle={MESSAGE_JSON_STYLE}
          />
        ) : (
          <div
            style={MESSAGE_TEXT_CLAMP_STYLE}
            onClick={handleToggleExpand}
            role="button"
            tabIndex={0}
            onKeyDown={handleKeyDown}
          >
            {previewText}
          </div>
        )}
        {isLong && !expanded ? (
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              marginTop: 1,
            }}
            onClick={handleToggleExpand}
          >
            展开全部 ↓
          </span>
        ) : null}
        {isLong && expanded ? (
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              marginTop: 1,
            }}
            onClick={handleToggleExpand}
          >
            收起 ↑
          </span>
        ) : null}
        {sessionId && onOpenLayerSession && (
          <button
            type="button"
            className="team-v2-control team-v2-control--transparent"
            style={openHovered ? OPEN_BUTTON_HOVER_STYLE : OPEN_BUTTON_STYLE}
            onMouseEnter={() => setOpenHovered(true)}
            onMouseLeave={() => setOpenHovered(false)}
            onClick={() => onOpenLayerSession(sessionId)}
            aria-label={`打开${id.short}完整会话`}
            title={`打开会话 ${sessionId}`}
          >
            打开会话 →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── 流式消息卡片 ───────────────────────────────────────────────────

const STREAMING_INDICATOR_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '1px 6px',
  borderRadius: 'var(--radius-pill, 9999px)',
  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  color: 'var(--accent)',
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
};

const STREAMING_DOTS_STYLE: CSSProperties = {
  display: 'inline-flex',
  gap: 2,
  alignItems: 'center',
};

const STREAMING_DOT_STYLE: CSSProperties = {
  width: 4,
  height: 4,
  borderRadius: '50%',
  background: 'var(--accent)',
  display: 'inline-block',
  animation: 'team-streaming-bounce 1s ease-in-out infinite',
};

/**
 * 流式消息卡片：在群聊汇总面板中展示正在生成的消息。
 * 与普通消息卡片相比：
 * - 带有"正在输入"脉冲动画指示器
 * - 消息内容实时更新（由上层 streamBuffer 驱动）
 * - 不显示"打开会话"按钮（流式结束后才可用）
 */
function StreamingMessageCard({
  message,
  layer,
  displayName,
}: {
  message: ChatMessage;
  layer: string;
  displayName?: string | null;
}) {
  const id = getRoleLayerIdentity(layer);
  const displayText = getTeamMessageDetailText(message);
  const isEmpty = displayText === '团队正在处理中…' || displayText.trim().length === 0;

  return (
    <div
      style={{
        ...MESSAGE_CARD_BASE_STYLE,
      }}
      data-layer={layer}
      data-streaming="true"
    >
      {/* 头像 */}
      <div
        style={{
          ...AVATAR_STYLE,
          background: `color-mix(in srgb, ${id.color} 14%, transparent)`,
          color: id.color,
          border: `1px solid color-mix(in srgb, ${id.color} 28%, transparent)`,
        }}
        aria-hidden
      >
        {id.icon}
      </div>
      {/* 消息体 */}
      <div style={MESSAGE_BODY_STYLE}>
        <div style={MESSAGE_HEADER_STYLE}>
          <span style={{ ...LAYER_NAME_STYLE, color: id.color }}>{id.short}</span>
          {displayName ? (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 3,
                background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                color: 'var(--accent)',
                maxWidth: 80,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={displayName}
            >
              {displayName}
            </span>
          ) : null}
          <span style={STREAMING_INDICATOR_STYLE}>
            <span style={STREAMING_DOTS_STYLE}>
              <span style={{ ...STREAMING_DOT_STYLE, animationDelay: '0ms' }} />
              <span style={{ ...STREAMING_DOT_STYLE, animationDelay: '150ms' }} />
              <span style={{ ...STREAMING_DOT_STYLE, animationDelay: '300ms' }} />
            </span>
            正在输入
          </span>
        </div>
        <div
          style={{
            ...MESSAGE_TEXT_FULL_STYLE,
            ...(isEmpty
              ? {
                  color: 'var(--fg-subtle)',
                  fontStyle: 'italic',
                }
              : {}),
          }}
        >
          {displayText}
        </div>
      </div>
    </div>
  );
}

// ─── 层级分隔条 ─────────────────────────────────────────────────────

function LayerDivider({
  layer,
  count,
  isActive,
  isHovered,
  displayName,
  onClick,
}: {
  layer: string;
  count: number;
  isActive: boolean;
  isHovered: boolean;
  displayName?: string | null;
  onClick: () => void;
}) {
  const id = getRoleLayerIdentity(layer);
  return (
    <div
      style={isHovered ? LAYER_DIVIDER_HOVER_STYLE : LAYER_DIVIDER_STYLE}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`选中${displayName ?? id.label}`}
    >
      <span style={{ fontSize: 12 }} aria-hidden>
        {id.icon}
      </span>
      <span style={{ color: id.color }}>{id.label}</span>
      {displayName ? (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: 3,
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
            color: 'var(--accent)',
            maxWidth: 100,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={displayName}
        >
          {displayName}
        </span>
      ) : null}
      {id.code && (
        <span
          style={{
            fontSize: 9,
            padding: '0 4px',
            borderRadius: 3,
            background: `color-mix(in srgb, ${id.color} 12%, transparent)`,
            color: id.color,
          }}
        >
          {id.code}
        </span>
      )}
      <span
        style={{
          ...COUNT_BADGE_STYLE,
          background: `color-mix(in srgb, ${id.color} 15%, transparent)`,
          color: id.color,
        }}
      >
        {count}
      </span>
      {isActive && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--accent)',
            marginLeft: 2,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--accent)',
              display: 'inline-block',
            }}
          />
          当前
        </span>
      )}
    </div>
  );
}

// ─── 主组件 ─────────────────────────────────────────────────────────

export function TeamLayerChatPanel({
  activeLayer,
  currentSessionId,
  layers,
  onOpenLayerSession,
  onLayerSelect,
}: TeamLayerChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const rafCleanupRef = useRef<(() => void) | null>(null);
  const historyExpansionRef = useRef(false);
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const previousHistoryContextRef = useRef<{
    layerSessionKey: string;
    totalMessages: number;
  } | null>(null);
  const [autoScroll, setAutoScrollState] = useState(true);
  const [hoveredDivider, setHoveredDivider] = useState<string | null>(null);

  const setAutoScroll = useCallback((value: boolean) => {
    autoScrollRef.current = value;
    setAutoScrollState(value);
  }, []);

  const flattenedMessages = useMemo(() => flattenLayerMessages(layers), [layers]);
  const totalHistoricalMessageCount = flattenedMessages.length;
  const layerSessionKey = useMemo(
    () => layers.map((layer) => `${layer.layer}:${layer.sessionIds.join(',')}`).join('|'),
    [layers],
  );
  const [visibleStartIndex, setVisibleStartIndex] = useState(() =>
    Math.max(totalHistoricalMessageCount - INITIAL_VISIBLE_MESSAGE_COUNT, 0),
  );

  useEffect(() => {
    const nextDefaultStart = Math.max(
      totalHistoricalMessageCount - INITIAL_VISIBLE_MESSAGE_COUNT,
      0,
    );
    const previousContext = previousHistoryContextRef.current;

    if (
      !previousContext ||
      previousContext.layerSessionKey !== layerSessionKey ||
      totalHistoricalMessageCount < previousContext.totalMessages
    ) {
      historyExpansionRef.current = false;
      setVisibleStartIndex(nextDefaultStart);
    } else if (
      totalHistoricalMessageCount > previousContext.totalMessages &&
      !historyExpansionRef.current
    ) {
      setVisibleStartIndex(nextDefaultStart);
    }

    previousHistoryContextRef.current = {
      layerSessionKey,
      totalMessages: totalHistoricalMessageCount,
    };
  }, [layerSessionKey, totalHistoricalMessageCount]);

  const visibleMessages = useMemo(
    () => flattenedMessages.slice(visibleStartIndex),
    [flattenedMessages, visibleStartIndex],
  );
  const messageGroups = useMemo(
    () => buildMessageGroups(visibleMessages, layers),
    [layers, visibleMessages],
  );
  const lastVisibleGroupIndexBySession = useMemo(() => {
    const groupIndexMap = new Map<string, number>();
    messageGroups.forEach((group, index) => {
      groupIndexMap.set(group.sessionId, index);
    });
    return groupIndexMap;
  }, [messageGroups]);
  const layerMap = useMemo(() => {
    const map = new Map<string, LayerMessages>();
    for (const layer of layers) {
      // 用 sessionIds[0] 作为 key，因为同层可能有多个角色实例，
      // 每个 LayerMessages 条目代表一个独立角色实例。
      const key = layer.sessionIds[0] ?? layer.layer;
      map.set(key, layer);
    }
    return map;
  }, [layers]);

  const totalMessageCount = useMemo(
    () =>
      layers.reduce(
        (sum, layer) => sum + layer.messages.length + (layer.streamingMessage ? 1 : 0),
        0,
      ),
    [layers],
  );
  const activeLayerCount = useMemo(
    () => layers.filter((layer) => layer.messages.length > 0 || layer.streamingMessage).length,
    [layers],
  );
  const totalSessionCount = useMemo(
    () => layers.reduce((sum, layer) => sum + layer.sessionIds.length, 0),
    [layers],
  );
  const visibleStreamingCount = useMemo(
    () => layers.filter((layer) => layer.streamingMessage).length,
    [layers],
  );
  const visibleRenderedCount = visibleMessages.length + visibleStreamingCount;
  const hasHiddenHistory = visibleStartIndex > 0;
  const visibleWindowLabel = hasHiddenHistory
    ? `已显示最近 ${visibleRenderedCount} / ${totalMessageCount} 条消息`
    : `已显示全部 ${totalMessageCount} 条消息`;

  // 计算最后一条消息的 id + 内容长度作为「消息流是否变化」的稳定签名，
  // 即使 layers 引用因 React 重新渲染而变化，只要内容没变就不重复滚动；
  // 反过来如果内容变了（流式增量更新），签名一定变化，保证实时滚动。
  // 同时包含流式消息的 content 长度，确保流式 token 累积时也触发自动滚动。
  const lastMessageSignature = useMemo(() => {
    let base = '';
    if (totalMessageCount > 0) {
      let last: FlattenedMessage | undefined;
      for (const group of messageGroups) {
        if (group.messages.length > 0) {
          last = group.messages[group.messages.length - 1];
        }
      }
      if (last) {
        base = `${last.message.id}:${last.timestamp}:${last.message.content?.length ?? 0}`;
      }
    }
    // 追加流式消息签名：content 长度变化时触发滚动
    const streamingLayer = layers.find((l) => l.streamingMessage);
    if (streamingLayer?.streamingMessage) {
      const sm = streamingLayer.streamingMessage;
      base += `|streaming:${sm.content?.length ?? 0}`;
    }
    return base;
  }, [messageGroups, totalMessageCount, layers]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el) {
      return;
    }
    const delta = el.scrollHeight - anchor.scrollHeight;
    el.scrollTop = anchor.scrollTop + delta;
    prependAnchorRef.current = null;
  }, [messageGroups]);

  // 自动滚动到底部 —— 用双 rAF 确保在 DOM 布局完成后执行，
  // 避免高频流式更新时 scrollTop 赋值被后续重绘覆盖。
  useEffect(() => {
    if (!autoScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const doScroll = () => {
      el.scrollTop = el.scrollHeight;
    };
    const raf1 = requestAnimationFrame(() => {
      doScroll();
      // 第二帧再修正一次，防止内容高度异步增长导致滚动位置不够
      const raf2 = requestAnimationFrame(doScroll);
      rafCleanupRef.current = () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, [lastMessageSignature, totalMessageCount]);

  // 面板首次挂载或从隐藏变为显示时立即滚到底部
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听容器尺寸变化 —— 面板从 display:none 切换为可见（single→dual）时
  // 立即滚动到底部，避免用户看到的是历史消息位置而非最新消息。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let prevVisible = el.clientHeight > 0;
    const observer = new ResizeObserver(() => {
      const isVisible = el.clientHeight > 0;
      if (isVisible && !prevVisible && autoScrollRef.current) {
        // 容器从隐藏变为可见，立即滚到底
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
      prevVisible = isVisible;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const loadOlderMessages = useCallback(() => {
    if (visibleStartIndex <= 0 || prependAnchorRef.current) {
      return;
    }
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    prependAnchorRef.current = {
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    };
    historyExpansionRef.current = true;
    setVisibleStartIndex((current) => Math.max(0, current - LOAD_MORE_BATCH_SIZE));
  }, [visibleStartIndex]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop <= LOAD_MORE_SCROLL_THRESHOLD_PX) {
      loadOlderMessages();
    }
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(isNearBottom);
  }, [loadOlderMessages, setAutoScroll]);

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [setAutoScroll]);

  // 空态
  if (layers.length === 0 || totalMessageCount === 0) {
    return (
      <div style={PANEL_STYLE}>
        <div style={HEADER_STYLE}>
          <div style={HEADER_TITLE_STYLE}>
            <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
              <strong style={{ color: 'var(--fg-strong)', fontSize: 13 }}>团队消息汇总</strong>
              <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                所有层级的对话动态将在这里实时汇总
              </span>
            </span>
          </div>
        </div>
        <div style={EMPTY_STYLE}>
          <div>
            <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
            <div style={{ fontWeight: 700, color: 'var(--fg-muted)' }}>暂无消息</div>
            <div style={{ fontSize: 11, marginTop: 4, color: 'var(--fg-subtle)', lineHeight: 1.6 }}>
              团队开始工作后，各层级的消息会
              <br />
              在这里按时间汇总展示
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={PANEL_STYLE}>
      {/* 头部 */}
      <div style={HEADER_STYLE}>
        <div style={HEADER_TITLE_STYLE}>
          <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
            <strong style={{ color: 'var(--fg-strong)', fontSize: 13 }}>团队消息汇总</strong>
            <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
              所有层级对话按时间汇总，层级标识清晰不混合
            </span>
          </span>
        </div>
        <div style={METRIC_ROW_STYLE} aria-label="团队消息汇总指标">
          <span style={METRIC_PILL_STYLE}>
            <span>活跃层级</span>
            <strong style={{ color: 'var(--fg-strong)' }}>{activeLayerCount}</strong>
          </span>
          <span style={METRIC_PILL_STYLE}>
            <span>会话</span>
            <strong style={{ color: 'var(--fg-strong)' }}>{totalSessionCount}</strong>
          </span>
          <span style={METRIC_PILL_STYLE}>
            <span>消息</span>
            <strong style={{ color: 'var(--fg-strong)' }}>{totalMessageCount}</strong>
          </span>
        </div>
        <div style={WINDOW_SUMMARY_STYLE} aria-live="polite">
          <span>{visibleWindowLabel}</span>
          <span>
            {hasHiddenHistory ? `上滑继续加载更早 ${LOAD_MORE_BATCH_SIZE} 条` : '已展开完整历史'}
          </span>
        </div>
      </div>

      {/* 消息流 */}
      <div
        ref={scrollRef}
        style={SCROLL_STYLE}
        onScroll={handleScroll}
        role="log"
        aria-label="团队层级消息汇总"
        aria-live="polite"
      >
        {hasHiddenHistory ? (
          <div style={LOAD_MORE_HINT_STYLE}>上滑到顶部后自动加载更早消息</div>
        ) : null}
        {messageGroups.map((group, groupIdx) => {
          const groupKey = `group-${groupIdx}-${group.layer}-${groupIdx}`;
          const isActive = group.layer === activeLayer;
          // 用消息所属的 session 查找 layerData（每个角色实例独立）
          const layerData = layerMap.get(group.sessionId ?? '') ?? null;
          const sessionId = layerData
            ? getPrimarySessionId(layerData, currentSessionId)
            : (group.sessionId ?? null);
          // 流式消息只附加到该 session 当前最后一个可见 group，避免重复渲染。
          const shouldRenderStreaming =
            lastVisibleGroupIndexBySession.get(group.sessionId) === groupIdx;
          const streamingMsg = shouldRenderStreaming ? (layerData?.streamingMessage ?? null) : null;

          return (
            <div key={groupKey}>
              <LayerDivider
                layer={group.layer}
                count={group.messages.length + (streamingMsg ? 1 : 0)}
                isActive={isActive}
                isHovered={hoveredDivider === groupKey}
                displayName={layerData?.displayName}
                onClick={() => onLayerSelect?.(group.layer)}
              />
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                  padding: 0,
                }}
                onMouseEnter={() => setHoveredDivider(groupKey)}
                onMouseLeave={() => setHoveredDivider(null)}
              >
                {group.messages.map((item, msgIdx) => (
                  <LayerChatMessageCard
                    key={`${item.message.id}-${msgIdx}`}
                    message={item.message}
                    layer={group.layer}
                    sessionId={sessionId}
                    displayName={layerData?.displayName}
                    onOpenLayerSession={onOpenLayerSession}
                  />
                ))}
                {streamingMsg && (
                  <StreamingMessageCard
                    message={streamingMsg}
                    layer={group.layer}
                    displayName={layerData?.displayName}
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* 底部留白 */}
        <div style={{ flexShrink: 0, height: 4 }} />
      </div>

      {/* 滚动到底部按钮 */}
      {!autoScroll && (
        <button
          type="button"
          className="team-v2-control"
          style={SCROLL_BOTTOM_BTN_STYLE}
          onClick={scrollToBottom}
        >
          ↓ 最新消息
        </button>
      )}
    </div>
  );
}
