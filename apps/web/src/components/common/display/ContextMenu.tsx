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
  /**
   * Rendering mode:
   * - `item` (default): clickable action row.
   * - `separator`: divider line, `label` ignored.
   * - `header`: non-clickable info row used to show context such as the
   *   target's full path. `hint` renders as a small caption above `label`,
   *   and the label text stays selectable so it can be copied by hand.
   */
  type?: 'item' | 'separator' | 'header';
  /** Small caption rendered above `label` when `type='header'`. */
  hint?: string;
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
      if (item.disabled || item.type === 'separator' || item.type === 'header') return;
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
        if (item.type === 'header') {
          const plainText = typeof item.label === 'string' ? item.label : undefined;
          return (
            <div key={item.id} role="presentation" style={HEADER_STYLE} title={plainText}>
              {item.hint ? <span style={HEADER_HINT_STYLE}>{item.hint}</span> : null}
              <span style={HEADER_TEXT_STYLE}>{item.label}</span>
            </div>
          );
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
                ? 'var(--danger)'
                : item.disabled
                  ? 'var(--fg-muted)'
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
              <span style={{ fontSize: 10, color: 'var(--fg-muted)', marginLeft: 16 }}>
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
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  boxShadow: '0 12px 28px var(--bg-base)',
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

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '6px 8px 7px',
  maxWidth: 360,
  // The surrounding menu disables text selection; re-enable it here so the
  // user can still highlight the path by hand (and so the row itself does
  // not look like a clickable action).
  userSelect: 'text',
  cursor: 'default',
};

const HEADER_HINT_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  userSelect: 'none',
};

const HEADER_TEXT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-default)',
  lineHeight: 1.5,
  overflowWrap: 'anywhere',
};
