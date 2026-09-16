import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { SessionPermissionMode } from '@openAwork/shared';

/**
 * 工具调用审批方式档位：与 `@openAwork/shared` 的 `SessionPermissionMode`
 * 共用同一联合类型（平台单一事实来源），此处保留旧导出名避免消费端批量改名。
 */
export type ComposerPermissionMode = SessionPermissionMode;

/** 单个档位的展示信息：触发按钮与菜单项共用。 */
export interface ComposerPermissionModeOption {
  value: ComposerPermissionMode;
  label: string;
  description: string;
  /** 仅免审批档使用琥珀警示语义（warning），其余档位保持中性。 */
  tone?: 'warning';
}

export const COMPOSER_PERMISSION_MODE_OPTIONS: readonly [
  ComposerPermissionModeOption,
  ...ComposerPermissionModeOption[],
] = [
  { value: 'ask', label: '每次询问', description: '工具调用前先征求你的确认' },
  {
    value: 'auto-edit',
    label: '编辑自动',
    description: '文件编辑与写入自动执行；命令执行及其余工具仍需确认',
  },
  {
    value: 'yolo',
    label: '免审批（YOLO）',
    description: '跳过审批、直达结果；显式禁止的规则仍然生效',
    tone: 'warning',
  },
];

/** 浮层宽度 / 偏移 / 最大高度，与 `ChatComposer.css` 中 `.composer-permission-menu` 一致。 */
const MENU_WIDTH = 300;
const MENU_OFFSET = 8;
const MENU_MAX_HEIGHT = 320;

export interface ComposerPermissionModeSelectProps {
  value: ComposerPermissionMode;
  /** 选中新档位；首次切到免审批时会先在浮层内二次确认，不弹全局对话框。 */
  onChange: (next: ComposerPermissionMode) => void;
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
  className?: string;
  style?: CSSProperties;
}

type MenuPosition = { left: number; top: number; maxHeight: number };

/** 档位图标：免审批为闪电，编辑自动为铅笔，每次询问为盾牌；描边 / 填充由样式表按 data-glyph 统一处理。 */
function ModeGlyph({ mode }: { mode: ComposerPermissionMode }) {
  return (
    <svg aria-hidden="true" data-glyph={mode} width="12" height="12" viewBox="0 0 24 24">
      {mode === 'yolo' ? (
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      ) : mode === 'auto-edit' ? (
        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      ) : (
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zm-3-10l2 2 4-4" />
      )}
    </svg>
  );
}

/**
 * 输入框工具条左侧的「审批方式」档位选择器；首次切到免审批时先在浮层内联确认一次。
 */
export function ComposerPermissionModeSelect(props: ComposerPermissionModeSelectProps) {
  const options = COMPOSER_PERMISSION_MODE_OPTIONS;
  const { value, onChange, disabled = false, disabledReason, busy = false } = props;
  const { className, style } = props;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [confirming, setConfirming] = useState(false);
  /** 本次会话内是否已确认过免审批（仅组件状态，不持久化）。 */
  const [confirmedYolo, setConfirmedYolo] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const currentOption = options.find((option) => option.value === value) ?? options[0];
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const closeMenu = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  const selectOption = useCallback(
    (next: ComposerPermissionMode) => {
      if (next === value) return closeMenu();
      // 首次开启免审批时先内联确认，避免误触后工具调用直接跳过审批。
      if (next === 'yolo' && !confirmedYolo) {
        setConfirming(true);
        return;
      }
      closeMenu();
      onChange(next);
    },
    [closeMenu, confirmedYolo, onChange, value],
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover || typeof window === 'undefined') return;
    const rect = trigger.getBoundingClientRect();
    const measuredHeight = popover.offsetHeight;
    const maxLeft = Math.max(MENU_OFFSET, window.innerWidth - MENU_WIDTH - MENU_OFFSET);
    const left = Math.min(Math.max(MENU_OFFSET, rect.left), maxLeft);
    // 浮层始终锚定触发按钮：上下各预留 MENU_OFFSET 间距后，按可用空间决定展开方向。
    const spaceAbove = rect.top - MENU_OFFSET * 2;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_OFFSET * 2;
    // 优先向下展开；下方放不下测得高度、且上方更宽裕时才上翻。
    const placeAbove = spaceBelow < measuredHeight && spaceAbove > spaceBelow;
    // 高度上限取展开方向的可用空间；空间不足由 max-height + overflow-y 在盒内滚动吸收。
    const maxHeight = Math.max(
      MENU_OFFSET * 4,
      Math.min(MENU_MAX_HEIGHT, placeAbove ? spaceAbove : spaceBelow),
    );
    // 定位用「实际会渲染的高度」：盒高被上限压缩时不能按完整内容高度摆放。
    const height = Math.min(measuredHeight, maxHeight);
    const anchorTop = placeAbove ? rect.top - MENU_OFFSET - height : rect.bottom + MENU_OFFSET;
    // 仅做视口钳制：浮层允许覆盖消息区，但必须完整落在视口内（不再借输入框外壳做锚点）。
    const top = Math.max(
      MENU_OFFSET,
      Math.min(anchorTop, window.innerHeight - MENU_OFFSET - height),
    );

    setPosition((previous) =>
      previous &&
      Math.abs(previous.left - left) < 1 &&
      Math.abs(previous.top - top) < 1 &&
      previous.maxHeight === maxHeight
        ? previous
        : { left, top, maxHeight },
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    // 焦点进入菜单容器；方向键由容器接管，Escape 时再还给触发按钮。
    popoverRef.current?.focus();

    const handleViewportChange = () => updatePosition();
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !popoverRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        // 点击浮层外部关闭时，若焦点还在浮层内（键盘用户），先把焦点还给触发按钮。
        if (popoverRef.current?.contains(document.activeElement)) {
          triggerRef.current?.focus();
        }
        closeMenu();
      }
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    document.addEventListener('mousedown', handlePointerDown, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      document.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, [closeMenu, open, updatePosition]);

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        triggerRef.current?.focus();
        closeMenu();
        return;
      }
      // 确认行可见时不响应方向键 / Home / End；Enter/Space 始终交给原生按钮激活，容器不处理。
      if (confirming) return;
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const edgeIndex = event.key === 'Home' ? 0 : options.length - 1;
        setActiveIndex(edgeIndex);
        optionRefs.current[edgeIndex]?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (activeIndex + delta + options.length) % options.length;
      setActiveIndex(nextIndex);
      optionRefs.current[nextIndex]?.focus();
    },
    [activeIndex, closeMenu, confirming, options.length],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`composer-permission-trigger${className ? ` ${className}` : ''}`}
        data-tone={currentOption.tone ?? 'default'}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled && disabledReason ? disabledReason : currentOption.description}
        disabled={disabled || busy}
        style={style}
        onClick={() => {
          if (disabled || busy) return;
          if (open) return closeMenu();
          setConfirming(false);
          setActiveIndex(currentIndex);
          setOpen(true);
        }}
      >
        {busy && <span className="composer-permission-trigger__spinner" aria-hidden="true" />}
        <ModeGlyph mode={value} />
        <span className="composer-permission-trigger__label">{currentOption.label}</span>
        <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            aria-label="工具调用审批方式"
            tabIndex={-1}
            className="composer-permission-menu"
            onKeyDown={handleMenuKeyDown}
            style={position ? { ...position, opacity: 1 } : { opacity: 0 }}
          >
            {options.map((option, index) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={index === activeIndex ? 0 : -1}
                  data-active={index === activeIndex}
                  data-tone={option.tone ?? 'default'}
                  className="composer-permission-menu__item"
                  onClick={() => selectOption(option.value)}
                >
                  <ModeGlyph mode={option.value} />
                  <span className="composer-permission-menu__item-body">
                    <span className="composer-permission-menu__item-label">{option.label}</span>
                    <span className="composer-permission-menu__item-description">
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}

            {confirming && (
              <div className="composer-permission-menu__confirm">
                <span className="composer-permission-menu__confirm-text">
                  切换到免审批后，工具调用将跳过「每次询问」直接执行；显式禁止的规则仍然生效。
                </span>
                <div className="composer-permission-menu__confirm-actions">
                  <button
                    type="button"
                    className="composer-permission-menu__confirm-button"
                    onClick={() => {
                      // 取消后确认行会被移除：先把焦点还给触发按钮，避免焦点掉到 body。
                      triggerRef.current?.focus();
                      setConfirming(false);
                    }}
                  >
                    取消
                  </button>
                  <button
                    autoFocus
                    type="button"
                    className="composer-permission-menu__confirm-button composer-permission-menu__confirm-button--primary"
                    onClick={() => {
                      setConfirmedYolo(true);
                      closeMenu();
                      onChange('yolo');
                    }}
                  >
                    确认开启
                  </button>
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
