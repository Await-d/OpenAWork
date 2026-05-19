import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  /** Stable id used as React key. */
  id: string;
  /** Visible label (or `'-'` to render a separator via type='separator'). */
  label?: ReactNode;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Optional keyboard shortcut hint shown right-aligned. */
  shortcut?: string;
  /** Disable the item — still shown but unclickable. */
  disabled?: boolean;
  /** Mark the item as destructive (red text). */
  danger?: boolean;
  /** Click handler. Menu auto-closes after invocation. */
  onSelect?: () => void;
  /** Render as a divider line. `label` is ignored. */
  type?: 'item' | 'separator';
}

export interface ContextMenuProps {
  /** Anchor coordinates in viewport space (clientX/clientY from the event). */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Headless-style context menu rendered into a portal at <body>.
 *
 * - Auto-positions to stay within the viewport.
 * - Closes on outside click, Escape, scroll, or resize.
 * - Items can be a mix of action items and separators.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // Clamp the menu within the viewport once it has measured itself.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = x;
    let top = y;
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPos({ left, top });
  }, [x, y]);

  // Close on Escape, scroll, resize, and outside click.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handlePointerDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const handleScroll = () => onClose();

    // NOTE: we deliberately do NOT listen for `contextmenu` at the
    // document level. The same right-click that opens this menu also
    // bubbles up to document and would close the menu instantly. Right-
    // clicks outside the menu still close it via `mousedown`, which
    // browsers fire before `contextmenu`.
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleScroll);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleScroll);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  const handleSelect = useCallback(
    (item: ContextMenuItem) => {
      if (item.disabled || item.type === 'separator') return;
      onClose();
      // Defer to the next microtask so the close transition can settle
      // before the action runs (helps with focus-restore).
      queueMicrotask(() => item.onSelect?.());
    },
    [onClose],
  );

  const menu = (
    <div
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      style={{
        ...MENU_STYLE,
        left: pos.left,
        top: pos.top,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => {
        if (item.type === 'separator') {
          return <div key={item.id} role="separator" style={SEPARATOR_STYLE} />;
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => handleSelect(item)}
            style={{
              ...ITEM_STYLE,
              color: item.danger
                ? 'var(--danger, #d73a49)'
                : item.disabled
                  ? 'var(--text-3)'
                  : 'var(--text-1)',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              opacity: item.disabled ? 0.55 : 1,
            }}
            onMouseEnter={(e) => {
              if (item.disabled) return;
              (e.currentTarget as HTMLButtonElement).style.background =
                'color-mix(in oklch, var(--accent) 14%, transparent)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}>
              {item.icon ?? null}
            </span>
            <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
            {item.shortcut ? (
              <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 16 }}>
                {item.shortcut}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  return createPortal(menu, document.body);
}

const MENU_STYLE: CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  minWidth: 180,
  padding: 4,
  borderRadius: 8,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  boxShadow: '0 12px 28px color-mix(in oklch, var(--bg) 70%, transparent)',
  fontSize: 12,
  color: 'var(--text-1)',
  userSelect: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};

const ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 28,
  padding: '0 8px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  fontSize: 12,
  textAlign: 'left',
};

const SEPARATOR_STYLE: CSSProperties = {
  height: 1,
  margin: '4px 6px',
  background: 'var(--border-subtle)',
};
