/**
 * BaseSessionRow — 会话列表行的共享骨架组件
 *
 * 提供统一的行容器、标题行（图标 + 标题 + 时间）、副行（元信息 / hover 操作切换）、
 * 以及可选的扩展内容插槽。chat 和 team 两侧通过 props/children 注入各自的差异化内容。
 *
 * 设计方向：
 * - 通过背景色 + 边框 + 阴影区分 active/hover 态（无额外色条）
 * - 微妙的浮起效果（hover 时 translateY + shadow）
 * - 圆角 10px，柔和现代感
 * - transition 使用 cubic-bezier 缓动，手感更有弹性
 *
 * 视觉结构：
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [icon slot]  title ·······  [time ↔ hover 操作]      │  ← headRow（右侧槽位互斥显示）
 *   │ [meta slot]                                          │  ← metaRow（compact 时嵌在标题正下方）
 *   │ [extra slot]                                         │  ← optional
 *   └──────────────────────────────────────────────────────┘
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import './BaseSessionRow.css';

/** 触屏长按判定：按住 500ms 且位移不超过 8px 视为长按。 */
const LONG_PRESS_DELAY_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 8;

// ─── Density presets ─────────────────────────────────────────────────────────

export type BaseSessionRowDensity = 'compact' | 'cozy';

interface DensityTokens {
  rowGap: number;
  rowPadding: string;
  rowMargin: string;
  headGap: number;
  metaMinHeight: number;
}

const DENSITY: Record<BaseSessionRowDensity, DensityTokens> = {
  // 紧凑模式：chat 端使用，最大化每屏可见的会话条数
  compact: {
    rowGap: 0,
    rowPadding: '2px 6px',
    rowMargin: '0',
    headGap: 6,
    metaMinHeight: 14,
  },
  // 宽松模式：team 端使用，给进度条 / agent 头像留出呼吸空间
  cozy: {
    rowGap: 4,
    rowPadding: '7px 10px',
    rowMargin: '0 5px 2px',
    headGap: 8,
    metaMinHeight: 18,
  },
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const TITLE_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 12,
  lineHeight: '1.35',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const TIME_STYLE: CSSProperties = {
  flexShrink: 0,
  fontSize: 10,
  color: 'var(--fg-muted)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  lineHeight: '18px',
};

const META_ROW_BASE_STYLE: CSSProperties = {
  position: 'relative',
};

const ACTION_BTN_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 5,
  border: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BaseSessionRowAction {
  key: string;
  title: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export interface BaseSessionRowProps {
  /** 唯一标识 */
  sessionId: string;
  /** 标题文本 */
  title: string;
  /** 时间显示文本 */
  timeLabel?: string;
  /** 时间 tooltip */
  timeTitle?: string;
  /** 是否选中态 */
  active?: boolean;
  /** 是否 hover 态 */
  hovered?: boolean;
  /** 图标插槽（左侧 icon box） */
  icon?: ReactNode;
  /**
   * 前导插槽：渲染在 icon 之前（如子代理折叠箭头）。
   * 内部为按钮时，`isNestedInteractiveTarget` 会阻止触发行选择。
   */
  leadingSlot?: ReactNode;
  /** 元信息插槽（标题下方，非 hover 时显示） */
  meta?: ReactNode;
  /** 额外内容插槽（meta 行下方，始终显示） */
  extra?: ReactNode;
  /** hover 时显示的操作按钮 */
  actions?: BaseSessionRowAction[];
  /** 是否在 hover 时隐藏 meta 行（切换为 actions） */
  hideMetaOnHover?: boolean;
  /** 点击行 */
  onSelect?: (sessionId: string) => void;
  /** 右键菜单 */
  onContextMenu?: (event: MouseEvent, sessionId: string) => void;
  /**
   * 长按（触屏 / 触摸板）回调，参数为触发位置。
   * 用于在没有 hover 能力的设备上打开与右键等价的菜单。
   */
  onLongPress?: (position: { x: number; y: number }) => void;
  /** hover 状态变化 */
  onHoverChange?: (sessionId: string | null) => void;
  /** 鼠标进入时的预加载回调 */
  onPreload?: (sessionId: string) => void;
  /** 指针位置变化（用于恢复 hover） */
  onPointerPositionChange?: (position: { x: number; y: number } | null) => void;
  /** 自定义 data 属性 */
  dataState?: string;
  /** aria-label */
  ariaLabel?: string;
  /** 是否正在重命名 */
  renaming?: boolean;
  /** 重命名输入框内容 */
  renameValue?: string;
  /** 重命名输入框变化 */
  onRenameChange?: (value: string) => void;
  /** 提交重命名 */
  onRenameCommit?: (sessionId: string) => void;
  /**
   * 标题插槽：当提供时，替换默认的 `<span>{title}</span>` 渲染，
   * 用于注入 InlineEditor 等自定义标题组件。当外部 `renaming=true` 时，
   * 仍然显示内置的重命名 input（保持动作按钮触发的重命名流程正常工作）。
   */
  titleSlot?: ReactNode;
  /**
   * 行密度。compact = chat 端紧凑模式，cozy = team 端宽松模式（默认）。
   * 影响内边距、行间距、meta 行最小高度。
   */
  density?: BaseSessionRowDensity;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNestedInteractiveTarget(target: EventTarget | null): target is Element {
  return target instanceof Element && target.closest('button, input, textarea, select, a') !== null;
}

// ─── Action button ───────────────────────────────────────────────────────────

interface SessionActionButtonProps {
  action: BaseSessionRowAction;
  /** compact 模式下按钮更小，贴合浮层高度 */
  compact?: boolean;
  /** 操作区是否可见；不可见时移出 tab 序列 */
  visible: boolean;
}

function SessionActionButton({ action, compact = false, visible }: SessionActionButtonProps) {
  return (
    <button
      type="button"
      className="base-session-action-btn"
      data-danger={action.danger ? 'true' : undefined}
      onClick={(event) => {
        event.stopPropagation();
        action.onClick();
      }}
      tabIndex={visible ? 0 : -1}
      disabled={action.disabled}
      title={action.title}
      style={{
        ...ACTION_BTN_STYLE,
        ...(compact ? { width: 18, height: 16, borderRadius: 4 } : {}),
        color: action.danger ? 'var(--danger)' : ACTION_BTN_STYLE.color,
        opacity: action.disabled ? 0.45 : 1,
        cursor: action.disabled ? 'wait' : 'pointer',
      }}
    >
      {action.icon}
    </button>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BaseSessionRow({
  sessionId,
  title,
  timeLabel,
  timeTitle,
  active = false,
  hovered = false,
  icon,
  leadingSlot,
  meta,
  extra,
  actions,
  hideMetaOnHover = true,
  onSelect,
  onContextMenu,
  onLongPress,
  onHoverChange,
  onPreload,
  onPointerPositionChange,
  dataState,
  ariaLabel,
  renaming = false,
  renameValue,
  onRenameChange,
  onRenameCommit,
  titleSlot,
  density = 'cozy',
}: BaseSessionRowProps) {
  const tokens = DENSITY[density];
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (longPressTriggeredRef.current) {
      // 长按已打开菜单：抑制随后的 click，避免误触打开会话。
      longPressTriggeredRef.current = false;
      return;
    }
    if (isNestedInteractiveTarget(event.target)) return;
    onSelect?.(sessionId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isNestedInteractiveTarget(event.target)) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(sessionId);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onLongPress || event.button !== 0) return;
    if (isNestedInteractiveTarget(event.target)) return;

    const { clientX, clientY } = event;
    longPressTriggeredRef.current = false;
    longPressStartRef.current = { x: clientX, y: clientY };
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressTriggeredRef.current = true;
      onLongPress({ x: clientX, y: clientY });
    }, LONG_PRESS_DELAY_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = longPressStartRef.current;
    if (!start) return;
    if (
      Math.abs(event.clientX - start.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
      Math.abs(event.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE_PX
    ) {
      cancelLongPress();
    }
  };

  const showActions = hovered && !renaming && !!actions && actions.length > 0;
  const hasActions = !!actions && actions.length > 0;
  // 紧凑模式：meta 与标题视觉上紧贴，嵌入到标题所在的列里
  const inlineMeta = density === 'compact';
  const hasInlineMetaContent = inlineMeta && (!!meta || hasActions);
  const hasOuterMetaContent = !inlineMeta && (!!meta || hasActions);

  return (
    <div
      role="button"
      tabIndex={0}
      className="base-session-row"
      data-session-id={sessionId}
      data-session-state={dataState}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu?.(event, sessionId);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onMouseEnter={(event) => {
        onPreload?.(sessionId);
        onPointerPositionChange?.({ x: event.clientX, y: event.clientY });
        onHoverChange?.(sessionId);
      }}
      onMouseMove={(event) => {
        onPointerPositionChange?.({ x: event.clientX, y: event.clientY });
      }}
      onMouseLeave={() => {
        onPointerPositionChange?.(null);
        onHoverChange?.(null);
      }}
      onFocusCapture={() => {
        onPreload?.(sessionId);
        onHoverChange?.(sessionId);
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onHoverChange?.(null);
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.rowGap,
        padding: tokens.rowPadding,
        margin: tokens.rowMargin,
        borderRadius: 10,
        border: '1px solid transparent',
        cursor: 'pointer',
        transition:
          'background 160ms cubic-bezier(0.4, 0, 0.2, 1), border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
        position: 'relative',
        background: active
          ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-overlay))'
          : hovered
            ? 'color-mix(in srgb, var(--fg-muted) 5%, transparent)'
            : 'transparent',
        borderColor: active ? 'color-mix(in srgb, var(--accent) 28%, transparent)' : 'transparent',
        boxShadow: active
          ? '0 1px 6px color-mix(in srgb, var(--accent) 14%, transparent)'
          : hovered
            ? 'var(--shadow-sm)'
            : 'none',
        transform: hovered && !active ? 'translateY(-1px)' : 'translateY(0)',
      }}
      title={title}
      aria-current={active ? 'true' : undefined}
      aria-label={ariaLabel ?? title}
    >
      {/* Head row: icon + title (+ meta inline in compact) + time */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.headGap,
          minWidth: 0,
        }}
      >
        {leadingSlot}
        {icon}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: density === 'compact' ? 1 : 1,
            pointerEvents: 'none',
          }}
        >
          {renaming ? (
            <input
              className="session-rename-input"
              ref={(element) => element?.focus()}
              value={renameValue ?? ''}
              onChange={(event) => onRenameChange?.(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter' || event.key === 'Escape') {
                  onRenameCommit?.(sessionId);
                }
              }}
              onBlur={() => onRenameCommit?.(sessionId)}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'var(--bg-overlay)',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                padding: '3px 6px',
                color: 'var(--fg-strong)',
                fontSize: 12,
              }}
            />
          ) : (
            (titleSlot ?? (
              <span
                style={{
                  ...TITLE_STYLE,
                  lineHeight: density === 'compact' ? '1.25' : '1.35',
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--fg-strong)' : 'var(--fg-default)',
                  pointerEvents: 'auto',
                }}
              >
                {title}
              </span>
            ))
          )}

          {/* compact 模式下 meta 直接嵌入在标题正下方，与标题同 X 对齐；hover 操作位于标题行右侧槽位，不会与之重叠 */}
          {hasInlineMetaContent && !renaming && meta && (
            <div
              style={{
                position: 'relative',
                minHeight: 14,
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'auto',
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {meta}
              </span>
            </div>
          )}
        </div>
        {/*
          右侧槽位：时间与 hover 操作共用同一格（grid 叠放），
          槽位宽度取二者较大值 —— 既不会压住标题，也不会因 hover 导致行内宽度抖动。
        */}
        {(timeLabel || (inlineMeta && hasActions)) && (
          <div
            style={{
              flexShrink: 0,
              alignSelf: 'flex-start',
              display: 'grid',
              gridTemplateAreas: '"slot"',
              justifyItems: 'end',
              alignItems: 'center',
              height: 18,
            }}
          >
            {timeLabel && (
              <span
                style={{
                  ...TIME_STYLE,
                  gridArea: 'slot',
                  opacity: inlineMeta && showActions ? 0 : 1,
                  transition: 'opacity 120ms ease-out',
                }}
                title={timeTitle}
              >
                {timeLabel}
              </span>
            )}
            {inlineMeta && hasActions && (
              <div
                className="session-actions"
                style={{
                  gridArea: 'slot',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: 2,
                  height: 16,
                  opacity: showActions ? 1 : 0,
                  transform: showActions ? 'translateY(0)' : 'translateY(2px)',
                  transition: 'opacity 120ms ease-out, transform 120ms ease-out',
                  pointerEvents: showActions ? 'auto' : 'none',
                  willChange: 'opacity, transform',
                }}
              >
                {actions!.map((action) => (
                  <SessionActionButton
                    key={action.key}
                    action={action}
                    compact
                    visible={showActions}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 非 compact 模式时才使用外层 meta 行 */}
      {hasOuterMetaContent && (
        <div style={{ ...META_ROW_BASE_STYLE, minHeight: tokens.metaMinHeight }}>
          {meta && (
            <span
              style={{
                position: hideMetaOnHover ? 'absolute' : 'relative',
                inset: hideMetaOnHover ? 0 : undefined,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                opacity: hideMetaOnHover && showActions ? 0 : 1,
                transition: 'opacity 120ms ease-out',
                pointerEvents: hideMetaOnHover && showActions ? 'none' : 'auto',
                willChange: 'opacity',
              }}
            >
              {meta}
            </span>
          )}
          {hasActions && (
            <div
              className="session-actions"
              style={{
                position: hideMetaOnHover ? 'absolute' : 'relative',
                inset: hideMetaOnHover ? 0 : undefined,
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 4,
                alignItems: 'center',
                opacity: showActions ? 1 : 0,
                transition: 'opacity 120ms ease-out',
                pointerEvents: showActions ? 'auto' : 'none',
                willChange: 'opacity',
              }}
            >
              {actions!.map((action) => (
                <SessionActionButton key={action.key} action={action} visible={showActions} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Extra slot */}
      {extra}
    </div>
  );
}

// ─── Shared Icons ────────────────────────────────────────────────────────────

export const RenameIcon = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

export const ExportIcon = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const DeleteIcon = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export { ACTION_BTN_STYLE as baseSessionActionButtonStyle };
