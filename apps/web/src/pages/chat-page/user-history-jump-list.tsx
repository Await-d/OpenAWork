import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { ChatMessage } from '../../components/session-conversation/runtime/support.js';

/**
 * UserHistoryJumpList · chat-only 右侧浮动跳转栏
 *
 * 默认折叠：贴在主对话区右侧只显示一条窄带 + 项数徽章；鼠标移入或点击
 * 展开成完整的卡片列表，移开后自动收起，避免长时间占据右侧视图遮挡
 * 消息内容。展开/折叠用 CSS transform + opacity 过渡，保留鼠标 hover
 * 的「悬停意图」延时，防止在 stripe 边缘进出抖动反复展开。
 *
 * 跳转策略：复用聊天搜索浮层的同一套机制 — 通过 `data-message-id` 选择
 * 器在 `scrollRegionRef` 里定位 user 消息节点，平滑滚动到中央并打一个
 * 短暂的 `data-search-flash` 高亮（`chat-message.css` 里已经定义了这个
 * 状态的视觉反馈）。
 *
 * 当目标消息节点不在 DOM 中(被分页裁掉了 / 服务端还没拉过来)时调用
 * `ensureMessageVisible` 让 ChatPage 扩大可见窗口或重载 snapshot。
 */

export interface UserHistoryJumpItem {
  messageId: string;
  /** 卡片主标题：消息文本第一行，已截断。 */
  preview: string;
  /** 鼠标悬停时显示的完整文本（截断到合理上限）。 */
  fullPreview: string;
  /** 卡片下方的辅助说明，例如时间或字符数。 */
  meta: string;
  /** 在 messages 数组中的顺序索引，从 1 开始；用于卡片左侧编号。 */
  ordinal: number;
}

const MAX_PREVIEW_LENGTH = 38;
const MAX_TITLE_LENGTH = 160;
const FLASH_DURATION_MS = 1200;
/**
 * 鼠标移开后再过这么久才真正折叠 — 用户在 stripe / 卡片之间快速划过
 * 不应该把面板抖到收起。
 */
const COLLAPSE_DELAY_MS = 240;

function formatTimeLabel(value: number | string | undefined): string {
  if (value === undefined) return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  if (sameDay) {
    return `${hours}:${minutes}`;
  }
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

function truncateToMax(value: string, max: number): string {
  const normalized = value.trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1)}…`;
}

function pickFirstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return text.trim();
}

export function buildUserHistoryJumpItems(messages: ChatMessage[]): UserHistoryJumpItem[] {
  const items: UserHistoryJumpItem[] = [];
  let ordinal = 0;

  for (const message of messages) {
    if (message.role !== 'user') continue;
    const baseText = (message.content ?? '').toString();
    const firstLine = pickFirstNonEmptyLine(baseText);
    if (firstLine.length === 0) {
      // 纯附件 / 纯图片消息也要给一个占位条目，方便跳回去查看上下文。
      ordinal += 1;
      const time = formatTimeLabel(message.createdAt);
      items.push({
        messageId: message.id,
        preview: '（无文本）',
        fullPreview: '（无文本：仅附件 / 图片）',
        meta: time,
        ordinal,
      });
      continue;
    }

    ordinal += 1;
    const preview = truncateToMax(firstLine, MAX_PREVIEW_LENGTH);
    const fullPreview = truncateToMax(baseText.replace(/\s+/gu, ' '), MAX_TITLE_LENGTH);
    const time = formatTimeLabel(message.createdAt);
    const charLength = baseText.trim().length;
    const lengthLabel = charLength > MAX_PREVIEW_LENGTH ? `${charLength} 字` : '';
    const meta = [time, lengthLabel].filter((segment) => segment.length > 0).join(' · ');

    items.push({
      messageId: message.id,
      preview,
      fullPreview,
      meta,
      ordinal,
    });
  }

  return items;
}

const CONTAINER_STYLE: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 10,
  pointerEvents: 'auto',
};

/** 折叠态:窄竖条 + 数字徽章 + 提示文字。永远占据微小空间,不挡内容。 */
const COLLAPSED_STRIPE_STYLE: CSSProperties = {
  width: 22,
  minHeight: 96,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '10px 2px',
  borderRadius: '10px 0 0 10px',
  border: '1px solid var(--border-subtle)',
  borderRight: 'none',
  background: 'color-mix(in oklch, var(--surface) 88%, transparent)',
  color: 'var(--text-3)',
  cursor: 'pointer',
  // stripe 自身的反馈 — 跟 panel 进入动画区分。出场时配合 panel 一并淡出。
  transition:
    'background 200ms ease, color 200ms ease, transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease',
  willChange: 'transform, opacity',
};

const COLLAPSED_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  borderRadius: 999,
  background: 'color-mix(in oklch, var(--accent) 18%, var(--surface))',
  color: 'var(--accent)',
  fontSize: 9,
  fontWeight: 700,
  lineHeight: 1,
};

const COLLAPSED_LABEL_STYLE: CSSProperties = {
  writingMode: 'vertical-rl',
  textOrientation: 'mixed',
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'var(--text-2)',
  whiteSpace: 'nowrap',
};

const EXPANDED_PANEL_BASE_STYLE: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: '50%',
  width: 200,
  maxHeight: '70vh',
  display: 'flex',
  flexDirection: 'column',
  padding: '10px 8px 10px 10px',
  borderRadius: '10px 0 0 10px',
  border: '1px solid var(--border-subtle)',
  borderRight: 'none',
  background: 'color-mix(in oklch, var(--surface) 96%, transparent)',
  boxShadow: '-8px 0 32px rgba(0,0,0,0.18)',
  backdropFilter: 'blur(10px)',
  overflow: 'hidden',
  transformOrigin: '100% 50%',
  // 切换:transform(滑入 + 缩放)+ opacity 同步缓动,cubic-bezier 给一点
  // overshoot 视觉,比线性更"灵动";收起延后 visibility 切换避免硬切。
  transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms ease',
  willChange: 'transform, opacity',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '0 4px 6px',
};

const HEADER_TITLE_STYLE: CSSProperties = {
  fontSize: 9,
  fontWeight: 800,
  color: 'var(--text-2)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const HEADER_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 5px',
  borderRadius: 999,
  border: '1px solid var(--border-subtle)',
  background: 'color-mix(in oklch, var(--surface) 82%, transparent)',
  fontSize: 8,
  fontWeight: 700,
  color: 'var(--text-3)',
};

const SCROLLER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  overflowY: 'auto',
  scrollbarWidth: 'thin',
  paddingRight: 2,
};

function UserHistoryItemCard({
  item,
  selected,
  onSelect,
}: {
  item: UserHistoryJumpItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={item.fullPreview}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '5px 7px',
        borderRadius: 8,
        border: selected
          ? '1px solid color-mix(in oklch, var(--accent) 50%, var(--border-subtle))'
          : '1px solid transparent',
        background: selected
          ? 'color-mix(in oklch, var(--surface) 84%, var(--accent) 16%)'
          : 'transparent',
        color: 'var(--text)',
        boxShadow: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'background 140ms ease, border-color 140ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 16,
            height: 14,
            padding: '0 4px',
            borderRadius: 999,
            border: '1px solid var(--border-subtle)',
            background: selected
              ? 'color-mix(in oklch, var(--accent) 22%, var(--surface))'
              : 'color-mix(in oklch, var(--surface) 82%, transparent)',
            color: selected ? 'var(--accent)' : 'var(--text-3)',
            fontSize: 8.5,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {item.ordinal}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: selected ? 'var(--text)' : 'var(--text-2)',
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {item.preview}
        </span>
      </div>
      {item.meta && (
        <div
          style={{
            paddingLeft: 21,
            fontSize: 8.5,
            color: 'var(--text-3)',
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.meta}
        </div>
      )}
    </button>
  );
}

interface UserHistoryJumpListProps {
  items: UserHistoryJumpItem[];
  scrollRegionRef: RefObject<HTMLDivElement | null>;
  /**
   * 当目标消息节点不在 DOM 中(因为分页加载只渲染了最近 N 条 / 服务端
   * 还没拉过来),这里负责把它「弄出来」:扩大 visibleMessageCount、
   * 必要时拉一次 snapshot。返回 promise 让我们在节点真的出现后再
   * 滚动 — 否则跳转就会静默失败,用户感觉「点了没反应」。
   */
  ensureMessageVisible?: (messageId: string) => Promise<void> | void;
}

export function UserHistoryJumpList({
  items,
  scrollRegionRef,
  ensureMessageVisible,
}: UserHistoryJumpListProps) {
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const flashTimerRef = useRef<number | null>(null);
  const lastFlashedRef = useRef<HTMLElement | null>(null);
  const collapseTimerRef = useRef<number | null>(null);

  const orderedItems = useMemo(() => items, [items]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
      if (lastFlashedRef.current) {
        lastFlashedRef.current.removeAttribute('data-search-flash');
        lastFlashedRef.current = null;
      }
    };
  }, []);

  const cancelCollapseTimer = (): void => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  };

  const scheduleCollapse = (): void => {
    cancelCollapseTimer();
    collapseTimerRef.current = window.setTimeout(() => {
      setExpanded(false);
      collapseTimerRef.current = null;
    }, COLLAPSE_DELAY_MS);
  };

  const focusMessage = async (messageId: string) => {
    const region = scrollRegionRef.current;
    if (!region) return;

    setActiveMessageId(messageId);

    let target = region.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);

    // Node missing → ask the host to expand pagination / load more,
    // then poll briefly for the node to appear. We bound the wait so
    // a missing message id can't hang the click forever.
    if (!target && ensureMessageVisible) {
      try {
        await ensureMessageVisible(messageId);
      } catch {
        /* swallow — fallthrough to a final lookup */
      }
      const deadlineMs = performance.now() + 1500;
      while (!target && performance.now() < deadlineMs) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        target = region.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
      }
    }
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    if (lastFlashedRef.current && lastFlashedRef.current !== target) {
      lastFlashedRef.current.removeAttribute('data-search-flash');
    }
    target.setAttribute('data-search-flash', 'true');
    lastFlashedRef.current = target;
    flashTimerRef.current = window.setTimeout(() => {
      target.removeAttribute('data-search-flash');
      if (lastFlashedRef.current === target) {
        lastFlashedRef.current = null;
      }
      flashTimerRef.current = null;
    }, FLASH_DURATION_MS);
  };

  if (orderedItems.length === 0) {
    return null;
  }

  return (
    <aside
      aria-label="历史输入快速跳转"
      style={CONTAINER_STYLE}
      onMouseEnter={() => {
        cancelCollapseTimer();
        setExpanded(true);
      }}
      onMouseLeave={scheduleCollapse}
    >
      {/* Collapsed stripe — 始终渲染,通过 opacity/visibility 切换 */}
      <button
        type="button"
        aria-label={`展开历史输入(共 ${orderedItems.length} 条)`}
        title={`历史输入 · ${orderedItems.length} 条 · 鼠标悬停展开`}
        onClick={() => {
          cancelCollapseTimer();
          setExpanded(true);
        }}
        style={{
          ...COLLAPSED_STRIPE_STYLE,
          opacity: expanded ? 0 : 1,
          // 折叠状态可点击,展开后让出指针给面板。
          pointerEvents: expanded ? 'none' : 'auto',
          transform: expanded ? 'translateX(8px)' : 'translateX(0)',
        }}
      >
        <span style={COLLAPSED_LABEL_STYLE}>历史输入</span>
        <span style={COLLAPSED_BADGE_STYLE}>{orderedItems.length}</span>
      </button>

      {/* Expanded panel — 始终挂载,折叠时滑出 + 淡出 + 微缩放,营造从
        stripe 弹出的"延展"感而非硬切。 */}
      <div
        aria-hidden={!expanded}
        style={{
          ...EXPANDED_PANEL_BASE_STYLE,
          opacity: expanded ? 1 : 0,
          transform: expanded ? 'translate(0, -50%) scale(1)' : 'translate(20px, -50%) scale(0.94)',
          pointerEvents: expanded ? 'auto' : 'none',
          // 收起时让 visibility 在 transition 结束后再切,避免子节点
          // 在还没淡出时就被 hidden 截断;展开瞬时 visible。
          visibility: expanded ? 'visible' : 'hidden',
          transitionProperty: 'transform, opacity, visibility',
          transitionDuration: '320ms, 240ms, 0ms',
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1), ease, linear',
          transitionDelay: expanded ? '0ms, 0ms, 0ms' : '0ms, 0ms, 320ms',
        }}
      >
        <div style={HEADER_STYLE}>
          <div style={HEADER_TITLE_STYLE}>历史输入</div>
          <span style={HEADER_BADGE_STYLE}>{orderedItems.length}</span>
          <span style={{ flex: 1 }} aria-hidden="true" />
          <button
            type="button"
            onClick={() => {
              cancelCollapseTimer();
              setExpanded(false);
            }}
            aria-label="折叠历史输入"
            title="折叠"
            style={{
              width: 18,
              height: 18,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-3)',
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ›
          </button>
        </div>
        <div style={SCROLLER_STYLE}>
          {orderedItems.map((item, index) => {
            // 错峰滑入:每条延迟 24ms,前 8 条按序进场,后续不再加额外延时,
            // 防止列表很长时尾部卡片久久不出现。
            const stagger = expanded ? Math.min(index, 8) * 24 : 0;
            return (
              <div
                key={item.messageId}
                style={{
                  opacity: expanded ? 1 : 0,
                  transform: expanded ? 'translateX(0)' : 'translateX(12px)',
                  transition: `opacity 260ms ease ${stagger}ms, transform 320ms cubic-bezier(0.22, 1, 0.36, 1) ${stagger}ms`,
                  willChange: 'transform, opacity',
                }}
              >
                <UserHistoryItemCard
                  item={item}
                  selected={activeMessageId === item.messageId}
                  onSelect={() => {
                    void focusMessage(item.messageId);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
